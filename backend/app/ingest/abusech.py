"""
Abuse.ch Feeds Integration (ThreatFox, Feodo Tracker, URLhaus)
Malware + botnet C2 + ransomware intelligence

API Documentation: https://threatfox-api.abuse.ch/
Rate Limit: Reasonable use (bulk download daily dumps recommended)
Refresh Cadence: Every 60 minutes (delta) or daily (full dump)
Expected Volume: 5K-20K IOCs across all feeds
"""

import logging
import aiohttp
import asyncio
import csv
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from io import StringIO

from ..models import Event
from .geolocation import geolocate

logger = logging.getLogger(__name__)

# Abuse.ch API Configuration
THREATFOX_API_URL = "https://threatfox-api.abuse.ch/api/v1/"
FEODO_TRACKER_URL = "https://feodotracker.abuse.ch/downloads/ipblocklist.csv"
URLHAUS_URL = "https://urlhaus.abuse.ch/downloads/csv_recent/"

# Malware family to vector mapping
MALWARE_VECTOR_MAP = {
    "ransomware": "ransomware",
    "emotet": "botnet_c2",
    "trickbot": "botnet_c2",
    "qakbot": "botnet_c2",
    "cobalt_strike": "botnet_c2",
    "icedid": "botnet_c2",
    "dridex": "botnet_c2",
    "formbook": "malware",
    "agent_tesla": "malware",
    "remcos": "malware",
    "njrat": "malware",
    "asyncrat": "malware",
    "redline": "malware",
}


class AbusechIngestor:
    """Abuse.ch threat feed ingestor"""

    def __init__(self, session: Session):
        self.session = session
        self.http_session: Optional[aiohttp.ClientSession] = None
        self.events_inserted = 0
        self.errors = 0

    async def __aenter__(self):
        timeout = aiohttp.ClientTimeout(total=60)  # Longer timeout for CSV downloads
        self.http_session = aiohttp.ClientSession(timeout=timeout)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.http_session:
            await self.http_session.close()

    def _map_malware_to_vector(self, malware_family: str) -> str:
        """Map malware family to attack vector"""
        malware_lower = malware_family.lower()

        for key, vector in MALWARE_VECTOR_MAP.items():
            if key in malware_lower:
                return vector

        # Check for common patterns
        if any(x in malware_lower for x in ["ransom", "crypt", "locker"]):
            return "ransomware"
        elif any(x in malware_lower for x in ["bot", "c2", "c&c", "command"]):
            return "botnet_c2"
        elif any(x in malware_lower for x in ["trojan", "stealer", "rat", "backdoor"]):
            return "malware"
        else:
            return "malware"  # Default fallback

    async def _fetch_threatfox_iocs(self, days: int = 1) -> List[Dict[str, Any]]:
        """
        Fetch recent IOCs from ThreatFox API

        Args:
            days: Number of days of recent IOCs to fetch

        Returns:
            List of IOC records
        """
        url = THREATFOX_API_URL
        payload = {
            "query": "get_iocs",
            "days": days
        }

        try:
            async with self.http_session.post(url, json=payload) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get("query_status") == "ok":
                        return data.get("data", [])
                    else:
                        logger.warning(f"ThreatFox query failed: {data.get('query_status')}")
                        return []
                else:
                    logger.error(f"ThreatFox API returned {response.status}")
                    return []

        except Exception as e:
            logger.error(f"Error fetching ThreatFox IOCs: {e}")
            return []

    async def _fetch_feodo_tracker(self) -> List[Dict[str, Any]]:
        """
        Fetch Feodo Tracker botnet C2 IP blocklist

        Returns:
            List of C2 server records
        """
        url = FEODO_TRACKER_URL

        try:
            async with self.http_session.get(url) as response:
                if response.status == 200:
                    text = await response.text()

                    # Parse CSV (skip comments starting with #)
                    records = []
                    reader = csv.DictReader(
                        StringIO(text),
                        fieldnames=["first_seen", "dst_ip", "dst_port", "last_online", "malware"]
                    )

                    for row in reader:
                        # Skip comment lines
                        if row["first_seen"].startswith("#"):
                            continue
                        records.append(row)

                    logger.info(f"Fetched {len(records)} Feodo C2 IPs")
                    return records
                else:
                    logger.error(f"Feodo Tracker returned {response.status}")
                    return []

        except Exception as e:
            logger.error(f"Error fetching Feodo Tracker: {e}")
            return []

    async def _fetch_urlhaus(self) -> List[Dict[str, Any]]:
        """
        Fetch URLhaus recent malicious URLs

        Returns:
            List of malicious URL records
        """
        url = URLHAUS_URL

        try:
            async with self.http_session.get(url) as response:
                if response.status == 200:
                    text = await response.text()

                    # Parse CSV
                    records = []
                    lines = text.split("\n")

                    # Skip comment lines
                    csv_lines = [line for line in lines if not line.startswith("#")]
                    reader = csv.DictReader(StringIO("\n".join(csv_lines)))

                    for row in reader:
                        records.append(row)

                    logger.info(f"Fetched {len(records)} URLhaus malicious URLs")
                    return records
                else:
                    logger.error(f"URLhaus returned {response.status}")
                    return []

        except Exception as e:
            logger.error(f"Error fetching URLhaus: {e}")
            return []

    def _normalize_threatfox_event(self, ioc: Dict[str, Any]) -> Optional[Event]:
        """Normalize ThreatFox IOC to Event"""
        ioc_type = ioc.get("ioc_type")

        # We're interested in IP-based IOCs
        if ioc_type not in ["ip:port", "ip_address"]:
            return None

        ioc_value = ioc.get("ioc")
        if not ioc_value:
            return None

        # Extract IP (may be in "IP:PORT" format)
        ip = ioc_value.split(":")[0] if ":" in ioc_value else ioc_value

        # Geolocate
        geo_result = geolocate(ip)
        if not geo_result:
            return None

        # Extract malware info
        malware_family = ioc.get("malware", "unknown")
        malware_alias = ioc.get("malware_alias", "")
        threat_type = ioc.get("threat_type", "")

        # Map to vector
        vector = self._map_malware_to_vector(malware_family)

        # Parse timestamp
        first_seen = ioc.get("first_seen_utc", "")
        if first_seen:
            try:
                event_time = datetime.strptime(first_seen, "%Y-%m-%d %H:%M:%S").replace(
                    tzinfo=timezone.utc
                )
            except ValueError:
                event_time = datetime.now(timezone.utc)
        else:
            event_time = datetime.now(timezone.utc)

        # Severity based on confidence level
        confidence = ioc.get("confidence_level", 50)
        severity_raw = confidence / 100.0

        # Create Event
        event = Event(
            ts=event_time,
            lat=geo_result.lat,
            lon=geo_result.lon,
            vector=vector,
            count=1,
            source="abusech_threatfox",
            source_ip=ip,
            source_asn=geo_result.asn,
            source_country=geo_result.country_iso,
            target_port=None,
            severity_raw=severity_raw,
            tags={
                "malware_family": malware_family,
                "malware_alias": malware_alias,
                "threat_type": threat_type,
                "ioc_type": ioc_type,
                "confidence_level": confidence,
            },
            raw_ref=f"threatfox_{ioc.get('id')}",
        )

        return event

    def _normalize_feodo_event(self, record: Dict[str, Any]) -> Optional[Event]:
        """Normalize Feodo Tracker C2 to Event"""
        ip = record.get("dst_ip")
        if not ip:
            return None

        # Geolocate
        geo_result = geolocate(ip)
        if not geo_result:
            return None

        # Extract malware and port
        malware = record.get("malware", "unknown")
        port = record.get("dst_port")

        # Parse timestamp
        last_online = record.get("last_online", "")
        if last_online:
            try:
                event_time = datetime.strptime(last_online, "%Y-%m-%d").replace(
                    tzinfo=timezone.utc
                )
            except ValueError:
                event_time = datetime.now(timezone.utc)
        else:
            event_time = datetime.now(timezone.utc)

        # Create Event
        event = Event(
            ts=event_time,
            lat=geo_result.lat,
            lon=geo_result.lon,
            vector="botnet_c2",
            count=1,
            source="abusech_feodo",
            source_ip=ip,
            source_asn=geo_result.asn,
            source_country=geo_result.country_iso,
            target_port=int(port) if port and port.isdigit() else None,
            severity_raw=0.9,  # High severity for confirmed C2
            tags={
                "malware_family": malware,
                "c2_server": True,
                "feed": "feodo_tracker",
            },
            raw_ref=f"feodo_{ip}_{port}",
        )

        return event

    async def ingest(self, hours_back: int = 1) -> int:
        """
        Main Abuse.ch ingest entry point

        Args:
            hours_back: Not used (Abuse.ch provides recent data)

        Returns:
            Number of events inserted
        """
        logger.info("Starting Abuse.ch ingest")
        self.events_inserted = 0
        self.errors = 0

        # Fetch from all feeds concurrently
        tasks = [
            self._ingest_threatfox(),
            self._ingest_feodo(),
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Abuse.ch ingest task {i} failed: {result}")
                self.errors += 1

        logger.info(
            f"Abuse.ch ingest complete: {self.events_inserted} events inserted, {self.errors} errors"
        )
        return self.events_inserted

    async def _ingest_threatfox(self):
        """Ingest ThreatFox IOCs"""
        iocs = await self._fetch_threatfox_iocs(days=1)
        events_added = 0

        for ioc in iocs:
            event = self._normalize_threatfox_event(ioc)
            if event:
                self.session.add(event)
                events_added += 1

        if events_added > 0:
            self.session.commit()
            self.events_inserted += events_added
            logger.info(f"Inserted {events_added} ThreatFox events")

    async def _ingest_feodo(self):
        """Ingest Feodo Tracker C2s"""
        records = await self._fetch_feodo_tracker()
        events_added = 0

        for record in records:
            event = self._normalize_feodo_event(record)
            if event:
                self.session.add(event)
                events_added += 1

        if events_added > 0:
            self.session.commit()
            self.events_inserted += events_added
            logger.info(f"Inserted {events_added} Feodo Tracker events")


# Public API function matching runbook specification
async def ingest(session: Session, hours_back: int = 1) -> int:
    """
    Abuse.ch feed ingest entry point (runbook interface)

    Args:
        session: SQLAlchemy database session
        hours_back: Historical lookback window (not used for Abuse.ch)

    Returns:
        Number of events inserted
    """
    async with AbusechIngestor(session) as ingestor:
        return await ingestor.ingest(hours_back=hours_back)
