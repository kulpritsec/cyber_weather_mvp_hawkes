from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .db import Base, engine
from .routers.nowcast import router as nowcast_router
from .routers.forecast import router as forecast_router
from .routers.advisory import router as advisory_router
from .routers.params import router as params_router

Base.metadata.create_all(bind=engine)
app = FastAPI(title="Cyber Weather Forecast API (Hawkes)", version="0.2.0")

# Add CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/healthz")
def healthz(): return {"ok": True}

app.include_router(nowcast_router)
app.include_router(forecast_router)
app.include_router(advisory_router)
app.include_router(params_router)
