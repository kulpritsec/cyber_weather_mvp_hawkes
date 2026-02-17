from pydantic import BaseModel
from typing import List, Dict, Optional

class GeoFeature(BaseModel):
    type: str = "Feature"
    geometry: Dict
    properties: Dict

class FeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: List[GeoFeature]

class AdvisoryOut(BaseModel):
    id: int
    vector: str
    title: str
    body: Optional[str] = None
    details: Optional[str] = None
    severity: int
    region: Optional[str] = None
    issued_at: Optional[str] = None
    expires_at: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    confidence: Optional[float] = None
    grid_id: Optional[int] = None
