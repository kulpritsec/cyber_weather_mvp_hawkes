"""
Legacy entry point — delegates to the canonical implementation in
services.aggregator to avoid duplicated EWMA logic.
"""

from ..db import SessionLocal, engine, Base
from ..services.aggregator import recompute_all_nowcasts


def compute_nowcast():
    """Standalone CLI-callable nowcast computation."""
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        recompute_all_nowcasts(session)
    finally:
        session.close()
