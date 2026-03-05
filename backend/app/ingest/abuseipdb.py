"""
AbuseIPDB Ingest Module
Pulls recently reported malicious IPs from the AbuseIPDB blacklist + recent reports.

Key advantage: Reports come from VICTIMS worldwide — not just infrastructure hubs.
This naturally populates Africa, LATAM, SEA, Middle East on the globe.

Free tier: 1,000 checks/day, 5 reports/day
Blacklist endpoint: 1 call returns top abusive IPs (configurable confidence threshold)
API: https://docs.abuseipdb.com/
"""

import logging
import json
import aiohttp
import asyncio
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session

from ..models import Event
from ..core.config import get_settings
from .geolocation import geolocate

logger = logging.getLogger(__name__)

# AbuseIPDB category IDs to attack vector mapping
# See: https://www.abuseipdb.com/categories
CATEGORY_VECTOR_MAP = {
    1: "dns_amp",      # DNS Compromise
    2: "dns_amp",      # DNS Poisoning
    3: "http",         # Fraud Orders
    4: "http",         # DDoS Attack
    5: "http",         # FTP Brute-Force
    6: "http",         # Ping of Death
    7: "phishing",     # Phishing
    8: "http",         # Fraud VoIP
    9: "http",         # Open Proxy
    10: "http",        # Web Spam
    11: "http",        # Email Spam
    12: "http",        # Blog Spam
    13: "http",        # VPN IP
    14: "ssh",         # Port Scan
    15: "http",        # Hacking
    16: "http",        # SQL Injection
    17: "http",        # Spoofing
    18: "ssh",         # Brute-Force
    19: "http",        # Bad Web Bot
    20: "http",        # Exploited Host
    21: "http",        # Web App Attack
    22: "ssh",         # SSH
    23: "http",        # IoT Targeted
}

# Default vector when category not mapped
DEFAULT_VECTOR = "http"


def _categories_to_vector(categories: List[int]) -> str:
    """Map AbuseIPDB category list to primary attack vector.
    
    Priority: SSH/brute-force > ransomware > phishing > exploit > http
    """
    vectors_seen = set()
    for cat_id in categories:
        v = CATEGORY_VECTOR_MAP.get(cat_id, DEFAULT_VECTOR)
        vectors_seen.add(v)

    # Priority ordering
    for priority in ["ransomware", "botnet_c2", "ssh", "rdp", "phishing", "dns_amp", "exploit"]:
        if priority in vectors_seen:
            return priority
    return "http"


def _confidence_to_intensity(confidence: int) -> float:
    """Map AbuseIPDB confidence score (0-100) to intensity (0.0-1.0)."""
    return max(0.1, min(1.0, confidence / 100.0))


async def _fetch_blacklist(http: aiohttp.ClientSession, headers: dict,
                           confidence_minimum: int = 75, limit: int = 500) -> List[Dict]:
    """Fetch the AbuseIPDB blacklist — top abusive IPs globally.
    
    This is the most efficient endpoint: 1 API call returns up to 10K IPs.
    Free tier allows this with confidenceMinimum >= 75.
    """
    url = "https://api.abuseipdb.com/api/v2/blacklist"
    params = {
        "confidenceMinimum": confidence_minimum,
        "limit": limit,
    }

    try:
        async with http.get(url, headers=headers, params=params) as resp:
            if resp.status == 401:
                logger.error("AbuseIPDB API key invalid")
                return []
            if resp.status == 429:
                logger.warning("AbuseIPDB rate limited")
                return []
            if resp.status != 200:
                logger.error(f"AbuseIPDB blacklist returned {resp.status}")
                return []

            data = await resp.json()
            ips = data.get("data", [])
            logger.info(f"AbuseIPDB blacklist: {len(ips)} IPs (confidence >= {confidence_minimum})")
            return ips

    except asyncio.TimeoutError:
        logger.warning("AbuseIPDB blacklist request timed out")
        return []


async def _fetch_reports_for_ip(http: aiohttp.ClientSession, headers: dict,
                                 ip: str) -> Optional[Dict]:
    """Fetch detailed report data for a specific IP.
    
    This uses 1 check from the daily quota. Use sparingly.
    Returns enrichment data: categories, country, ISP, usage type, etc.
    """
    url = "https://api.abuseipdb.com/api/v2/check"
    params = {
        "ipAddress": ip,
        "maxAgeInDays": 30,
        "verbose": True,
    }

    try:
        async with http.get(url, headers=headers, params=params) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
            return data.get("data", {})
    except (asyncio.TimeoutError, Exception):
        return None


async def ingest(session: Session, hours_back: int = 24) -> int:
    """
    Ingest AbuseIPDB threat data.
    
    Strategy (optimized for free tier 1000 checks/day):
    1. Pull blacklist (1 API call, returns hundreds of IPs)
    2. Geolocate via MaxMind (free, no API cost)
    3. Optionally enrich top IPs with /check endpoint (costs 1 check each)
    
    Returns count of new events inserted.
    """
    settings = get_settings()
    api_key = getattr(settings, "abuseipdb_api_key", None)

    if not api_key:
        logger.warning("AbuseIPDB API key not configured — skipping. "
                       "Set CYBER_WEATHER_ABUSEIPDB_API_KEY in .env")
        return 0

    headers = {
        "Key": api_key,
        "Accept": "application/json",
    }

    events_created = 0
    errors = []

    try:
        timeout = aiohttp.ClientTimeout(total=90)
        async with aiohttp.ClientSession(timeout=timeout) as http:

            # --- Phase 1: Blacklist (bulk, 1 API call) ---
            blacklist_ips = await _fetch_blacklist(
                http, headers,
                confidence_minimum=75,
                limit=500,  # Plenty for geographic spread
            )

            for entry in blacklist_ips:
                try:
                    ip = entry.get("ipAddress", "")
                    confidence = entry.get("abuseConfidenceScore", 0)
                    country_code = entry.get("countryCode", "")
                    total_reports = entry.get("totalReports", 0)
                    last_reported = entry.get("lastReportedAt", "")

                    if not ip:
                        continue

                    # Deduplicate
                    raw_ref = f"abuseipdb_bl_{ip}"
                    existing = session.query(Event).filter_by(raw_ref=raw_ref).first()
                    if existing:
                        continue

                    # Geolocate via MaxMind
                    geo_result = geolocate(ip)
                    if not geo_result or not geo_result.lat:
                        continue

                    lat = geo_result.lat
                    lon = geo_result.lon
                    country = geo_result.country_iso or country_code
                    city = getattr(geo_result, "city_name", "") or ""
                    asn = getattr(geo_result, "asn", "") or ""

                    # Parse timestamp
                    try:
                        if last_reported:
                            ts = datetime.fromisoformat(
                                last_reported.replace("Z", "+00:00")
                            )
                        else:
                            ts = datetime.now(timezone.utc)
                    except (ValueError, TypeError):
                        ts = datetime.now(timezone.utc)

                    # Confidence-based intensity
                    intensity = _confidence_to_intensity(confidence)

                    # Default vector from blacklist (no categories available)
                    # Blacklist entries are generically malicious
                    vector = "ssh"  # Most blacklisted IPs are brute-forcers

                    event = Event(
                        ts=ts,
                        source="abuseipdb",
                        vector=vector,
                        source_ip=ip,
                        lat=lat,
                        lon=lon,
                        source_country=country,
                        severity_raw=intensity,
                        tags=json.dumps({
                            "confidence": confidence,
                            "total_reports": total_reports,
                            "city": city,
                            "asn": asn,
                            "country_code": country_code,
                            "source_type": "blacklist",
                        }),
                        raw_ref=raw_ref,
                    )
                    session.add(event)
                    events_created += 1

                    if events_created % 100 == 0:
                        session.commit()

                except Exception as e:
                    errors.append(str(e)[:100])
                    continue

            # --- Phase 2: Enrich top IPs with detailed reports ---
            # Use up to 50 checks from daily quota for enrichment
            enrich_limit = min(50, len(blacklist_ips))
            enriched = 0

            # Sort by confidence desc, enrich the most abusive first
            top_ips = sorted(blacklist_ips, 
                           key=lambda x: x.get("abuseConfidenceScore", 0),
                           reverse=True)[:enrich_limit]

            for entry in top_ips:
                ip = entry.get("ipAddress", "")
                if not ip:
                    continue

                # Rate limit: 1 req per second to be nice
                await asyncio.sleep(1)

                report_data = await _fetch_reports_for_ip(http, headers, ip)
                if not report_data:
                    continue

                # Extract categories from reports
                categories = []
                reports = report_data.get("reports", [])
                for report in reports[:20]:  # Sample first 20 reports
                    cats = report.get("categories", [])
                    categories.extend(cats)

                if categories:
                    vector = _categories_to_vector(categories)
                    isp = report_data.get("isp", "")
                    usage_type = report_data.get("usageType", "")
                    domain = report_data.get("domain", "")

                    # Update the existing event with enriched data
                    raw_ref = f"abuseipdb_bl_{ip}"
                    existing_event = session.query(Event).filter_by(raw_ref=raw_ref).first()
                    if existing_event:
                        existing_event.vector = vector
                        existing_tags = json.loads(existing_event.tags or "{}")
                        existing_tags.update({
                            "categories": list(set(categories)),
                            "isp": isp,
                            "usage_type": usage_type,
                            "domain": domain,
                            "enriched": True,
                        })
                        existing_event.tags = json.dumps(existing_tags)
                        enriched += 1

                if enriched % 10 == 0 and enriched > 0:
                    session.commit()

            session.commit()

            logger.info(f"AbuseIPDB enrichment: {enriched}/{enrich_limit} IPs enriched with categories")

    except Exception as e:
        logger.error(f"AbuseIPDB ingest failed: {e}")
        errors.append(str(e)[:200])
        return 0

    logger.info(f"AbuseIPDB ingest complete: {events_created} events "
                f"({len(errors)} errors)")
    return events_created
