import argparse
from collections import defaultdict
from datetime import timedelta
from sqlalchemy.orm import Session
from ..forecast.nowcast import compute_nowcast
from ..config import EWMA_LAMBDA, BASE_TIME_WINDOW_MIN, GRID_RES_DEG
from ..models import Event, GridCell, Nowcast
from ..utils.geo import latlon_to_cell_indices, cell_bounds
from ..utils.time import utcnow, round_down

def recompute_all_nowcasts(session: Session) -> dict:
    """
    Recompute nowcast intensity for all grid cells and vectors

    Args:
        session: Database session

    Returns:
        Dict with computation results: cells_updated, events_processed
    """
    now = utcnow()
    window_end = round_down(now, BASE_TIME_WINDOW_MIN)
    window_start = window_end - timedelta(minutes=BASE_TIME_WINDOW_MIN)

    # Aggregate events by (lat_idx, lon_idx, vector)
    agg = defaultdict(int)
    q = session.query(Event).filter(Event.ts >= window_start, Event.ts < window_end)

    events_processed = 0
    for ev in q:
        lat_idx, lon_idx = latlon_to_cell_indices(ev.lat, ev.lon, GRID_RES_DEG)
        agg[(lat_idx, lon_idx, ev.vector)] += min(int(max(1, ev.count)), 10)
        events_processed += 1

    cells_updated = 0
    for (lat_idx, lon_idx, vector), count in agg.items():
        # Ensure grid cell exists
        cell = session.query(GridCell).filter_by(
            lat_idx=lat_idx, lon_idx=lon_idx, res_deg=GRID_RES_DEG
        ).first()

        if not cell:
            b = cell_bounds(lat_idx, lon_idx, GRID_RES_DEG)
            cell = GridCell(
                lat_idx=lat_idx, lon_idx=lon_idx, res_deg=GRID_RES_DEG,
                lat_min=b["lat_min"], lat_max=b["lat_max"],
                lon_min=b["lon_min"], lon_max=b["lon_max"]
            )
            session.add(cell)
            session.flush()

        # Compute EWMA intensity
        prev = session.query(Nowcast).filter_by(grid_id=cell.id, vector=vector).first()
        intensity = EWMA_LAMBDA * (prev.intensity if prev else 0.0) + (1.0 - EWMA_LAMBDA) * count
        confidence = min(1.0, 0.1 + 0.9 * (1 - pow(0.5, count / 10.0)))
        pressure = intensity

        if prev:
            prev.intensity = intensity
            prev.pressure = pressure
            prev.confidence = confidence
            prev.updated_at = window_end
        else:
            session.add(Nowcast(
                grid_id=cell.id, vector=vector,
                intensity=intensity, pressure=pressure, confidence=confidence,
                updated_at=window_end
            ))

        cells_updated += 1

    session.commit()

    return {
        "cells_updated": cells_updated,
        "events_processed": events_processed,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat()
    }

def recalc():
    compute_nowcast()

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--recalc", action="store_true")
    args = ap.parse_args()
    if args.recalc: recalc()
