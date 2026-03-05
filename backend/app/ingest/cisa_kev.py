"""CISA KEV Ingest — Free, no API key."""
import json, logging, httpx
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)
KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"

async def run_kev_ingest(db: Session) -> dict:
    result = {"status": "ok", "total": 0, "new": 0, "errors": []}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(KEV_URL)
            if resp.status_code != 200:
                return {"status": "error", "errors": [f"HTTP {resp.status_code}"]}
            vulns = resp.json().get("vulnerabilities", [])
            result["total"] = len(vulns)
            for v in vulns:
                try:
                    db.execute(text("""
                        INSERT INTO cisa_kev (cve_id, vendor, product, vuln_name,
                            date_added, short_description, required_action, due_date,
                            ransomware_use, cwes, fetched_at)
                        VALUES (:cve, :vendor, :product, :name, :added, :desc,
                            :action, :due, :ransom, :cwes, :now)
                        ON CONFLICT (cve_id) DO UPDATE SET
                            ransomware_use = :ransom, fetched_at = :now
                    """), {"cve": v["cveID"], "vendor": v.get("vendorProject",""),
                           "product": v.get("product",""), "name": v.get("vulnerabilityName",""),
                           "added": v.get("dateAdded"), "desc": v.get("shortDescription",""),
                           "action": v.get("requiredAction",""), "due": v.get("dueDate"),
                           "ransom": v.get("knownRansomwareCampaignUse","Unknown"),
                           "cwes": json.dumps(v.get("cwes",[])),
                           "now": datetime.now(timezone.utc)})
                    result["new"] += 1
                except Exception as e:
                    logger.warning(f"KEV upsert error for {v.get('cveID')}: {e}")
            db.commit()
            logger.info(f"KEV ingest: {result['new']} CVEs stored")
    except Exception as e:
        logger.error(f"KEV ingest error: {e}")
        result["status"] = "error"
        result["errors"].append(str(e))
        db.rollback()
    return result
