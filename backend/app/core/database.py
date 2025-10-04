"""
Optimized database operations with connection pooling and caching
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import QueuePool
from functools import lru_cache
from typing import Generator
import time
from .config import get_settings, get_database_url

settings = get_settings()

# Create engine with connection pooling
engine = create_engine(
    get_database_url(),
    poolclass=QueuePool,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_pre_ping=True,  # Verify connections before use
    pool_recycle=3600,   # Recycle connections every hour
    connect_args={"check_same_thread": False} if get_database_url().startswith("sqlite") else {}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class DatabaseManager:
    """Enhanced database operations with caching and optimization"""
    
    def __init__(self):
        self._cache = {}
        self._cache_times = {}
    
    def get_db(self) -> Generator:
        """Get database session with automatic cleanup"""
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()
    
    @lru_cache(maxsize=100)
    def get_grid_cell_bounds(self, lat_idx: int, lon_idx: int, res_deg: float):
        """Cached grid cell bounds calculation"""
        from ..utils.geo import cell_bounds
        return cell_bounds(lat_idx, lon_idx, res_deg)
    
    def cached_query(self, cache_key: str, query_func, ttl: int = None):
        """Execute query with caching"""
        ttl = ttl or settings.cache_ttl_seconds
        now = time.time()
        
        # Check cache
        if cache_key in self._cache:
            cache_time = self._cache_times.get(cache_key, 0)
            if now - cache_time < ttl:
                return self._cache[cache_key]
        
        # Execute query and cache result
        result = query_func()
        self._cache[cache_key] = result
        self._cache_times[cache_key] = now
        
        # Cleanup old cache entries
        if len(self._cache) > settings.cache_max_size:
            self._cleanup_cache()
        
        return result
    
    def _cleanup_cache(self):
        """Remove old cache entries"""
        now = time.time()
        expired_keys = [
            key for key, cache_time in self._cache_times.items()
            if now - cache_time > settings.cache_ttl_seconds
        ]
        for key in expired_keys:
            self._cache.pop(key, None)
            self._cache_times.pop(key, None)
    
    def bulk_insert(self, session, objects: list):
        """Optimized bulk insert operation"""
        if not objects:
            return
        
        # Use bulk_save_objects for better performance
        session.bulk_save_objects(objects)
        session.commit()
    
    def get_connection_info(self):
        """Get database connection information"""
        pool = engine.pool
        return {
            "pool_size": pool.size(),
            "checked_in": pool.checkedin(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
            "invalidated": pool.invalidated()
        }

# Global database manager instance
db_manager = DatabaseManager()

# Convenience functions
def get_db():
    """Get database session"""
    return db_manager.get_db()

def get_cached_query(cache_key: str, query_func, ttl: int = None):
    """Execute cached query"""
    return db_manager.cached_query(cache_key, query_func, ttl)