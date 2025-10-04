"""
Threat feed ingestion service for processing real-time cyber threat indicators
Supports multiple threat intelligence sources and data formats
"""

import asyncio
import aiohttp
import json
import re
import logging
from typing import List, Dict, Any, Optional, AsyncGenerator
from datetime import datetime, timedelta
from enum import Enum
import ipaddress

from .geolocation import GeolocationService, GeolocationResult
from ..db import SessionLocal
from ..models import Event
from ..utils.time import utcnow

logger = logging.getLogger(__name__)

class ThreatType(Enum):
    MALWARE = "malware"
    BOTNET = "botnet"
    PHISHING = "phishing"
    SCANNING = "scanning"
    BRUTE_FORCE = "brute_force"
    DDoS = "ddos"
    SUSPICIOUS = "suspicious"
    UNKNOWN = "unknown"

class ThreatIndicator:
    def __init__(self, indicator: str, threat_type: ThreatType, confidence: float = 0.5,
                 source: str = "unknown", description: str = None, timestamp: datetime = None):
        self.indicator = indicator
        self.threat_type = threat_type
        self.confidence = confidence
        self.source = source
        self.description = description
        self.timestamp = timestamp or utcnow()
        self.geolocation: Optional[GeolocationResult] = None

class ThreatFeedService:
    def __init__(self):
        self.session = None
        self.geo_service = None
        self.active_feeds = []
        
        # Public threat feeds (free tier)
        self.feed_configs = [
            {
                'name': 'abuse_ch_malware',
                'url': 'https://feodotracker.abuse.ch/downloads/ipblocklist.txt',
                'format': 'text_list',
                'threat_type': ThreatType.MALWARE,
                'enabled': True,
                'update_interval': 3600  # 1 hour
            },
            {
                'name': 'emerging_threats_compromised',
                'url': 'https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt',
                'format': 'text_list',
                'threat_type': ThreatType.SUSPICIOUS,
                'enabled': True,
                'update_interval': 7200  # 2 hours
            },
            {
                'name': 'blocklist_de_ssh',
                'url': 'https://www.blocklist.de/downloads/export-ips_ssh.txt',
                'format': 'text_list',
                'threat_type': ThreatType.BRUTE_FORCE,
                'enabled': True,
                'update_interval': 3600
            },
            {
                'name': 'greensnow_blocklist',
                'url': 'https://blocklist.greensnow.co/greensnow.txt',
                'format': 'text_list', 
                'threat_type': ThreatType.SCANNING,
                'enabled': True,
                'update_interval': 3600
            }
        ]

    async def __aenter__(self):
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))
        self.geo_service = await GeolocationService().__aenter__()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.geo_service:
            await self.geo_service.__aexit__(exc_type, exc_val, exc_tb)
        if self.session:
            await self.session.close()

    def _is_valid_ip(self, ip_str: str) -> bool:
        """Validate IP address"""
        try:
            ip = ipaddress.ip_address(ip_str.strip())
            return not (ip.is_private or ip.is_loopback or ip.is_reserved)
        except ValueError:
            return False

    def _extract_ips_from_text(self, text: str) -> List[str]:
        """Extract IP addresses from text content"""
        ip_pattern = r'\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b'
        ips = re.findall(ip_pattern, text)
        return [ip for ip in ips if self._is_valid_ip(ip)]

    async def _fetch_feed(self, feed_config: Dict[str, Any]) -> List[ThreatIndicator]:
        """Fetch and parse a single threat feed"""
        indicators = []
        
        try:
            logger.info(f"Fetching threat feed: {feed_config['name']}")
            
            async with self.session.get(feed_config['url']) as response:
                if response.status != 200:
                    logger.error(f"Failed to fetch {feed_config['name']}: HTTP {response.status}")
                    return indicators
                
                content = await response.text()
                
                if feed_config['format'] == 'text_list':
                    # Extract IPs from text-based feeds
                    ips = self._extract_ips_from_text(content)
                    for ip in ips[:1000]:  # Limit to 1000 IPs per feed to avoid overload
                        indicators.append(ThreatIndicator(
                            indicator=ip,
                            threat_type=feed_config['threat_type'],
                            confidence=0.7,  # Moderate confidence for public feeds
                            source=feed_config['name'],
                            description=f"Listed in {feed_config['name']} threat feed"
                        ))
                
                logger.info(f"Extracted {len(indicators)} indicators from {feed_config['name']}")
                
        except Exception as e:
            logger.error(f"Error fetching feed {feed_config['name']}: {e}")
        
        return indicators

    async def _geolocate_indicators(self, indicators: List[ThreatIndicator]) -> List[ThreatIndicator]:
        """Add geolocation data to threat indicators"""
        # Extract unique IP addresses
        ips = list(set(ind.indicator for ind in indicators if self._is_valid_ip(ind.indicator)))
        
        if not ips:
            return indicators
        
        logger.info(f"Geolocating {len(ips)} unique IP addresses...")
        
        # Batch geolocate IPs
        geo_results = await self.geo_service.geolocate_batch(ips, max_concurrent=3)
        
        # Add geolocation to indicators
        geolocated_count = 0
        for indicator in indicators:
            if indicator.indicator in geo_results:
                indicator.geolocation = geo_results[indicator.indicator]
                if indicator.geolocation:
                    geolocated_count += 1
        
        logger.info(f"Successfully geolocated {geolocated_count} threat indicators")
        return indicators

    async def _store_indicators(self, indicators: List[ThreatIndicator]):
        """Store threat indicators as events in the database"""
        session = SessionLocal()
        
        try:
            events_created = 0
            for indicator in indicators:
                if not indicator.geolocation:
                    continue  # Skip indicators without geolocation
                
                # Map threat type to vector
                vector_map = {
                    ThreatType.BRUTE_FORCE: "ssh",
                    ThreatType.SCANNING: "ssh", 
                    ThreatType.MALWARE: "http",
                    ThreatType.PHISHING: "http",
                    ThreatType.BOTNET: "dns_amp",
                    ThreatType.DDoS: "dns_amp",
                    ThreatType.SUSPICIOUS: "http"
                }
                
                vector = vector_map.get(indicator.threat_type, "http")
                
                # Create event
                event = Event(
                    ts=indicator.timestamp,
                    lat=indicator.geolocation.lat,
                    lon=indicator.geolocation.lon,
                    vector=vector,
                    count=int(indicator.confidence * 10),  # Scale confidence to count
                    source=f"threat_feed_{indicator.source}",
                    threat_metadata=json.dumps({
                        'indicator': indicator.indicator,
                        'threat_type': indicator.threat_type.value,
                        'confidence': indicator.confidence,
                        'description': indicator.description,
                        'country': indicator.geolocation.country,
                        'city': indicator.geolocation.city,
                        'geo_provider': indicator.geolocation.provider
                    })
                )
                
                session.add(event)
                events_created += 1
            
            session.commit()
            logger.info(f"Stored {events_created} threat events in database")
            
        except Exception as e:
            session.rollback()
            logger.error(f"Error storing threat indicators: {e}")
        finally:
            session.close()

    async def fetch_all_feeds(self) -> int:
        """Fetch all enabled threat feeds and store as events"""
        total_indicators = 0
        
        enabled_feeds = [feed for feed in self.feed_configs if feed.get('enabled', True)]
        
        for feed_config in enabled_feeds:
            try:
                # Fetch indicators from feed
                indicators = await self._fetch_feed(feed_config)
                if not indicators:
                    continue
                
                # Add geolocation data
                indicators = await self._geolocate_indicators(indicators)
                
                # Store in database
                await self._store_indicators(indicators)
                
                total_indicators += len(indicators)
                
                # Small delay between feeds to be respectful
                await asyncio.sleep(2)
                
            except Exception as e:
                logger.error(f"Error processing feed {feed_config['name']}: {e}")
        
        logger.info(f"Processed {total_indicators} total threat indicators")
        return total_indicators

    async def start_continuous_ingestion(self, interval_minutes: int = 60):
        """Start continuous threat feed ingestion"""
        logger.info(f"Starting continuous threat feed ingestion (interval: {interval_minutes}m)")
        
        while True:
            try:
                start_time = datetime.utcnow()
                count = await self.fetch_all_feeds()
                duration = (datetime.utcnow() - start_time).total_seconds()
                
                logger.info(f"Feed ingestion cycle completed: {count} indicators in {duration:.1f}s")
                
                # Wait for next cycle
                await asyncio.sleep(interval_minutes * 60)
                
            except Exception as e:
                logger.error(f"Error in continuous ingestion: {e}")
                await asyncio.sleep(300)  # Wait 5 minutes on error

# Convenience functions
async def ingest_threat_feeds() -> int:
    """One-time threat feed ingestion"""
    async with ThreatFeedService() as feed_service:
        return await feed_service.fetch_all_feeds()

async def start_threat_feed_monitor(interval_minutes: int = 60):
    """Start continuous threat feed monitoring"""
    async with ThreatFeedService() as feed_service:
        await feed_service.start_continuous_ingestion(interval_minutes)