# FIREHARMONY Installation Guide

This guide explains how to run FIREHARMONY locally and configure optional credentials for live data.

## Requirements

- Python 3.10 or later.
- Internet access to install dependencies and query external services.
- A NASA FIRMS map key to query live satellite fire detections.
- Meteomatics credentials to query weather data. This integration is optional.

The application can start without credentials; requests to the corresponding services will not be available.

## 1. Get the project

Clone the repository and change into the project folder:

```bash
git clone https://github.com/Tade0G/FIREHARMONY.git
cd FIREHARMONY
```

If you already have the project, open a terminal in that folder.

## 2. Create an environment and install dependencies

### Windows (PowerShell)

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

### macOS or Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## 3. Configure credentials

Create a file named `.env` in the project root and add the credentials you want to use:

```dotenv
FIRMS_MAP_KEY=your_nasa_firms_key
METEOMATICS_USER=your_username
METEOMATICS_PASSWORD=your_password
```

- Get a NASA FIRMS key at [firms.modaps.eosdis.nasa.gov/api/map_key](https://firms.modaps.eosdis.nasa.gov/api/map_key/). It is required to query live fire data.
- Set `METEOMATICS_USER` and `METEOMATICS_PASSWORD` to your Meteomatics account credentials. They are required for weather queries.
- You can omit the variables for any service you do not plan to use.

The `.env` file is excluded from version control. Do not publish or share keys or passwords.

## 4. Start the application

With the virtual environment activated, run:

```bash
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser. To stop the server, return to the terminal and press `Ctrl+C`.

## 5. Query data

- To query fires, configure `FIRMS_MAP_KEY`, select an area, date, 1–5 days, and MODIS or VIIRS sensors, then select **Get live NASA data**.
- To query weather, configure the Meteomatics credentials and use the weather section.
- Without the corresponding credentials, the application can open, but those live queries will not be available.

The NASA FIRMS area query uses an approximate geographic bounding rectangle. Satellite detections are thermal anomalies and do not necessarily represent unique fires. Historical CSV files can be loaded to explore longer historical periods.

## Troubleshooting

- **Port 5000 is already in use:** stop the other process using it and start the application again.
- **NASA data cannot be queried:** check that `FIRMS_MAP_KEY` is correct in `.env`, then restart the server after editing the file.
- **Weather cannot be queried:** check `METEOMATICS_USER` and `METEOMATICS_PASSWORD`, then restart the server.
- **Dependency installation fails:** confirm that Python 3.10 or later is installed and that the terminal is in the folder containing `requirements.txt`.

## References

- [NASA FIRMS: Area API](https://firms.modaps.eosdis.nasa.gov/api/area/)
- [NASA FIRMS: Get a MAP_KEY](https://firms.modaps.eosdis.nasa.gov/api/map_key/)
- [Meteomatics](https://www.meteomatics.com/)
