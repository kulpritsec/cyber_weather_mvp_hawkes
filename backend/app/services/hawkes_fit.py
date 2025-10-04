import argparse
from datetime import timedelta
from sqlalchemy.orm import Session
from ..db import SessionLocal, engine, Base
from ..models import Event, GridCell, HawkesParam, Nowcast, Forecast
from ..utils.geo import latlon_to_cell_indices, cell_bounds
from ..utils.time import utcnow
from ..config import GRID_RES_DEG
from ..forecast.hawkes_process import fit_hawkes_exponential, mean_intensity_future

HORIZONS = (6, 24, 72)

def _ensure_cell(session: Session, lat_idx: int, lon_idx: int) -> GridCell:
    cell = session.query(GridCell).filter_by(lat_idx=lat_idx, lon_idx=lon_idx, res_deg=GRID_RES_DEG).first()
    if cell: return cell
    b = cell_bounds(lat_idx, lon_idx, GRID_RES_DEG)
    cell = GridCell(lat_idx=lat_idx, lon_idx=lon_idx, res_deg=GRID_RES_DEG,
                    lat_min=b["lat_min"], lat_max=b["lat_max"],
                    lon_min=b["lon_min"], lon_max=b["lon_max"])
    session.add(cell); session.flush(); return cell

def _event_series_for_cell(session: Session, cell: GridCell, vector: str, start, end):
    q = session.query(Event).filter(Event.ts >= start, Event.ts < end, Event.vector == vector,
                                    Event.lat >= cell.lat_min, Event.lat < cell.lat_max,
                                    Event.lon >= cell.lon_min, Event.lon < cell.lon_max)                            .order_by(Event.ts.asc())
    times = []; counts = []
    for ev in q:
        h = (ev.ts - start).total_seconds()/3600.0
        times.append(h); counts.append(int(max(1, ev.count)))
    T = (end - start).total_seconds()/3600.0
    return times, counts, T

def run(hours: int = 24, min_events: int = 50, vectors=("ssh","rdp","http","dns_amp")):
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    now = utcnow(); start = now - timedelta(hours=hours)

    # Pre-bucket by (lat_idx, lon_idx, vector)
    buckets = {}
    q = session.query(Event).filter(Event.ts >= start, Event.ts < now)
    for ev in q:
        lat_idx, lon_idx = latlon_to_cell_indices(ev.lat, ev.lon, GRID_RES_DEG)
        key = (lat_idx, lon_idx, ev.vector)
        buckets[key] = buckets.get(key, 0) + max(1, int(ev.count))

    processed = 0
    for (lat_idx, lon_idx, vector), total in sorted(buckets.items(), key=lambda kv: kv[1], reverse=True):
        if vector not in vectors or total < min_events: continue
        cell = _ensure_cell(session, lat_idx, lon_idx)
        times, counts, T = _event_series_for_cell(session, cell, vector, start, now)
        if sum(counts) < min_events: continue

        params = fit_hawkes_exponential(times, counts, T)

        hp = session.query(HawkesParam).filter_by(grid_id=cell.id, vector=vector).first()
        if hp:
            hp.mu, hp.beta, hp.n_br, hp.updated_at = params.mu, params.beta, params.n_br, now
        else:
            session.add(HawkesParam(grid_id=cell.id, vector=vector, mu=params.mu, beta=params.beta, n_br=params.n_br, updated_at=now))

        nc = session.query(Nowcast).filter_by(grid_id=cell.id, vector=vector).first()
        lambda_now = nc.intensity if nc else params.mu

        for h in HORIZONS:
            lam_h = mean_intensity_future(lambda_now, params, float(h))
            conf = min(1.0, 0.5 + min_events/200.0)  # simple placeholder
            row = session.query(Forecast).filter_by(grid_id=cell.id, vector=vector, horizon_h=h).first()
            if row:
                row.intensity, row.confidence, row.updated_at = lam_h, conf, now
            else:
                session.add(Forecast(grid_id=cell.id, vector=vector, horizon_h=h, intensity=lam_h, confidence=conf, updated_at=now))
        processed += 1

    session.commit(); session.close()
    print(f"Fitted Hawkes for {processed} hot buckets (>= {min_events} events).")

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--min-events", type=int, default=50)
    args = ap.parse_args()
    run(hours=args.hours, min_events=args.min_events)
