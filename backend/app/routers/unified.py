from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional, AsyncGenerator
import numpy as np
import asyncio
import json
try:
    from scipy.interpolate import griddata
    from matplotlib import pyplot as plt
    import matplotlib.patches as patches
    CONTOURS_AVAILABLE = True
except ImportError:
    CONTOURS_AVAILABLE = False
from ..db import SessionLocal
from ..models import Nowcast, Forecast, HawkesParam, Advisory, GridCell, Event
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
    mode: str = Query("nowcast", regex="^(nowcast|forecast|params|contours)$"),
    vector: str = Query("ssh"), 
    horizon: Optional[int] = Query(24), 
    res: float = Query(2.5),
    levels: Optional[int] = Query(5),
    db: Session = Depends(get_db)
):
    """Unified endpoint for all cyber weather data types"""
    
    if mode == "nowcast":
        return _get_nowcast_data(vector, res, db)
    elif mode == "forecast":
        return _get_forecast_data(vector, horizon or 24, res, db)
    elif mode == "contours":
        return _get_contour_data(vector, horizon or 24, res, levels or 5, db)
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

@router.get("/pipeline/status")
def get_pipeline_status():
    """Get pipeline orchestrator health status and scheduler information"""
    from ..services.pipeline import get_pipeline_status
    return get_pipeline_status()

@router.get("/events/stream")
async def stream_events(request: Request, db: Session = Depends(get_db)):
    """
    Server-Sent Events endpoint for real-time threat event streaming

    - Sends 50 most recent events on connect
    - Polls for new events every 2 seconds
    - Sends keepalive every 15 seconds
    - Supports Last-Event-ID header for reconnection
    """

    def derive_action(vector: str, port: Optional[int]) -> str:
        """Derive human-readable action from vector and port"""
        action_map = {
            ('ssh', 22): 'SSH Brute Force',
            ('ssh', 23): 'Telnet Brute Force',
            ('rdp', 3389): 'RDP Spray Attack',
            ('rdp', 445): 'SMB Enumeration',
            ('http', 80): 'HTTP Web Probe',
            ('http', 443): 'HTTPS Web Probe',
            ('dns_amp', 53): 'DNS Amplification',
            ('brute_force', None): 'Credential Stuffing',
            ('botnet_c2', None): 'Botnet C2 Communication',
            ('ransomware', None): 'Ransomware Activity',
        }

        # Try exact match first
        key = (vector, port)
        if key in action_map:
            return action_map[key]

        # Fallback to vector-only match
        for (v, p), action in action_map.items():
            if v == vector and p is None:
                return action

        # Default
        return f"{vector.upper()} Activity"

    def format_event(event: Event, event_id: int) -> str:
        """Format event as SSE message"""
        event_data = {
            'id': event_id,
            'ts': event.ts.isoformat() if event.ts else datetime.now(timezone.utc).isoformat(),
            'vector': event.vector,
            'source_ip': event.source_ip,
            'source_country': event.source_country or 'XX',
            'target_port': event.target_port,
            'lat': float(event.lat),
            'lon': float(event.lon),
            'action': derive_action(event.vector, event.target_port),
            'severity': float(event.severity_raw) if event.severity_raw else 0.5,
            'count': event.count or 1,
        }

        return f"id: {event_id}\ndata: {json.dumps(event_data)}\n\n"

    async def event_generator() -> AsyncGenerator[str, None]:
        """Generate SSE stream"""
        # Get Last-Event-ID from header for reconnection support
        last_event_id = request.headers.get('Last-Event-ID', '0')
        try:
            last_id = int(last_event_id)
        except ValueError:
            last_id = 0

        # Send initial burst of 50 most recent events
        recent_events = db.query(Event).order_by(Event.ts.desc()).limit(50).all()

        for idx, event in enumerate(reversed(recent_events), start=last_id + 1):
            yield format_event(event, idx)

        current_id = last_id + len(recent_events)
        last_seen_ts = recent_events[0].ts if recent_events else datetime.now(timezone.utc)
        last_keepalive = datetime.now()

        # Stream new events as they arrive
        while True:
            # Check if client disconnected
            if await request.is_disconnected():
                break

            # Poll for new events
            new_events = db.query(Event).filter(
                Event.ts > last_seen_ts
            ).order_by(Event.ts.asc()).limit(100).all()

            if new_events:
                for event in new_events:
                    current_id += 1
                    yield format_event(event, current_id)
                    last_seen_ts = event.ts

            # Send keepalive comment if no events
            now = datetime.now()
            if (now - last_keepalive).total_seconds() > 15:
                yield ": keepalive\n\n"
                last_keepalive = now

            # Wait 2 seconds before next poll
            await asyncio.sleep(2)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )

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

def _get_contour_data(vector: str, horizon: int, res: float, levels: int, db: Session) -> FeatureCollection:
    """Generate contour lines from grid cell intensity data"""
    if not CONTOURS_AVAILABLE:
        return FeatureCollection(type="FeatureCollection", features=[])
    
    # Get grid data (use forecast data for contours)
    cells = db.query(GridCell).all()
    if not cells:
        return FeatureCollection(type="FeatureCollection", features=[])
    
    # Collect lat, lon, intensity data
    lats, lons, intensities = [], [], []
    for cell in cells:
        forecast = db.query(Forecast).filter_by(
            grid_id=cell.id, vector=vector, horizon_h=horizon
        ).first()
        
        if forecast and forecast.intensity > 0:
            lats.append(cell.lat_center)
            lons.append(cell.lon_center)
            intensities.append(forecast.intensity)
    
    if len(lats) < 4:  # Need at least 4 points for interpolation
        return FeatureCollection(type="FeatureCollection", features=[])
    
    # Create interpolation grid
    lat_min, lat_max = min(lats), max(lats)
    lon_min, lon_max = min(lons), max(lons)
    
    # Create a finer grid for smooth contours
    grid_resolution = 50
    lat_grid = np.linspace(lat_min, lat_max, grid_resolution)
    lon_grid = np.linspace(lon_min, lon_max, grid_resolution)
    lon_mesh, lat_mesh = np.meshgrid(lon_grid, lat_grid)
    
    # Interpolate intensity values
    points = np.column_stack((lats, lons))
    intensity_grid = griddata(points, intensities, (lat_mesh, lon_mesh), method='cubic', fill_value=0)
    
    # Generate contour levels
    max_intensity = max(intensities)
    contour_levels = np.linspace(0.1 * max_intensity, max_intensity, levels)
    
    # Generate contours using matplotlib
    fig, ax = plt.subplots(figsize=(1, 1))
    cs = ax.contour(lon_mesh, lat_mesh, intensity_grid, levels=contour_levels)
    plt.close(fig)
    
    # Convert contours to GeoJSON features
    features = []
    for i, collection in enumerate(cs.collections):
        contour_level = contour_levels[i] if i < len(contour_levels) else 0
        for path in collection.get_paths():
            # Convert matplotlib path to coordinates
            vertices = path.vertices
            if len(vertices) < 3:
                continue
                
            coordinates = [[float(lon), float(lat)] for lon, lat in vertices]
            
            # Close the polygon if not already closed
            if coordinates[0] != coordinates[-1]:
                coordinates.append(coordinates[0])
            
            feature = GeoFeature(
                type="Feature",
                geometry={
                    "type": "LineString",
                    "coordinates": coordinates
                },
                properties={
                    "contour_level": float(contour_level),
                    "vector": vector,
                    "horizon_h": horizon,
                    "type": "contour"
                }
            )
            features.append(feature)
    
    return FeatureCollection(type="FeatureCollection", features=features)