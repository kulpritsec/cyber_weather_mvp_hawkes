from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from ..db import SessionLocal
from ..models import HawkesParam, GridCell
from ..schemas import FeatureCollection, GeoFeature
from ..utils.geo import cell_polygon

router = APIRouter(prefix="/v1")

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

@router.get("/params", response_model=FeatureCollection)
def get_hawkes_params(vector: str = Query("ssh"), res: float = Query(2.5), db: Session = Depends(get_db)):
    """Get fitted Hawkes process parameters (μ, β, n) for each grid cell and vector"""
    q = db.query(HawkesParam, GridCell).join(GridCell, HawkesParam.grid_id == GridCell.id) \
           .filter(HawkesParam.vector == vector, GridCell.res_deg == res)
    
    features = []
    for hp, cell in q:
        geom = cell_polygon(cell.lat_min, cell.lat_max, cell.lon_min, cell.lon_max)
        props = {
            "grid_id": cell.id, 
            "vector": hp.vector,
            "mu": hp.mu,  # baseline intensity (events/hour)
            "beta": hp.beta,  # decay rate (1/hour)
            "n_br": hp.n_br,  # branching ratio (0-1)
            "alpha": hp.n_br * hp.beta,  # excitement coefficient
            "mu_std": hp.mu_std or 0.0,  # uncertainty estimates
            "beta_std": hp.beta_std or 0.0,
            "n_br_std": hp.n_br_std or 0.0,
            "stability": "stable" if hp.n_br < 1.0 else "unstable",
            "updated_at": hp.updated_at.isoformat()
        }
        features.append(GeoFeature(geometry=geom, properties=props))
    
    return FeatureCollection(features=features)