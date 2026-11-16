"use strict";

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM cargado. Inicializando mapa y controles…");
})

console.log("FireHarmony v1.0.0 - MODIS + VIIRS - 2024-06-10");


const $ = (id) => document.getElementById(id);
let currentLanguage =
  localStorage.getItem("fireharmony-language") === "es" ? "es" : "en";
const monthNamesByLanguage = {
  es: [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic",
  ],
  en: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ],
};
const weekDaysByLanguage = {
  es: ["L", "M", "X", "J", "V", "S", "D"],
  en: ["M", "T", "W", "T", "F", "S", "S"],
};
let map,
  markers = [],
  areaCircle = null,
  imported = false,
  layerControl = null,
  mapBaseLayers = null;
  let calendarSummary = null;
  let calendarRecords = [];
let calendarView = new Date(Date.UTC(2025, 0, 1));
let calendarSource = "summary";
  let selectedCalendarDate = "";
  let calendarRequestId = 0;
let weatherRequestId = 0;

let monthNames = monthNamesByLanguage[currentLanguage];

function tr(spanish, english, values = {}) {
  return formatMessage(currentLanguage === "en" ? english : spanish, values);
}

function formatMessage(template, values) {
  let message = template;
  Object.entries(values).forEach(([key, value]) => {
    message = message.split(`{${key}}`).join(String(value));
  });
  return message;
}

function setLocalizedText(element, spanish, english, values = {}) {
  element.dataset.localizedEs = formatMessage(spanish, values);
  element.dataset.localizedEn = formatMessage(english, values);
  element.textContent =
    currentLanguage === "en"
      ? element.dataset.localizedEn
      : element.dataset.localizedEs;
}

function applyLanguage() {
  document.documentElement.lang = currentLanguage;
  monthNames = monthNamesByLanguage[currentLanguage];

  document.querySelectorAll("[data-en], [data-en-html]").forEach((element) => {
    const isHtml = element.hasAttribute("data-en-html"),
      property = isHtml ? "innerHTML" : "textContent",
      english = isHtml ? element.dataset.enHtml : element.dataset.en,
      spanishKey = isHtml ? "esHtml" : "esText";
    if (element.dataset[spanishKey] === undefined)
      element.dataset[spanishKey] = element[property];
    element[property] =
      currentLanguage === "en" ? english : element.dataset[spanishKey];
  });

  document.querySelectorAll("[data-en-title]").forEach((element) => {
    if (element.dataset.esTitle === undefined)
      element.dataset.esTitle = element.title;
    element.title =
      currentLanguage === "en" ? element.dataset.enTitle : element.dataset.esTitle;
  });
  document.querySelectorAll("[data-en-aria-label]").forEach((element) => {
    if (element.dataset.esAriaLabel === undefined)
      element.dataset.esAriaLabel = element.getAttribute("aria-label") || "";
    element.setAttribute(
      "aria-label",
      currentLanguage === "en"
        ? element.dataset.enAriaLabel
        : element.dataset.esAriaLabel,
    );
  });
  document.querySelectorAll("[data-localized-es]").forEach((element) => {
    element.textContent =
      currentLanguage === "en"
        ? element.dataset.localizedEn
        : element.dataset.localizedEs;
  });

  $("languageToggle").textContent = currentLanguage === "es" ? "EN" : "ES";
  $("languageToggle").title =
    currentLanguage === "es" ? "Switch to English" : "Cambiar a español";
  $("languageToggle").setAttribute(
    "aria-label",
    currentLanguage === "es" ? "Switch to English" : "Cambiar a español",
  );
  if (map && mapBaseLayers) renderLayerControl();
  if (map) render();
  renderWeatherLocation();
}

function renderWeatherLocation() {
  const lat = Number($("lat").value),
    lon = Number($("lon").value);
  $("weatherLocation").textContent =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? tr("Ubicación: {lat}, {lon}", "Location: {lat}, {lon}", {
          lat: lat.toFixed(2),
          lon: lon.toFixed(2),
        })
      : tr(
          "Usando las coordenadas del área seleccionada.",
          "Using the selected area's coordinates.",
        );
}

function weatherErrorInEnglish(message) {
  const replacements = [
    ["No se pudo cargar el clima.", "Could not load weather."],
    [
      "Faltan configurar METEOMATICS_USER y METEOMATICS_PASSWORD.",
      "Configure METEOMATICS_USER and METEOMATICS_PASSWORD.",
    ],
    [
      "No se pudo conectar con Meteomatics (red o timeout).",
      "Could not connect to Meteomatics (network error or timeout).",
    ],
    [
        "Meteomatics rechazó la solicitud (HTTP 400). Revisá los parámetros y sus unidades.",
        "Meteomatics rejected the request (HTTP 400). Check the parameters and units.",
    ],
    [
        "Meteomatics indicó que se alcanzó un límite de uso (HTTP 429).",
        "Meteomatics reported that a usage limit was reached (HTTP 429).",
    ],
    [
        "Meteomatics no devolvió una respuesta JSON válida.",
        "Meteomatics did not return a valid JSON response.",
    ],
    [
        "Meteomatics devolvió datos con formato inválido.",
        "Meteomatics returned data in an invalid format.",
    ],
    [
        "La respuesta no incluye la temperatura actual.",
        "The response does not include the current temperature.",
    ],
  ];
  let translated = message.replace(
    /Meteomatics rechazó la autenticación \(HTTP (\d+)\)\. Verificá METEOMATICS_USER y METEOMATICS_PASSWORD\./,
    "Meteomatics rejected authentication (HTTP $1). Check METEOMATICS_USER and METEOMATICS_PASSWORD.",
  );
  translated = translated.replace(
    /Meteomatics respondió HTTP (\d+)\./,
    "Meteomatics responded with HTTP $1.",
  );
  replacements.forEach(([spanish, english]) => {
    translated = translated.replace(spanish, english);
  });
  return translated;
}

// Initialize the map
function initMap() {
  map = L.map("map", { center: [-15, -45], zoom: 3 });
  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 18 },
  );
  const street = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19 },
  );
  satellite.addTo(map);
  mapBaseLayers = { satellite, street };
  renderLayerControl();
  map.on("click", (e) => {
    $("lat").value = e.latlng.lat.toFixed(4);
    $("lon").value = e.latlng.lng.toFixed(4);
    applyArea();
    $("mapInfo").innerHTML =
      `<strong>📍 ${tr("Punto seleccionado", "Selected point")}</strong><br>${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}<br>${tr("Aplicá el área para centrar el análisis.", "Apply the area to center the analysis.")}`;
  });
  render();
}

function renderLayerControl() {
  if (layerControl) map.removeControl(layerControl);
  layerControl = L.control
    .layers(
      {
        [tr("🛰️ Satélite", "🛰️ Satellite")]: mapBaseLayers.satellite,
        [tr("🗺️ Calles", "🗺️ Streets")]: mapBaseLayers.street,
      },
      {},
      { collapsed: true },
    )
    .addTo(map);
}

function serviceErrorInEnglish(message) {
  const replacements = [
    ["Ingresá coordenadas válidas.", "Enter valid coordinates."],
    [
      "Falta configurar FIRMS_MAP_KEY en el entorno del servidor.",
      "Configure FIRMS_MAP_KEY in the server environment.",
    ],
    ["NASA FIRMS no devolvió datos.", "NASA FIRMS returned no data."],
    [
      "No se pudieron cargar los focos del día.",
      "Could not load the day's hotspots.",
    ],
    [
      "No se pudo cargar el resumen histórico.",
      "Could not load the historical summary.",
    ],
    [
      "El servidor devolvió registros con formato inválido.",
      "The server returned records in an invalid format.",
    ],
    [
      "El servidor devolvió un resumen con formato inválido.",
      "The server returned a summary in an invalid format.",
    ],
    [
      "El servidor no informó una fecha válida.",
      "The server did not provide a valid date.",
    ],
    ["Activá al menos un sensor.", "Enable at least one sensor."],
    ["Error de NASA FIRMS", "NASA FIRMS error"],
  ];
  return replacements.reduce(
    (result, [spanish, english]) => result.replace(spanish, english),
    message,
  );
}

// Funcion que retorna el nombre del sensor
function sensorName(r) {
  return String(r.satellite || r.sensor || "").toUpperCase();
}

// Normaliza la fecha a formato YYYY-MM-DD
function normDate(v) {
  if (!v) return "";
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function setCalendarMonth(value) {
  const date = normDate(value);
  if (!date) return;
  const [year, month] = date.split("-").map(Number);
  calendarView = new Date(Date.UTC(year, month - 1, 1));
}

//no tocar
let records = [];

// Filtra los registros según los parámetros seleccionados
function filtered() {
  const useM = $("modis").checked,
    useV = $("viirs").checked,
    conf = $("confidence").value;

  let arr = records.filter((r) => {
    const s = sensorName(r);
    if (s.includes("MODIS") && !useM) return false;
    if (s.includes("VIIRS") && !useV) return false;
    const c = String(r.confidence ?? "").toLowerCase();
    if (
      conf === "high" &&
      !(c === "high" || c === "h" || c === "3" || c === "80" || c === "90")
    )
      return false;
    if (
      conf === "nominal" &&
      (c === "low" || c === "l" || c === "0" || c === "1")
    )
      return false;
    return true;
  });
  return arr;
}

function markerColor(r) {
  const s = sensorName(r);
  return s.includes("VIIRS")
    ? "#ff554d"
    : s.includes("MODIS")
      ? "#ffb14a"
      : "#b68cff";
}

function fitMapToArgentina() {
  if (markers.length) {
    const bounds = L.latLngBounds(markers.map((marker) => marker.getLatLng()));
    map.fitBounds(bounds.pad(0.1), { maxZoom: 7 });
    return;
  }
  map.fitBounds(
    [
      [-55.1, -73.6],
      [-21.8, -53.6],
    ],
    { maxZoom: 5 },
  );
}

// Renderiza los marcadores en el mapa y actualiza la información de la interfaz
function render() {
  if (!map) return;
  const arr = filtered();
  markers.forEach((m) => map.removeLayer(m));
  markers = [];
  arr.forEach((r) => {
    const lat = Number(r.latitude ?? r.lat),
      lon = Number(r.longitude ?? r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const c = markerColor(r),
      m = L.circleMarker([lat, lon], {
        radius: Math.max(
          5,
          Math.min(10, 5 + Math.log10(Math.max(1, Number(r.frp) || 1))),
        ),
        color: "#111925",
        weight: 1.5,
        fillColor: c,
        fillOpacity: 0.9,
      }).addTo(map);
    const origin = r.isDemo
      ? tr("Registro simulado", "Simulated record")
      : r.source
        ? "NASA FIRMS"
        : tr("Registro importado", "Imported record");
    m.bindPopup(
      `<strong>${sensorName(r) || tr("Sensor no identificado", "Unknown sensor")}</strong><br>${tr("Fecha", "Date")}: ${normDate(r.acq_date || r.date) || tr("Sin fecha", "No date")}<br>${tr("Confianza", "Confidence")}: ${r.confidence ?? tr("No informada", "Not reported")}<br>FRP: ${r.frp ?? tr("No disponible", "Not available")} MW<br>${origin}`,
    );
    markers.push(m);
  });

  const v = arr.filter((r) => sensorName(r).includes("VIIRS")).length,
    m = arr.filter((r) => sensorName(r).includes("MODIS")).length;
  const frps = arr.map((r) => Number(r.frp)).filter(Number.isFinite);
  $("total").textContent = arr.length;
  $("frp").textContent = frps.length
    ? frps.reduce((a, b) => a + b, 0).toFixed(1)
    : "—";
  $("viirsCount").textContent = v;
  $("modisCount").textContent = m;
  const max = Math.max(1, ...arr.map((r) => Number(r.frp) || 0));
  const relative = Math.min(
    100,
    Math.round((arr.length / Math.max(1, records.length)) * 100),
  );
  $("activityLabel").textContent = relative + "%";
  $("activityBar").style.width = relative + "%";
  $("modisStatus").textContent = tr("{count} registros", "{count} records", {
    count: m,
  });
  $("viirsStatus").textContent = tr("{count} registros", "{count} records", {
    count: v,
  });
  $("selectedArea").textContent = $("region").selectedOptions[0].textContent;
  const hasDemo = records.some((r) => r.isDemo),
    origin = imported
      ? "CSV"
      : hasDemo
        ? tr("Demo", "Demo")
        : records.some((r) => r.source)
          ? "NASA"
          : tr("Sin datos", "No data");
  $("areaStatus").textContent = origin;
  $("insight").textContent = arr.length
    ? tr(
        "Se muestran {total} detecciones en los filtros actuales ({modis} MODIS y {viirs} VIIRS). Revisá fecha, sensor y confianza antes de interpretar los patrones. {demo}",
        "Showing {total} detections with the current filters ({modis} MODIS and {viirs} VIIRS). Check the date, sensor, and confidence before interpreting patterns. {demo}",
        {
          total: arr.length,
          modis: m,
          viirs: v,
          demo: hasDemo
            ? tr(
                "Hay registros simulados en el conjunto actual.",
                "The current dataset includes simulated records.",
              )
            : "",
        },
      )
    : tr(
        "No hay registros con estos filtros. Probá otro período, sensor o importá un CSV.",
        "No records match these filters. Try another period or sensor, or import a CSV.",
      );
  renderCalendar();
  renderChart();
  $("mapInfo").innerHTML =
    `<strong>🔥 ${tr("{count} detecciones visibles", "{count} visible detections", { count: arr.length })}</strong><br>MODIS: ${m} · VIIRS: ${v}<br>${hasDemo ? tr("Modo demostración / datos mixtos", "Demo mode / mixed data") : origin === "NASA" ? "NASA FIRMS" : origin === "CSV" ? tr("Datos importados", "Imported data") : tr("Sin datos", "No data")}<br>${tr("Elegí un punto para ver detalles.", "Select a point to see details.")}`;
}

function renderCalendar() {
  const year = calendarView.getUTCFullYear(),
    month = calendarView.getUTCMonth() + 1,
    data = calendarSource === "summary" ? calendarSummary : calendarRecords,
    d0 = new Date(Date.UTC(year, month - 1, 1)),
    days = new Date(Date.UTC(year, month, 0)).getUTCDate(),
    offset = (d0.getUTCDay() + 6) % 7;
  $("calendarTitle").textContent = monthNames[month - 1] + " " + year;
  if (calendarSource === "summary" && calendarSummary === null) {
    $("calendar").innerHTML = "";
    return;
  }

  const counts = {};
  data.forEach((r) => {
    const sensor = sensorName(r);
    if (sensor.includes("MODIS") && !$("modis").checked) return;
    if (sensor.includes("VIIRS") && !$("viirs").checked) return;
    const d =
      normDate(r.acq_date || r.date) ||
      (r.year && r.month && r.day
        ? `${r.year}-${String(r.month).padStart(2, "0")}-${String(r.day).padStart(2, "0")}`
        : "");
    if (!d || !d.startsWith(`${year}-${String(month).padStart(2, "0")}`))
      return;
    const day = +d.slice(8, 10);
    if (!counts[day]) counts[day] = { total: 0, MODIS: 0, VIIRS: 0 };
    const n = Number(r.cantidad_hotspots) || 1;
    counts[day].total += n;
    if (sensor.includes("MODIS")) counts[day].MODIS += n;
    if (sensor.includes("VIIRS")) counts[day].VIIRS += n;
  });
  let out = weekDaysByLanguage[currentLanguage]
    .map((x) => `<div class="dayhead">${x}</div>`)
    .join("");
  for (let i = 0; i < offset; i++)
    out += '<div class="day" style="opacity:.15"></div>';
  for (let d = 1; d <= days; d++) {
    const countsForDay = counts[d] || { total: 0, MODIS: 0, VIIRS: 0 },
      n = countsForDay.total,
      date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      title = tr(
        "Total: {total} · MODIS: {modis} · VIIRS: {viirs}",
        "Total: {total} · MODIS: {modis} · VIIRS: {viirs}",
        {
          total: n,
          modis: countsForDay.MODIS,
          viirs: countsForDay.VIIRS,
        },
      ),
      selected = selectedCalendarDate === date ? " selected-day" : "";
    out += `<button type="button" class="day${selected} ${n >= 4 ? "veryhot" : n > 0 ? "hot" : ""}" data-date="${date}" title="${title}" aria-label="${date}: ${title}">${d}${n ? `<span style="display:block;font-size:8px;margin-top:2px">${n}</span>` : ""}</button>`;
  }
  $("calendar").innerHTML = out;
}

async function showHistoricalDay(selectedDate) {
  const requestId = ++calendarRequestId;
  selectedCalendarDate = selectedDate;
  setLocalizedText(
    $("calendarStatus"),
    `Cargando focos activos del ${selectedDate}…`,
    `Loading active hotspots for ${selectedDate}…`,
  );
  renderCalendar();
  try {
    const response = await fetch(
      `/api/fires/records?date=${encodeURIComponent(selectedDate)}`,
    );
    const data = await response.json();
    if (requestId !== calendarRequestId) return;
    if (!response.ok)
      throw new Error(
        data.error ||
          "No se pudieron cargar los focos del día.",
      );
    if (!Array.isArray(data.records))
      throw new Error(
        "El servidor devolvió registros con formato inválido.",
      );
    records = data.records.map((r, i) => ({
      ...r,
      id: `HISTORY-${selectedDate}-${i + 1}`,
    }));
    imported = true;
    $("modis").checked = true;
    $("viirs").checked = true;
    $("confidence").value = "all";
    setLocalizedText(
      $("calendarStatus"),
      "{count} focos activos de MODIS y VIIRS el {date}.",
      "{count} active MODIS and VIIRS hotspots on {date}.",
      { count: records.length, date: selectedDate },
    );
    render();
    fitMapToArgentina();
  } catch (error) {
    if (requestId !== calendarRequestId) return;
    setLocalizedText(
      $("calendarStatus"),
      `No se pudieron cargar los focos del ${selectedDate}: ${error.message}`,
      `Could not load hotspots for ${selectedDate}: ${serviceErrorInEnglish(error.message)}`,
    );
  }
}

async function fetchCalendarSummary() {
  setLocalizedText(
    $("calendarStatus"),
    "Cargando actividad histórica de MODIS y VIIRS…",
    "Loading historical MODIS and VIIRS activity…",
  );
  try {
    const response = await fetch("/api/fires/summary");
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || "No se pudo cargar el resumen histórico.",
      );
    if (!Array.isArray(data))
      throw new Error(
        "El servidor devolvió un resumen con formato inválido.",
      );
    calendarSummary = data;
    renderChart();
    setLocalizedText(
      $("calendarStatus"),
      "CSV históricos · {count} resúmenes diarios · MODIS y VIIRS",
      "Historical CSV · {count} daily summaries · MODIS and VIIRS",
      { count: data.length },
    );
    renderCalendar();
  } catch (error) {
    calendarSummary = null;
    renderChart();
    setLocalizedText(
      $("calendarStatus"),
      `No se pudo cargar la actividad histórica: ${error.message}`,
      `Could not load historical activity: ${serviceErrorInEnglish(error.message)}`,
    );
    $("calendar").innerHTML = "";
  }
}

function renderChart() {
  const yearSelect = $("chartYear"),
    years = Array.from(
      new Set(
        (calendarSummary || [])
          .map((r) => Number(r.year))
          .filter((year) => Number.isInteger(year) && year > 0),
      ),
    ).sort((a, b) => b - a),
    currentYear = Number(yearSelect.value);
  yearSelect.innerHTML = years
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");
  if (years.includes(currentYear)) yearSelect.value = String(currentYear);
  else if (years.length) yearSelect.value = String(years[0]);
  yearSelect.disabled = years.length < 2;

  const year = Number(yearSelect.value),
    counts = Array(12).fill(0),
    useModis = $("modis").checked,
    useViirs = $("viirs").checked;
  (calendarSummary || []).forEach((r) => {
    if (Number(r.year) !== year) return;
    const sensor = sensorName(r),
      month = Number(r.month) - 1,
      count = Number(r.cantidad_hotspots);
    if (sensor.includes("MODIS") && !useModis) return;
    if (sensor.includes("VIIRS") && !useViirs) return;
    if (
      !Number.isInteger(month) ||
      month < 0 ||
      month >= counts.length ||
      !Number.isFinite(count)
    )
      return;
    counts[month] += count;
  });
  const max = Math.max(1, ...counts);
  $("chartYear").textContent = year;
  $("monthlyChart").innerHTML = counts
    .map(
      (n, i) =>
        `<div class="chartcol" title="${tr("{month}: {count} detecciones", "{month}: {count} detections", { month: monthNames[i], count: n })}"><small>${n || ""}</small><div class="chartbar" style="height:${Math.max(n ? 4 : 2, (n / max) * 72)}px;opacity:${n ? 1 : 0.25}"></div><span>${monthNames[i]}</span></div>`,
    )
    .join("");
}

function applyArea() {
  const lat = Number($("lat").value),
    lon = Number($("lon").value),
    km = +$("radius").value;
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    alert(tr("Ingresá coordenadas válidas.", "Enter valid coordinates."));
    return;
  }
  map.setView(
    [lat, lon],
    // Zoom
    // km <= 50 ? 8 : km <= 100 ? 7 : km <= 250 ? 6 : km <= 500 ? 5 : 4,
    
  );
  if (areaCircle) map.removeLayer(areaCircle);
  areaCircle = L.circle([lat, lon], {
    radius: km * 1000,
    color: "#ffb16d",
    weight: 2,
    fillColor: "#ff8b42",
    fillOpacity: 0.07,
    dashArray: "5 6",
  }).addTo(map);
  $("mapInfo").innerHTML =
    `<strong>📍 ${tr("Área de interés", "Area of interest")}</strong><br>${lat.toFixed(3)}, ${lon.toFixed(3)}<br>${tr("Radio de referencia", "Reference radius")}: ${km} km<br>${tr("El círculo es orientativo.", "The circle is for reference only.")}`;
  fetchWeather();
}
function searchCoords() {
  const p = $("coordSearch")
    .value.split(",")
    .map((v) => Number(v.trim()));
  if (
    p.length !== 2 ||
    !p.every(Number.isFinite) ||
    p[0] < -90 ||
    p[0] > 90 ||
    p[1] < -180 ||
    p[1] > 180
  ) {
    alert(
      tr(
        "Usá latitud, longitud. Ejemplo: -27.8, -64.3",
        "Use latitude, longitude. Example: -27.8, -64.3",
      ),
    );
    return;
  }
  map.setView(p, 8);
  $("lat").value = p[0];
  $("lon").value = p[1];
  applyArea();
}
function parseCSV(text) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) throw new Error("El CSV no contiene filas de datos.");
  function split(line) {
    const out = [];
    let cur = "",
      quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && quoted) {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  const headers = split(lines[0]).map((h) =>
    h
      .toLowerCase()
      .replace(/^\uFEFF/, "")
      .trim(),
  );
  const idx = (...names) => headers.findIndex((h) => names.includes(h));
  const ilat = idx("latitude", "lat", "y"),
    ilon = idx("longitude", "lon", "lng", "long", "x"),
    idate = idx("acq_date", "date", "fecha"),
    isensor = idx("satellite", "sensor", "instrument"),
    iconf = idx("confidence", "confianza"),
    ifrp = idx("frp", "fire_radiative_power");
  if (ilat < 0 || ilon < 0)
    throw new Error("Faltan columnas latitude/longitude (o lat/lon).");
  return lines
    .slice(1)
    .map((line, i) => {
      const c = split(line);
      return {
        id: "CSV-" + (i + 1),
        latitude: Number(c[ilat]),
        longitude: Number(c[ilon]),
        acq_date: idate >= 0 ? c[idate] : "",
        satellite: isensor >= 0 ? c[isensor] : "",
        confidence: iconf >= 0 ? c[iconf] : "",
        frp: ifrp >= 0 ? Number(c[ifrp]) : null,
        isDemo: false,
      };
    })
    .filter(
      (r) =>
        Number.isFinite(r.latitude) &&
        r.latitude >= -90 &&
        r.latitude <= 90 &&
        Number.isFinite(r.longitude) &&
        r.longitude >= -180 &&
        r.longitude <= 180,
    );
}

/*
$("csvFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = parseCSV(await file.text());
    if (!parsed.length)
      throw new Error("No se encontraron filas con coordenadas válidas.");
    records = parsed;
    calendarRecords = parsed;
    imported = true;
    calendarSource = "records";
    $("calendarStatus").textContent = "Actividad del CSV importado.";
    const latestDate =
      parsed
        .map((r) => normDate(r.acq_date))
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || "2026-01-01";
    setCalendarMonth(latestDate);
    $("year").value = String(
      Math.max(
        2022,
        Math.min(
          2026,
          +latestDate.slice(0, 4),
        ),
      ),
    );
    $("period").value = "365";
    render();
    alert(`CSV cargado: ${parsed.length} registros válidos.`);
  } catch (err) {
    alert("No se pudo leer el CSV: " + err.message);
  }
});
$("downloadSample").onclick = () => {
  const csv =
    "latitude,longitude,acq_date,satellite,confidence,frp\n-27.8,-64.3,2026-08-14,VIIRS,high,18.4\n-28.1,-64.6,2026-08-14,MODIS,nominal,11.2\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  a.download = "plantilla_focos_incendios.csv";
  a.click();
  URL.revokeObjectURL(a.href);
};
*/

function getWeatherValue(data, parameter) {
  const series = data.find((item) => item.parameter === parameter);
  const rawValue = series?.coordinates?.[0]?.dates?.[0]?.value;
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;
  const value = Number(rawValue);
  return Number.isFinite(value) && value !== -999 ? value : null;
}

async function fetchWeather() {
  const requestId = ++weatherRequestId;
  const lat = Number($("lat").value),
    lon = Number($("lon").value),
    status = $("weatherStatus"),
    button = $("weatherRefresh");
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    setLocalizedText(status, "Coordenadas inválidas", "Invalid coordinates");
    status.className = "demo";
    button.disabled = false;
    return;
  }

  setLocalizedText(status, "Consultando…", "Loading…");
  status.className = "demo";
  button.disabled = true;
  renderWeatherLocation();
  try {
    const query = new URLSearchParams({ lat: String(lat), lon: String(lon) });
    const response = await fetch(`/api/weather?${query}`);
    const result = await response.json();
    if (requestId !== weatherRequestId) return;
    if (!response.ok)
      throw new Error(result.error || "No se pudo cargar el clima.");
    if (!Array.isArray(result.data))
      throw new Error("Meteomatics devolvió datos con formato inválido.");

    const temperature = getWeatherValue(result.data, "t_2m:C"),
      humidity = getWeatherValue(result.data, "relative_humidity_2m:p"),
      wind = getWeatherValue(result.data, "wind_speed_10m:kmh"),
      precipitation = getWeatherValue(result.data, "precip_1h:mm");
    if (temperature === null)
      throw new Error("La respuesta no incluye la temperatura actual.");

    $("weatherTemp").textContent = temperature.toFixed(1);
    $("weatherHumidity").textContent =
      humidity === null ? "—" : `${Math.round(humidity)}%`;
    $("weatherWind").textContent =
      wind === null ? "—" : `${wind.toFixed(1)} km/h`;
    $("weatherPrecip").textContent =
      precipitation === null ? "—" : `${precipitation.toFixed(1)} mm`;
    const updatedAt = new Intl.DateTimeFormat(
      currentLanguage === "en" ? "en-US" : "es-AR",
      {
      hour: "2-digit",
      minute: "2-digit",
      },
    ).format(new Date());
    setLocalizedText(
      status,
      `Actualizado ${updatedAt}`,
      `Updated ${updatedAt}`,
    );
    status.className = "ok";
  } catch (error) {
    if (requestId !== weatherRequestId) return;
    const networkError = error instanceof TypeError,
      spanishError = networkError
        ? "No se pudo conectar con el servidor."
        : error.message,
      englishError = networkError
        ? "Could not connect to the server."
        : weatherErrorInEnglish(error.message);
    setLocalizedText(
      status,
      spanishError,
      englishError,
    );
    status.className = "demo";
  } finally {
    if (requestId === weatherRequestId) button.disabled = false;
  }
}

async function fetchFiresToday() {
  $("nasaFetch").disabled = true;
  setLocalizedText(
    $("nasaFetch"),
    "Cargando focos del día…",
    "Loading today's hotspots…",
  );
  setLocalizedText(
    $("nasaMessage"),
    "Consultando focos activos de Argentina…",
    "Querying active hotspots in Argentina…",
  );
  setLocalizedText($("apiStatus"), "Consultando…", "Loading…");
  try {
    const response = await fetch("/api/fires/today");
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || "No se pudieron cargar los focos de hoy.",
      );
    if (
      !Array.isArray(data.records) ||
      !Array.isArray(data.sources) ||
      !Array.isArray(data.errors)
    )
      throw new Error(
        "El servidor devolvió datos con formato inválido.",
      );
    const requestedDate = normDate(data.requested_date);
    if (!requestedDate)
      throw new Error(
        "El servidor no informó una fecha válida.",
      );

    records = data.records.map((record, index) => ({
      ...record,
      id: `NASA-TODAY-${index + 1}`,
    }));
    imported = false;
    $("modis").checked = true;
    $("viirs").checked = true;
    $("confidence").value = "all";
    selectedCalendarDate = "";
    calendarRequestId++;
    render();
    fitMapToArgentina();

    const partialWarningEs = data.errors.length
        ? ` Algunas fuentes no respondieron: ${data.errors.join("; ")}.`
        : "",
      partialWarningEn = data.errors.length
        ? ` Some sources did not respond: ${data.errors.join("; ")}.`
        : "";
    setLocalizedText(
      $("apiStatus"),
      data.errors.length ? "Conectada (parcial)" : "Conectada",
      data.errors.length ? "Connected (partial)" : "Connected",
    );
    $("apiStatus").className = data.errors.length ? "demo" : "ok";
    setLocalizedText(
      $("nasaMessage"),
      `Carga automática completada: ${records.length} detecciones del ${requestedDate}. Fuentes: ${data.sources.join(", ")}.${partialWarningEs}`,
      `Automatic load complete: ${records.length} detections on ${requestedDate}. Sources: ${data.sources.join(", ")}.${partialWarningEn}`,
    );
    $("nasaMessage").style.borderLeftColor = data.errors.length
      ? "#ffb14a"
      : "#65d6a0";
  } catch (error) {
    setLocalizedText($("apiStatus"), "Error", "Error");
    $("apiStatus").className = "demo";
    setLocalizedText(
      $("nasaMessage"),
      `No se pudieron cargar automáticamente los focos de hoy: ${error.message}`,
      `Could not automatically load today's hotspots: ${serviceErrorInEnglish(error.message)}`,
    );
    $("nasaMessage").style.borderLeftColor = "#ff554d";
  } finally {
    $("nasaFetch").disabled = false;
    setLocalizedText(
      $("nasaFetch"),
      "🛰️ Consultar datos reales NASA",
      "🛰️ Get live NASA data",
    );
  }
}

async function fetchNASA() {
  const lat = Number($("lat").value),
    lon = Number($("lon").value),
    radius = Number($("radius").value),
    date = new Date().toISOString().split("T")[0],
    days = 1; //Number($("nasaDays").value);
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    alert(tr("Ingresá coordenadas válidas.", "Enter valid coordinates."));
    return;
  }
  if (!date) {
    alert(tr("Error en fecha", "Invalid date."));
    return;
  }
  if (!$("modis").checked && !$("viirs").checked) {
    alert(tr("Activá al menos un sensor.", "Enable at least one sensor."));
    return;
  }
  const q = new URLSearchParams({
    lat,
    lon,
    radius,
    date,
    days,
    modis: $("modis").checked ? "1" : "0",
    viirs: $("viirs").checked ? "1" : "0",
  });
  $("nasaFetch").disabled = true;
  setLocalizedText($("nasaFetch"), "Consultando NASA…", "Querying NASA…");
  setLocalizedText(
    $("nasaMessage"),
    "Consultando NASA FIRMS…",
    "Querying NASA FIRMS…",
  );
  setLocalizedText($("apiStatus"), "Consultando…", "Loading…");
  try {
    const res = await fetch("/api/fires?" + q);
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.error || "Error de NASA FIRMS");
    records = data.records.map((r, i) => ({
      ...r,
      id: "NASA-" + (i + 1),
    }));
    selectedCalendarDate = "";
    calendarRequestId++;
    imported = false;
    render();
    setLocalizedText($("apiStatus"), "Conectada", "Connected");
    $("apiStatus").className = "ok";
    setLocalizedText(
      $("nasaMessage"),
      `Consulta completada: ${records.length} detecciones. Fuentes: ${data.sources.join(", ")}. ${date} (${days} día(s)).`,
      `Query complete: ${records.length} detections. Sources: ${data.sources.join(", ")}. ${date} (${days} day(s)).`,
    );
    $("nasaMessage").style.borderLeftColor = "#65d6a0";
  } catch (e) {
    setLocalizedText($("apiStatus"), "Error", "Error");
    setLocalizedText(
      $("nasaMessage"),
      `${e.message} Revisá que el servidor esté activo y FIRMS_MAP_KEY configurada.`,
      `${serviceErrorInEnglish(e.message)} Check that the server is running and FIRMS_MAP_KEY is configured.`,
    );
    $("nasaMessage").style.borderLeftColor = "#ff554d";
  } finally {
    $("nasaFetch").disabled = false;
    setLocalizedText(
      $("nasaFetch"),
      "Consultar datos de NASA",
      "Get NASA data",
    );
  }
}

$("languageToggle").addEventListener("click", () => {
  currentLanguage = currentLanguage === "es" ? "en" : "es";
  localStorage.setItem("fireharmony-language", currentLanguage);
  applyLanguage();
});
applyLanguage();

$("nasaFetch").onclick = fetchNASA;
$("weatherRefresh").onclick = fetchWeather;
$("centerBtn").onclick = applyArea;
$("allBtn").onclick = () => map.setView([0, 0], 2);
$("calendarPrev").onclick = () => {
  calendarView.setUTCMonth(calendarView.getUTCMonth() - 1);
  renderCalendar();
};
$("calendarNext").onclick = () => {
  calendarView.setUTCMonth(calendarView.getUTCMonth() + 1);
  renderCalendar();
};
$("calendar").addEventListener("click", (event) => {
  const day = event.target.closest("button[data-date]");
  if (day) showHistoricalDay(day.dataset.date);
});
$("chartYear").addEventListener("change", renderChart);
["modis", "viirs", "confidence"].forEach((id) =>
  $(id).addEventListener("change", render),
);
$("region").addEventListener("change", () => {
  const v = $("region").value;
  const places = {
    global: [0, 0],
    argentina: [-38.4, -63.6],
    santiago: [-27.8, -64.3],
    southamerica: [-15, -60],
  };
  if (places[v]) {
    $("lat").value = places[v][0];
    $("lon").value = places[v][1];
    fetchWeather();
  }
});
$("analysisBtn").onclick = () => $("analysisModal").classList.add("show");
$("closeAnalysis").onclick = () => $("analysisModal").classList.remove("show");

window.addEventListener("DOMContentLoaded", () => {
  initMap();
  applyArea();
  render();
  fetchCalendarSummary();
  fetchFiresToday();
});
