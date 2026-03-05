"""
CrowdSec Community Blocklist Ingest
Free blocklist of malicious IPs from 190 countries, 80K+ machines.
No API key needed for the community blocklist.
Source: https://raw.githubusercontent.com/crowdsecurity/crowdsec-cyber-threat-intelligence/
"""
import logging
import httpx
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.orm import Session

from .geolocation import geolocate

logger = logging.getLogger(__name__)

# Multiple free CrowdSec-adjacent blocklists
BLOCKLIST_URLS = [
    # CrowdSec community fire list
    "https://raw.githubusercontent.com/stamparm/ipsum/master/levels/3.txt",
    # Blocklist.de — strong IPs (attacks reported to German CERT)
    "https://lists.blocklist.de/lists/strongips.txt",
]

# Vector assignment based on blocklist source
VECTOR_MAP = {
    "ipsum": "brute_force",
    "blocklist.de": "brute_force",
}


async def run_crowdsec_ingest(db: Session) -> dict:
    """Fetch community blocklists and create events with geolocation."""
    result = {"status": "ok", "total": 0, "new": 0, "sources": [], "errors": []}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            all_ips = {}

            for url in BLOCKLIST_URLS:
                try:
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        result["errors"].append(f"{url}: HTTP {resp.status_code}")
                        continue

                    source_name = "ipsum" if "ipsum" in url else "blocklist_de"
                    ips = []
                    for line in resp.text.strip().split("\n"):
                        line = line.strip()
                        if not line or line.startswith("#") or line.startswith("/"):
                            continue
                        # ipsum format: "IP\tcount" or just IP
                        ip = line.split("\t")[0].split(" ")[0].strip()
                        if ip and "." in ip and len(ip) <= 45:
                            ips.append(ip)

                    result["sources"].append({"name": source_name, "ips": len(ips)})
                    for ip in ips:
                        all_ips[ip] = source_name

                except Exception as e:
                    result["errors"].append(f"{url}: {e}")

            result["total"] = len(all_ips)
            now = datetime.now(timezone.utc)
            new_count = 0

            # Sample up to 500 IPs per run to avoid overwhelming the DB
            import random
            sampled = list(all_ips.items())
            if len(sampled) > 500:
                sampled = random.sample(sampled, 500)

            for ip, source_name in sampled:
                try:
                    # Check if already ingested recently
                    exists = db.execute(text(
                        "SELECT 1 FROM events WHERE source_ip = :ip AND source = :src AND ts > NOW() - INTERVAL '24 hours' LIMIT 1"
                    ), {"ip": ip, "src": f"crowdsec_{source_name}"}).fetchone()

                    if exists:
                        continue

                    # Geolocate
                    geo = geolocate(ip)
                    if not geo or not geo.lat:
                        continue

                    lat = geo.lat
                    lon = geo.lon
                    country = geo.country_iso or "XX" 

                    # Determine vector from blocklist tags
                    vector = VECTOR_MAP.get(source_name, "brute_force")

                    db.execute(text("""
                        INSERT INTO events (ts, lat, lon, vector, count, source,
                            source_ip, source_country, severity_raw, tags, raw_ref)
                        VALUES (:ts, :lat, :lon, :vec, 1, :src,
                            :ip, :cc, :sev, :tags, :ref)
                    """), {
                        "ts": now, "lat": lat, "lon": lon, "vec": vector,
                        "src": f"crowdsec_{source_name}",
                        "ip": ip, "cc": country, "sev": 0.8,
                        "tags": f"blocklist,{source_name}",
                        "ref": f"cs_{ip}_{now.strftime('%Y%m%d')}",
                    })
                    new_count += 1
                except Exception as e:
                    if "unique" not in str(e).lower() and new_count < 3:
                        logger.warning(f"CrowdSec event insert error: {e}")

            db.commit()
            result["new"] = new_count
            logger.info(f"CrowdSec ingest: {new_count} new events from {len(all_ips)} IPs")

    except Exception as e:
        logger.error(f"CrowdSec ingest error: {e}")
        result["status"] = "error"
        result["errors"].append(str(e))
        db.rollback()

    return result
