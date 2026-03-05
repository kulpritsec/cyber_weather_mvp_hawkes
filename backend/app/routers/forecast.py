from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from ..models import Forecast, GridCell
from ..schemas import FeatureCollection, GeoFeature
from ..utils.geo import cell_polygon
from ..deps import get_db

router = APIRouter(prefix="/v1")

@router.get("/forecast", response_model=FeatureCollection)
def get_forecast(vector: str = Query("ssh"), horizon: int = Query(24), res: float = Query(2.5), db: Session = Depends(get_db)):
    q = db.query(Forecast, GridCell).join(GridCell, Forecast.grid_id == GridCell.id)           .filter(Forecast.vector == vector, Forecast.horizon_h == horizon, GridCell.res_deg == res)
    max_i = max([fc.intensity for fc, _ in q] + [1.0])
    features = []
    for fc, cell in q:
        geom = cell_polygon(cell.lat_min, cell.lat_max, cell.lon_min, cell.lon_max)
        props = {"grid_id": cell.id, "vector": fc.vector, "intensity": fc.intensity,
                 "normalized": fc.intensity / max_i, "confidence": fc.confidence,
                 "horizon_h": fc.horizon_h, "updated_at": fc.updated_at.isoformat()}
        features.append(GeoFeature(geometry=geom, properties=props))
    return FeatureCollection(features=features)
