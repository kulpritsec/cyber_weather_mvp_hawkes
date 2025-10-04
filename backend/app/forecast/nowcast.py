from collections import defaultdict
from datetime import timedelta
from ..config import EWMA_LAMBDA, BASE_TIME_WINDOW_MIN, GRID_RES_DEG
from ..db import SessionLocal, engine, Base
from ..models import Event, GridCell, Nowcast
from ..utils.geo import latlon_to_cell_indices, cell_bounds
from ..utils.time import utcnow, round_down

def compute_nowcast():
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    now = utcnow()
    window_end = round_down(now, BASE_TIME_WINDOW_MIN)
    window_start = window_end - timedelta(minutes=BASE_TIME_WINDOW_MIN)

    agg = defaultdict(int)
    q = session.query(Event).filter(Event.ts >= window_start, Event.ts < window_end)
    for ev in q:
        lat_idx, lon_idx = latlon_to_cell_indices(ev.lat, ev.lon, GRID_RES_DEG)
        agg[(lat_idx, lon_idx, ev.vector)] += int(max(1, ev.count))

    for (lat_idx, lon_idx, vector), count in agg.items():
        cell = session.query(GridCell).filter_by(lat_idx=lat_idx, lon_idx=lon_idx, res_deg=GRID_RES_DEG).first()
        if not cell:
            b = cell_bounds(lat_idx, lon_idx, GRID_RES_DEG)
            cell = GridCell(lat_idx=lat_idx, lon_idx=lon_idx, res_deg=GRID_RES_DEG,
                            lat_min=b["lat_min"], lat_max=b["lat_max"],
                            lon_min=b["lon_min"], lon_max=b["lon_max"])
            session.add(cell); session.flush()

        prev = session.query(Nowcast).filter_by(grid_id=cell.id, vector=vector).first()
        intensity = EWMA_LAMBDA * (prev.intensity if prev else 0.0) + (1.0 - EWMA_LAMBDA) * count
        confidence = min(1.0, 0.1 + 0.9 * (1 - pow(0.5, count/10.0)))
        pressure = intensity
        if prev:
            prev.intensity = intensity; prev.pressure = pressure; prev.confidence = confidence; prev.updated_at = window_end
        else:
            session.add(Nowcast(grid_id=cell.id, vector=vector, intensity=intensity, pressure=pressure, confidence=confidence, updated_at=window_end))

    session.commit(); session.close()
