import math
from typing import Tuple, Dict

def clamp_lat(lat: float) -> float:
    return max(-85.0, min(85.0, lat))

def wrap_lon(lon: float) -> float:
    while lon < -180.0:
        lon += 360.0
    while lon > 180.0:
        lon -= 360.0
    return lon

def latlon_to_cell_indices(lat: float, lon: float, res_deg: float) -> Tuple[int,int]:
    lat = clamp_lat(lat)
    lon = wrap_lon(lon)
    lat_idx = int(math.floor((lat + 90.0) / res_deg))
    lon_idx = int(math.floor((lon + 180.0) / res_deg))
    return lat_idx, lon_idx

def cell_bounds(lat_idx: int, lon_idx: int, res_deg: float) -> Dict[str, float]:
    lat_min = -90.0 + lat_idx * res_deg
    lat_max = lat_min + res_deg
    lon_min = -180.0 + lon_idx * res_deg
    lon_max = lon_min + res_deg
    return {"lat_min": lat_min, "lat_max": lat_max, "lon_min": lon_min, "lon_max": lon_max}

def cell_polygon(lat_min: float, lat_max: float, lon_min: float, lon_max: float) -> Dict:
    return {
        "type": "Polygon",
        "coordinates": [[
            [lon_min, lat_min],
            [lon_max, lat_min],
            [lon_max, lat_max],
            [lon_min, lat_max],
            [lon_min, lat_min]
        ]]
    }
