# Guía de instalación de FIREHARMONY

Esta guía explica cómo ejecutar FIREHARMONY localmente y configurar las credenciales opcionales para consultar datos reales.

## Requisitos

- Python 3.10 o posterior.
- Acceso a Internet para instalar dependencias y consultar servicios externos.
- Una clave de NASA FIRMS para consultar detecciones satelitales en tiempo real.
- Credenciales de Meteomatics para consultar el clima. Esta integración es opcional.

La aplicación puede iniciarse sin credenciales; las consultas a los servicios correspondientes no estarán disponibles.

## 1. Obtener el proyecto

Cloná el repositorio y entrá en la carpeta del proyecto:

```bash
git clone https://github.com/Tade0G/FIREHARMONY.git
cd FIREHARMONY
```

Si ya tenés el proyecto, abrí una terminal en esa carpeta.

## 2. Crear un entorno e instalar dependencias

### Windows (PowerShell)

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

### macOS o Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## 3. Configurar credenciales

Creá un archivo llamado `.env` en la carpeta raíz del proyecto. Agregá las credenciales que quieras utilizar:

```dotenv
FIRMS_MAP_KEY=tu_clave_de_nasa_firms
METEOMATICS_USER=tu_usuario
METEOMATICS_PASSWORD=tu_contraseña
```

- Obtené una clave de NASA FIRMS en [firms.modaps.eosdis.nasa.gov/api/map_key](https://firms.modaps.eosdis.nasa.gov/api/map_key/). Es necesaria para consultar datos reales de incendios.
- Configurá `METEOMATICS_USER` y `METEOMATICS_PASSWORD` con las credenciales de tu cuenta de Meteomatics. Son necesarias para la consulta meteorológica.
- Si no vas a usar uno de los servicios, podés omitir sus variables.

El archivo `.env` está excluido del control de versiones. No publiques ni compartas claves o contraseñas.

## 4. Iniciar la aplicación

Con el entorno virtual activado, ejecutá:

```bash
python app.py
```

Abrí [http://127.0.0.1:5000](http://127.0.0.1:5000) en el navegador. Para detener el servidor, volvé a la terminal y presioná `Ctrl+C`.

## 5. Consultar datos

- Para consultar incendios, configurá `FIRMS_MAP_KEY`, elegí el área y los sensores MODIS o VIIRS; luego presioná **Consultar datos reales NASA**.
- Para consultar el clima, configurá las credenciales de Meteomatics y usá la sección del clima.
- Sin las credenciales correspondientes, la aplicación puede abrirse, pero esas consultas reales no estarán disponibles.

La consulta de área de NASA FIRMS utiliza un rectángulo geográfico aproximado. Las detecciones satelitales son anomalías térmicas y no necesariamente representan incendios únicos. Para consultar datos históricos extensos, se pueden cargar archivos CSV históricos.

## Solución de problemas

- **El puerto 5000 ya está en uso:** cerrá el otro proceso que lo utiliza y volvé a iniciar la aplicación.
- **No se pueden consultar datos de NASA:** verificá que `FIRMS_MAP_KEY` esté escrito correctamente en `.env` y reiniciá el servidor después de editarlo.
- **No se puede consultar el clima:** verificá `METEOMATICS_USER` y `METEOMATICS_PASSWORD`, y reiniciá el servidor.
- **Falla la instalación:** confirmá que Python 3.10 o posterior esté instalado y que la terminal esté ubicada en la carpeta que contiene `requirements.txt`.

## Referencias

- [NASA FIRMS: API de área](https://firms.modaps.eosdis.nasa.gov/api/area/)
- [NASA FIRMS: obtener una MAP_KEY](https://firms.modaps.eosdis.nasa.gov/api/map_key/)
- [Meteomatics](https://www.meteomatics.com/)
