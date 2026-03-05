"""URLhaus (abuse.ch) Ingest — CSV download (API requires auth now)."""
import csv, io, json, logging, httpx
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)
URLHAUS_CSV = "https://urlhaus.abuse.ch/downloads/csv_recent/"

async def run_urlhaus_ingest(db: Session) -> dict:
    result = {"status": "ok", "total": 0, "new": 0, "errors": []}
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(URLHAUS_CSV)
            if resp.status_code != 200:
                return {"status": "error", "errors": [f"HTTP {resp.status_code}"]}

            lines = resp.text.strip().split("\n")
            # Skip comment lines (start with #)
            data_lines = [l for l in lines if not l.startswith("#")]
            result["total"] = len(data_lines)

            now = datetime.now(timezone.utc)
            reader = csv.reader(io.StringIO("\n".join(data_lines)))
            new_count = 0

            for row in reader:
                if len(row) < 8: continue
                try:
                    uid = int(row[0].strip('"'))
                    date_added = row[1].strip('"')
                    url = row[2].strip('"')
                    url_status = row[3].strip('"')
                    last_online = row[4].strip('"')
                    threat = row[5].strip('"')
                    tags = row[6].strip('"')
                    host = row[7].strip('"') if len(row) > 7 else ""
                    # Some CSV rows have country in position 8
                    country = row[8].strip('"') if len(row) > 8 else ""

                    db.execute(text("""
                        INSERT INTO urlhaus_urls (urlhaus_id, url, url_status, host,
                            date_added, threat, tags, country, fetched_at)
                        VALUES (:uid, :url, :status, :host, :added,
                                :threat, :tags, :country, :now)
                        ON CONFLICT (urlhaus_id) DO UPDATE SET
                            url_status = :status, fetched_at = :now
                    """), {"uid": uid, "url": url[:2000], "status": url_status,
                           "host": host[:256], "added": date_added if date_added else None,
                           "threat": threat, "tags": tags, "country": country[:8],
                           "now": now})
                    new_count += 1
                except Exception as e:
                    if "unique" not in str(e).lower() and new_count < 3:
                        logger.warning(f"URLhaus CSV row error: {e}")

                # Cap at 1000 most recent for reasonable ingest
                if new_count >= 1000: break

            db.commit()
            result["new"] = new_count
            logger.info(f"URLhaus CSV ingest: {new_count} URLs stored")
    except Exception as e:
        logger.error(f"URLhaus ingest error: {e}")
        result["status"] = "error"
        result["errors"].append(str(e))
        db.rollback()
    return result
