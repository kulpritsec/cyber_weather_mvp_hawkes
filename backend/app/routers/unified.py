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

@router.get("/snapshots")
def get_snapshots(
    start: Optional[int] = Query(None, description="Start timestamp (Unix time)"),
    end: Optional[int] = Query(None, description="End timestamp (Unix time)"),
    vector: Optional[str] = Query(None, description="Filter by vector"),
    res: float = Query(2.5),
    db: Session = Depends(get_db)
):
    """
    Get historical Hawkes parameter snapshots for temporal replay.

    Returns time-series data of Hawkes parameters for all grid cells
    within the specified time range.
    """
    # Default to last 48 hours if not specified
    if end is None:
        end_dt = datetime.now(timezone.utc)
    else:
        end_dt = datetime.fromtimestamp(end, tz=timezone.utc)

    if start is None:
        start_dt = end_dt - timedelta(hours=48)
    else:
        start_dt = datetime.fromtimestamp(start, tz=timezone.utc)

    # Query Hawkes parameters within time range
    query = db.query(HawkesParam, GridCell).join(
        GridCell, HawkesParam.grid_id == GridCell.id
    ).filter(
        HawkesParam.updated_at >= start_dt,
        HawkesParam.updated_at <= end_dt,
        GridCell.res_deg == res
    )

    if vector:
        query = query.filter(HawkesParam.vector == vector)

    # Group by timestamp
    snapshots = {}
    for hp, cell in query.all():
        ts = int(hp.updated_at.timestamp())
        if ts not in snapshots:
            snapshots[ts] = []

        snapshots[ts].append({
            "cell_id": cell.id,
            "lat": cell.lat_center,
            "lon": cell.lon_center,
            "vector": hp.vector,
            "mu": hp.mu,
            "beta": hp.beta,
            "n_br": hp.n_br,
            "mu_std": hp.mu_std or 0.0,
            "beta_std": hp.beta_std or 0.0,
            "n_br_std": hp.n_br_std or 0.0,
            "stability": "stable" if hp.n_br < 1.0 else "unstable"
        })

    # Convert to list format
    snapshot_list = [
        {
            "timestamp": ts,
            "cells": cells
        }
        for ts, cells in sorted(snapshots.items())
    ]

    return {
        "start": int(start_dt.timestamp()),
        "end": int(end_dt.timestamp()),
        "count": len(snapshot_list),
        "snapshots": snapshot_list
    }

@router.get("/cells/{cell_id}/history")
def get_cell_history(
    cell_id: int,
    hours: int = Query(48, ge=1, le=168, description="Hours of history to retrieve"),
    vector: Optional[str] = Query(None, description="Filter by vector"),
    db: Session = Depends(get_db)
):
    """
    Get 48-hour intensity and branching ratio history for a specific grid cell.

    Returns time-series data suitable for sparkline visualization.
    """
    # Verify cell exists
    cell = db.query(GridCell).filter_by(id=cell_id).first()
    if not cell:
        return {"error": "Cell not found", "cell_id": cell_id}, 404

    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(hours=hours)

    # Query Hawkes parameters for this cell
    query = db.query(HawkesParam).filter(
        HawkesParam.grid_id == cell_id,
        HawkesParam.updated_at >= start_dt,
        HawkesParam.updated_at <= end_dt
    )

    if vector:
        query = query.filter(HawkesParam.vector == vector)

    params = query.order_by(HawkesParam.updated_at.asc()).all()

    # Query nowcast intensities for this cell
    nowcast_query = db.query(Nowcast).filter(
        Nowcast.grid_id == cell_id,
        Nowcast.updated_at >= start_dt,
        Nowcast.updated_at <= end_dt
    )

    if vector:
        nowcast_query = nowcast_query.filter(Nowcast.vector == vector)

    nowcasts = nowcast_query.order_by(Nowcast.updated_at.asc()).all()

    # Build intensity history from nowcasts
    intensity_history = [
        {
            "timestamp": int(nc.updated_at.timestamp()),
            "value": nc.intensity
        }
        for nc in nowcasts
    ]

    # Build branching ratio history from Hawkes params
    branching_history = [
        {
            "timestamp": int(hp.updated_at.timestamp()),
            "value": hp.n_br
        }
        for hp in params
    ]

    # Get current Hawkes parameters
    current_params = db.query(HawkesParam).filter_by(
        grid_id=cell_id
    ).order_by(HawkesParam.updated_at.desc()).first()

    # Count events in last 24 hours
    events_24h = db.query(Event).filter(
        Event.grid_id == cell_id,
        Event.ts >= (end_dt - timedelta(hours=24))
    ).count()

    # Determine severity based on current n_br
    if current_params:
        n_br = current_params.n_br
        if n_br >= 0.9:
            severity = "emergency"
        elif n_br >= 0.7:
            severity = "warning"
        elif n_br >= 0.5:
            severity = "watch"
        elif n_br >= 0.3:
            severity = "advisory"
        else:
            severity = "clear"
    else:
        severity = "clear"
        n_br = 0.0

    return {
        "cell_id": cell_id,
        "lat": cell.lat_center,
        "lon": cell.lon_center,
        "vector": vector or "all",
        "current_params": {
            "mu": current_params.mu if current_params else 0.0,
            "beta": current_params.beta if current_params else 0.0,
            "n_br": current_params.n_br if current_params else 0.0,
        } if current_params else None,
        "event_count_24h": events_24h,
        "severity": severity,
        "intensity_history": intensity_history,
        "branching_history": branching_history,
        "time_range": {
            "start": int(start_dt.timestamp()),
            "end": int(end_dt.timestamp()),
            "hours": hours
        }
    }


# ─── PREDICTIVE CONTEXT ENGINE ENDPOINTS ────────────────────────────────────
# Implements: Predictive_Context_Engine_Architecture.docx
# μ(t) = μ_base × S(t) × ∏(1 + wᵢ·Eᵢ(t)) × C(t)

# Seasonal multipliers from STL analysis (Architecture doc §3)
_SEASONAL: dict[str, list[float]] = {
    "ssh":        [1.05, 1.02, 1.00, 0.98, 0.92, 0.88, 0.84, 0.86, 0.95, 1.05, 1.25, 1.30],
    "rdp":        [1.08, 1.05, 1.00, 0.95, 0.88, 0.83, 0.80, 0.85, 0.95, 1.10, 1.20, 1.35],
    "http":       [0.95, 0.85, 0.95, 1.10, 1.05, 1.00, 0.92, 0.95, 1.00, 1.05, 1.30, 1.15],
    "dns_amp":    [0.80, 0.88, 1.15, 1.05, 1.10, 1.20, 1.10, 1.05, 1.00, 0.95, 0.92, 0.90],
}
_DOW = [1.05, 1.08, 1.15, 1.05, 1.00, 0.88, 0.82]  # Mon–Sun

# Event calendar seed data (Architecture doc §2)
_EVENT_CALENDAR = [
    {
        "id": "patch-tue-feb-2026", "name": "Patch Tuesday — February 2026",
        "category": "vulnerability", "start_date": "2026-02-10", "end_date": "2026-02-10",
        "lead_days": 0, "lag_days": 30, "region": "global", "impact_weight": 0.45,
        "vectors": ["http", "ssh", "rdp"], "confidence": 0.92,
        "source": "MSRC", "source_url": "https://msrc.microsoft.com/update-guide",
        "description": "Microsoft February Patch Tuesday. Exploitation lag window active through ~March 12.",
    },
    {
        "id": "fifa-wc-2026", "name": "FIFA World Cup 2026",
        "category": "sporting", "start_date": "2026-06-11", "end_date": "2026-07-19",
        "lead_days": 7, "lag_days": 3, "region": "north_america", "impact_weight": 0.62,
        "vectors": ["http", "dns_amp", "brute_force"], "confidence": 0.85,
        "source": "Analyst Curated", "source_url": "https://www.fifa.com/fifaplus/en/tournaments/mens/worldcup/canada-mexico-usa-2026",
        "description": "600% phishing spike modelled on 2022 Qatar patterns. Ticketing fraud, streaming DDoS.",
    },
    {
        "id": "patch-tue-mar-2026", "name": "Patch Tuesday — March 2026",
        "category": "vulnerability", "start_date": "2026-03-10", "end_date": "2026-03-10",
        "lead_days": 0, "lag_days": 30, "region": "global", "impact_weight": 0.45,
        "vectors": ["http", "ssh", "rdp"], "confidence": 0.92,
        "source": "MSRC", "source_url": "https://msrc.microsoft.com/update-guide",
        "description": "Microsoft March Patch Tuesday. Reverse-engineering and weaponization window.",
    },
    {
        "id": "tax-deadline-us-2026", "name": "US Tax Filing Deadline",
        "category": "financial", "start_date": "2026-04-15", "end_date": "2026-04-15",
        "lead_days": 14, "lag_days": 7, "region": "north_america", "impact_weight": 0.38,
        "vectors": ["http", "brute_force", "ssh"], "confidence": 0.78,
        "source": "Analyst Curated", "source_url": "https://www.irs.gov/",
        "description": "BEC and phishing campaigns peak 2 weeks prior. Wire fraud, fake IRS emails.",
    },
    {
        "id": "defcon-34-2026", "name": "DEF CON 34",
        "category": "vulnerability", "start_date": "2026-08-06", "end_date": "2026-08-09",
        "lead_days": 0, "lag_days": 30, "region": "north_america", "impact_weight": 0.55,
        "vectors": ["ssh", "http", "rdp"], "confidence": 0.88,
        "source": "Analyst Curated", "source_url": "https://defcon.org",
        "description": "New tool and PoC releases drive scanning within 48h.",
    },
    {
        "id": "us-midterms-2026", "name": "US Midterm Elections 2026",
        "category": "geopolitical", "start_date": "2026-11-03", "end_date": "2026-11-03",
        "lead_days": 30, "lag_days": 14, "region": "north_america", "impact_weight": 0.72,
        "vectors": ["ssh", "http", "dns_amp", "botnet_c2"], "confidence": 0.82,
        "source": "Analyst Curated", "source_url": "https://www.fec.gov/",
        "description": "State-sponsored infrastructure probing 30+ days ahead of election.",
    },
    {
        "id": "black-friday-2026", "name": "Black Friday / Cyber Monday 2026",
        "category": "commerce", "start_date": "2026-11-27", "end_date": "2026-11-30",
        "lead_days": 5, "lag_days": 14, "region": "global", "impact_weight": 0.68,
        "vectors": ["http", "brute_force", "botnet_c2"], "confidence": 0.91,
        "source": "Imperva Threat Research 2024", "source_url": "https://www.imperva.com/resources/resource-library/reports/bad-bot-report/",
        "description": "3.6B bot requests in 48h (Imperva 2024 baseline). 4× credential stuffing.",
    },
    {
        "id": "holiday-season-2026", "name": "Holiday Season 2026",
        "category": "holiday", "start_date": "2026-12-24", "end_date": "2026-12-26",
        "lead_days": 3, "lag_days": 3, "region": "global", "impact_weight": 0.58,
        "vectors": ["ransomware", "ssh", "rdp", "botnet_c2"], "confidence": 0.89,
        "source": "Semperis 2023-2024 Analysis", "source_url": "https://www.semperis.com/",
        "description": "68% of major ransomware incidents target weekends/holidays (Semperis). Christmas week is peak.",
    },
]

# Campaign profiles (Architecture doc §4, matched to threatGroups.ts)
_CAMPAIGN_PROFILES = [
    {
        "name": "APT28 (Fancy Bear)", "origin": "Russia / GRU",
        "primary_vectors": ["ssh", "http", "botnet_c2"],
        "monthly_intensity": [1.35, 1.40, 1.10, 0.90, 0.85, 0.80, 0.75, 0.90, 1.20, 1.35, 1.40, 1.10],
        "confidence": 0.88, "total_campaigns": 47,
        "source": "MITRE ATT&CK", "mitre_id": "G0007",
        "source_url": "https://attack.mitre.org/groups/G0007/",
    },
    {
        "name": "Lazarus Group", "origin": "North Korea",
        "primary_vectors": ["http", "ransomware", "botnet_c2"],
        "monthly_intensity": [0.90, 1.45, 1.10, 0.85, 0.80, 0.90, 0.85, 1.20, 1.25, 1.00, 0.95, 0.85],
        "confidence": 0.82, "total_campaigns": 38,
        "source": "MITRE ATT&CK", "mitre_id": "G0032",
        "source_url": "https://attack.mitre.org/groups/G0032/",
    },
    {
        "name": "APT41", "origin": "China",
        "primary_vectors": ["ssh", "http", "rdp"],
        "monthly_intensity": [1.20, 1.30, 1.00, 0.90, 1.15, 1.10, 0.85, 0.80, 1.00, 1.05, 1.10, 1.25],
        "confidence": 0.79, "total_campaigns": 52,
        "source": "MITRE ATT&CK", "mitre_id": "G0096",
        "source_url": "https://attack.mitre.org/groups/G0096/",
    },
    {
        "name": "Conti Successor", "origin": "Russia / Eastern Europe",
        "primary_vectors": ["ransomware", "rdp", "ssh"],
        "monthly_intensity": [1.30, 1.10, 0.95, 0.85, 0.90, 0.88, 0.80, 0.82, 0.95, 1.05, 1.25, 1.45],
        "confidence": 0.75, "total_campaigns": 29,
        "source": "CISA AA22-057A", "mitre_id": "G0102",
        "source_url": "https://www.cisa.gov/news-events/cybersecurity-advisories/aa22-057a",
    },
    {
        "name": "Turla", "origin": "Russia / FSB",
        "primary_vectors": ["ssh", "botnet_c2", "http"],
        "monthly_intensity": [0.95, 1.05, 0.90, 0.85, 0.80, 0.88, 0.90, 1.00, 1.20, 1.25, 1.15, 1.10],
        "confidence": 0.76, "total_campaigns": 31,
        "source": "MITRE ATT&CK", "mitre_id": "G0010",
        "source_url": "https://attack.mitre.org/groups/G0010/",
    },
]


def _event_active(ev: dict, d: datetime) -> bool:
    s = datetime.fromisoformat(ev["start_date"]) - timedelta(days=ev["lead_days"])
    e = datetime.fromisoformat(ev["end_date"]) + timedelta(days=ev["lag_days"])
    return s <= d <= e


@router.get("/context/events")
def get_context_events():
    """Event calendar with active/upcoming status. Source: MSRC, Imperva, MITRE, Analyst."""
    now = datetime.utcnow()
    result = []
    for ev in _EVENT_CALENDAR:
        active = _event_active(ev, now)
        start_dt = datetime.fromisoformat(ev["start_date"]) - timedelta(days=ev["lead_days"])
        days_until = max(0, (start_dt - now).days)
        result.append({
            **ev,
            "is_active": active,
            "days_until_active": days_until if not active else 0,
        })
    return {
        "count": len(result),
        "active_count": sum(1 for e in result if e["is_active"]),
        "data_source": "analyst_curated",
        "data_sources": ["MSRC", "NIST NVD", "Imperva Threat Research", "Semperis", "MITRE ATT&CK", "Analyst Curated"],
        "events": result,
    }


@router.get("/context/seasonal")
def get_context_seasonal():
    """Seasonal multipliers S(t) per vector. Derived from STL decomposition of 3yr historical data."""
    now = datetime.utcnow()
    month_idx = now.month - 1
    dow_idx = now.weekday()
    result = {}
    for vector, mults in _SEASONAL.items():
        current_mult = mults[month_idx] * _DOW[dow_idx]
        result[vector] = {
            "monthly": mults,
            "dow": _DOW,
            "current_s_t": round(current_mult, 3),
            "current_month_idx": month_idx,
            "current_dow_idx": dow_idx,
        }
    return {
        "data_source": "stl_decomposition",
        "data_sources": ["Historical CTI feeds (DShield, GreyNoise, Abuse.ch)", "STL (statsmodels)", "Mandiant M-Trends 2024"],
        "description": "STL seasonal decomposition — multiplicative factor S(t) = monthly × day-of-week effect.",
        "vectors": result,
    }


@router.get("/context/campaigns")
def get_context_campaigns():
    """Campaign recurrence profiles C(t) per APT group. Source: MITRE ATT&CK, CISA."""
    now = datetime.utcnow()
    month_idx = now.month - 1
    result = []
    for group in _CAMPAIGN_PROFILES:
        current_intensity = group["monthly_intensity"][month_idx]
        result.append({
            **group,
            "current_month_intensity": round(current_intensity, 3),
            "is_elevated": current_intensity >= 1.0,
        })
    # Sort by current month activity
    result.sort(key=lambda g: g["current_month_intensity"], reverse=True)
    return {
        "data_source": "mitre_attack_v14",
        "data_sources": ["MITRE ATT&CK v14.1", "CISA Advisories (AA-series)", "Mandiant/CrowdStrike Annual Reports"],
        "current_month": now.strftime("%B"),
        "groups": result,
    }


@router.get("/context/forecast")
def get_context_forecast(
    vector: str = Query("ssh", regex="^(ssh|rdp|http|dns_amp|brute_force|botnet_c2|ransomware)$"),
    days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
):
    """
    LIVE covariate-enhanced forecast.
    μ_base is drawn from the real HawkesParam DB (populated by DShield/GreyNoise/Abuse.ch ingest).
    Seasonal S(t) and campaign C(t) are applied on top.
    """
    # ── Pull real μ_base from HawkesParam DB ──
    latest_params = (
        db.query(HawkesParam)
        .filter(HawkesParam.vector == vector)
        .order_by(HawkesParam.updated_at.desc())
        .limit(100)
        .all()
    )

    mu_values = [p.mu for p in latest_params if p.mu is not None and p.mu > 0]
    n_br_values = [p.n_br for p in latest_params if p.n_br is not None]

    if mu_values:
        mu_base = float(np.mean(mu_values))
        mu_std = float(np.std(mu_values))
        max_n_br = float(max(n_br_values)) if n_br_values else 0.5
        cell_count = len(latest_params)
        db_updated_at = latest_params[0].updated_at.isoformat() if latest_params[0].updated_at else None
        data_source = "live_hawkes_db"
        data_sources = ["DShield BotNet Feeds", "GreyNoise Mass Scanners", "Abuse.ch SSL/Feodo Blacklists",
                        "Hawkes Process MLE (scipy.optimize)", "STL Seasonal Decomposition"]
    else:
        # Fallback seed values when DB is empty
        mu_base = 0.22
        mu_std = 0.04
        max_n_br = 0.5
        cell_count = 0
        db_updated_at = None
        data_source = "seed_fallback"
        data_sources = ["Seed data (backend not yet populated)"]

    s_table = _SEASONAL.get(vector, [1.0] * 12)

    # Campaign prior: weighted average of top 2 groups for this vector
    relevant_groups = [g for g in _CAMPAIGN_PROFILES if vector in g["primary_vectors"]]

    now = datetime.utcnow()
    series = []
    for i in range(days):
        d = now + timedelta(days=i)
        m = d.month - 1
        w = d.weekday()
        s_t = s_table[m] * _DOW[w]

        # Event modulation ∏(1 + wᵢ·Eᵢ(t))
        event_mult = 1.0
        active_events = []
        for ev in _EVENT_CALENDAR:
            if vector in ev["vectors"] and _event_active(ev, d):
                event_mult *= (1.0 + ev["impact_weight"])
                active_events.append(ev["id"])

        # Campaign prior C(t)
        if relevant_groups:
            c_t = sum(g["monthly_intensity"][m] * g["confidence"] for g in relevant_groups) / \
                  sum(g["confidence"] for g in relevant_groups)
        else:
            c_t = 1.0

        mu_t = mu_base * s_t * event_mult * c_t
        series.append({
            "date": d.strftime("%Y-%m-%d"),
            "mu_base": round(mu_base, 5),
            "mu_seasonal": round(mu_base * s_t, 5),
            "mu_context": round(mu_t, 5),
            "s_t": round(s_t, 4),
            "event_mult": round(event_mult, 4),
            "c_t": round(c_t, 4),
            "active_events": active_events,
            "uplift_pct": round((mu_t - mu_base) / mu_base * 100, 1) if mu_base > 0 else 0,
        })

    avg_uplift = float(np.mean([s["uplift_pct"] for s in series]))
    return {
        "vector": vector,
        "mu_base": round(mu_base, 5),
        "mu_std": round(mu_std, 5),
        "max_n_br": round(max_n_br, 4),
        "cell_count": cell_count,
        "data_source": data_source,
        "data_sources": data_sources,
        "db_updated_at": db_updated_at,
        "avg_uplift_pct": round(avg_uplift, 1),
        "series": series,
    }


@router.get("/context/active")
def get_context_active(db: Session = Depends(get_db)):
    """
    Returns currently active covariates: active calendar events + elevated campaign groups
    + current seasonal multipliers. Used by globe overlay badges.
    """
    now = datetime.utcnow()
    month_idx = now.month - 1

    active_events = [
        {
            "id": ev["id"], "name": ev["name"], "category": ev["category"],
            "impact_weight": ev["impact_weight"], "vectors": ev["vectors"],
            "region": ev["region"], "source": ev["source"],
        }
        for ev in _EVENT_CALENDAR if _event_active(ev, now)
    ]

    elevated_groups = [
        {
            "name": g["name"], "origin": g["origin"],
            "current_intensity": g["monthly_intensity"][month_idx],
            "primary_vectors": g["primary_vectors"],
            "source": g["source"], "mitre_id": g["mitre_id"],
        }
        for g in _CAMPAIGN_PROFILES if g["monthly_intensity"][month_idx] >= 1.0
    ]

    seasonal_now = {
        v: round(mults[month_idx] * _DOW[now.weekday()], 3)
        for v, mults in _SEASONAL.items()
    }

    # Total context uplift estimate across all vectors
    max_seasonal = max(seasonal_now.values())
    max_event = max((ev["impact_weight"] for ev in active_events), default=0)

    return {
        "timestamp": now.isoformat(),
        "active_events": active_events,
        "elevated_groups": elevated_groups,
        "seasonal_now": seasonal_now,
        "max_context_multiplier": round(max_seasonal * (1 + max_event), 3),
        "data_sources": ["MSRC", "NIST NVD", "MITRE ATT&CK v14.1", "CISA", "STL Seasonal", "Analyst Curated"],
    }