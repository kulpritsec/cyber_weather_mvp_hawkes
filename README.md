# Cyber Weather Forecast — Hawkes Process MVP

Real-time cyber threat forecasting using self-exciting Hawkes point processes with 3D globe visualization and live CTI feed integration.

**Backend:** FastAPI · SQLAlchemy · SQLite/PostgreSQL · NumPy/SciPy · Hawkes MLE + Bootstrap
**Frontend:** React · Three.js · Vite · D3 · Interactive 3D Globe
**CTI Feeds:** DShield · GreyNoise · Abuse.ch · MaxMind GeoLite2
**Deployment:** Docker Compose · PostgreSQL · Nginx

---

## Features

- **3D Globe Visualization** — Interactive threat intelligence globe powered by Three.js
- **Real-time CTI Integration** — Live data from DShield, GreyNoise, and Abuse.ch
- **Hawkes Process Forecasting** — Self-exciting point process modeling for attack prediction
- **Weather Metaphor UI** — Severity levels from Clear → Advisory → Watch → Warning → Emergency
- **Multi-Vector Analysis** — SSH, RDP, HTTP, DNS Amplification, Botnet C2, Ransomware
- **Predictive Context Engine** — Live forecasting panel with seasonal context, campaigns, and threat arcs
- **Math Lab** — Animated Hawkes process blackboard with interactive parameter tuning
- **Infrastructure Topology** — SVG Mercator map of submarine cables, IXPs, cloud regions, and satellite bands
- **Geolocation** — MaxMind GeoLite2 offline IP geolocation (50k LRU cache)

---

## Architecture

```
CTI Feeds (DShield, GreyNoise, Abuse.ch)
    ↓ (async ingest)
MaxMind GeoLite2 → Event Store (SQLite/PostgreSQL)
    ↓ (spatial gridding, 2.5° resolution)
Grid Cells (~10k cells globally)
    ↓ (Hawkes MLE fitting, bootstrap CI)
HawkesParam (μ, β, n̂) → Nowcast (λ) → Forecast (6h/24h/72h)
    ↓ (REST API)
Three.js Globe UI ← FastAPI /v1/* endpoints
```

---

## Quick Start

### Prerequisites

| Component | Version | Purpose |
|-----------|---------|---------|
| Python | 3.11+ | Backend runtime |
| Node.js | 20 LTS+ | Frontend build toolchain |
| PostgreSQL | 16+ | Production database (SQLite for dev) |
| Docker | 24+ | Container orchestration (optional) |

### 1. Clone Repository

```bash
git clone https://github.com/kulpritsec/cyber_weather_mvp_hawkes.git
cd cyber_weather_mvp_hawkes
```

### 2. Backend Setup

```bash
cd backend
python -m venv .venv

# Activate virtual environment
# Windows:  .venv\Scripts\activate
# Linux/Mac: source .venv/bin/activate

pip install -r requirements.txt
```

### 3. MaxMind GeoLite2 Setup (required for live feeds)

1. Create a free MaxMind account: https://www.maxmind.com/en/geolite2/signup
2. Generate a license key under Account → Manage License Keys
3. Download `GeoLite2-City.mmdb` and place it at `/data/GeoLite2-City.mmdb`
   (or configure `CYBER_WEATHER_MAXMIND_DB_PATH` in `.env`)

### 4. Environment Configuration

```bash
cd backend
cp .env.example .env
# Edit .env — key settings listed below
```

Key `.env` variables:

```bash
CYBER_WEATHER_DATABASE_URL=sqlite:///./cyber_weather.db
CYBER_WEATHER_MAXMIND_DB_PATH=/data/GeoLite2-City.mmdb
CYBER_WEATHER_GREYNOISE_API_KEY=          # optional
CYBER_WEATHER_INGEST_INTERVAL_MIN=15
CYBER_WEATHER_FIT_INTERVAL_MIN=60
```

### 5. Start Backend

```bash
cd backend
python start.py
```

`start.py` runs the full pipeline: synthetic data generation → aggregation → Hawkes fitting → API server.
API available at **http://localhost:8000** — Swagger UI at **http://localhost:8000/docs**

### 6. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend available at **http://localhost:5173**

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /healthz` | Health check |
| `GET /v1/data?mode=nowcast&vector=ssh` | Current threat intensity (GeoJSON FeatureCollection) |
| `GET /v1/data?mode=forecast&vector=ssh&horizon=24` | Forecast at 6h / 24h / 72h horizon |
| `GET /v1/data?mode=params&vector=ssh` | Hawkes parameters (μ, β, n̂, stability) |
| `GET /v1/data?mode=contours&vector=ssh` | Threat contour polygons |
| `GET /v1/advisories?vector=ssh` | Active weather-style advisories |
| `GET /v1/summary` | Global threat level + per-vector summary |
| `GET /v1/vectors` | Available attack vectors with metadata |
| `GET /v1/context/events` | Recent raw event summary |
| `GET /v1/context/seasonal` | Seasonal threat patterns (monthly curves) |
| `GET /v1/context/campaigns` | Known threat actor campaign context |
| `GET /v1/context/forecast?vector=ssh` | 30-day Hawkes intensity series |
| `GET /v1/context/active` | Active events + elevated groups + seasonal snapshot |

Full documentation: **http://localhost:8000/docs**

---

## Frontend Panels

The Three.js globe (`CyberWeatherGlobe.tsx`) hosts several overlay panels activated via toolbar buttons:

| Button | Panel | Position |
|--------|-------|---------|
| `PCE` | Predictive Context Engine — live feed, arcs, forecasts | Right |
| `∫ λ(t)` | Math Lab — animated Hawkes blackboard with tunable parameters | Right |
| `🌐 NET` | Infrastructure Topology — submarine cables, IXPs, cloud regions, satellites | Left |

Press `Esc` to close all panels.

---

## Testing

```bash
cd backend
python -m pytest          # 54 tests (32 unit + 22 integration)
python -m pytest -v       # verbose output
python -m pytest tests/test_api.py -v   # API integration tests only
```

Test files:

| File | Coverage |
|------|----------|
| `tests/test_api.py` | All `/v1/*` API endpoints (integration) |
| `tests/test_hawkes_process.py` | Hawkes MLE fitting, bootstrap CI |
| `tests/test_models.py` | SQLAlchemy model round-trips |
| `tests/test_geo.py` | Geolocation + grid mapping utilities |

---

## Database Models

| Table | Purpose |
|-------|---------|
| `events` | Raw CTI events (ts, lat, lon, vector, count) |
| `gridcell` | 2.5° spatial grid cells |
| `hawkesparam` | Fitted Hawkes parameters (μ, β, n̂) with bootstrap std |
| `nowcast` | Current intensity λ + pressure + confidence |
| `forecast` | Projected intensity at 6h/24h/72h |
| `forecastsnapshot` | Historical parameter snapshots |
| `advisory` | Generated threat advisories |
| `vectorconfig` | Attack vector definitions and display config |

---

## CTI Feeds

| Feed | Data | Auth |
|------|------|------|
| DShield / SANS ISC | Port scans, brute force (50K–200K events/hr) | None |
| GreyNoise | IP classification, actor tags | Optional API key |
| Abuse.ch ThreatFox | Malware IOCs | None |
| Abuse.ch Feodo | Botnet C2 servers | None |

Ingest modules are in `backend/app/ingest/`.

---

## Docker Compose (Production)

```bash
cp backend/.env.example backend/.env
# Set CYBER_WEATHER_DATABASE_URL to PostgreSQL and configure secrets

docker compose up --build
# PostgreSQL: localhost:5432
# Backend API: localhost:8000
# Frontend:    localhost:80
```

---

## Configuration Reference

All env vars use the `CYBER_WEATHER_` prefix:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite:///./cyber_weather.db` | DB connection string |
| `MAXMIND_DB_PATH` | `/data/GeoLite2-City.mmdb` | GeoLite2 file path |
| `GREYNOISE_API_KEY` | — | GreyNoise key (optional) |
| `INGEST_INTERVAL_MIN` | `15` | Feed refresh interval |
| `FIT_INTERVAL_MIN` | `60` | Hawkes fitting interval |
| `MIN_EVENTS_FIT` | `50` | Min events per cell to fit |
| `HAWKES_BOOTSTRAP_SAMPLES` | `200` | Bootstrap iterations |
| `GRID_RESOLUTION_DEG` | `2.5` | Spatial grid resolution |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed CORS origins |

---

## Troubleshooting

**MaxMind database not found**
Download `GeoLite2-City.mmdb` and set `CYBER_WEATHER_MAXMIND_DB_PATH` in `.env`.

**DShield 429 rate limit**
Increase `CYBER_WEATHER_INGEST_INTERVAL_MIN` or add exponential backoff.

**GreyNoise 401**
Check `CYBER_WEATHER_GREYNOISE_API_KEY`. Leave blank to skip GreyNoise entirely.

**"no such table" in tests**
Ensure conftest uses `from app.db import Base, engine` — not `app.core.database`.

---

## Credits

- **MaxMind** — GeoLite2 geolocation database
- **SANS ISC** — DShield threat feed
- **GreyNoise** — IP classification and enrichment
- **Abuse.ch** — ThreatFox IOCs and Feodo Tracker
- **Three.js** — 3D globe visualization
- **FastAPI** — High-performance Python web framework
