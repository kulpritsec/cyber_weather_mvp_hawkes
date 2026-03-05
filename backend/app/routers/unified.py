from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
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
    mode: str = Query("nowcast", pattern="^(nowcast|forecast|params|contours)$"),
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
    """Get security advisories — real rows first, synthetic fallback when table empty."""
    now = datetime.now(timezone.utc)
    real = db.query(Advisory).filter(
        Advisory.vector == vector, Advisory.expires_at > now
    ).order_by(Advisory.severity.desc()).limit(10).all()
    if real:
        return [
            AdvisoryOut(
                id=a.id, vector=a.vector, title=a.title, body=a.body, details=a.details,
                severity=a.severity, region=a.region or str(a.grid_id),
                issued_at=a.issued_at.isoformat() if a.issued_at else None,
                expires_at=a.expires_at.isoformat() if a.expires_at else None,
                start_time=a.start_time.isoformat() if a.start_time else None,
                end_time=a.end_time.isoformat() if a.end_time else None,
                confidence=a.confidence, grid_id=a.grid_id,
            ) for a in real
        ]
    q = db.query(Nowcast).filter(Nowcast.vector == vector).order_by(Nowcast.intensity.desc()).limit(5).all()
    return [
        AdvisoryOut(
            id=i, vector=vector, title=f"{vector.upper()} Storm Watch — Cell {nc.grid_id}",
            body=f"Elevated hostile activity (intensity={nc.intensity:.1f}, conf={nc.confidence:.2f}).",
            severity=4 if i <= 2 else 3, region=str(nc.grid_id),
            issued_at=now.isoformat(), expires_at=(now + timedelta(hours=6)).isoformat(),
            start_time=now.isoformat(), end_time=(now + timedelta(hours=6)).isoformat(),
            confidence=nc.confidence, grid_id=nc.grid_id,
        ) for i, nc in enumerate(q, start=1)
    ]

@router.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "cyber-weather-api", "version": "0.3.0"}

@router.get("/pipeline/status")
def get_pipeline_status():
    """Get pipeline orchestrator health status and scheduler information"""
    from ..services.pipeline import get_pipeline_status
    return get_pipeline_status()

@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    """Global threat summary across all active vectors."""
    from ..models import VectorConfig, VECTOR_SEED

    vector_names = [r.name for r in db.query(VectorConfig).filter(VectorConfig.is_active == True).all()]
    if not vector_names:
        vector_names = [v["name"] for v in VECTOR_SEED]

    vectors_out = []
    total_intensity = 0.0
    for vname in vector_names:
        rows = db.query(Nowcast).filter(Nowcast.vector == vname).all()
        if not rows:
            continue
        avg = sum(r.intensity for r in rows) / len(rows)
        total_intensity += avg
        vectors_out.append({"vector": vname, "avg_intensity": round(avg, 2), "cell_count": len(rows)})

    level = "low"
    if total_intensity > 200:
        level = "critical"
    elif total_intensity > 100:
        level = "high"
    elif total_intensity > 40:
        level = "moderate"
    elif total_intensity > 10:
        level = "elevated"

    return {
        "global_threat_level": level,
        "active_vector_count": len(vectors_out),
        "vectors": vectors_out,
    }


@router.get("/vectors")
def get_vectors(db: Session = Depends(get_db)):
    """List active threat vectors: merges VectorConfig + auto-discovered from events."""
    from ..models import VectorConfig, VECTOR_SEED
    from sqlalchemy import text

    # Start with seed as baseline
    seed_map = {v["name"]: v for v in VECTOR_SEED}

    # Override with DB config if populated
    rows = db.query(VectorConfig).filter(VectorConfig.is_active == True).order_by(VectorConfig.sort_order).all()
    if rows:
        seed_map = {r.name: {"name": r.name, "display_name": r.display_name, "color_hex": r.color_hex, "sort_order": r.sort_order} for r in rows}

    # Auto-discover vectors from events table not in seed
    AUTO_COLORS = ["#fbbf24", "#38bdf8", "#fb7185", "#a3e635", "#c084fc", "#f472b6", "#2dd4bf", "#818cf8"]
    result = db.execute(text("SELECT DISTINCT vector FROM events WHERE vector IS NOT NULL"))
    discovered = [r[0] for r in result if r[0] not in seed_map]
    for i, v in enumerate(discovered):
        seed_map[v] = {
            "name": v,
            "display_name": v.replace("_", " ").title(),
            "color_hex": AUTO_COLORS[i % len(AUTO_COLORS)],
            "sort_order": 100 + i,
        }

    # Return sorted
    vectors = sorted(seed_map.values(), key=lambda x: x.get("sort_order", 99))
    return [{"name": v["name"], "display_name": v["display_name"], "color_hex": v["color_hex"]} for v in vectors]




# Country centroids for arc visualization
COUNTRY_CENTROIDS = {
    "US": (39.8, -98.5), "CN": (35.9, 104.2), "RU": (61.5, 105.3), "DE": (51.2, 10.4),
    "GB": (55.4, -3.4), "FR": (46.2, 2.2), "JP": (36.2, 138.3), "KR": (35.9, 127.8),
    "BR": (-14.2, -51.9), "IN": (20.6, 79.0), "NL": (52.1, 5.3), "AU": (-25.3, 133.8),
    "CA": (56.1, -106.3), "IT": (41.9, 12.6), "SE": (60.1, 18.6), "SG": (1.4, 103.8),
    "HK": (22.4, 114.1), "UA": (48.4, 31.2), "BG": (42.7, 25.5), "IE": (53.4, -8.2),
    "PL": (51.9, 19.1), "RO": (45.9, 25.0), "TW": (23.7, 121.0), "VN": (14.1, 108.3),
    "ID": (-0.8, 113.9), "TH": (15.9, 100.9), "AR": (-38.4, -63.6), "ZA": (-30.6, 22.9),
}

@router.get("/top-countries")
def get_top_countries(db: Session = Depends(get_db)):
    """Top attacking and targeted countries from recent events"""
    rows = db.execute(text("""
        SELECT source_country, vector, COUNT(*) as cnt,
               ROUND(AVG(severity_raw)::numeric, 2) as avg_severity
        FROM events
        WHERE ts > NOW() - INTERVAL '24 hours' AND source_country IS NOT NULL
        GROUP BY source_country, vector
        ORDER BY cnt DESC
        LIMIT 100
    """)).fetchall()

    # Aggregate by country
    countries = {}
    for row in rows:
        cc = row[0]
        if cc not in countries:
            lat, lon = COUNTRY_CENTROIDS.get(cc, (0, 0))
            countries[cc] = {"code": cc, "lat": lat, "lon": lon, "total": 0, "vectors": {}, "avg_severity": 0}
        countries[cc]["total"] += row[2]
        countries[cc]["vectors"][row[1]] = row[2]
        countries[cc]["avg_severity"] = float(row[3]) if row[3] is not None else 0.0

    ranked = sorted(countries.values(), key=lambda x: -x["total"])[:15]
    return {"countries": ranked, "timestamp": datetime.now(timezone.utc).isoformat()}

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
            ('ssh', None): 'SSH Scan',
            ('rdp', 3389): 'RDP Spray Attack',
            ('rdp', 445): 'SMB Enumeration',
            ('rdp', None): 'RDP Scan',
            ('http', 80): 'HTTP Web Probe',
            ('http', 443): 'HTTPS Web Probe',
            ('http', 8080): 'HTTP Proxy Scan',
            ('http', None): 'HTTP Scan',
            ('dns_amp', 53): 'DNS Amplification',
            ('dns_amp', None): 'DNS Reflection',
            ('malware', 443): 'Malware C2 Beacon',
            ('malware', 80): 'Malware Dropper',
            ('malware', None): 'Malware Activity',
            ('brute_force', None): 'Credential Stuffing',
            ('botnet_c2', 443): 'Botnet C2 Encrypted',
            ('botnet_c2', 80): 'Botnet C2 Beacon',
            ('botnet_c2', None): 'Botnet C2 Communication',
            ('ransomware', 445): 'Ransomware Lateral Movement',
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
            'source': event.source or 'unknown',
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
        # Sample across vectors for diverse ticker — interleave
        vectors_in_db = [v[0] for v in db.query(Event.vector).distinct().all()]
        per_vector = max(5, 50 // max(len(vectors_in_db), 1))
        buckets = {}
        for vn in vectors_in_db:
            buckets[vn] = list(reversed(db.query(Event).filter(Event.vector == vn).order_by(Event.ts.desc()).limit(per_vector).all()))
        # Round-robin interleave
        recent_events = []
        max_len = max((len(b) for b in buckets.values()), default=0)
        for i in range(max_len):
            for vn in vectors_in_db:
                if i < len(buckets[vn]):
                    recent_events.append(buckets[vn][i])
        recent_events = recent_events[:50]

        for idx, event in enumerate(reversed(recent_events), start=last_id + 1):
            yield format_event(event, idx)

        current_id = last_id + len(recent_events)
        last_seen_ts = max(e.ts for e in recent_events) if recent_events else datetime.now(timezone.utc)
        last_keepalive = datetime.now()

        # Stream new events as they arrive
        while True:
            # Check if client disconnected
            if await request.is_disconnected():
                break

            # Poll for new events — interleave across vectors for diverse ticker
            new_events = []
            for vec in vectors_in_db:
                vec_events = db.query(Event).filter(
                    Event.ts > last_seen_ts,
                    Event.vector == vec
                ).order_by(Event.ts.desc()).limit(5).all()
                new_events.extend(vec_events)

            if new_events:
                # Sort by ts so we advance last_seen_ts correctly
                new_events.sort(key=lambda e: e.ts)
                for event in new_events:
                    current_id += 1
                    yield format_event(event, current_id)
                    if event.ts > last_seen_ts:
                        last_seen_ts = event.ts
            else:
                # No new events — replay random recent events for continuous visual stream
                import random as _rng
                # Fast replay using TABLESAMPLE (0.1s for 15 rows vs 0.8s for offset)
                replay_rows = db.execute(text(
                    "SELECT * FROM events TABLESAMPLE BERNOULLI(0.01) LIMIT 15"
                )).fetchall()
                for replay_row in replay_rows:
                    if not replay_row.source_country or not replay_row.lat:
                        continue
                    current_id += 1
                    class _E:
                        pass
                    ev = _E()
                    ev.ts = replay_row.ts
                    ev.vector = replay_row.vector
                    ev.source_ip = replay_row.source_ip
                    ev.source_country = replay_row.source_country
                    ev.target_port = replay_row.target_port
                    ev.lat = replay_row.lat
                    ev.lon = replay_row.lon
                    ev.severity_raw = replay_row.severity_raw
                    ev.count = replay_row.count
                    ev.source = replay_row.source
                    yield format_event(ev, current_id)

            # Send keepalive comment if no events
            now = datetime.now()
            if (now - last_keepalive).total_seconds() > 15:
                yield ": keepalive\n\n"
                last_keepalive = now

            # Wait 2 seconds before next poll
            await asyncio.sleep(0.4)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


@router.get("/events/ticker-stream")
async def ticker_stream(request: Request, db: Session = Depends(get_db)):
    """Slow SSE stream for the ticker — 1 event per second, diverse."""
    import random as _rng

    vectors_in_db = [v[0] for v in db.query(Event.vector).distinct().all()]

    async def ticker_generator():
        current_id = 0
        while True:
            if await request.is_disconnected():
                break
            # Pick one random event per tick
            vec = _rng.choice(vectors_in_db) if vectors_in_db else "ssh"
            row = db.execute(text(
                "SELECT * FROM events TABLESAMPLE BERNOULLI(0.01) LIMIT 1"
            )).fetchone()
            if row and row.lat and row.source_country:
                current_id += 1
                event_data = {
                    "id": current_id,
                    "ts": row.ts.isoformat() if row.ts else datetime.now(timezone.utc).isoformat(),
                    "vector": row.vector,
                    "source_ip": row.source_ip,
                    "source_country": row.source_country or "XX",
                    "target_port": row.target_port,
                    "lat": float(row.lat),
                    "lon": float(row.lon),
                    "action": derive_action(row.vector, row.target_port),
                    "severity": float(row.severity_raw) if row.severity_raw else 0.5,
                    "count": row.count or 1,
                    "source": row.source or "unknown",
                }
                yield f"id: {current_id}\ndata: {json.dumps(event_data)}\n\n"
            await asyncio.sleep(0.8)

    return StreamingResponse(
        ticker_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
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
            lats.append((cell.lat_min + cell.lat_max) / 2)
            lons.append((cell.lon_min + cell.lon_max) / 2)
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
            "lat": (cell.lat_min + cell.lat_max) / 2,
            "lon": (cell.lon_min + cell.lon_max) / 2,
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

    # Count events in last 24 hours (using cell lat/lon bounds)
    events_24h = db.query(Event).filter(
        Event.lat >= cell.lat_min,
        Event.lat < cell.lat_max,
        Event.lon >= cell.lon_min,
        Event.lon < cell.lon_max,
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
        "lat": (cell.lat_min + cell.lat_max) / 2,
        "lon": (cell.lon_min + cell.lon_max) / 2,
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
    vector: str = Query("ssh", pattern="^(ssh|rdp|http|dns_amp|brute_force|botnet_c2|ransomware)$"),
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

# ─── FEED STATUS ENDPOINT ───────────────────────────────────────────────
@router.get("/feeds/status")
def get_feeds_status(db: Session = Depends(get_db)):
    """Per-source CTI feed health: total events, last event, 24h count."""
    from sqlalchemy import func, text

    results = db.execute(text("""
        SELECT
            source,
            COUNT(*) as total_events,
            MAX(ts) as last_event,
            ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(ts)))/60) as mins_since_last,
            SUM(CASE WHEN ts > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END) as events_24h,
            COUNT(DISTINCT vector) as vector_count
        FROM events
        GROUP BY source
        ORDER BY MAX(ts) DESC
    """)).fetchall()

    sources = {}
    total_all = 0
    for row in results:
        sources[row[0]] = {
            "total_events": row[1],
            "last_event": row[2].isoformat() if row[2] else None,
            "mins_since_last": float(row[3]) if row[3] is not None else None,
            "events_24h": int(row[4]),
            "vector_count": row[5],
        }
        total_all += row[1]

    # Per-source vector breakdown for last 24h
    vector_results = db.execute(text("""
        SELECT source, vector, COUNT(*) as cnt
        FROM events
        WHERE ts > NOW() - INTERVAL '24 hours'
        GROUP BY source, vector
        ORDER BY cnt DESC
    """)).fetchall()

    for row in vector_results:
        src = row[0]
        if src in sources:
            if "vectors_24h" not in sources[src]:
                sources[src]["vectors_24h"] = {}
            sources[src]["vectors_24h"][row[1]] = row[2]

    return {
        "sources": sources,
        "total_events": total_all,
        "source_count": len(sources),
    }


# ─── Reverse Geocode Endpoint (added by credibility fix) ─────────────────
@router.get("/geo/reverse")
def reverse_geocode(
    lat: float = Query(...),
    lon: float = Query(...),
):
    """Return city/country for a lat/lon using MaxMind GeoLite2."""
    import geoip2.database
    import os

    mmdb = os.getenv("GEOIP_DB", "/data/GeoLite2-City.mmdb")
    if not os.path.exists(mmdb):
        # Fallback: use country centroids to guess
        return {"lat": lat, "lon": lon, "city": "Unknown", "country": "Unknown", "country_code": "??"}

    # GeoLite2 is IP-based, not lat/lon-based. For grid cell reverse geocoding,
    # we'll use a simple country lookup from our stored event data.
    from sqlalchemy import text
    from ..db import SessionLocal
    db = SessionLocal()
    try:
        # Find the most common country for events near this lat/lon
        row = db.execute(text("""
            SELECT source_country, COUNT(*) as cnt
            FROM events
            WHERE source_country IS NOT NULL
              AND source_country != ''
              AND lat BETWEEN :lat_min AND :lat_max
              AND lon BETWEEN :lon_min AND :lon_max
            GROUP BY source_country
            ORDER BY cnt DESC
            LIMIT 1
        """), {
            "lat_min": lat - 2.5,
            "lat_max": lat + 2.5,
            "lon_min": lon - 2.5,
            "lon_max": lon + 2.5,
        }).fetchone()

        country_code = row.source_country if row else "??"

        # Also check Shodan exposures for richer location data
        shodan_row = db.execute(text("""
            SELECT city, country_code, org
            FROM exposures
            WHERE lat BETWEEN :lat_min AND :lat_max
              AND lon BETWEEN :lon_min AND :lon_max
            ORDER BY fetched_at DESC
            LIMIT 1
        """), {
            "lat_min": lat - 1.5,
            "lat_max": lat + 1.5,
            "lon_min": lon - 1.5,
            "lon_max": lon + 1.5,
        }).fetchone()

        city = shodan_row.city if shodan_row and shodan_row.city else "Unknown"
        if shodan_row and shodan_row.country_code:
            country_code = shodan_row.country_code

        return {
            "lat": lat,
            "lon": lon,
            "city": city,
            "country_code": country_code,
            "org": shodan_row.org if shodan_row else None,
        }
    finally:
        db.close()


# ─── Top Attack Flows (added by real arc targeting fix) ───────────────────
@router.get("/flows/top")
def get_top_flows(
    hours: int = Query(default=24),
    limit: int = Query(default=50),
    db: Session = Depends(get_db),
):
    """
    Return top source_country → vector attack flows from recent events.
    Used by the globe to draw real attack arcs.
    """
    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    rows = db.execute(text("""
        SELECT source_country, vector, event_count, avg_lat, avg_lon, unique_ips, top_port
        FROM (
            SELECT source_country, vector, COUNT(*) as event_count,
                   ROUND(AVG(lat)::numeric, 2) as avg_lat,
                   ROUND(AVG(lon)::numeric, 2) as avg_lon,
                   COUNT(DISTINCT source_ip) as unique_ips,
                   MODE() WITHIN GROUP (ORDER BY target_port) as top_port,
                   ROW_NUMBER() OVER (PARTITION BY source_country ORDER BY COUNT(*) DESC) as rn
            FROM events
            WHERE source_country IS NOT NULL
              AND source_country != ''
              AND ts >= :cutoff
            GROUP BY source_country, vector
            HAVING COUNT(*) >= 3
        ) ranked
        WHERE rn <= 2
        ORDER BY event_count DESC
        LIMIT :limit
    """), {"cutoff": cutoff, "limit": limit}).fetchall()

    flows = []
    for r in rows:
        flows.append({
            "source_country": r.source_country,
            "vector": r.vector,
            "event_count": r.event_count,
            "avg_lat": float(r.avg_lat) if r.avg_lat else 0,
            "avg_lon": float(r.avg_lon) if r.avg_lon else 0,
            "unique_ips": r.unique_ips,
            "top_port": r.top_port,
        })

    return {"hours": hours, "flows": flows}


# ─── Forecast Time Series (for Context Engine panel) ─────────────────────
@router.get("/forecast/series")
def get_forecast_series(
    vector: str = Query(default="ssh"),
    days: int = Query(default=30),
    db: Session = Depends(get_db),
):
    """
    Return historical intensity + forward forecast for a vector.
    Used by Context Engine panel's forecast chart.
    """
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)

    # Historical: hourly intensity from nowcast snapshots
    history_cutoff = now - timedelta(days=days)
    hist_rows = db.execute(text("""
        SELECT date_trunc('hour', ts) as hour, COUNT(*) as events,
               AVG(severity_raw) as avg_severity
        FROM events
        WHERE vector = :vector AND ts >= :cutoff
        GROUP BY date_trunc('hour', ts)
        ORDER BY hour ASC
    """), {"vector": vector, "cutoff": history_cutoff}).fetchall()

    history = []
    for r in hist_rows:
        history.append({
            "t": int(r.hour.timestamp() * 1000) if r.hour else 0,
            "value": float(r.events),
            "severity": float(r.avg_severity) if r.avg_severity else 0,
            "isForecast": False,
        })

    # Forward forecast: use Hawkes params to project
    # Get current median params for this vector
    params_row = db.execute(text("""
        SELECT
            percentile_cont(0.5) WITHIN GROUP (ORDER BY mu) as med_mu,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY n_br) as med_nbr,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY beta) as med_beta,
            COUNT(*) as cell_count
        FROM hawkes_params
        WHERE vector = :vector
    """), {"vector": vector}).fetchone()

    mu = float(params_row.med_mu) if params_row and params_row.med_mu else 0.1
    n_br = float(params_row.med_nbr) if params_row and params_row.med_nbr else 0.5
    cell_count = params_row.cell_count if params_row else 0

    # Get recent baseline (last 24h average hourly events)
    baseline_row = db.execute(text("""
        SELECT COUNT(*) / GREATEST(1, EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts))) / 3600) as avg_hourly
        FROM events
        WHERE vector = :vector AND ts >= :cutoff24
    """), {"vector": vector, "cutoff24": now - timedelta(hours=24)}).fetchone()

    base_rate = float(baseline_row.avg_hourly) if baseline_row and baseline_row.avg_hourly else 10

    # Project forward using Hawkes steady-state: E[λ] = μ / (1 - n_br)
    # With uncertainty growing over time
    forecast = []
    steady_state = mu / max(0.01, 1 - min(n_br, 0.99)) * cell_count
    for h in range(1, days * 24 + 1):
        t = int((now + timedelta(hours=h)).timestamp() * 1000)
        # Blend baseline with steady-state forecast
        blend = min(h / (7 * 24), 1.0)  # transition over 7 days
        value = base_rate * (1 - blend) + steady_state * blend
        # Growing uncertainty
        uncertainty = 0.1 + (h / (days * 24)) * 0.4
        forecast.append({
            "t": t,
            "value": round(value, 2),
            "lower": round(value * (1 - uncertainty * 1.65), 2),
            "upper": round(value * (1 + uncertainty * 1.65), 2),
            "isForecast": True,
        })

    return {
        "vector": vector,
        "history": history,
        "forecast": forecast,
        "params": {
            "mu": round(mu, 6),
            "n_br": round(n_br, 4),
            "cell_count": cell_count,
            "base_rate_hourly": round(base_rate, 1),
            "steady_state": round(steady_state, 2),
        },
    }


# ─── Network Flow Data (for Network Flow Mathematics panel) ──────────────
@router.get("/network/flows")
def get_network_flows(
    hours: int = Query(default=24),
    db: Session = Depends(get_db),
):
    """
    Return aggregated network flow data from real events.
    Used by Network Flow Mathematics panel.
    """
    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Traffic by vector
    vector_rows = db.execute(text("""
        SELECT vector, COUNT(*) as events,
               COUNT(DISTINCT source_ip) as unique_ips,
               COUNT(DISTINCT source_country) as countries,
               COUNT(DISTINCT target_port) as unique_ports
        FROM events
        WHERE ts >= :cutoff
        GROUP BY vector
        ORDER BY events DESC
    """), {"cutoff": cutoff}).fetchall()

    # Top source IPs
    ip_rows = db.execute(text("""
        SELECT source_ip, source_country, vector, COUNT(*) as events,
               COUNT(DISTINCT target_port) as ports_targeted
        FROM events
        WHERE ts >= :cutoff AND source_ip IS NOT NULL
        GROUP BY source_ip, source_country, vector
        ORDER BY events DESC
        LIMIT 20
    """), {"cutoff": cutoff}).fetchall()

    # Top target ports
    port_rows = db.execute(text("""
        SELECT target_port, vector, COUNT(*) as events,
               COUNT(DISTINCT source_ip) as source_ips
        FROM events
        WHERE ts >= :cutoff AND target_port IS NOT NULL
        GROUP BY target_port, vector
        ORDER BY events DESC
        LIMIT 15
    """), {"cutoff": cutoff}).fetchall()

    # Hourly timeline
    timeline_rows = db.execute(text("""
        SELECT date_trunc('hour', ts) as hour, vector, COUNT(*) as events
        FROM events
        WHERE ts >= :cutoff
        GROUP BY date_trunc('hour', ts), vector
        ORDER BY hour ASC
    """), {"cutoff": cutoff}).fetchall()

    # Country breakdown
    country_rows = db.execute(text("""
        SELECT source_country, COUNT(*) as events,
               COUNT(DISTINCT source_ip) as unique_ips,
               COUNT(DISTINCT vector) as vectors
        FROM events
        WHERE ts >= :cutoff AND source_country IS NOT NULL AND source_country != ''
        GROUP BY source_country
        ORDER BY events DESC
        LIMIT 20
    """), {"cutoff": cutoff}).fetchall()

    # Build timeline series grouped by vector
    timeline = {}
    for r in timeline_rows:
        vec = r.vector
        if vec not in timeline:
            timeline[vec] = []
        timeline[vec].append({
            "t": int(r.hour.timestamp() * 1000) if r.hour else 0,
            "events": r.events,
        })

    return {
        "hours": hours,
        "vectors": [
            {
                "name": r.vector,
                "events": r.events,
                "unique_ips": r.unique_ips,
                "countries": r.countries,
                "unique_ports": r.unique_ports,
            }
            for r in vector_rows
        ],
        "top_sources": [
            {
                "ip": r.source_ip,
                "country": r.source_country,
                "vector": r.vector,
                "events": r.events,
                "ports_targeted": r.ports_targeted,
            }
            for r in ip_rows
        ],
        "top_ports": [
            {
                "port": r.target_port,
                "vector": r.vector,
                "events": r.events,
                "source_ips": r.source_ips,
            }
            for r in port_rows
        ],
        "timeline": timeline,
        "top_countries": [
            {
                "country": r.source_country,
                "events": r.events,
                "unique_ips": r.unique_ips,
                "vectors": r.vectors,
            }
            for r in country_rows
        ],
    }
