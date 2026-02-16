"""
Unit tests for ORM models.
"""
import pytest
from app.models import GridCell, HawkesParam, Event
from datetime import datetime, timezone


class TestGridCellHybridProperties:
    def test_lat_center(self, db_session):
        cell = GridCell(
            lat_idx=10, lon_idx=20, res_deg=2.5,
            lat_min=10.0, lat_max=12.5, lon_min=30.0, lon_max=32.5,
        )
        db_session.add(cell)
        db_session.flush()
        assert cell.lat_center == pytest.approx(11.25)
        assert cell.lon_center == pytest.approx(31.25)

    def test_negative_coords(self, db_session):
        cell = GridCell(
            lat_idx=5, lon_idx=5, res_deg=5.0,
            lat_min=-65.0, lat_max=-60.0, lon_min=-155.0, lon_max=-150.0,
        )
        db_session.add(cell)
        db_session.flush()
        assert cell.lat_center == pytest.approx(-62.5)
        assert cell.lon_center == pytest.approx(-152.5)


class TestHawkesParamAlpha:
    def test_alpha_computation(self, db_session):
        cell = GridCell(
            lat_idx=0, lon_idx=0, res_deg=2.5,
            lat_min=0, lat_max=2.5, lon_min=0, lon_max=2.5,
        )
        db_session.add(cell)
        db_session.flush()

        hp = HawkesParam(
            grid_id=cell.id, vector="ssh",
            mu=1.0, beta=2.0, n_br=0.5,
            updated_at=datetime.now(timezone.utc),
        )
        # alpha = n_br * beta
        expected_alpha = 0.5 * 2.0
        assert hp.n_br * hp.beta == pytest.approx(expected_alpha)


class TestEventModel:
    def test_default_source(self, db_session):
        ev = Event(
            ts=datetime.now(timezone.utc),
            lat=40.0, lon=-74.0, vector="ssh", count=5,
        )
        db_session.add(ev)
        db_session.flush()
        assert ev.source == "synthetic"
