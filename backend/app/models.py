from sqlalchemy import Column, Integer, Float, String, DateTime, Index, ForeignKey
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

Index("ix_events_time_vector", Event.ts, Event.vector)

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

class Advisory(Base):
    __tablename__ = "advisories"
    id = Column(Integer, primary_key=True, index=True)
    vector = Column(String, index=True)
    title = Column(String)
    details = Column(String)
    severity = Column(String)
    region = Column(String)
    start_time = Column(DateTime)
    end_time = Column(DateTime)
    confidence = Column(Float)

class HawkesParam(Base):
    __tablename__ = "hawkes_params"
    id = Column(Integer, primary_key=True, index=True)
    grid_id = Column(Integer, ForeignKey("grid_cells.id"))
    vector = Column(String, index=True)
    mu = Column(Float)     # per-hour baseline
    beta = Column(Float)   # per-hour decay
    n_br = Column(Float)   # branching ratio in (0,1); alpha = n_br * beta
    updated_at = Column(DateTime)
    grid = relationship("GridCell")

Index("ix_hawkes_grid_vector", HawkesParam.grid_id, HawkesParam.vector)
