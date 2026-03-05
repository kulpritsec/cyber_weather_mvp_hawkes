"""
GreyNoise Community/Enterprise API integration
Enriches threat events with classification, actor labels, and CVE tags

API Documentation: https://docs.greynoise.io/
Rate Limit: Community (50/day per IP), Enterprise (bulk export)
Refresh Cadence: Every 15 minutes (Enterprise) or hourly (Community)
Expected Volume: 500-1,000 classified IPs per batch
"""

import logging
import aiohttp
import asyncio
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session

from ..models import Event
from ..core.config import get_settings
from .geolocation import geolocate
import json

logger = logging.getLogger(__name__)

# GreyNoise API Configuration
GREYNOISE_API_BASE = "https://api.greynoise.io/v3"
GREYNOISE_COMMUNITY_BASE = "https://api.greynoise.io/v3/community"

# Tag to vector mapping
TAG_VECTOR_MAP = {
    "bruteforcer": "brute_force",
    "brute_forcer": "brute_force",
    "web_scanner": "http",
    "port_scanner": "ssh",
    "worm": "ssh",
    "ssh_scanner": "ssh",
    "rdp_scanner": "rdp",
    "dns_amplifier": "dns_amp",
    "http_scanner": "http",
    "malware": "botnet_c2",
    "ransomware": "ransomware",
}


class GreyNoiseIngestor:
    """GreyNoise threat intelligence enrichment ingestor"""

    def __init__(self, session: Session, api_key: Optional[str] = None):
        self.session = session
        self.api_key = api_key or get_settings().greynoise_api_key
        self.http_session: Optional[aiohttp.ClientSession] = None
        self.events_inserted = 0
        self.errors = 0

        # Determine if we have Enterprise (full API) or Community (limited) access
        self.is_enterprise = self.api_key and len(self.api_key) > 40  # Enterprise keys are longer

    async def __aenter__(self):
        headers = {}
        if self.api_key:
            headers["key"] = self.api_key

        timeout = aiohttp.ClientTimeout(total=30)
        self.http_session = aiohttp.ClientSession(timeout=timeout, headers=headers)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.http_session:
            await self.http_session.close()

    def _map_tags_to_vector(self, tags: List[str]) -> str:
        """Map GreyNoise tags to attack vector"""
        for tag in tags:
            tag_lower = tag.lower().replace(" ", "_")
            if tag_lower in TAG_VECTOR_MAP:
                return TAG_VECTOR_MAP[tag_lower]

        # Default to ssh if no specific match
        return "ssh"

    async def _query_community_ip(self, ip: str) -> Optional[Dict[str, Any]]:
        """
        Query GreyNoise Community API for a single IP

        Args:
            ip: IP address to lookup

        Returns:
            GreyNoise classification data or None
        """
        url = f"{GREYNOISE_COMMUNITY_BASE}/{ip}"

        try:
            async with self.http_session.get(url) as response:
                if response.status == 200:
                    return await response.json()
                elif response.status == 404:
                    # IP not in GreyNoise database
                    return None
                elif response.status == 429:
                    logger.warning(f"GreyNoise rate limited for {ip}")
                    return None
                else:
                    logger.error(f"GreyNoise API returned {response.status} for {ip}")
                    return None

        except Exception as e:
            logger.error(f"Error querying GreyNoise for {ip}: {e}")
            return None

    async def _query_gnql(self, query: str, size: int = 1000) -> List[Dict[str, Any]]:
        """
        Query GreyNoise using GNQL (Enterprise only)

        Args:
            query: GNQL query string (e.g., "classification:malicious")
            size: Number of results to return

        Returns:
            List of IP records matching the query
        """
        if not self.is_enterprise:
            logger.warning("GNQL queries require Enterprise API key")
            return []

        url = f"{GREYNOISE_API_BASE}/experimental/gnql"
        payload = {"query": query, "size": size}

        try:
            async with self.http_session.post(url, json=payload) as response:
                if response.status == 200:
                    data = await response.json()
                    return data.get("data", [])
                else:
                    logger.error(f"GNQL query failed: {response.status}")
                    return []

        except Exception as e:
            logger.error(f"Error executing GNQL query: {e}")
            return []

    def _normalize_greynoise_event(
        self,
        ip_data: Dict[str, Any],
        source: str = "greynoise"
    ) -> Optional[Event]:
        """
        Normalize GreyNoise data into an Event

        Args:
            ip_data: GreyNoise IP classification data
            source: Source identifier (greynoise or greynoise_enterprise)

        Returns:
            Event instance or None if invalid
        """
        ip = ip_data.get("ip")
        if not ip:
            return None

        # Geolocate
        geo_result = geolocate(ip)
        if not geo_result:
            return None

        # Extract GreyNoise classification
        classification = ip_data.get("classification", "unknown")  # malicious, benign, unknown
        noise = ip_data.get("noise", False)
        riot = ip_data.get("riot", False)  # RIOT = Legitimate service

        # Extract tags and actor info
        tags = ip_data.get("tags", [])
        actor = ip_data.get("actor", "")
        cves = ip_data.get("cves", [])

        # Map to vector
        vector = self._map_tags_to_vector(tags)

        # Calculate severity based on classification
        severity_map = {
            "malicious": 0.8,
            "benign": 0.2,
            "unknown": 0.5,
        }
        severity_raw = severity_map.get(classification, 0.5)

        # If RIOT (legitimate service), downgrade severity
        if riot:
            severity_raw *= 0.3

        # Timestamp - GreyNoise provides last_seen or we use current time
        last_seen = ip_data.get("last_seen")
        if last_seen:
            try:
                event_time = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
            except ValueError:
                event_time = datetime.now(timezone.utc)
        else:
            event_time = datetime.now(timezone.utc)

        # Build tags JSON
        event_tags = {
            "classification": classification,
            "noise": noise,
            "riot": riot,
            "greynoise_tags": tags,
            "actor": actor,
            "cves": cves,
        }

        # Create Event
        event = Event(
            ts=event_time,
            lat=geo_result.lat,
            lon=geo_result.lon,
            vector=vector,
            count=1,  # GreyNoise doesn't aggregate counts
            source=source,
            source_ip=ip,
            source_asn=geo_result.asn,
            source_country=geo_result.country_iso,
            target_port=None,  # GreyNoise doesn't always specify target port
            severity_raw=severity_raw,
            tags=json.dumps(event_tags) if isinstance(event_tags, dict) else event_tags,
            raw_ref=f"greynoise_{ip}",
        )

        return event

    async def ingest(self, hours_back: int = 1) -> int:
        """
        Main GreyNoise ingest entry point

        Strategy:
        - Community API: Query recent IPs from other feeds (e.g., DShield IPs)
        - Enterprise API: Use GNQL to bulk export malicious IPs

        Args:
            hours_back: Historical lookback window

        Returns:
            Number of events inserted
        """
        logger.info(f"Starting GreyNoise ingest (hours_back={hours_back})")

        if not self.api_key:
            logger.warning("No GreyNoise API key configured - skipping ingest")
            return 0

        self.events_inserted = 0
        self.errors = 0

        if self.is_enterprise:
            # Enterprise: Use GNQL to get malicious/noise IPs
            await self._ingest_enterprise()
        else:
            # Community: Enrich existing IPs from database
            await self._ingest_community()

        logger.info(
            f"GreyNoise ingest complete: {self.events_inserted} events inserted, {self.errors} errors"
        )
        return self.events_inserted

    async def _ingest_enterprise(self):
        """Enterprise GNQL bulk export"""
        # Query for malicious noise in last 24h
        query = "classification:malicious last_seen:24h"
        ip_records = await self._query_gnql(query, size=1000)

        logger.info(f"Retrieved {len(ip_records)} IPs from GNQL")

        events_added = 0
        for ip_data in ip_records:
            event = self._normalize_greynoise_event(ip_data, source="greynoise_enterprise")
            if event:
                self.session.add(event)
                events_added += 1

        if events_added > 0:
            self.session.commit()
            self.events_inserted += events_added
            logger.info(f"Inserted {events_added} GreyNoise Enterprise events")

    async def _ingest_community(self):
        """Community API: enrich recent IPs from database"""
        # Get unique IPs from recent events (last 24 hours)
        from ..models import Event as EventModel

        recent_events = self.session.query(EventModel.source_ip).distinct().filter(
            EventModel.source != "greynoise"  # Don't re-query our own events
        ).filter(
            EventModel.ts >= datetime.now(timezone.utc) - timedelta(hours=6)
        ).limit(10).all()  # Limit to 50 to stay within Community rate limits

        ips = [e[0] for e in recent_events if e[0]]
        logger.info(f"Enriching {len(ips)} IPs with GreyNoise Community API")

        events_added = 0
        for ip in ips:
            ip_data = await self._query_community_ip(ip)
            if ip_data:
                event = self._normalize_greynoise_event(ip_data, source="greynoise")
                if event:
                    self.session.add(event)
                    events_added += 1

            # Rate limiting: 50/day = ~2/minute, so wait 30s between queries
            await asyncio.sleep(60)

        if events_added > 0:
            self.session.commit()
            self.events_inserted += events_added
            logger.info(f"Inserted {events_added} GreyNoise Community events")


# Public API function matching runbook specification
async def ingest(session: Session, hours_back: int = 1) -> int:
    # Skip if no API key to avoid rate-limit spam
    settings = get_settings()
    if not settings.greynoise_api_key:
        logger.info("GreyNoise: skipping (no API key configured)")
        return 0
    """
    GreyNoise feed ingest entry point (runbook interface)

    Args:
        session: SQLAlchemy database session
        hours_back: Historical lookback window

    Returns:
        Number of events inserted
    """
    async with GreyNoiseIngestor(session) as ingestor:
        return await ingestor.ingest(hours_back=hours_back)
