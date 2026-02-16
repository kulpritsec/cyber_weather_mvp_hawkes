"""
Integration tests for API endpoints using FastAPI TestClient.
"""
import os
os.environ["CYBER_WEATHER_DATABASE_URL"] = "sqlite://"

import pytest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

# Import AFTER setting env var so the app uses in-memory sqlite
from app.core.database import Base, engine, get_db
from app.main import app
from app.models import (
    Event, GridCell, Nowcast, Forecast, HawkesParam, VectorConfig,
    ForecastSnapshot, Advisory,
)

# Use the APP's engine directly — no separate test engine
TestSession = sessionmaker(bind=engine)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_db():
    """Create all tables on the app's engine before each test, drop after."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def seeded_db():
    """Populate the DB with sample data."""
    session = TestSession()
    now = datetime.now(timezone.utc)

    cell = GridCell(
        lat_idx=52, lon_idx=77, res_deg=2.5,
        lat_min=40.0, lat_max=42.5, lon_min=12.5, lon_max=15.0,
    )
    session.add(cell)
    session.flush()

    for i in range(20):
        session.add(Event(
            ts=now - timedelta(minutes=i * 3),
            lat=41.0, lon=13.5, vector="ssh", count=2,
        ))

    session.add(Nowcast(
        grid_id=cell.id, vector="ssh",
        intensity=15.0, pressure=15.0, confidence=0.7,
        updated_at=now,
    ))

    session.add(HawkesParam(
        grid_id=cell.id, vector="ssh",
        mu=3.0, beta=1.5, n_br=0.45,
        mu_std=0.2, beta_std=0.1, n_br_std=0.03,
        updated_at=now,
    ))

    for h in [6, 24, 72]:
        session.add(Forecast(
            grid_id=cell.id, vector="ssh", horizon_h=h,
            intensity=12.0 + h * 0.05, confidence=0.65,
            updated_at=now,
        ))

    session.commit()
    session.close()


class TestHealthEndpoints:
    def test_healthz(self, client):
        r = client.get("/healthz")
        assert r.status_code == 200
        assert r.json()["status"] == "healthy"

    def test_root(self, client):
        r = client.get("/")
        assert r.status_code == 200
        assert "endpoints" in r.json()


class TestDataEndpoint:
    def test_nowcast_empty(self, client):
        r = client.get("/v1/data?mode=nowcast&vector=ssh")
        assert r.status_code == 200
        data = r.json()
        assert data["type"] == "FeatureCollection"

    def test_nowcast_with_data(self, client, seeded_db):
        r = client.get("/v1/data?mode=nowcast&vector=ssh")
        assert r.status_code == 200
        features = r.json()["features"]
        assert len(features) >= 1
        assert features[0]["properties"]["vector"] == "ssh"
        assert features[0]["properties"]["mode"] == "nowcast"

    def test_forecast_with_data(self, client, seeded_db):
        r = client.get("/v1/data?mode=forecast&vector=ssh&horizon=24")
        assert r.status_code == 200
        features = r.json()["features"]
        assert len(features) >= 1
        assert features[0]["properties"]["horizon_h"] == 24

    def test_params_with_data(self, client, seeded_db):
        r = client.get("/v1/data?mode=params&vector=ssh")
        assert r.status_code == 200
        features = r.json()["features"]
        assert len(features) >= 1
        props = features[0]["properties"]
        assert "mu" in props
        assert "beta" in props
        assert "n_br" in props
        assert "stability" in props

    def test_invalid_mode(self, client):
        r = client.get("/v1/data?mode=invalid")
        assert r.status_code == 422


class TestAdvisories:
    def test_empty(self, client):
        r = client.get("/v1/advisories?vector=ssh")
        assert r.status_code == 200
        assert r.json() == []

    def test_with_data(self, client, seeded_db):
        r = client.get("/v1/advisories?vector=ssh")
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        assert "Storm Watch" in items[0]["title"]


class TestSummary:
    def test_empty(self, client):
        r = client.get("/v1/summary")
        assert r.status_code == 200
        data = r.json()
        assert "global_threat_level" in data
        assert "vectors" in data

    def test_with_data(self, client, seeded_db):
        r = client.get("/v1/summary")
        assert r.status_code == 200
        data = r.json()
        assert data["active_vector_count"] >= 1
        ssh = next((v for v in data["vectors"] if v["vector"] == "ssh"), None)
        assert ssh is not None
        assert ssh["avg_intensity"] > 0


class TestPodcastScript:
    def test_empty(self, client):
        r = client.get("/v1/podcast/script")
        assert r.status_code == 200
        data = r.json()
        assert "sections" in data
        assert any(s["type"] == "opening" for s in data["sections"])
        assert any(s["type"] == "closing" for s in data["sections"])

    def test_with_data(self, client, seeded_db):
        r = client.get("/v1/podcast/script")
        assert r.status_code == 200
        data = r.json()
        assert len(data["sections"]) >= 3
        opening = next(s for s in data["sections"] if s["type"] == "opening")
        assert "Cyber Weather Report" in opening["text"]


class TestVectors:
    def test_default_vectors(self, client):
        r = client.get("/v1/vectors")
        assert r.status_code == 200
        names = [v["name"] for v in r.json()]
        assert "ssh" in names


class TestLegacyEndpoints:
    def test_legacy_nowcast(self, client, seeded_db):
        r = client.get("/v1/nowcast?vector=ssh")
        assert r.status_code == 200
        assert r.json()["type"] == "FeatureCollection"

    def test_legacy_forecast(self, client, seeded_db):
        r = client.get("/v1/forecast?vector=ssh&horizon=24")
        assert r.status_code == 200

    def test_legacy_params(self, client, seeded_db):
        r = client.get("/v1/params?vector=ssh")
        assert r.status_code == 200
