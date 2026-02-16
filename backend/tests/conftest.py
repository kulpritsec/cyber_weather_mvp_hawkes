"""
Shared test fixtures — in-memory SQLite for isolation.
"""
import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Force in-memory DB before any app imports
os.environ["CYBER_WEATHER_DATABASE_URL"] = "sqlite://"

from app.core.database import Base
from app.models import (
    Event, GridCell, Nowcast, Forecast, ForecastSnapshot,
    HawkesParam, Advisory, VectorConfig,
)


@pytest.fixture
def db_engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session(db_engine):
    Session = sessionmaker(bind=db_engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def seeded_session(db_session):
    """Session pre-populated with a grid cell, events, and nowcast."""
    from datetime import datetime, timezone, timedelta

    cell = GridCell(
        lat_idx=26, lon_idx=101, res_deg=2.5,
        lat_min=-25.0, lat_max=-22.5, lon_min=72.5, lon_max=75.0,
    )
    db_session.add(cell)
    db_session.flush()

    now = datetime.now(timezone.utc)
    for i in range(100):
        db_session.add(Event(
            ts=now - timedelta(minutes=i * 5),
            lat=-23.5, lon=73.5, vector="ssh", count=3,
        ))

    db_session.add(Nowcast(
        grid_id=cell.id, vector="ssh",
        intensity=25.0, pressure=25.0, confidence=0.8,
        updated_at=now,
    ))

    db_session.add(HawkesParam(
        grid_id=cell.id, vector="ssh",
        mu=5.0, beta=2.0, n_br=0.4,
        mu_std=0.5, beta_std=0.3, n_br_std=0.05,
        updated_at=now,
    ))

    for h in [6, 24, 72]:
        db_session.add(Forecast(
            grid_id=cell.id, vector="ssh", horizon_h=h,
            intensity=20.0 + h * 0.1, confidence=0.75,
            updated_at=now,
        ))

    db_session.commit()
    return db_session
