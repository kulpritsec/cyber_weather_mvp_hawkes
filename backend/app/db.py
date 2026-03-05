from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from .core.config import get_settings

_settings = get_settings()
_db_url = _settings.effective_db_url

_engine_kwargs: dict = {}
if _db_url.startswith("sqlite"):
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    _engine_kwargs["pool_size"] = _settings.db_pool_size
    _engine_kwargs["max_overflow"] = _settings.db_max_overflow

engine = create_engine(_db_url, **_engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
