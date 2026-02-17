# Cyber Weather Forecast — Hawkes Process MVP

Real-time cyber threat forecasting using self-exciting Hawkes point processes with 3D globe visualization and live CTI feed integration.

**Backend:** FastAPI · SQLAlchemy · PostgreSQL/SQLite · NumPy/SciPy · Hawkes MLE + Bootstrap
**Frontend:** React · Three.js · Vite · Interactive 3D Globe
**CTI Feeds:** DShield · GreyNoise · Abuse.ch · MaxMind GeoLite2
**Deployment:** Docker Compose · PostgreSQL · Nginx

---

## 🌍 Features

- **3D Globe Visualization** - Interactive threat intelligence globe powered by Three.js
- **Real-time CTI Integration** - Live data from DShield, GreyNoise, and Abuse.ch
- **Hawkes Process Forecasting** - Self-exciting point process modeling for attack prediction
- **Weather Metaphor UI** - Severity levels from Clear → Advisory → Watch → Warning → Emergency
- **Multi-Vector Analysis** - SSH, RDP, HTTP, DNS Amplification, Botnet C2, Ransomware
- **Geolocation** - MaxMind GeoLite2 offline IP geolocation (50k LRU cache)

---

## 📋 Architecture

```
CTI Feeds (DShield, GreyNoise, Abuse.ch)
    ↓ (async ingest)
MaxMind GeoLite2 → Event Store (PostgreSQL/SQLite)
    ↓ (spatial gridding)
Grid Cells (2.5° resolution, ~10k cells)
    ↓ (Hawkes MLE fitting)
HawkesParam (μ, β, n̂) → Nowcast (λ) → Forecast (6h/24h/72h)
    ↓ (REST API)
Three.js Globe UI ← /v1/data endpoints ← FastAPI Backend
```

---

## 🚀 Quick Start

### **Prerequisites**

| Component | Version | Purpose |
|-----------|---------|---------|
| Python | 3.11+ | Backend runtime |
| Node.js | 20 LTS+ | Frontend build toolchain |
| PostgreSQL | 16+ | Production database (optional, SQLite for dev) |
| Docker | 24+ | Container orchestration (optional) |
| Git | 2.40+ | Version control |

---

## 📦 Installation

### **1. Clone Repository**

```bash
git clone https://github.com/kulpritsec/cyber_weather_mvp_hawkes.git
cd cyber_weather_mvp_hawkes
```

### **2. Backend Setup**

#### **Install Python Dependencies**

```bash
cd backend
python -m venv .venv

# Activate virtual environment
# Windows:
.venv\Scripts\activate
# Linux/Mac:
source .venv/bin/activate

# Install all dependencies
pip install -r requirements.txt
```

#### **requirements.txt includes:**
```
# Core API
fastapi==0.114.2
uvicorn[standard]==0.30.6
pydantic==2.9.2
pydantic-settings==2.5.2

# Database
SQLAlchemy==2.0.35
alembic==1.13.2

# Data / Math
pandas==2.2.3
numpy==1.26.4
scipy==1.14.1
matplotlib==3.8.4

# Networking (threat feeds)
aiohttp==3.10.11

# Geolocation
geoip2==4.8.0  # MaxMind GeoLite2 support

# Utilities
python-dateutil==2.9.0.post0
geojson==3.1.0

# Testing
pytest==8.3.3
pytest-asyncio==0.24.0
httpx==0.27.2
```

### **3. MaxMind GeoLite2 Setup** ⚠️ **REQUIRED**

The CTI feed pipeline requires MaxMind GeoLite2 for IP geolocation.

#### **Download GeoLite2-City Database**

1. **Create free MaxMind account**: https://www.maxmind.com/en/geolite2/signup
2. **Generate license key**: Account → Manage License Keys
3. **Download database**:
   - Manual: https://www.maxmind.com/en/accounts/current/geoip/downloads
   - File: `GeoLite2-City.mmdb`
4. **Place database file**:
   ```bash
   # Option A: System location
   mkdir -p /data
   mv ~/Downloads/GeoLite2-City.mmdb /data/

   # Option B: Project location
   mkdir -p backend/data
   mv ~/Downloads/GeoLite2-City.mmdb backend/data/
   ```

#### **Alternative: Use geoipupdate (Recommended for Production)**

```bash
# Install geoipupdate
# Ubuntu/Debian:
sudo apt-get install geoipupdate

# macOS:
brew install geoipupdate

# Configure with your account ID and license key
sudo vi /etc/GeoIP.conf

# Run update
sudo geoipupdate
```

### **4. Environment Configuration**

```bash
cd backend
cp .env.example .env
```

**Edit `.env` with your settings:**

```bash
# Database (SQLite for dev, PostgreSQL for production)
CYBER_WEATHER_DATABASE_URL=sqlite:///./cyber_weather.db
# Production:
# CYBER_WEATHER_DATABASE_URL=postgresql://user:password@localhost:5432/cyber_weather

# MaxMind GeoLite2 (REQUIRED)
CYBER_WEATHER_MAXMIND_DB_PATH=/data/GeoLite2-City.mmdb
# Or if using project location:
# CYBER_WEATHER_MAXMIND_DB_PATH=./backend/data/GeoLite2-City.mmdb

# CTI Feed API Keys
# GreyNoise (optional - Community or Enterprise)
# Get from: https://viz.greynoise.io/signup
CYBER_WEATHER_GREYNOISE_API_KEY=

# Ingest & Pipeline Configuration
CYBER_WEATHER_INGEST_INTERVAL_MIN=15  # Ingest every 15 minutes
CYBER_WEATHER_FIT_INTERVAL_MIN=60     # Fit Hawkes model every hour
CYBER_WEATHER_MIN_EVENTS_FIT=50       # Min events per cell to fit

# Hawkes Model Settings
CYBER_WEATHER_HAWKES_MIN_EVENTS=50
CYBER_WEATHER_HAWKES_BOOTSTRAP_SAMPLES=200
CYBER_WEATHER_HAWKES_MAX_OPTIMIZATION_TIME=30

# Server
CYBER_WEATHER_SERVER_HOST=0.0.0.0
CYBER_WEATHER_SERVER_PORT=8000
CYBER_WEATHER_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# Environment
CYBER_WEATHER_ENV=development  # or production
```

### **5. Frontend Setup**

```bash
cd frontend
npm install
```

**Package.json dependencies:**
```json
{
  "dependencies": {
    "@types/three": "^0.169.0",
    "three": "^0.169.0",       // 3D globe rendering
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "d3-contour": "^4.0.2",    // Legacy map support
    "leaflet": "^1.9.4"
  }
}
```

---

## 🎯 Running the Application

### **Option 1: Development Mode (Recommended for Testing)**

#### **Start Backend**
```bash
cd backend
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Option A: Run full pipeline (synthetic data)
python start.py

# Option B: Step-by-step
python -m app.ingest.generate_synthetic --hours 24 --rate 1200
python -m app.services.aggregator --recalc
python -m app.services.hawkes_fit --hours 24
uvicorn app.main:app --reload --port 8000
```

Backend runs at: **http://localhost:8000**
API Docs: **http://localhost:8000/docs**

#### **Start Frontend**
```bash
cd frontend
npm run dev
```

Frontend runs at: **http://localhost:5173**

### **Option 2: Docker Compose (Production)**

```bash
# Copy environment file
cp backend/.env.example backend/.env
# Edit backend/.env and set DB_PASSWORD

# Build and start all services
docker compose up --build

# Services:
# - PostgreSQL: localhost:5432
# - Backend API: localhost:8000
# - Frontend: localhost:80
```

---

## 📡 CTI Feed Integration

### **Available CTI Feeds**

The platform integrates with multiple threat intelligence feeds for real-time data:

| Feed | Type | Volume | Rate Limit | Auth Required |
|------|------|--------|------------|---------------|
| **DShield/SANS ISC** | Port scans, brute force | 50K-200K events/hour | ~60 req/hour | No |
| **GreyNoise** | IP classification, actors | 500-1K IPs/batch | Community: 50/day<br>Enterprise: Bulk | Optional |
| **Abuse.ch ThreatFox** | Malware IOCs | 5K-20K IOCs | Reasonable use | No |
| **Abuse.ch Feodo** | Botnet C2 servers | Updated daily | Reasonable use | No |

### **CTI Feed Modules**

All feeds are in `backend/app/ingest/`:

```python
# backend/app/ingest/geolocation.py (195 lines)
# MaxMind GeoLite2 integration with LRU cache

# backend/app/ingest/dshield.py (353 lines)
# DShield/SANS ISC - primary high-volume feed

# backend/app/ingest/greynoise.py (328 lines)
# GreyNoise Community & Enterprise API

# backend/app/ingest/abusech.py (386 lines)
# Abuse.ch ThreatFox + Feodo Tracker
```

### **Manual CTI Ingest Test**

Test individual feeds to verify configuration:

```python
# Test script: backend/test_cti_feeds.py
import asyncio
from app.core.database import SessionLocal
from app.ingest import dshield, greynoise, abusech

async def test_feeds():
    session = SessionLocal()
    try:
        # Test DShield (no auth required)
        print("Testing DShield...")
        count = await dshield.ingest(session, hours_back=1)
        print(f"✓ DShield: {count} events inserted")

        # Test Abuse.ch (no auth required)
        print("\nTesting Abuse.ch...")
        count = await abusech.ingest(session, hours_back=1)
        print(f"✓ Abuse.ch: {count} events inserted")

        # Test GreyNoise (requires API key)
        if os.getenv("CYBER_WEATHER_GREYNOISE_API_KEY"):
            print("\nTesting GreyNoise...")
            count = await greynoise.ingest(session, hours_back=1)
            print(f"✓ GreyNoise: {count} events inserted")
        else:
            print("\n⚠ GreyNoise API key not configured, skipping")

    finally:
        session.close()

# Run test
asyncio.run(test_feeds())
```

**Run the test:**
```bash
cd backend
python test_cti_feeds.py
```

**Expected output:**
```
Testing DShield...
✓ DShield: 1,247 events inserted

Testing Abuse.ch...
✓ Abuse.ch: 342 events inserted

Testing GreyNoise...
✓ GreyNoise: 89 events inserted
```

### **Vector Classification**

CTI feeds are automatically classified into attack vectors:

| Vector | Classification Sources |
|--------|----------------------|
| **ssh** | Port 22, 23, SSH scanners |
| **rdp** | Port 3389, 445, RDP scanners |
| **http** | Port 80, 443, web scanners |
| **dns_amp** | Port 53 UDP, DNS amplifiers |
| **brute_force** | GreyNoise "bruteforcer" tag |
| **botnet_c2** | Feodo tracker, malware C2 |
| **ransomware** | ThreatFox ransomware families |

---

## 🔌 API Endpoints

| Endpoint | Description | Example |
|----------|-------------|---------|
| `GET /v1/data?mode=nowcast&vector=ssh&res=2.5` | Current threat intensity (GeoJSON) | Heatmap data |
| `GET /v1/data?mode=forecast&vector=ssh&horizon=24&res=2.5` | Forecasted threat levels | 6h/24h/72h projection |
| `GET /v1/data?mode=params&vector=ssh&res=2.5` | Hawkes parameters (μ, β, n̂) | Parameter visualization |
| `GET /v1/data?mode=contours&vector=ssh&horizon=24&levels=5` | Contour polygons | Threat contours |
| `GET /v1/advisories?vector=ssh` | Active advisories | Storm warnings |
| `GET /v1/vectors` | Available attack vectors | Vector configuration |
| `GET /health` | System health check | Status monitoring |

**Full API documentation:** http://localhost:8000/docs (Swagger UI)

---

## 🧪 Testing

### **Run Test Suite**

```bash
cd backend
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest tests/test_hawkes_process.py -v

# Run API tests
pytest tests/test_api.py -v
```

### **Test Files**

- `tests/test_api.py` - API endpoint integration tests
- `tests/test_hawkes_process.py` - Hawkes model unit tests
- `tests/test_models.py` - Database model tests
- `tests/test_geo.py` - Geolocation utility tests

---

## 📊 Database Models

### **Core Tables**

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| **events** | Raw CTI event storage | ts, lat, lon, vector, source_ip, severity_raw |
| **gridcell** | Spatial grid cells (2.5°) | lat_idx, lon_idx, lat_min/max, lon_min/max |
| **hawkesparam** | Fitted Hawkes parameters | mu (μ), beta (β), n_br (n̂), *_std |
| **nowcast** | Current threat intensity | intensity (λ), pressure, confidence |
| **forecast** | Predicted conditions | horizon_h, intensity, confidence |
| **forecastsnapshot** | Historical parameter tracking | run_id, run_ts, mu, beta, n_br |
| **advisory** | Generated threat alerts | severity, title, body, issued_at |
| **vectorconfig** | Attack vector definitions | name, color, category, enabled |

---

## 🛠️ Configuration Reference

### **Environment Variables**

All configuration uses the `CYBER_WEATHER_` prefix:

| Variable | Default | Description |
|----------|---------|-------------|
| `CYBER_WEATHER_DATABASE_URL` | `sqlite:///./cyber_weather.db` | Database connection string |
| `CYBER_WEATHER_MAXMIND_DB_PATH` | `/data/GeoLite2-City.mmdb` | MaxMind database file path |
| `CYBER_WEATHER_GREYNOISE_API_KEY` | `None` | GreyNoise API key (optional) |
| `CYBER_WEATHER_INGEST_INTERVAL_MIN` | `15` | CTI feed refresh interval (minutes) |
| `CYBER_WEATHER_FIT_INTERVAL_MIN` | `60` | Hawkes fitting interval (minutes) |
| `CYBER_WEATHER_MIN_EVENTS_FIT` | `50` | Minimum events per cell to fit |
| `CYBER_WEATHER_HAWKES_BOOTSTRAP_SAMPLES` | `200` | Bootstrap iterations for CI |
| `CYBER_WEATHER_GRID_RESOLUTION_DEG` | `2.5` | Spatial grid resolution (degrees) |
| `CYBER_WEATHER_CORS_ORIGINS` | `http://localhost:5173` | Allowed CORS origins |

See `backend/.env.example` for complete list.

---

## 🎨 Frontend 3D Globe

The frontend features an interactive Three.js globe with real-time threat visualization:

**Features:**
- Interactive rotation (drag) and zoom (scroll)
- Real-time hotspot markers color-coded by vector
- Attack arc visualizations between source/target
- Live threat statistics panels
- Severity-based color gradients (Clear → Emergency)
- Atmospheric effects (glow, scanlines, vignette)

**Component:** `frontend/src/components/CyberWeatherGlobe.tsx` (874 lines)

---

## 📝 Development Runbook

For detailed implementation guidance, see:
`C:\Users\Seanw\Downloads\threat weather map\Cyber_Weather_MVP_Development_Runbook.docx`

The runbook contains:
- Complete Claude Code prompts for each component
- Backend data pipeline specifications
- Frontend UI component build sequence
- Testing strategies
- Deployment checklists

---

## 🐛 Troubleshooting

### **MaxMind Database Not Found**
```
Error: MaxMind database not found at /data/GeoLite2-City.mmdb
```
**Solution:** Download GeoLite2-City.mmdb and set `CYBER_WEATHER_MAXMIND_DB_PATH` correctly.

### **Import Error: geoip2**
```
ModuleNotFoundError: No module named 'geoip2'
```
**Solution:** `pip install geoip2==4.8.0`

### **DShield Rate Limited**
```
WARNING: DShield rate limited (429)
```
**Solution:** Increase backoff time or reduce request frequency. DShield has soft limit of ~60 req/hour.

### **GreyNoise Authentication Failed**
```
ERROR: GreyNoise API returned 401
```
**Solution:** Check `CYBER_WEATHER_GREYNOISE_API_KEY` in `.env`. Leave blank to skip GreyNoise.

---

## 📄 License

Internal development project. All rights reserved.

---

## 🙏 Credits

- **MaxMind** - GeoLite2 geolocation database
- **SANS ISC** - DShield threat feed
- **GreyNoise** - IP classification and enrichment
- **Abuse.ch** - ThreatFox IOCs and Feodo Tracker
- **Three.js** - 3D globe visualization
- **FastAPI** - High-performance Python web framework
