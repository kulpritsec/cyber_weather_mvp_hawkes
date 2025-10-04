"""
Centralized configuration management for Cyber Weather MVP
"""
import os
from typing import Optional
from pydantic import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Database
    database_url: str = "sqlite:///./cyber_weather.db"
    
    # Grid configuration
    grid_resolution_deg: float = 2.5
    
    # Nowcast settings
    ewma_lambda: float = 0.7
    base_time_window_min: int = 60
    
    # Hawkes model settings
    hawkes_min_events: int = 50
    hawkes_bootstrap_samples: int = 20
    hawkes_max_optimization_time: int = 30  # seconds
    
    # Data generation
    synthetic_rate_per_hour: int = 1200
    synthetic_hours_default: int = 24
    synthetic_seed: int = 42
    
    # API settings
    api_title: str = "Cyber Weather Forecast API"
    api_version: str = "0.3.0"
    api_cors_origins: list = ["http://localhost:5173", "http://127.0.0.1:5173"]
    
    # Server settings
    server_host: str = "0.0.0.0"
    server_port: int = 8000
    server_reload: bool = True
    
    # Cache settings
    cache_ttl_seconds: int = 300  # 5 minutes
    cache_max_size: int = 1000
    
    # Performance settings
    db_pool_size: int = 5
    db_max_overflow: int = 10
    
    class Config:
        env_prefix = "CYBER_WEATHER_"
        env_file = ".env"

@lru_cache()
def get_settings() -> Settings:
    """Get cached application settings"""
    return Settings()

# Environment-specific configurations
def get_database_url() -> str:
    """Get database URL with environment-specific defaults"""
    settings = get_settings()
    return os.getenv("CYBER_WEATHER_DATABASE_URL", settings.database_url)

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