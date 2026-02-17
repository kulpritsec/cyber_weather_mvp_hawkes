from sqlalchemy import Column, Integer, Float, String, DateTime, Boolean, Index, ForeignKey, Text
from sqlalchemy.orm import relationship
from .db import Base


class Event(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True, index=True)
    ts = Column(DateTime, index=True)
    lat = Column(Float)
    lon = Column(Float)
    vector = Column(String, index=True)
    count = Column(Integer, default=1)
    source = Column(String, index=True, default="synthetic")
    threat_metadata = Column(Text)  # JSON metadata for threat intelligence

Index("ix_events_time_vector", Event.ts, Event.vector)
# ix_events_source auto-created by index=True on Event.source


class GridCell(Base):
    __tablename__ = "grid_cells"
    id = Column(Integer, primary_key=True, index=True)
    lat_idx = Column(Integer, index=True)
    lon_idx = Column(Integer, index=True)
    lat_min = Column(Float)
    lat_max = Column(Float)
    lon_min = Column(Float)
    lon_max = Column(Float)
    res_deg = Column(Float)

    @property
    def lat_center(self) -> float:
        return (self.lat_min + self.lat_max) / 2.0

    @property
    def lon_center(self) -> float:
        return (self.lon_min + self.lon_max) / 2.0

Index("ix_grid_cells_idx", GridCell.lat_idx, GridCell.lon_idx)


class Nowcast(Base):
    __tablename__ = "nowcast"
    id = Column(Integer, primary_key=True, index=True)
    grid_id = Column(Integer, ForeignKey("grid_cells.id"))
    vector = Column(String, index=True)
    intensity = Column(Float)
    pressure = Column(Float)
    confidence = Column(Float)
    updated_at = Column(DateTime)
    grid = relationship("GridCell")

Index("ix_nowcast_grid_vector", Nowcast.grid_id, Nowcast.vector)


class Forecast(Base):
    __tablename__ = "forecast"
    id = Column(Integer, primary_key=True, index=True)
    grid_id = Column(Integer, ForeignKey("grid_cells.id"))
    vector = Column(String, index=True)
    horizon_h = Column(Integer)
    intensity = Column(Float)
    confidence = Column(Float)
    updated_at = Column(DateTime)
    grid = relationship("GridCell")

Index("ix_forecast_grid_vector_h", Forecast.grid_id, Forecast.vector, Forecast.horizon_h)


class ForecastSnapshot(Base):
    """
    Point-in-time globe snapshot used by temporal replay.
    One fitting cycle writes many rows (one per grid_id × vector × horizon_h)
    all sharing the same run_id UUID so the frontend can scrub through time.
    """
    __tablename__ = "forecast_snapshots"
    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(String, index=True)          # UUID grouping all rows from one cycle
    grid_id = Column(Integer, ForeignKey("grid_cells.id"))
    vector = Column(String, index=True)
    horizon_h = Column(Integer, default=0)       # hours ahead (0 = nowcast)
    mu_base = Column(Float)                      # raw Hawkes base rate
    s_t = Column(Float, default=1.0)             # seasonal multiplier
    event_mult = Column(Float, default=1.0)      # event calendar multiplier
    campaign_mult = Column(Float, default=1.0)   # campaign recurrence multiplier
    mu_t = Column(Float)                         # full covariate-enhanced rate
    snapshot_at = Column(DateTime, index=True)   # wall-clock time of fitting run
    grid = relationship("GridCell")

Index("ix_fsnap_run_vector", ForecastSnapshot.run_id, ForecastSnapshot.vector)
Index("ix_fsnap_at", ForecastSnapshot.snapshot_at)


class Advisory(Base):
    __tablename__ = "advisories"
    id = Column(Integer, primary_key=True, index=True)
    grid_id = Column(Integer, ForeignKey("grid_cells.id"), nullable=True)
    vector = Column(String, index=True)
    title = Column(String)
    body = Column(Text)                          # long-form advisory text
    details = Column(String, nullable=True)      # legacy short description
    severity = Column(Integer)                   # 1-5 numeric (matches weather metaphor)
    region = Column(String, nullable=True)
    issued_at = Column(DateTime)
    expires_at = Column(DateTime, index=True)
    start_time = Column(DateTime, nullable=True) # scheduled event window start
    end_time = Column(DateTime, nullable=True)   # scheduled event window end
    confidence = Column(Float, nullable=True)
    grid = relationship("GridCell")

Index("ix_advisory_vector_expires", Advisory.vector, Advisory.expires_at)


class HawkesParam(Base):
    __tablename__ = "hawkes_params"
    id = Column(Integer, primary_key=True, index=True)
    grid_id = Column(Integer, ForeignKey("grid_cells.id"))
    vector = Column(String, index=True)
    mu = Column(Float)     # per-hour baseline
    beta = Column(Float)   # per-hour decay
    n_br = Column(Float)   # branching ratio in (0,1); alpha = n_br * beta
    mu_std = Column(Float, default=0.0)
    beta_std = Column(Float, default=0.0)
    n_br_std = Column(Float, default=0.0)
    updated_at = Column(DateTime)
    grid = relationship("GridCell")

Index("ix_hawkes_grid_vector", HawkesParam.grid_id, HawkesParam.vector)


class VectorConfig(Base):
    """
    Centralised vector metadata — replaces scattered hardcoded lists.
    Seed rows are inserted by the startup migration so the pipeline,
    frontend, and tests all read from one source of truth.
    """
    __tablename__ = "vector_configs"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)   # e.g. "ssh"
    display_name = Column(String)                    # e.g. "SSH Brute Force"
    color_hex = Column(String, default="#00e5ff")    # UI colour
    default_mu = Column(Float, default=0.10)         # seed base rate
    default_beta = Column(Float, default=1.50)       # seed decay rate
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)

# Canonical vector seed data (consumed by startup migration)
VECTOR_SEED = [
    {"name": "ssh",        "display_name": "SSH Brute Force",    "color_hex": "#00e5ff", "default_mu": 0.22, "default_beta": 1.80, "sort_order": 0},
    {"name": "rdp",        "display_name": "RDP Exploit",        "color_hex": "#ff6d00", "default_mu": 0.15, "default_beta": 1.50, "sort_order": 1},
    {"name": "http",       "display_name": "HTTP Flood",         "color_hex": "#b388ff", "default_mu": 0.18, "default_beta": 1.20, "sort_order": 2},
    {"name": "dns_amp",    "display_name": "DNS Amplification",  "color_hex": "#76ff03", "default_mu": 0.10, "default_beta": 2.00, "sort_order": 3},
    {"name": "brute_force","display_name": "Credential Stuffing","color_hex": "#ff4081", "default_mu": 0.25, "default_beta": 1.60, "sort_order": 4},
    {"name": "botnet_c2",  "display_name": "Botnet C2",          "color_hex": "#ffd740", "default_mu": 0.08, "default_beta": 0.90, "sort_order": 5},
    {"name": "ransomware", "display_name": "Ransomware Deploy",  "color_hex": "#ff1744", "default_mu": 0.05, "default_beta": 0.60, "sort_order": 6},
]
