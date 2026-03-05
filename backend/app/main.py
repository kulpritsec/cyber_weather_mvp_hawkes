from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .db import Base, engine
from .routers.unified import router as unified_router
from .routers.nowcast import router as nowcast_router
from .routers.forecast import router as forecast_router
from .routers.advisory import router as advisory_router
from .routers.params import router as params_router
from app.routers.vuln_router import router as vuln_router
from app.routers.ioc_enrichment import router as ioc_router
from app.routers.ttp_heatmap import router as ttp_router
from .routers.shodan_router import router as shodan_router
from .routers.podcast_feeds import router as podcast_router
from .services.pipeline import start_scheduler, stop_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle - startup and shutdown events"""
    # Startup: Initialize database and start pipeline scheduler
    Base.metadata.create_all(bind=engine)
    start_scheduler()
    yield
    # Shutdown: Stop pipeline scheduler
    stop_scheduler()

app = FastAPI(
    title="Cyber Weather Forecast API (Hawkes)",
    version="0.3.0",
    lifespan=lifespan
)

# Add CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/healthz")
def healthz(): return {"status": "healthy", "ok": True}

@app.get("/")
def root():
    return {
        "service": "Cyber Weather Forecast API",
        "version": "0.3.0",
        "endpoints": ["/healthz", "/v1/data", "/v1/advisories", "/v1/summary",
                      "/v1/vectors", "/v1/context/events", "/v1/context/seasonal",
                      "/v1/context/campaigns", "/v1/context/forecast", "/v1/context/active"],
    }

# Include the unified router first (for the new /v1/data endpoint)
app.include_router(unified_router)
app.include_router(ioc_router)

# Keep legacy endpoints for backward compatibility
app.include_router(nowcast_router)
app.include_router(forecast_router)
app.include_router(advisory_router)
app.include_router(params_router)
app.include_router(vuln_router)
app.include_router(ttp_router)
app.include_router(shodan_router)
app.include_router(podcast_router)
