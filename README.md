# Cyber Weather Forecast — Hawkes Process MVP

Real-time cyber threat forecasting using self-exciting Hawkes point processes,
presented through a weather-forecaster archetype for daily podcast production.

**Backend:** FastAPI · PostgreSQL/SQLite · NumPy/SciPy · Hawkes MLE + Bootstrap  
**Frontend:** Vite · React · Leaflet  
**Deployment:** Docker Compose · PostgreSQL · Nginx

## Architecture

```
┌─────────────┐    ┌──────────────┐    ┌────────────────┐
│ Threat Feeds │───→│  Event Store │───→│ Nowcast (EWMA)  │
│ + Synthetic  │    │  (PostgreSQL)│    └────────┬───────┘
└─────────────┘    └──────────────┘             │
                                                ▼
                                     ┌──────────────────┐
                                     │ Hawkes Fit (MLE)  │
                                     │ + Bootstrap CI    │
                                     └────────┬─────────┘
                                              │
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                   ┌────────────┐    ┌──────────────┐    ┌──────────────┐
                   │ Forecast   │    │  Snapshots   │    │  /v1/summary │
                   │ (6/24/72h) │    │  (History)   │    │  /v1/podcast │
                   └────────────┘    └──────────────┘    └──────────────┘
```

## Quickstart (Development)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Run the full pipeline + server:
python start.py

# Or step by step:
python -m app.ingest.generate_synthetic --hours 24 --rate 1200
python -m app.services.aggregator --recalc
python -m app.services.hawkes_fit --hours 24
uvicorn app.main:app --reload --port 8000
```

Frontend:
```bash
cd frontend && npm install && npm run dev
```

## Quickstart (Docker)

```bash
cp backend/.env.example backend/.env   # edit DB_PASSWORD
docker compose up --build
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /v1/data?mode=nowcast&vector=ssh` | GeoJSON nowcast layer |
| `GET /v1/data?mode=forecast&vector=ssh&horizon=24` | GeoJSON forecast layer |
| `GET /v1/data?mode=params&vector=ssh` | Hawkes parameters per cell |
| `GET /v1/summary` | Aggregated threat summary (podcast input) |
| `GET /v1/podcast/script` | Structured podcast script JSON |
| `GET /v1/advisories?vector=ssh` | Active storm advisories |
| `GET /v1/vectors` | Configured attack vectors |
| `GET /health` | Health check |

## Testing

```bash
cd backend
pip install -r requirements.txt
pytest
```

## Configuration

All settings are environment variables with `CYBER_WEATHER_` prefix.  
See `backend/.env.example` for the full list.
