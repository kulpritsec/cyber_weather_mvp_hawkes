from pydantic import BaseModel
from typing import List, Dict

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
    details: str
    severity: str
    region: str
    start_time: str
    end_time: str
    confidence: float
