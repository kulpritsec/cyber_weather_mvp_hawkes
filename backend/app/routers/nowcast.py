from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from ..db import SessionLocal
from ..models import Nowcast, GridCell
from ..schemas import FeatureCollection, GeoFeature
from ..utils.geo import cell_polygon

router = APIRouter(prefix="/v1")

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

@router.get("/nowcast", response_model=FeatureCollection)
def get_nowcast(vector: str = Query("ssh"), res: float = Query(2.5), db: Session = Depends(get_db)):
    q = db.query(Nowcast, GridCell).join(GridCell, Nowcast.grid_id == GridCell.id)           .filter(Nowcast.vector == vector, GridCell.res_deg == res)
    max_p = max([nc.pressure for nc, _ in q] + [1.0])
    features = []
    for nc, cell in q:
        geom = cell_polygon(cell.lat_min, cell.lat_max, cell.lon_min, cell.lon_max)
        props = {"grid_id": cell.id, "vector": nc.vector, "intensity": nc.intensity,
                 "pressure": nc.pressure / max_p, "confidence": nc.confidence,
                 "updated_at": nc.updated_at.isoformat()}
        features.append(GeoFeature(geometry=geom, properties=props))
    return FeatureCollection(features=features)
