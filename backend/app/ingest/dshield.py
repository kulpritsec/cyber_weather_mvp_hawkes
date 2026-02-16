"""
DShield / SANS Internet Storm Center feed integration
Primary high-volume CTI feed for port-based attack vectors

API Documentation: https://isc.sans.edu/api/
Rate Limit: ~60 requests/hour (be polite, no official limit)
Refresh Cadence: Every 60 minutes
Expected Volume: 50K-200K events per hourly pull across monitored ports
"""

import logging
import aiohttp
import asyncio
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session

from ..models import Event, GridCell, VectorConfig
from ..core.database import get_db
from .geolocation import geolocate

logger = logging.getLogger(__name__)

# DShield API Configuration
DSHIELD_BASE_URL = "https://isc.sans.edu/api"

# Monitored ports mapping to attack vectors
PORT_VECTOR_MAP = {
    22: "ssh",
    3389: "rdp",
    80: "http",
    443: "http",
    53: "dns_amp",
    23: "ssh",  # Telnet often used for similar brute force
    21: "ssh",  # FTP brute force
    25: "http",  # SMTP enumeration
    445: "rdp",  # SMB/Windows shares
}


class DShieldIngestor:
    """DShield/SANS ISC threat feed ingestor"""

    def __init__(self, session: Session):
        self.session = session
        self.http_session: Optional[aiohttp.ClientSession] = None
        self.events_inserted = 0
        self.errors = 0

    async def __aenter__(self):
        timeout = aiohttp.ClientTimeout(total=30)
        self.http_session = aiohttp.ClientSession(timeout=timeout)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.http_session:
            await self.http_session.close()

    def _map_port_to_vector(self, port: int) -> Optional[str]:
        """Map destination port to attack vector using VectorConfig"""
        # First check our static map
        if port in PORT_VECTOR_MAP:
            return PORT_VECTOR_MAP[port]

        # Fallback to database VectorConfig lookup
        vector_config = self.session.query(VectorConfig).filter(
            VectorConfig.enabled == True
        ).all()

        # Could add port range matching logic here if needed
        return None

    async def _fetch_with_retry(
        self,
        url: str,
        max_retries: int = 3,
        backoff_factor: float = 2.0
    ) -> Optional[Dict[str, Any]]:
        """
        Fetch JSON from URL with exponential backoff retry logic

        Args:
            url: API endpoint URL
            max_retries: Maximum number of retry attempts
            backoff_factor: Multiplier for exponential backoff

        Returns:
            Parsed JSON response or None on failure
        """
        for attempt in range(max_retries):
            try:
                async with self.http_session.get(url) as response:
                    if response.status == 200:
                        return await response.json()
                    elif response.status == 429:  # Rate limited
                        wait_time = backoff_factor ** attempt
                        logger.warning(
                            f"DShield rate limited (429), waiting {wait_time}s before retry {attempt + 1}/{max_retries}"
                        )
                        await asyncio.sleep(wait_time)
                    else:
                        logger.error(
                            f"DShield API returned {response.status}: {url}"
                        )
                        return None

            except asyncio.TimeoutError:
                logger.warning(f"Timeout fetching {url}, retry {attempt + 1}/{max_retries}")
                await asyncio.sleep(backoff_factor ** attempt)
            except Exception as e:
                logger.error(f"Error fetching {url}: {e}")
                return None

        logger.error(f"Failed to fetch {url} after {max_retries} retries")
        return None

    async def _fetch_top_ips(self, limit: int = 100) -> List[Dict[str, Any]]:
        """
        Fetch top attacking IPs from DShield

        Args:
            limit: Number of top IPs to fetch (max 10000)

        Returns:
            List of IP records with attacks, count, etc.
        """
        url = f"{DSHIELD_BASE_URL}/topips/records/{limit}/?json"
        logger.info(f"Fetching top {limit} attacking IPs from DShield")

        data = await self._fetch_with_retry(url)
        if not data:
            return []

        # DShield returns {"topips": {"sources": [...]}}
        sources = data.get("topips", {}).get("sources", [])
        logger.info(f"Retrieved {len(sources)} top attacking IPs")
        return sources

    async def _fetch_port_details(self, port: int) -> List[Dict[str, Any]]:
        """
        Fetch detailed attack data for a specific port

        Args:
            port: Port number to query

        Returns:
            List of attack records for that port
        """
        url = f"{DSHIELD_BASE_URL}/portdetails/{port}/?json"
        logger.debug(f"Fetching port {port} details from DShield")

        data = await self._fetch_with_retry(url)
        if not data:
            return []

        # DShield returns {"portdetails": {"sources": [...]}}
        sources = data.get("portdetails", {}).get("sources", [])
        logger.debug(f"Retrieved {len(sources)} records for port {port}")
        return sources

    def _normalize_dshield_event(
        self,
        source_ip: str,
        port: int,
        count: int,
        vector: str,
        raw_data: Dict[str, Any]
    ) -> Optional[Event]:
        """
        Normalize a DShield record into an Event model

        Args:
            source_ip: Attacking IP address
            port: Target port
            count: Number of attacks (DShield aggregates)
            vector: Attack vector classification
            raw_data: Original DShield JSON for reference

        Returns:
            Event instance or None if geolocation fails
        """
        # Geolocate the source IP
        geo_result = geolocate(source_ip)
        if not geo_result:
            logger.debug(f"Skipping {source_ip} - geolocation failed")
            return None

        # Parse timestamp - DShield may provide lasttime or we use current time
        ts = raw_data.get("lasttime")
        if ts:
            try:
                # DShield timestamp format: "2024-02-16 12:00:00"
                event_time = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(
                    tzinfo=timezone.utc
                )
            except ValueError:
                event_time = datetime.now(timezone.utc)
        else:
            event_time = datetime.now(timezone.utc)

        # Calculate severity from count (normalized 0-1)
        # DShield counts can range from 1 to 10000+
        severity_raw = min(count / 1000.0, 1.0)  # Cap at 1000 for normalization

        # Create Event instance
        event = Event(
            ts=event_time,
            lat=geo_result.lat,
            lon=geo_result.lon,
            vector=vector,
            count=count,
            source="dshield",
            source_ip=source_ip,
            source_asn=geo_result.asn,
            source_country=geo_result.country_iso,
            target_port=port,
            severity_raw=severity_raw,
            tags={
                "city": geo_result.city_name,
                "accuracy_radius": geo_result.accuracy_radius,
            },
            raw_ref=f"dshield_{source_ip}_{port}",
        )

        return event

    async def ingest(self, hours_back: int = 1) -> int:
        """
        Main ingest entry point - pull DShield data and insert events

        Args:
            hours_back: How many hours of historical data to pull (mostly ignored for DShield as it's realtime)

        Returns:
            Number of events inserted
        """
        logger.info(f"Starting DShield ingest (hours_back={hours_back})")
        self.events_inserted = 0
        self.errors = 0

        # Strategy: Pull top attacking IPs, then get port-specific data for monitored ports
        tasks = []

        # Task 1: Get top IPs across all ports
        tasks.append(self._ingest_top_ips())

        # Task 2-N: Get port-specific data for each monitored port
        for port in PORT_VECTOR_MAP.keys():
            tasks.append(self._ingest_port(port))

        # Run all ingestion tasks concurrently
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Log any exceptions
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Ingest task {i} failed: {result}")
                self.errors += 1

        logger.info(
            f"DShield ingest complete: {self.events_inserted} events inserted, {self.errors} errors"
        )
        return self.events_inserted

    async def _ingest_top_ips(self) -> int:
        """Ingest top attacking IPs"""
        sources = await self._fetch_top_ips(limit=100)
        events_added = 0

        for source in sources:
            ip = source.get("ip")
            attacks = source.get("attacks", 0)
            port = source.get("targetport", 0)  # DShield may include port

            if not ip:
                continue

            # Map port to vector
            vector = self._map_port_to_vector(port) if port else "ssh"  # Default to ssh

            # Normalize and insert
            event = self._normalize_dshield_event(
                source_ip=ip,
                port=port if port else 22,
                count=attacks,
                vector=vector,
                raw_data=source
            )

            if event:
                self.session.add(event)
                events_added += 1

        if events_added > 0:
            self.session.commit()
            logger.info(f"Inserted {events_added} events from top IPs")
            self.events_inserted += events_added

        return events_added

    async def _ingest_port(self, port: int) -> int:
        """Ingest port-specific attack data"""
        sources = await self._fetch_port_details(port)
        events_added = 0

        vector = self._map_port_to_vector(port)
        if not vector:
            logger.debug(f"Skipping port {port} - no vector mapping")
            return 0

        for source in sources:
            ip = source.get("ip")
            reports = source.get("reports", 0)
            count = source.get("count", reports)  # Use count if available, else reports

            if not ip:
                continue

            # Normalize and insert
            event = self._normalize_dshield_event(
                source_ip=ip,
                port=port,
                count=count,
                vector=vector,
                raw_data=source
            )

            if event:
                self.session.add(event)
                events_added += 1

        if events_added > 0:
            self.session.commit()
            logger.info(f"Inserted {events_added} events for port {port} ({vector})")
            self.events_inserted += events_added

        return events_added


# Public API function matching runbook specification
async def ingest(session: Session, hours_back: int = 1) -> int:
    """
    DShield feed ingest entry point (runbook interface)

    Args:
        session: SQLAlchemy database session
        hours_back: Historical lookback window (hours)

    Returns:
        Number of events inserted
    """
    async with DShieldIngestor(session) as ingestor:
        return await ingestor.ingest(hours_back=hours_back)
