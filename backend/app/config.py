"""
Thin shim — all values come from core.config.Settings so there is one
source of truth.  Modules that still import from here will get the
same values as modules using ``from ..core.config import get_settings``.
"""

from .core.config import get_settings as _get_settings

_s = _get_settings()

DB_URL: str = _s.effective_db_url
GRID_RES_DEG: float = _s.grid_resolution_deg
EWMA_LAMBDA: float = _s.ewma_lambda
FORECAST_PHI: float = _s.forecast_phi
BASE_TIME_WINDOW_MIN: int = _s.base_time_window_min
