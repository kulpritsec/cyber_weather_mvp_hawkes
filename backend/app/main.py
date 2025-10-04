from fastapi import FastAPI
from .db import Base, engine
from .routers.nowcast import router as nowcast_router
from .routers.forecast import router as forecast_router
from .routers.advisory import router as advisory_router

Base.metadata.create_all(bind=engine)
app = FastAPI(title="Cyber Weather Forecast API (Hawkes)", version="0.2.0")

@app.get("/healthz")
def healthz(): return {"ok": True}

app.include_router(nowcast_router)
app.include_router(forecast_router)
app.include_router(advisory_router)
