import os

DB_URL = os.getenv("CYBER_WEATHER_DB_URL", "sqlite:///./cyber_weather.db")
GRID_RES_DEG = float(os.getenv("CYBER_WEATHER_GRID_RES_DEG", "2.5"))
EWMA_LAMBDA = float(os.getenv("CYBER_WEATHER_EWMA_LAMBDA", "0.7"))
FORECAST_PHI = float(os.getenv("CYBER_WEATHER_FORECAST_PHI", "0.4"))
BASE_TIME_WINDOW_MIN = int(os.getenv("CYBER_WEATHER_WINDOW_MIN", "60"))
