"""
Centralized configuration management for Cyber Weather MVP
"""
import os
from typing import Optional
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Database — accepts CYBER_WEATHER_DB_URL (legacy) or CYBER_WEATHER_DATABASE_URL
    db_url: str = "sqlite:///./cyber_weather.db"
    database_url: str = ""  # alias kept for backwards compat

    # MaxMind GeoLite2 Configuration
    maxmind_db_path: str = "/data/GeoLite2-City.mmdb"

    # CTI Feed Configuration
    greynoise_api_key: Optional[str] = None
    otx_api_key: str = ""
    abuseipdb_api_key: str = ""
    ingest_interval_min: int = 15
    fit_interval_min: int = 60
    min_events_fit: int = 50

    # Grid configuration
    grid_resolution_deg: float = 2.5

    # Nowcast settings
    ewma_lambda: float = 0.7
    base_time_window_min: int = 60

    # Forecast
    forecast_phi: float = 0.4

    # Hawkes model settings
    hawkes_min_events: int = 50
    hawkes_bootstrap_samples: int = 20
    hawkes_max_optimization_time: int = 30

    # API settings
    api_title: str = "Cyber Weather Forecast API"
    api_version: str = "0.3.0"
    api_cors_origins: list = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Server settings
    server_host: str = "0.0.0.0"
    server_port: int = 8000
    server_reload: bool = True

    # Cache settings
    cache_ttl_seconds: int = 300
    cache_max_size: int = 1000

    # Performance settings
    db_pool_size: int = 10
    db_max_overflow: int = 20

    class Config:
        env_prefix = "CYBER_WEATHER_"
        env_file = ".env"

    @property
    def effective_db_url(self) -> str:
        """Return whichever DB URL is set, preferring the explicit database_url."""
        return self.database_url or self.db_url

@lru_cache()
def get_settings() -> Settings:
    """Get cached application settings"""
    return Settings()

def get_database_url() -> str:
    """Get resolved database URL."""
    return get_settings().effective_db_url

def get_cors_origins() -> list:
    """Get CORS origins from environment or defaults"""
    env_origins = os.getenv("CYBER_WEATHER_CORS_ORIGINS")
    if env_origins:
        return [origin.strip() for origin in env_origins.split(",")]
    return get_settings().api_cors_origins

def is_development() -> bool:
    """Check if running in development mode"""
    return os.getenv("CYBER_WEATHER_ENV", "development").lower() == "development"

def is_production() -> bool:
    """Check if running in production mode"""
    return os.getenv("CYBER_WEATHER_ENV", "development").lower() == "production"