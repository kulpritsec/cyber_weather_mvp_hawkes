"""
Ransomware Bridge — converts ransomware_victims rows into events table entries.
This makes ransomware victims appear as globe hotspots with geographic distribution.
"""
import logging
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Country code → approximate centroid (lat, lon)
# Covers all countries appearing in ransomware.live data
COUNTRY_COORDS = {
    "US": (39.83, -98.58), "DE": (51.17, 10.45), "CA": (56.13, -106.35),
    "GB": (55.38, -3.44), "UK": (55.38, -3.44), "IT": (41.87, 12.57),
    "FR": (46.23, 2.21), "ES": (40.46, -3.75), "IN": (20.59, 78.96),
    "BR": (-14.24, -51.93), "AU": (-25.27, 133.78), "JP": (36.20, 138.25),
    "TW": (23.70, 120.96), "MX": (23.63, -102.55), "TH": (15.87, 100.99),
    "TR": (38.96, 35.24), "CN": (35.86, 104.20), "MY": (4.21, 101.98),
    "CH": (46.82, 8.23), "AE": (23.42, 53.85), "NL": (52.13, 5.29),
    "KR": (35.91, 127.77), "SG": (1.35, 103.82), "PL": (51.92, 19.15),
    "ZA": (-30.56, 22.94), "AR": (-38.42, -63.62), "CL": (-35.68, -71.54),
    "CO": (4.57, -74.30), "PE": (-9.19, -75.02), "PH": (12.88, 121.77),
    "ID": (-0.79, 113.92), "VN": (14.06, 108.28), "NG": (9.08, 8.68),
    "KE": (-0.02, 37.91), "EG": (26.82, 30.80), "SA": (23.89, 45.08),
    "IL": (31.05, 34.85), "PT": (39.40, -8.22), "AT": (47.52, 14.55),
    "BE": (50.50, 4.47), "SE": (60.13, 18.64), "DK": (56.26, 9.50),
    "FI": (61.92, 25.75), "NO": (60.47, 8.47), "IE": (53.14, -7.69),
    "CZ": (49.82, 15.47), "RO": (45.94, 24.97), "HU": (47.16, 19.50),
    "GR": (39.07, 21.82), "BG": (42.73, 25.49), "HR": (45.10, 15.20),
    "SK": (48.67, 19.70), "LT": (55.17, 23.88), "LV": (56.88, 24.60),
    "EE": (58.60, 25.01), "SI": (46.15, 14.99), "RS": (44.02, 21.01),
    "UA": (48.38, 31.17), "RU": (61.52, 105.32), "PK": (30.38, 69.35),
    "BD": (23.68, 90.36), "LK": (7.87, 80.77), "NP": (28.39, 84.12),
    "QA": (25.35, 51.18), "KW": (29.31, 47.48), "BH": (26.07, 50.56),
    "OM": (21.51, 55.92), "JO": (30.59, 36.24), "LB": (33.85, 35.86),
    "IQ": (33.22, 43.68), "IR": (32.43, 53.69), "GH": (7.95, -1.02),
    "TZ": (-6.37, 34.89), "ET": (9.15, 40.49), "CM": (7.37, 12.35),
    "MA": (31.79, -7.09), "TN": (33.89, 9.54), "LUX": (49.82, 6.13),
    "NZ": (-40.90, 174.89), "HK": (22.40, 114.11), "PA": (8.54, -80.78),
    "CR": (9.75, -83.75), "DO": (18.74, -70.16), "EC": (-1.83, -78.18),
    "VE": (6.42, -66.59), "UY": (-32.52, -55.77), "PY": (-23.44, -58.44),
    "BO": (-16.29, -63.59), "GT": (15.78, -90.23), "HN": (15.20, -86.24),
    "SV": (13.79, -88.90), "NI": (12.87, -85.21), "CU": (21.52, -77.78),
}


async def bridge_ransomware_to_events(db: Session) -> dict:
    """Convert recent ransomware_victims into events table entries."""
    result = {"status": "ok", "bridged": 0, "skipped": 0, "errors": []}

    try:
        # Get victims not yet bridged (check by raw_ref)
        victims = db.execute(text("""
            SELECT rv.id, rv.group_name, rv.victim_name, rv.country,
                   rv.sector, rv.discovered_at, rv.description
            FROM ransomware_victims rv
            WHERE rv.country IS NOT NULL AND rv.country != ''
              AND NOT EXISTS (
                SELECT 1 FROM events e
                WHERE e.raw_ref = 'rv_' || rv.id::text
              )
            ORDER BY rv.discovered_at DESC NULLS LAST
            LIMIT 500
        """)).fetchall()

        now = datetime.now(timezone.utc)
        bridged = 0

        for v in victims:
            country = v.country.upper().strip()
            if country not in COUNTRY_COORDS:
                result["skipped"] += 1
                continue

            lat, lon = COUNTRY_COORDS[country]
            # Add small random jitter so dots don't stack
            import random
            lat += random.uniform(-1.5, 1.5)
            lon += random.uniform(-1.5, 1.5)

            ts = v.discovered_at or now
            group = v.group_name or "unknown"
            victim = v.victim_name or "unknown"
            sector = v.sector or ""

            # Severity based on group activity
            severity = 0.7
            if group.lower() in ("clop", "lockbit", "lockbit5", "blackcat", "alphv", "royal"):
                severity = 0.95
            elif group.lower() in ("akira", "play", "qilin", "incransom"):
                severity = 0.85

            metadata = f'{{"group":"{group}","victim":"{victim[:100]}","sector":"{sector}"}}'

            try:
                db.execute(text("""
                    INSERT INTO events (ts, lat, lon, vector, count, source,
                        threat_metadata, source_ip, source_country, target_port,
                        severity_raw, tags, raw_ref)
                    VALUES (:ts, :lat, :lon, 'ransomware', 1, 'ransomware_live',
                        :meta, NULL, :cc, NULL, :sev, :tags, :ref)
                """), {
                    "ts": ts, "lat": lat, "lon": lon,
                    "meta": metadata, "cc": country,
                    "sev": severity, "tags": f"ransomware,{group}",
                    "ref": f"rv_{v.id}",
                })
                bridged += 1
            except Exception as e:
                if "unique" not in str(e).lower():
                    result["errors"].append(str(e)[:100])

        db.commit()
        result["bridged"] = bridged
        logger.info(f"Ransomware bridge: {bridged} victims → events, {result['skipped']} skipped")

    except Exception as e:
        logger.error(f"Ransomware bridge error: {e}")
        result["status"] = "error"
        result["errors"].append(str(e))
        db.rollback()

    return result
