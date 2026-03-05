"""Shared FastAPI dependencies — single source of truth for get_db()."""

from .db import SessionLocal


def get_db():
    """Yield a SQLAlchemy session and guarantee cleanup."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
