"""
AlienVault OTX (Open Threat Exchange) Ingest Module
Pulls pulse indicators with global geographic coverage.
OTX has contributors worldwide — Africa, LATAM, SEA — filling gaps DShield misses.

Free API: https://otx.alienvault.com/api
Rate limit: ~10,000 requests/hour with API key
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

# OTX indicator type to attack vector mapping
INDICATOR_VECTOR_MAP = {
    "IPv4": "ssh",           # Default for raw IPs — refined by pulse tags
    "IPv6": "ssh",
    "domain": "http",        # Malicious domains → web vector
    "hostname": "http",
    "URL": "http",           # Malicious URLs → web vector
    "email": "phishing",     # Email indicators → phishing
    "FileHash-MD5": "malware",
    "FileHash-SHA1": "malware",
    "FileHash-SHA256": "malware",
    "CVE": "exploit",
    "CIDR": "ssh",
}

# Pulse tag keywords to vector refinement
TAG_VECTOR_OVERRIDES = {
    "ransomware": "ransomware",
    "ransom": "ransomware",
    "phishing": "phishing",
    "botnet": "botnet_c2",
    "c2": "botnet_c2",
    "command and control": "botnet_c2",
    "rat": "botnet_c2",
    "exploit": "exploit",
    "rdp": "rdp",
    "brute": "ssh",
    "ssh": "ssh",
    "ddos": "dns_amp",
    "amplification": "dns_amp",
    "apt": "http",
    "malware": "malware",
    "trojan": "malware",
    "stealer": "malware",
    "loader": "malware",
}


def _determine_vector(indicator_type: str, pulse_tags: List[str]) -> str:
    """Determine attack vector from indicator type and pulse context tags."""
    # Check pulse tags first — more specific
    tags_lower = [t.lower() for t in pulse_tags]
    for tag in tags_lower:
        for keyword, vector in TAG_VECTOR_OVERRIDES.items():
            if keyword in tag:
                return vector
    # Fall back to indicator type mapping
    return INDICATOR_VECTOR_MAP.get(indicator_type, "http")


def _extract_attack_ids(pulse: Dict[str, Any]) -> List[str]:
    """Extract ATT&CK technique IDs from pulse metadata."""
    attack_ids = []
    if "attack_ids" in pulse:
        for attack in pulse["attack_ids"]:
            if isinstance(attack, dict) and "id" in attack:
                attack_ids.append(attack["id"])
            elif isinstance(attack, str):
                attack_ids.append(attack)
    return attack_ids


async def ingest(session: Session, hours_back: int = 24) -> int:
    """
    Ingest recent OTX pulse indicators.

    Strategy:
    1. Fetch recent pulses from both /subscribed and /activity (last 7 days)
    2. For each pulse, fetch full indicators via /indicators endpoint
    3. Geolocate IPv4/IPv6 indicators
    4. Map to events with vector classification

    Target: 200+ events per cycle.
    Returns count of new events inserted.
    """
    settings = get_settings()
    api_key = getattr(settings, "otx_api_key", None) or getattr(settings, "alienvault_otx_api_key", None)

    if not api_key:
        logger.warning("OTX API key not configured — skipping OTX ingest. "
                       "Set CYBER_WEATHER_OTX_API_KEY in .env")
        return 0

    base_url = "https://otx.alienvault.com/api/v1"
    headers = {
        "X-OTX-API-KEY": api_key,
        "Accept": "application/json",
    }

    # Look back 7 days for more coverage
    since = datetime.now(timezone.utc) - timedelta(days=7)
    since_str = since.strftime("%Y-%m-%dT%H:%M:%S+00:00")

    events_created = 0
    pulses_processed = 0
    indicators_geolocated = 0
    errors = []

    try:
        timeout = aiohttp.ClientTimeout(total=120)
        async with aiohttp.ClientSession(timeout=timeout) as http:
            all_indicators = []
            pulse_ids_seen = set()

            # Fetch from BOTH endpoints for maximum coverage
            endpoints = [
                (f"{base_url}/pulses/subscribed", "subscribed"),
                (f"{base_url}/pulses/activity", "activity"),
            ]

            for endpoint_url, endpoint_name in endpoints:
                page = 1
                max_pages = 10  # Increased from 5

                while page <= max_pages:
                    params = {
                        "modified_since": since_str,
                        "page": page,
                        "limit": 50,
                    }

                    try:
                        async with http.get(endpoint_url, headers=headers, params=params) as resp:
                            if resp.status == 403:
                                logger.error(f"OTX API key invalid ({endpoint_name})")
                                break
                            if resp.status == 429:
                                logger.warning("OTX rate limited — backing off")
                                await asyncio.sleep(30)
                                continue
                            if resp.status != 200:
                                logger.warning(f"OTX {endpoint_name} returned {resp.status}")
                                break

                            data = await resp.json()
                            pulses = data.get("results", [])

                            if not pulses:
                                break

                            for pulse in pulses:
                                pulse_id = pulse.get("id", "unknown")
                                if pulse_id in pulse_ids_seen:
                                    continue
                                pulse_ids_seen.add(pulse_id)

                                pulse_name = pulse.get("name", "")
                                pulse_tags = pulse.get("tags", [])
                                attack_ids = _extract_attack_ids(pulse)
                                adversary = pulse.get("adversary", "")
                                targeted_countries = pulse.get("targeted_countries", [])
                                malware_families = pulse.get("malware_families", [])

                                # Get indicators from the pulse itself
                                indicators = pulse.get("indicators", [])

                                # If pulse has few indicators, fetch full indicator list
                                if len(indicators) < 5:
                                    try:
                                        ind_url = f"{base_url}/pulses/{pulse_id}/indicators"
                                        async with http.get(ind_url, headers=headers, params={"limit": 100}) as ind_resp:
                                            if ind_resp.status == 200:
                                                ind_data = await ind_resp.json()
                                                indicators = ind_data.get("results", indicators)
                                    except (asyncio.TimeoutError, Exception):
                                        pass

                                for indicator in indicators:
                                    ioc_type = indicator.get("type", "")
                                    ioc_value = indicator.get("indicator", "")
                                    ioc_title = indicator.get("title", "")
                                    ioc_created = indicator.get("created", "")

                                    if not ioc_value:
                                        continue

                                    # Only keep geolocatable types
                                    if ioc_type not in ("IPv4", "IPv6", "URL", "hostname", "domain"):
                                        # Still keep hashes if we have targeted_countries
                                        if not targeted_countries:
                                            continue

                                    all_indicators.append({
                                        "type": ioc_type,
                                        "value": ioc_value,
                                        "title": ioc_title,
                                        "created": ioc_created,
                                        "pulse_id": pulse_id,
                                        "pulse_name": pulse_name,
                                        "pulse_tags": pulse_tags,
                                        "attack_ids": attack_ids,
                                        "adversary": adversary,
                                        "targeted_countries": targeted_countries,
                                        "malware_families": [m.get("display_name", str(m))
                                                             if isinstance(m, dict) else str(m)
                                                             for m in malware_families],
                                    })

                                pulses_processed += 1

                            if data.get("next"):
                                page += 1
                            else:
                                break

                    except asyncio.TimeoutError:
                        logger.warning(f"OTX {endpoint_name} timed out on page {page}")
                        errors.append(f"timeout_{endpoint_name}_page_{page}")
                        break

                logger.info(f"OTX {endpoint_name}: {page - 1} pages fetched")

            logger.info(f"OTX: {pulses_processed} pulses, {len(all_indicators)} indicators fetched")

            # Process indicators — focus on IP types for geolocation
            for ind in all_indicators:
                try:
                    ioc_type = ind["type"]
                    ioc_value = ind["value"]
                    vector = _determine_vector(ioc_type, ind["pulse_tags"])

                    # Parse timestamp
                    try:
                        if ind["created"]:
                            ts = datetime.fromisoformat(
                                ind["created"].replace("Z", "+00:00")
                            )
                        else:
                            ts = datetime.now(timezone.utc)
                    except (ValueError, TypeError):
                        ts = datetime.now(timezone.utc)

                    lat, lon = 0.0, 0.0
                    country = ""
                    city = ""
                    asn = ""

                    # Geolocate IPs directly
                    if ioc_type in ("IPv4", "IPv6"):
                        geo_result = geolocate(ioc_value)
                        if geo_result and geo_result.lat:
                            lat = geo_result.lat
                            lon = geo_result.lon
                            country = geo_result.country_iso or ""
                            city = getattr(geo_result, "city_name", "") or ""
                            asn = getattr(geo_result, "asn", "") or ""
                            indicators_geolocated += 1
                        else:
                            continue  # Skip IPs we can't geolocate

                    # For URLs/hostnames/domains, resolve to IP
                    elif ioc_type in ("URL", "hostname", "domain"):
                        resolved_ip = _resolve_domain_to_ip(ioc_value, ioc_type if ioc_type != "domain" else "hostname")
                        if resolved_ip:
                            geo_result = geolocate(resolved_ip)
                            if geo_result and geo_result.lat:
                                lat = geo_result.lat
                                lon = geo_result.lon
                                country = geo_result.country_iso or ""
                                city = getattr(geo_result, "city_name", "") or ""
                                asn = getattr(geo_result, "asn", "") or ""
                                indicators_geolocated += 1
                            else:
                                continue
                        else:
                            continue

                    # For hashes/other: use targeted_countries or adversary mapping
                    else:
                        from .country_centroids import COUNTRY_CENTROIDS
                        resolved = False
                        for cc in ind.get("targeted_countries", []):
                            if cc in COUNTRY_CENTROIDS:
                                lat, lon = COUNTRY_CENTROIDS[cc]
                                country = cc
                                resolved = True
                                break
                        if not resolved:
                            cc = _adversary_to_country(ind["adversary"], ind["pulse_name"])
                            if cc and cc in COUNTRY_CENTROIDS:
                                lat, lon = COUNTRY_CENTROIDS[cc]
                                country = cc
                                resolved = True
                        if not resolved:
                            continue

                    # Deduplicate by raw_ref
                    raw_ref = f"otx_{ind['pulse_id']}_{ioc_value}"
                    existing = session.query(Event).filter_by(raw_ref=raw_ref).first()
                    if existing:
                        continue

                    event = Event(
                        ts=ts,
                        source="otx",
                        vector=vector,
                        source_ip=ioc_value if ioc_type in ("IPv4", "IPv6") else None,
                        lat=lat,
                        lon=lon,
                        source_country=country,
                        severity_raw=0.6,  # Moderate baseline — OTX is curated intel
                        tags=json.dumps({
                            "pulse_name": ind["pulse_name"],
                            "pulse_id": ind["pulse_id"],
                            "ioc_type": ioc_type,
                            "adversary": ind["adversary"],
                            "attack_ids": ind["attack_ids"],
                            "malware_families": ind["malware_families"],
                            "city": city,
                            "asn": asn,
                        }),
                        raw_ref=raw_ref,
                    )
                    session.add(event)
                    events_created += 1

                    # Batch commit every 100 events
                    if events_created % 100 == 0:
                        session.commit()

                except Exception as e:
                    errors.append(str(e)[:100])
                    continue

            session.commit()

    except Exception as e:
        logger.error(f"OTX ingest failed: {e}")
        errors.append(str(e)[:200])
        return 0

    logger.info(f"OTX ingest complete: {events_created} events from {pulses_processed} pulses, "
                f"{indicators_geolocated} geolocated ({len(errors)} errors)")
    return events_created


# ─── DNS RESOLUTION FALLBACK FOR URLs/HOSTNAMES ───
import socket
from urllib.parse import urlparse

_dns_cache = {}

def _resolve_domain_to_ip(indicator_value: str, indicator_type: str) -> str:
    """Extract domain from URL/hostname and resolve to IP."""
    try:
        if indicator_type == "URL":
            domain = urlparse(indicator_value).hostname
        elif indicator_type == "hostname":
            domain = indicator_value.strip().rstrip(".")
        else:
            return ""
        if not domain:
            return ""
        if domain in _dns_cache:
            return _dns_cache[domain]
        ip = socket.gethostbyname(domain)
        _dns_cache[domain] = ip
        return ip
    except (socket.gaierror, socket.herror, OSError, ValueError):
        _dns_cache.setdefault(domain, "")
        return ""


# Adversary name keywords → likely country of origin
ADVERSARY_COUNTRY_MAP = {
    "dprk": "KP", "lazarus": "KP", "kimsuky": "KP", "north korea": "KP",
    "apt38": "KP", "andariel": "KP",
    "china": "CN", "apt41": "CN", "plugx": "CN", "mustang panda": "CN",
    "apt27": "CN", "winnti": "CN", "panda": "CN",
    "russia": "RU", "apt28": "RU", "apt29": "RU", "fancy bear": "RU",
    "cozy bear": "RU", "sandworm": "RU", "turla": "RU", "bear": "RU",
    "iran": "IR", "apt33": "IR", "apt35": "IR", "charming kitten": "IR",
    "muddywater": "IR",
    "vietnam": "VN", "apt32": "VN", "oceanlotus": "VN",
    "india": "IN", "sidewinder": "IN",
    "pakistan": "PK", "transparent tribe": "PK",
    "turkey": "TR", "sea turtle": "TR",
    "nigeria": "NG", "silverterrier": "NG",
    "brazil": "BR",
}

def _adversary_to_country(adversary: str, pulse_name: str) -> str:
    """Map adversary or pulse name keywords to country code."""
    search_text = f"{adversary} {pulse_name}".lower()
    for keyword, cc in ADVERSARY_COUNTRY_MAP.items():
        if keyword in search_text:
            return cc
    return ""
