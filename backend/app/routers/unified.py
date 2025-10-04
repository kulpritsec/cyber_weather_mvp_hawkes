from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from ..db import SessionLocal
from ..models import Nowcast, Forecast, HawkesParam, Advisory, GridCell
from ..schemas import FeatureCollection, GeoFeature, AdvisoryOut
from ..utils.geo import cell_polygon
from datetime import datetime, timedelta, timezone

router = APIRouter(prefix="/v1")

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

@router.get("/data", response_model=FeatureCollection)
def get_cyber_data(
    mode: str = Query("nowcast", regex="^(nowcast|forecast|params)$"),
    vector: str = Query("ssh"), 
    horizon: Optional[int] = Query(24), 
    res: float = Query(2.5), 
    db: Session = Depends(get_db)
):
    """Unified endpoint for all cyber weather data types"""
    
    if mode == "nowcast":
        return _get_nowcast_data(vector, res, db)
    elif mode == "forecast":
        return _get_forecast_data(vector, horizon or 24, res, db)
    elif mode == "params":
        return _get_params_data(vector, res, db)
    else:
        raise ValueError(f"Invalid mode: {mode}")

def _get_nowcast_data(vector: str, res: float, db: Session) -> FeatureCollection:
    """Get nowcast data"""
    q = db.query(Nowcast, GridCell).join(GridCell, Nowcast.grid_id == GridCell.id) \
           .filter(Nowcast.vector == vector, GridCell.res_deg == res)
    max_p = max([nc.pressure for nc, _ in q] + [1.0])
    
    features = []
    for nc, cell in q:
        geom = cell_polygon(cell.lat_min, cell.lat_max, cell.lon_min, cell.lon_max)
        props = {
            "grid_id": cell.id, "vector": nc.vector, "mode": "nowcast",
            "intensity": nc.intensity, "pressure": nc.pressure / max_p, 
            "confidence": nc.confidence, "updated_at": nc.updated_at.isoformat()
        }
        features.append(GeoFeature(geometry=geom, properties=props))
    return FeatureCollection(features=features)

def _get_forecast_data(vector: str, horizon: int, res: float, db: Session) -> FeatureCollection:
    """Get forecast data"""
    q = db.query(Forecast, GridCell).join(GridCell, Forecast.grid_id == GridCell.id) \
           .filter(Forecast.vector == vector, Forecast.horizon_h == horizon, GridCell.res_deg == res)
    max_i = max([fc.intensity for fc, _ in q] + [1.0])
    
    features = []
    for fc, cell in q:
        geom = cell_polygon(cell.lat_min, cell.lat_max, cell.lon_min, cell.lon_max)
        props = {
            "grid_id": cell.id, "vector": fc.vector, "mode": "forecast",
            "intensity": fc.intensity, "normalized": fc.intensity / max_i, 
            "confidence": fc.confidence, "horizon_h": fc.horizon_h,
            "updated_at": fc.updated_at.isoformat()
        }
        features.append(GeoFeature(geometry=geom, properties=props))
    return FeatureCollection(features=features)

def _get_params_data(vector: str, res: float, db: Session) -> FeatureCollection:
    """Get Hawkes parameters data"""
    q = db.query(HawkesParam, GridCell).join(GridCell, HawkesParam.grid_id == GridCell.id) \
           .filter(HawkesParam.vector == vector, GridCell.res_deg == res)
    
    features = []
    for hp, cell in q:
        geom = cell_polygon(cell.lat_min, cell.lat_max, cell.lon_min, cell.lon_max)
        props = {
            "grid_id": cell.id, "vector": hp.vector, "mode": "params",
            "mu": hp.mu, "beta": hp.beta, "n_br": hp.n_br,
            "alpha": hp.n_br * hp.beta, 
            "mu_std": hp.mu_std or 0.0, "beta_std": hp.beta_std or 0.0, "n_br_std": hp.n_br_std or 0.0,
            "stability": "stable" if hp.n_br < 1.0 else "unstable",
            "updated_at": hp.updated_at.isoformat()
        }
        features.append(GeoFeature(geometry=geom, properties=props))
    return FeatureCollection(features=features)

@router.get("/advisories", response_model=list[AdvisoryOut])
def get_advisories(vector: str = Query("ssh"), db: Session = Depends(get_db)):
    """Get security advisories based on current threat levels"""
    now = datetime.now(timezone.utc)
    q = db.query(Nowcast).filter(Nowcast.vector == vector).order_by(Nowcast.intensity.desc()).limit(5).all()
    
    advisories = []
    for i, nc in enumerate(q, start=1):
        advisories.append(AdvisoryOut(
            id=i, vector=vector, 
            title=f"{vector.upper()} Storm Watch — Cell {nc.grid_id}",
            details=f"Elevated hostile activity (intensity={nc.intensity:.1f}, conf={nc.confidence:.2f}). Consider step-up auth, reduced token TTL, and micro-segmentation.",
            severity="watch" if i > 2 else "warning", 
            region=str(nc.grid_id),
            start_time=now.isoformat(), 
            end_time=(now + timedelta(hours=6)).isoformat(), 
            confidence=nc.confidence
        ))
    return advisories

@router.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "cyber-weather-api", "version": "0.3.0"}

# Legacy compatibility endpoints
@router.get("/nowcast", response_model=FeatureCollection)
def get_nowcast_legacy(vector: str = Query("ssh"), res: float = Query(2.5), db: Session = Depends(get_db)):
    """Legacy nowcast endpoint for backward compatibility"""
    return _get_nowcast_data(vector, res, db)

@router.get("/forecast", response_model=FeatureCollection)
def get_forecast_legacy(vector: str = Query("ssh"), horizon: int = Query(24), res: float = Query(2.5), db: Session = Depends(get_db)):
    """Legacy forecast endpoint for backward compatibility"""
    return _get_forecast_data(vector, horizon, res, db)

@router.get("/params", response_model=FeatureCollection)
def get_params_legacy(vector: str = Query("ssh"), res: float = Query(2.5), db: Session = Depends(get_db)):
    """Legacy params endpoint for backward compatibility"""
    return _get_params_data(vector, res, db)