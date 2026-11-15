from __future__ import annotations
import csv, io, os, math
from datetime import date, timedelta
from dotenv import load_dotenv
from flask import Flask, jsonify, request, render_template
import requests
import numpy as np
import pandas as pd

# Cargar las variables de entorno
load_dotenv()

APP_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__)
BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
SOURCES = {
    "modis": {"nrt": ["MODIS_NRT"], "sp": ["MODIS_SP"]},
    "viirs": {
        "nrt": ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"],
        "sp": ["VIIRS_SNPP_SP", "VIIRS_NOAA20_SP", "VIIRS_NOAA21_SP"],
    },
}
ARGENTINA_BBOX = "-73.6,-55.1,-53.6,-21.8"

MODIS_2025_ARGENTINA = os.path.join(
    APP_DIR, "data", "modis", "modis_2025_Argentina.csv"
)
VIIRS_2025_ARGENTINA = os.path.join(
    APP_DIR, "data", "viirs", "viirs-jpss1_2025_Argentina.csv"
)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/weather")
def weather():
    try:
        lat = float(request.args["lat"])
        lon = float(request.args["lon"])
    except (KeyError, ValueError, TypeError):
        return jsonify(error="Ingresá coordenadas válidas."), 400
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return jsonify(error="Coordenadas fuera de rango."), 400

    username = os.getenv("METEOMATICS_USER", "").strip()
    password = os.getenv("METEOMATICS_PASSWORD", "")
    if not username or not password:
        return (
            jsonify(
                error="Faltan configurar METEOMATICS_USER y METEOMATICS_PASSWORD."
            ),
            503,
        )

    parameters = "t_2m:C,relative_humidity_2m:p,wind_speed_10m:kmh,precip_1h:mm"
    url = (
        f"https://api.meteomatics.com/now/{parameters}/"
        f"{lat:.4f},{lon:.4f}/json"
    )
    try:
        response = requests.get(url, auth=(username, password), timeout=15)
    except requests.RequestException:
        app.logger.exception("No se pudo conectar con Meteomatics")
        return jsonify(error="No se pudo conectar con Meteomatics (red o timeout)."), 502

    if not response.ok:
        detail = response.text[:500]
        app.logger.error(
            "Meteomatics respondió HTTP %s: %s", response.status_code, detail
        )
        if response.status_code in (401, 403):
            message = (
                f"Meteomatics rechazó la autenticación (HTTP {response.status_code}). "
                "Verificá METEOMATICS_USER y METEOMATICS_PASSWORD."
            )
        elif response.status_code == 400:
            message = (
                "Meteomatics rechazó la solicitud (HTTP 400). "
                "Revisá los parámetros y sus unidades."
            )
            details = " ".join(response.text.split())
            if details:
                message = f"{message} Detalle: {details[:300]}"
        elif response.status_code == 429:
            message = (
                "Meteomatics indicó que se alcanzó un límite de uso (HTTP 429)."
            )
        else:
            message = f"Meteomatics respondió HTTP {response.status_code}."
        return jsonify(error=message), 502

    try:
        data = response.json()
    except ValueError:
        app.logger.error("Meteomatics respondió con contenido que no es JSON")
        return jsonify(error="Meteomatics no devolvió una respuesta JSON válida."), 502

    if not isinstance(data, dict) or not isinstance(data.get("data"), list):
        app.logger.error("Meteomatics devolvió una respuesta con formato inválido")
        return jsonify(error="Meteomatics devolvió datos con formato inválido."), 502
    return jsonify(data=data["data"])


def num(row, *keys):
    for k in keys:
        try:
            if row.get(k) not in (None, ""):
                return float(row[k])
        except (TypeError, ValueError):
            pass
    return None


def consultar_firms(key, sources, bbox, days, start):
    records = []
    errors = []
    for source in sources:
        url = f"{BASE}/{key}/{source}/{bbox}/{days}/{start.isoformat()}"
        try:
            resp = requests.get(url, timeout=45)
            if resp.status_code != 200:
                errors.append(f"{source}: HTTP {resp.status_code}")
                continue
            text = resp.text.strip()
            if not text or text.lower().startswith(("invalid", "error", "<html")):
                errors.append(f"{source}: respuesta vacía/no válida")
                continue
            for row in csv.DictReader(io.StringIO(text)):
                r = {str(k).lower().strip(): v for k, v in row.items() if k}
                la = num(r, "latitude", "lat")
                lo = num(r, "longitude", "lon")
                if (
                    la is None
                    or lo is None
                    or not (-90 <= la <= 90 and -180 <= lo <= 180)
                ):
                    continue
                records.append(
                    {
                        "latitude": la,
                        "longitude": lo,
                        "acq_date": r.get("acq_date", r.get("date", "")),
                        "acq_time": r.get("acq_time", ""),
                        "satellite": "MODIS" if source.startswith("MODIS") else "VIIRS",
                        "source": source,
                        "platform": r.get("satellite", source),
                        "confidence": r.get("confidence", ""),
                        "frp": num(r, "frp"),
                        "daynight": r.get("daynight", ""),
                        "isDemo": False,
                    }
                )
        except requests.RequestException as e:
            errors.append(f"{source}: {type(e).__name__}")
    return records, errors


def deduplicar_focos(records):
    unique = {}
    for record in records:
        key = (
            record["latitude"],
            record["longitude"],
            record["acq_date"],
            record["acq_time"],
            record["source"],
            record["platform"],
        )
        unique[key] = record
    return list(unique.values())


# Endpoint para obtener detecciones de incendios satelitales
@app.get("/api/fires")
def fires():
    key = os.getenv("FIRMS_MAP_KEY", "").strip()

    if not key:
        return (
            jsonify(error="Falta configurar FIRMS_MAP_KEY en el entorno del servidor."),
            503,
        )

    try:
        lat = float(request.args["lat"])
        lon = float(request.args["lon"])
        radius = float(request.args.get("radius", 100))
        days = int(request.args.get("days", 5))
        start = date.fromisoformat(request.args["date"])
    except (KeyError, ValueError, TypeError):
        return jsonify(error="Parámetros inválidos: coordenadas, fecha o días."), 400
    if (
        not (-90 <= lat <= 90 and -180 <= lon <= 180)
        or not (1 <= days <= 5)
        or not (1 <= radius <= 20000)
    ):
        return (
            jsonify(error="Coordenadas, radio o cantidad de días fuera de rango."),
            400,
        )
    if start > date.today() + timedelta(days=1):
        return jsonify(error="La fecha no puede estar en el futuro."), 400
    dlat = radius / 111
    dlon = radius / (111 * max(0.15, abs(math.cos(math.radians(lat)))))
    bbox = f"{max(-180,lon-dlon):.4f},{max(-90,lat-dlat):.4f},{min(180,lon+dlon):.4f},{min(90,lat+dlat):.4f}"
    sources = []
    # NRT para fechas recientes; Standard Processing para fechas históricas.
    processing = "nrt" if start >= date.today() - timedelta(days=5) else "sp"
    if request.args.get("modis") == "1":
        sources += SOURCES["modis"][processing]
    if request.args.get("viirs") == "1":
        sources += SOURCES["viirs"][processing]
    if not sources:
        return jsonify(error="Activá al menos un sensor."), 400
    records, errors = consultar_firms(key, sources, bbox, days, start)
    if not records and errors:
        return jsonify(error="NASA FIRMS no devolvió datos. " + "; ".join(errors)), 502
    return jsonify(
        records=deduplicar_focos(records),
        sources=sources,
        processing=processing,
        errors=errors,
        bbox=bbox,
        requested_date=start.isoformat(),
        days=days,
        note="Detecciones satelitales; no equivalen necesariamente a incendios únicos.",
    )


@app.get("/api/fires/today")
def fires_today():
    key = os.getenv("FIRMS_MAP_KEY", "").strip()
    if not key:
        return (
            jsonify(error="Falta configurar FIRMS_MAP_KEY en el entorno del servidor."),
            503,
        )

    today = date.today()
    sources = SOURCES["modis"]["nrt"] + SOURCES["viirs"]["nrt"]
    records, errors = consultar_firms(key, sources, ARGENTINA_BBOX, 1, today)
    if not records and errors:
        return jsonify(error="NASA FIRMS no devolvió datos. " + "; ".join(errors)), 502

    return jsonify(
        records=deduplicar_focos(records),
        sources=sources,
        processing="nrt",
        errors=errors,
        bbox=ARGENTINA_BBOX,
        requested_date=today.isoformat(),
        days=1,
        note=(
            "Detecciones satelitales del día sobre un rectángulo geográfico "
            "aproximado de Argentina; pueden incluir zonas fronterizas."
        ),
    )


@app.get("/api/fires/summary")
def summary():
    resumenes = []
    for sensor, ruta_csv in (
        ("MODIS", MODIS_2025_ARGENTINA),
        ("VIIRS", VIIRS_2025_ARGENTINA),
    ):
        resumen = procesar_datos_fuegos(ruta_csv)
        resumen["sensor"] = sensor
        resumenes.extend(resumen.to_dict(orient="records"))
    return jsonify(resumenes)


@app.get("/api/fires/records")
def historical_records():
    requested_date = request.args.get("date", "")
    try:
        selected_date = date.fromisoformat(requested_date)
    except ValueError:
        return jsonify(error="La fecha debe tener formato AAAA-MM-DD."), 400
    if selected_date.isoformat() != requested_date:
        return jsonify(error="La fecha debe tener formato AAAA-MM-DD."), 400

    records = []
    columns = ["latitude", "longitude", "acq_date", "satellite", "confidence", "frp"]
    for sensor, ruta_csv in (
        ("MODIS", MODIS_2025_ARGENTINA),
        ("VIIRS", VIIRS_2025_ARGENTINA),
    ):
        df = pd.read_csv(ruta_csv, usecols=columns)
        df["acq_date"] = pd.to_datetime(df["acq_date"], errors="coerce").dt.strftime(
            "%Y-%m-%d"
        )
        df["frp"] = pd.to_numeric(df["frp"], errors="coerce")
        daily = df[(df["acq_date"] == requested_date) & (df["frp"] > 0)]
        for row in daily.to_dict(orient="records"):
            latitude = num(row, "latitude")
            longitude = num(row, "longitude")
            if (
                latitude is None
                or longitude is None
                or not (-90 <= latitude <= 90 and -180 <= longitude <= 180)
            ):
                continue
            platform = row["satellite"]
            confidence = row["confidence"]
            records.append(
                {
                    "latitude": latitude,
                    "longitude": longitude,
                    "acq_date": requested_date,
                    "satellite": sensor,
                    "sensor": sensor,
                    "platform": "" if pd.isna(platform) else str(platform),
                    "confidence": "" if pd.isna(confidence) else str(confidence),
                    "frp": num(row, "frp"),
                    "isDemo": False,
                }
            )
    return jsonify(records=records, requested_date=requested_date)


def procesar_datos_fuegos(ruta_csv):
    # Cargar datos de FIRMS (MODIS y VIIRS combinados)
    df = pd.read_csv(ruta_csv)

    # 1. Limpieza y formateo de fechas
    df["acq_date"] = pd.to_datetime(df["acq_date"])
    df["year"] = df["acq_date"].dt.year
    df["month"] = df["acq_date"].dt.month
    df["day"] = df["acq_date"].dt.day

    # 2. Filtrado de calidad (descartar baja confianza o ruido industrial si aplica)
    # Nota: En VIIRS la confianza suele ser 'l', 'n', 'h' o numérica en algunas versiones.
    # Aquí filtramos por umbrales lógicos de potencia radiativa (FRP > 0)
    df = df[df["frp"] > 0]

    # 3. Armonización opcional: Ponderar por FRP para equilibrar la diferencia de resolución
    # (VIIRS detecta fuegos más chicos que MODIS ignoraba; usar FRP suaviza la métrica de intensidad)
    resumen_calendario = (
        df.groupby(["year", "month", "day"])
        .agg(
            cantidad_hotspots=("latitude", "count"),
            energia_total_frp=("frp", "sum"),
            frp_promedio=("frp", "mean"),
        )
        .reset_index()
    )

    # 4. Calcular la mediana histórica por mes (para detectar anomalías)
    # Ej: ¿Cuánto se quema típicamente en un mes de Septiembre?
    mediana_historica = (
        resumen_calendario.groupby("month")["cantidad_hotspots"]
        .median()
        .reset_index(name="mediana_historica")
    )

    resumen_calendario = resumen_calendario.merge(
        mediana_historica, on="month", how="left"
    )
    resumen_calendario["anomalia_porcentual"] = (
        (
            resumen_calendario["cantidad_hotspots"]
            - resumen_calendario["mediana_historica"]
        )
        / resumen_calendario["mediana_historica"]
    ) * 100

    return resumen_calendario


if __name__ == "__main__":
    if not os.getenv("FIRMS_MAP_KEY"):
        print("AVISO: configurá FIRMS_MAP_KEY antes de consultar datos reales.")
    app.run(host="0.0.0.0", port=5000, debug=True)