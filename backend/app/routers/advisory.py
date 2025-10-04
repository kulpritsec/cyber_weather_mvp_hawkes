from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from ..db import SessionLocal
from ..models import Advisory, Nowcast
from ..schemas import AdvisoryOut

router = APIRouter(prefix="/v1")

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

@router.get("/advisories", response_model=list[AdvisoryOut])
def get_advisories(vector: str = Query("ssh"), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    q = db.query(Nowcast).filter(Nowcast.vector == vector).order_by(Nowcast.intensity.desc()).limit(5).all()
    out = []
    for i, nc in enumerate(q, start=1):
        out.append(AdvisoryOut(
            id=i, vector=vector, title=f"{vector.upper()} Storm Watch — Cell {nc.grid_id}",
            details=f"Elevated hostile activity (intensity={nc.intensity:.1f}, conf={nc.confidence:.2f}). Consider step-up auth, reduced token TTL, and micro-segmentation.",
            severity="watch" if i > 2 else "warning", region=str(nc.grid_id),
            start_time=(now).isoformat(), end_time=(now + timedelta(hours=6)).isoformat(), confidence=nc.confidence
        ))
    return out
