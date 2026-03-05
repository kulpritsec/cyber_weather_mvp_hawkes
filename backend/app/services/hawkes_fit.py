"""
Optimized Hawkes Fitting Service
- SQL-side bucketing (no ORM iteration over 36K+ rows)
- Single-pass event series extraction via raw SQL
- Reduced bootstrap samples for scheduler viability on 4GB instances
"""

import logging
from datetime import timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text
from ..db import SessionLocal, engine, Base
from ..models import Event, GridCell, HawkesParam, Nowcast, Forecast
from ..utils.geo import cell_bounds
from ..utils.time import utcnow
from ..config import GRID_RES_DEG
from ..forecast.hawkes_process import fit_hawkes_exponential, mean_intensity_future

logger = logging.getLogger(__name__)

HORIZONS = (6, 24, 72)


def fit_vector(session: Session, vector: str, hours: int = 24, min_events: int = 50) -> dict:
    now = utcnow()
    start = now - timedelta(hours=hours)

    bucket_sql = text("""
        SELECT 
            FLOOR((lat + 90.0) / :res)::int AS lat_idx,
            FLOOR((lon + 180.0) / :res)::int AS lon_idx,
            SUM(GREATEST(count, 1))::int AS total
        FROM events
        WHERE vector = :vector AND ts >= :start AND ts < :now
        GROUP BY 1, 2
        HAVING SUM(GREATEST(count, 1)) >= :min_events
        ORDER BY total DESC
    """)

    result = session.execute(bucket_sql, {
        "res": GRID_RES_DEG,
        "vector": vector,
        "start": start,
        "now": now,
        "min_events": min_events,
    })
    buckets = [(row[0], row[1], row[2]) for row in result]

    logger.info(f"  {vector}: {len(buckets)} cells above threshold (min_events={min_events})")

    cells_fitted = 0
    events_processed = 0
    errors = 0

    for lat_idx, lon_idx, total in buckets:
        try:
            cell = _ensure_cell(session, lat_idx, lon_idx)
            times, counts, T = _event_series_for_cell_fast(session, cell, vector, start, now)

            if sum(counts) < min_events:
                continue

            params = fit_hawkes_exponential(times, counts, T, bootstrap_samples=5)

            hp = session.query(HawkesParam).filter_by(grid_id=cell.id, vector=vector).first()
            if hp:
                hp.mu, hp.beta, hp.n_br = params.mu, params.beta, params.n_br
                hp.mu_std, hp.beta_std, hp.n_br_std = params.mu_std, params.beta_std, params.n_br_std
                hp.updated_at = now
            else:
                session.add(HawkesParam(
                    grid_id=cell.id, vector=vector,
                    mu=params.mu, beta=params.beta, n_br=params.n_br,
                    mu_std=params.mu_std, beta_std=params.beta_std, n_br_std=params.n_br_std,
                    updated_at=now
                ))

            nc = session.query(Nowcast).filter_by(grid_id=cell.id, vector=vector).first()
            lambda_now = nc.intensity if nc else params.mu

            for h in HORIZONS:
                lam_h = mean_intensity_future(lambda_now, params, float(h))
                conf = min(1.0, 0.5 + sum(counts) / 200.0)

                row = session.query(Forecast).filter_by(
                    grid_id=cell.id, vector=vector, horizon_h=h
                ).first()

                if row:
                    row.intensity, row.confidence, row.updated_at = lam_h, conf, now
                else:
                    session.add(Forecast(
                        grid_id=cell.id, vector=vector, horizon_h=h,
                        intensity=lam_h, confidence=conf, updated_at=now
                    ))

            cells_fitted += 1
            events_processed += sum(counts)

            if cells_fitted % 10 == 0:
                logger.info(f"  {vector}: {cells_fitted} cells fitted so far...")
                session.commit()

        except Exception as e:
            errors += 1
            logger.warning(f"Error fitting cell ({lat_idx}, {lon_idx}) for {vector}: {e}")
            continue

    session.commit()

    logger.info(f"  {vector}: DONE - {cells_fitted} cells, {events_processed} events, {errors} errors")

    return {
        "vector": vector,
        "cells_fitted": cells_fitted,
        "events_processed": events_processed,
        "errors": errors,
        "hours": hours
    }


def _event_series_for_cell_fast(session: Session, cell: GridCell, vector: str, start, end):
    sql = text("""
        SELECT 
            EXTRACT(EPOCH FROM (ts - :start)) / 3600.0 AS t_hours,
            GREATEST(count, 1)::int AS cnt
        FROM events
        WHERE vector = :vector 
          AND ts >= :start AND ts < :end
          AND lat >= :lat_min AND lat < :lat_max
          AND lon >= :lon_min AND lon < :lon_max
        ORDER BY ts ASC
    """)

    result = session.execute(sql, {
        "vector": vector,
        "start": start,
        "end": end,
        "lat_min": cell.lat_min,
        "lat_max": cell.lat_max,
        "lon_min": cell.lon_min,
        "lon_max": cell.lon_max,
    })

    times = []
    counts = []
    for row in result:
        times.append(float(row[0]))
        counts.append(int(row[1]))

    T = (end - start).total_seconds() / 3600.0
    return times, counts, T


def _ensure_cell(session: Session, lat_idx: int, lon_idx: int) -> GridCell:
    cell = session.query(GridCell).filter_by(
        lat_idx=lat_idx, lon_idx=lon_idx, res_deg=GRID_RES_DEG
    ).first()
    if cell:
        return cell
    b = cell_bounds(lat_idx, lon_idx, GRID_RES_DEG)
    cell = GridCell(
        lat_idx=lat_idx, lon_idx=lon_idx, res_deg=GRID_RES_DEG,
        lat_min=b["lat_min"], lat_max=b["lat_max"],
        lon_min=b["lon_min"], lon_max=b["lon_max"]
    )
    session.add(cell)
    session.flush()
    return cell


def run(hours: int = 24, min_events: int = 50, vectors=None):
    from ..models import VectorConfig, VECTOR_SEED
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    if vectors is None:
        vc_rows = session.query(VectorConfig).filter(VectorConfig.is_active == True).order_by(VectorConfig.sort_order).all()
        vectors = [r.name for r in vc_rows] if vc_rows else [v["name"] for v in VECTOR_SEED]
    for vector in vectors:
        logger.info(f"Fitting {vector}...")
        result = fit_vector(session, vector, hours=hours, min_events=min_events)
        print(result)
    session.close()


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--min-events", type=int, default=50)
    args = ap.parse_args()
    run(hours=args.hours, min_events=args.min_events)
