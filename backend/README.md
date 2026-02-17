# Cyber Weather Forecast — Backend

FastAPI backend implementing Hawkes process threat forecasting over a live CTI event stream.

## Quick Start

```bash
cd backend
python -m venv .venv

# Windows:  .venv\Scripts\activate
# Linux/Mac: source .venv/bin/activate

pip install -r requirements.txt
python start.py
```

`start.py` bootstraps everything: generates synthetic events, runs aggregation and Hawkes fitting, then starts the API server at **http://localhost:8000**.

Swagger UI: **http://localhost:8000/docs**

## Manual Pipeline Steps

```bash
# 1. Generate synthetic events (or let live feeds populate instead)
python -m app.ingest.generate_synthetic --hours 24 --rate 1200

# 2. Run EWMA aggregation → nowcast
python -m app.services.aggregator --recalc

# 3. Fit Hawkes model per (cell, vector) → forecasts
python -m app.services.hawkes_fit --hours 24 --min-events 50

# 4. Start API
uvicorn app.main:app --reload --port 8000
```

## API Reference

| Endpoint | Description |
|----------|-------------|
| `GET /healthz` | Health check → `{"status": "healthy"}` |
| `GET /v1/data?mode=nowcast&vector=ssh` | GeoJSON FeatureCollection of current λ values |
| `GET /v1/data?mode=forecast&vector=ssh&horizon=24` | Forecasted intensity at 6h / 24h / 72h |
| `GET /v1/data?mode=params&vector=ssh` | Fitted μ, β, n̂, stability flag |
| `GET /v1/data?mode=contours&vector=ssh` | Threat contour polygons |
| `GET /v1/advisories?vector=ssh` | Active weather-style advisories |
| `GET /v1/summary` | Global threat level + per-vector breakdown |
| `GET /v1/vectors` | Available attack vectors |
| `GET /v1/context/events` | Recent event summary |
| `GET /v1/context/seasonal` | Monthly seasonal patterns per vector |
| `GET /v1/context/campaigns` | Threat actor campaign context |
| `GET /v1/context/forecast?vector=ssh` | 30-day Hawkes intensity series |
| `GET /v1/context/active` | Active events + elevated groups + seasonal now |

Valid vectors: `ssh`, `rdp`, `http`, `dns_amp`, `brute_force`, `botnet_c2`, `ransomware`

## Project Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI app, /healthz, CORS
│   ├── db.py                # SQLAlchemy engine/session (canonical Base)
│   ├── models.py            # ORM models
│   ├── config.py            # Simple constants
│   ├── routers/
│   │   └── unified.py       # All /v1/* routes
│   ├── services/
│   │   ├── aggregator.py    # EWMA nowcast builder
│   │   ├── hawkes_fit.py    # MLE fitting + bootstrap CI
│   │   ├── forecast.py      # Intensity projection
│   │   ├── advisory.py      # Advisory generation
│   │   └── pipeline.py      # Orchestrated background loop
│   ├── ingest/
│   │   ├── dshield.py       # DShield/SANS ISC feed
│   │   ├── greynoise.py     # GreyNoise feed
│   │   ├── abusech.py       # Abuse.ch ThreatFox + Feodo
│   │   ├── geolocation.py   # MaxMind GeoLite2 (ingest-side)
│   │   └── generate_synthetic.py
│   └── core/
│       ├── config.py        # Pydantic Settings (API keys, intervals)
│       └── database.py      # Orphaned Base — do not use in new code
├── tests/
│   ├── conftest.py
│   ├── test_api.py          # Integration tests (22 tests)
│   ├── test_hawkes_process.py
│   ├── test_models.py
│   └── test_geo.py
├── start.py
└── requirements.txt
```

## Testing

```bash
cd backend
python -m pytest              # 54 tests (32 unit + 22 integration)
python -m pytest -v           # verbose
python -m pytest tests/test_api.py -v
```

Tests use an in-memory SQLite database (`sqlite://`) — no file I/O, no state leakage between tests.

**Important:** All test infrastructure must import from `app.db`, not `app.core.database`:
```python
from app.db import Base, engine   # correct
```

## Hawkes Model

The intensity at time t is:

```
λ(t) = μ(t) + Σᵢ α · exp(-β · (t - tᵢ))
```

where `μ(t) = μ_base × S(t) × E(t) × C(t)` incorporates seasonal, geopolitical, and campaign modifiers.

Parameters fitted per `(grid_cell, vector)` pair via MLE with L-BFGS-B. Bootstrap samples (default 200) provide standard errors. Branching ratio `n̂ = α/β` — values ≥ 0.8 flag as supercritical (potential cascade).

## Environment Variables

All use `CYBER_WEATHER_` prefix. See `.env.example` for full list. Key variables:

| Variable | Default |
|----------|---------|
| `DATABASE_URL` | `sqlite:///./cyber_weather.db` |
| `MAXMIND_DB_PATH` | `/data/GeoLite2-City.mmdb` |
| `GREYNOISE_API_KEY` | — (optional) |
| `INGEST_INTERVAL_MIN` | `15` |
| `FIT_INTERVAL_MIN` | `60` |
| `MIN_EVENTS_FIT` | `50` |
| `HAWKES_BOOTSTRAP_SAMPLES` | `200` |
