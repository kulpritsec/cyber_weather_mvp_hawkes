"""Podcast Feeds API — /v1/podcast/*"""
import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Query, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..deps import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/podcast", tags=["podcast-feeds"])

@router.get("/kev/recent")
def get_recent_kevs(days: int = Query(default=30), db: Session = Depends(get_db)):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = db.execute(text("""
        SELECT cve_id, vendor, product, vuln_name, date_added,
               short_description, required_action, due_date, ransomware_use
        FROM cisa_kev WHERE date_added >= :cutoff ORDER BY date_added DESC
    """), {"cutoff": cutoff.date()}).fetchall()
    return {"count": len(rows), "kevs": [
        {"cve": r.cve_id, "vendor": r.vendor, "product": r.product,
         "name": r.vuln_name, "added": str(r.date_added),
         "description": r.short_description, "action": r.required_action,
         "due": str(r.due_date) if r.due_date else None,
         "ransomware": r.ransomware_use} for r in rows]}

@router.get("/kev/stats")
def get_kev_stats(db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    week_cutoff = (now - timedelta(days=7)).date()
    month_cutoff = (now - timedelta(days=30)).date()
    s = db.execute(text("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN ransomware_use = 'Known' THEN 1 ELSE 0 END) as ransomware_linked,
               SUM(CASE WHEN date_added >= :week_cutoff THEN 1 ELSE 0 END) as week,
               SUM(CASE WHEN date_added >= :month_cutoff THEN 1 ELSE 0 END) as month,
               COUNT(DISTINCT vendor) as vendors FROM cisa_kev
    """), {"week_cutoff": week_cutoff, "month_cutoff": month_cutoff}).fetchone()
    tv = db.execute(text("SELECT vendor, COUNT(*) as cnt FROM cisa_kev GROUP BY vendor ORDER BY cnt DESC LIMIT 10")).fetchall()
    return {"total": s.total, "ransomware_linked": s.ransomware_linked,
            "added_this_week": s.week, "added_this_month": s.month,
            "unique_vendors": s.vendors,
            "top_vendors": [{"vendor": r.vendor, "count": r.cnt} for r in tv]}

@router.get("/ransomware/recent")
def get_recent_ransomware(days: int = Query(default=7), db: Session = Depends(get_db)):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = db.execute(text("""
        SELECT group_name, victim_name, country, sector, discovered_at, description, status
        FROM ransomware_victims WHERE discovered_at >= :cutoff OR fetched_at >= :cutoff
        ORDER BY discovered_at DESC NULLS LAST LIMIT 50
    """), {"cutoff": cutoff}).fetchall()
    return {"count": len(rows), "victims": [
        {"group": r.group_name, "victim": r.victim_name, "country": r.country,
         "sector": r.sector, "discovered": r.discovered_at.isoformat() if r.discovered_at else None,
         "description": (r.description or "")[:200], "status": r.status} for r in rows]}

@router.get("/ransomware/stats")
def get_ransomware_stats(db: Session = Depends(get_db)):
    cutoff_30d = datetime.now(timezone.utc) - timedelta(days=30)
    tg = db.execute(text("SELECT group_name, COUNT(*) as v FROM ransomware_victims WHERE discovered_at >= :cutoff GROUP BY group_name ORDER BY v DESC LIMIT 10"), {"cutoff": cutoff_30d}).fetchall()
    ts = db.execute(text("SELECT sector, COUNT(*) as c FROM ransomware_victims WHERE sector IS NOT NULL AND sector != '' AND discovered_at >= :cutoff GROUP BY sector ORDER BY c DESC LIMIT 10"), {"cutoff": cutoff_30d}).fetchall()
    tc = db.execute(text("SELECT country, COUNT(*) as c FROM ransomware_victims WHERE country IS NOT NULL AND country != '' AND discovered_at >= :cutoff GROUP BY country ORDER BY c DESC LIMIT 10"), {"cutoff": cutoff_30d}).fetchall()
    total = db.execute(text("SELECT COUNT(*) FROM ransomware_victims")).scalar()
    return {"total_victims": total,
            "top_groups_30d": [{"group": r.group_name, "victims": r.v} for r in tg],
            "top_sectors_30d": [{"sector": r.sector, "count": r.c} for r in ts],
            "top_countries_30d": [{"country": r.country, "count": r.c} for r in tc]}

@router.get("/urlhaus/stats")
def get_urlhaus_stats(db: Session = Depends(get_db)):
    tt = db.execute(text("SELECT threat, COUNT(*) as c FROM urlhaus_urls WHERE threat IS NOT NULL AND threat != '' GROUP BY threat ORDER BY c DESC LIMIT 10")).fetchall()
    tc = db.execute(text("SELECT country, COUNT(*) as c FROM urlhaus_urls WHERE country IS NOT NULL AND country != '' GROUP BY country ORDER BY c DESC LIMIT 10")).fetchall()
    total = db.execute(text("SELECT COUNT(*) FROM urlhaus_urls")).scalar()
    online = db.execute(text("SELECT COUNT(*) FROM urlhaus_urls WHERE url_status = 'online'")).scalar()
    return {"total_urls": total, "online_urls": online,
            "top_threats": [{"threat": r.threat, "count": r.c} for r in tt],
            "top_countries": [{"country": r.country, "count": r.c} for r in tc]}

@router.get("/briefing")
def get_podcast_briefing(db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    kw = db.execute(text("SELECT cve_id, vendor, product, vuln_name, ransomware_use FROM cisa_kev WHERE date_added >= :c ORDER BY date_added DESC"), {"c": week_ago.date()}).fetchall()
    kt = db.execute(text("SELECT COUNT(*) FROM cisa_kev")).scalar()
    rv = db.execute(text("SELECT group_name, victim_name, country, sector FROM ransomware_victims WHERE discovered_at >= :c ORDER BY discovered_at DESC LIMIT 20"), {"c": week_ago}).fetchall()
    rg = db.execute(text("SELECT group_name, COUNT(*) as c FROM ransomware_victims WHERE discovered_at >= :c GROUP BY group_name ORDER BY c DESC LIMIT 5"), {"c": week_ago}).fetchall()
    ut = db.execute(text("SELECT threat, COUNT(*) as c FROM urlhaus_urls WHERE date_added >= :c AND threat IS NOT NULL AND threat != '' GROUP BY threat ORDER BY c DESC LIMIT 5"), {"c": week_ago}).fetchall()
    uc = db.execute(text("SELECT country, COUNT(*) as c FROM urlhaus_urls WHERE date_added >= :c AND country IS NOT NULL AND country != '' GROUP BY country ORDER BY c DESC LIMIT 5"), {"c": week_ago}).fetchall()
    return {"week_ending": now.strftime("%Y-%m-%d"),
        "kev": {"total_catalog": kt, "new_this_week": len(kw),
                "entries": [{"cve": r.cve_id, "vendor": r.vendor, "product": r.product, "name": r.vuln_name, "ransomware": r.ransomware_use} for r in kw]},
        "ransomware": {"victims_this_week": len(rv),
                       "top_groups": [{"group": r.group_name, "count": r.c} for r in rg],
                       "recent_victims": [{"group": r.group_name, "victim": r.victim_name, "country": r.country, "sector": r.sector} for r in rv[:10]]},
        "urlhaus": {"top_threats": [{"threat": r.threat, "count": r.c} for r in ut],
                    "top_hosting_countries": [{"country": r.country, "count": r.c} for r in uc]}}

@router.get("/health")
def podcast_feeds_health(db: Session = Depends(get_db)):
    kev = db.execute(text("SELECT COUNT(*), MAX(fetched_at) FROM cisa_kev")).fetchone()
    rv = db.execute(text("SELECT COUNT(*), MAX(fetched_at) FROM ransomware_victims")).fetchone()
    uh = db.execute(text("SELECT COUNT(*), MAX(fetched_at) FROM urlhaus_urls")).fetchone()
    return {"cisa_kev": {"count": kev[0], "last_fetch": kev[1].isoformat() if kev[1] else None},
            "ransomware": {"count": rv[0], "last_fetch": rv[1].isoformat() if rv[1] else None},
            "urlhaus": {"count": uh[0], "last_fetch": uh[1].isoformat() if uh[1] else None}}
