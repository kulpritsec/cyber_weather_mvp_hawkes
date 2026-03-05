"""Ransomware.live Ingest — Free API, no key."""
import logging, httpx
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

ENDPOINTS = [
    "https://api.ransomware.live/victims/2026",
    "https://api.ransomware.live/recentcyberattacks",
    "https://api.ransomware.live/v2/recentvictims",
]
GROUPS_URL = "https://api.ransomware.live/groups"

async def run_ransomware_ingest(db: Session) -> dict:
    result = {"status": "ok", "victims": 0, "groups": 0, "errors": []}
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            victims = []
            for url in ENDPOINTS:
                try:
                    resp = await client.get(url)
                    if resp.status_code == 200:
                        data = resp.json()
                        if isinstance(data, list) and len(data) > 0:
                            victims = data
                            logger.info(f"Ransomware.live: got {len(victims)} from {url}")
                            break
                except Exception as e:
                    logger.warning(f"Ransomware endpoint {url}: {e}")
                    continue

            now = datetime.now(timezone.utc)
            stored = 0
            for v in victims:
                try:
                    # recentcyberattacks: title, victim, country, summary, date, domain, url
                    # victims endpoint: group_name, post_title, discovered, country, activity
                    group = v.get("group_name", v.get("group", "cyberattack"))
                    victim = v.get("victim", v.get("post_title", v.get("title", v.get("name", "unknown"))))
                    discovered = v.get("discovered", v.get("date", v.get("added")))
                    country = v.get("country", "")
                    sector = v.get("activity", v.get("sector", ""))
                    desc = v.get("summary", v.get("description", v.get("body", "")))
                    website = v.get("url", v.get("website", v.get("domain", "")))

                    db.execute(text("""
                        INSERT INTO ransomware_victims
                            (group_name, victim_name, victim_url, country, sector,
                             discovered_at, description, status, fetched_at)
                        VALUES (:group, :victim, :url, :country, :sector,
                                :discovered, :desc, :status, :now)
                        ON CONFLICT (group_name, victim_name, discovered_at)
                        DO UPDATE SET status = COALESCE(:status, ransomware_victims.status),
                                      fetched_at = :now
                    """), {"group": group, "victim": (victim or "unknown")[:500],
                           "url": (website or "")[:500], "country": (country or "")[:128],
                           "sector": (sector or "")[:256], "discovered": discovered,
                           "desc": (desc or "")[:1000], "status": v.get("status",""), "now": now})
                    stored += 1
                except Exception as e:
                    if "unique" not in str(e).lower():
                        logger.warning(f"Ransomware victim error: {e}")
            db.commit()
            result["victims"] = stored

            # Groups
            try:
                resp = await client.get(GROUPS_URL)
                if resp.status_code == 200:
                    groups = resp.json()
                    if isinstance(groups, list):
                        for g in groups:
                            name = g.get("name", g.get("group_name", ""))
                            if not name: continue
                            try:
                                db.execute(text("""
                                    INSERT INTO ransomware_groups (group_name, profile, victim_count, fetched_at)
                                    VALUES (:name, :profile, :count, :now)
                                    ON CONFLICT (group_name) DO UPDATE SET
                                        profile = COALESCE(:profile, ransomware_groups.profile),
                                        victim_count = COALESCE(:count, ransomware_groups.victim_count),
                                        fetched_at = :now
                                """), {"name": name, "profile": g.get("description","")[:1000],
                                       "count": g.get("victim_count", 0), "now": now})
                            except Exception: pass
                        db.commit()
                        result["groups"] = len(groups)
            except Exception as e:
                result["errors"].append(f"Groups: {e}")
    except Exception as e:
        logger.error(f"Ransomware ingest error: {e}")
        result["status"] = "error"
        result["errors"].append(str(e))
        db.rollback()
    return result
