# Cyber Weather Forecast — Backend (FastAPI) with Hawkes Forecast

## Quickstart
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1) Generate synthetic events
python -m app.ingest.generate_synthetic --hours 24 --rate 1200

# 2) Build nowcast (EWMA)
python -m app.services.aggregator --recalc

# 3) Fit Hawkes per hot (cell,vector) and update forecasts
python -m app.services.hawkes_fit --hours 24 --min-events 50

# 4) Run API
uvicorn app.main:app --reload --port 8000
```
