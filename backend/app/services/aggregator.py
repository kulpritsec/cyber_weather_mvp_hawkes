import logging
import math
from datetime import timedelta

from sqlalchemy import text, func
from sqlalchemy.orm import Session

from ..config import EWMA_LAMBDA, BASE_TIME_WINDOW_MIN, GRID_RES_DEG
from ..models import GridCell, Nowcast
from ..utils.geo import cell_bounds
from ..utils.time import utcnow, round_down

logger = logging.getLogger(__name__)


def recompute_all_nowcasts(session: Session) -> dict:
    """
    Recompute nowcast intensity for all grid cells and vectors.

    Uses SQL-side aggregation to avoid loading every Event row into Python.
    """
    now = utcnow()
    window_end = round_down(now, BASE_TIME_WINDOW_MIN)
    window_start = window_end - timedelta(minutes=BASE_TIME_WINDOW_MIN)

    # ── Step 1: Aggregate events in SQL ──────────────────────────────────────
    agg_sql = text("""
        SELECT
            CAST(FLOOR((lat + 90.0) / :res) AS INTEGER) AS lat_idx,
            CAST(FLOOR((lon + 180.0) / :res) AS INTEGER) AS lon_idx,
            vector,
            SUM(LEAST(GREATEST(count, 1), 10)) AS total
        FROM events
        WHERE ts >= :ws AND ts < :we
        GROUP BY 1, 2, 3
    """)

    rows = session.execute(agg_sql, {
        "res": GRID_RES_DEG,
        "ws": window_start,
        "we": window_end,
    }).fetchall()

    events_processed = sum(r[3] for r in rows)

    # ── Step 2: Pre-load existing grid cells + nowcasts ──────────────────────
    cell_lookup: dict[tuple, GridCell] = {}
    for cell in session.query(GridCell).filter(GridCell.res_deg == GRID_RES_DEG):
        cell_lookup[(cell.lat_idx, cell.lon_idx)] = cell

    nowcast_lookup: dict[tuple, Nowcast] = {}
    for nc in session.query(Nowcast):
        nowcast_lookup[(nc.grid_id, nc.vector)] = nc

    # ── Step 3: Update in bulk ───────────────────────────────────────────────
    cells_updated = 0
    for lat_idx, lon_idx, vector, count in rows:
        lat_idx, lon_idx, count = int(lat_idx), int(lon_idx), int(count)

        # Ensure grid cell
        cell = cell_lookup.get((lat_idx, lon_idx))
        if not cell:
            b = cell_bounds(lat_idx, lon_idx, GRID_RES_DEG)
            cell = GridCell(
                lat_idx=lat_idx, lon_idx=lon_idx, res_deg=GRID_RES_DEG,
                lat_min=b["lat_min"], lat_max=b["lat_max"],
                lon_min=b["lon_min"], lon_max=b["lon_max"],
            )
            session.add(cell)
            session.flush()
            cell_lookup[(lat_idx, lon_idx)] = cell

        # EWMA
        prev = nowcast_lookup.get((cell.id, vector))
        intensity = EWMA_LAMBDA * (prev.intensity if prev else 0.0) + (1.0 - EWMA_LAMBDA) * count
        confidence = min(1.0, 0.1 + 0.9 * (1 - math.pow(0.5, count / 10.0)))

        if prev:
            prev.intensity = intensity
            prev.pressure = intensity
            prev.confidence = confidence
            prev.updated_at = window_end
        else:
            nc = Nowcast(
                grid_id=cell.id, vector=vector,
                intensity=intensity, pressure=intensity, confidence=confidence,
                updated_at=window_end,
            )
            session.add(nc)
            nowcast_lookup[(cell.id, vector)] = nc

        cells_updated += 1

    session.commit()

    logger.info(f"Nowcast recompute: {cells_updated} cells, {events_processed} events")
    return {
        "cells_updated": cells_updated,
        "events_processed": events_processed,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
    }
