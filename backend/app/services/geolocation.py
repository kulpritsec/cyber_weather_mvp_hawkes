"""
Geolocation service for mapping threat indicators to geographical coordinates
Supports IP address geolocation using multiple providers with fallback
"""

import asyncio
import aiohttp
import ipaddress
import json
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
import time

logger = logging.getLogger(__name__)

class GeolocationResult:
    def __init__(self, lat: float, lon: float, country: str = None, city: str = None, 
                 provider: str = None, confidence: float = 1.0):
        self.lat = lat
        self.lon = lon
        self.country = country
        self.city = city
        self.provider = provider
        self.confidence = confidence
        self.timestamp = datetime.utcnow()

class GeolocationService:
    def __init__(self):
        self.session = None
        self.cache = {}  # Simple in-memory cache
        self.cache_ttl = 3600  # 1 hour cache TTL
        self.rate_limits = {}  # Rate limiting per provider
        
        # Free tier providers (no API key required)
        self.providers = [
            {
                'name': 'ipapi',
                'url': 'http://ip-api.com/json/{ip}',
                'rate_limit': 45,  # 45 requests per minute
                'fields': {'lat': 'lat', 'lon': 'lon', 'country': 'country', 'city': 'city'}
            },
            {
                'name': 'ipinfo',
                'url': 'https://ipinfo.io/{ip}/json',
                'rate_limit': 50,  # 50 requests per month (very limited)
                'fields': {'lat': 'loc', 'lon': 'loc', 'country': 'country', 'city': 'city'}
            },
            {
                'name': 'freegeoip',
                'url': 'https://freegeoip.app/json/{ip}',
                'rate_limit': 15000,  # 15k requests per month
                'fields': {'lat': 'latitude', 'lon': 'longitude', 'country': 'country_name', 'city': 'city'}
            }
        ]

    async def __aenter__(self):
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()

    def _is_rate_limited(self, provider_name: str) -> bool:
        """Check if provider is rate limited"""
        if provider_name not in self.rate_limits:
            return False
        
        last_request, count = self.rate_limits[provider_name]
        if time.time() - last_request > 60:  # Reset counter every minute
            self.rate_limits[provider_name] = (time.time(), 1)
            return False
        
        provider = next(p for p in self.providers if p['name'] == provider_name)
        return count >= provider['rate_limit']

    def _update_rate_limit(self, provider_name: str):
        """Update rate limit tracking"""
        if provider_name in self.rate_limits:
            last_request, count = self.rate_limits[provider_name]
            if time.time() - last_request > 60:
                self.rate_limits[provider_name] = (time.time(), 1)
            else:
                self.rate_limits[provider_name] = (last_request, count + 1)
        else:
            self.rate_limits[provider_name] = (time.time(), 1)

    def _is_cached(self, ip: str) -> Optional[GeolocationResult]:
        """Check cache for IP geolocation"""
        if ip in self.cache:
            result, timestamp = self.cache[ip]
            if time.time() - timestamp < self.cache_ttl:
                return result
            else:
                del self.cache[ip]
        return None

    def _cache_result(self, ip: str, result: GeolocationResult):
        """Cache geolocation result"""
        self.cache[ip] = (result, time.time())

    def _is_valid_ip(self, ip: str) -> bool:
        """Validate IP address and check if it's public"""
        try:
            ip_obj = ipaddress.ip_address(ip)
            # Skip private, loopback, and reserved addresses
            return not (ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_reserved)
        except ValueError:
            return False

    async def _query_provider(self, provider: Dict[str, Any], ip: str) -> Optional[GeolocationResult]:
        """Query a specific geolocation provider"""
        if self._is_rate_limited(provider['name']):
            logger.warning(f"Rate limited for provider {provider['name']}")
            return None

        try:
            self._update_rate_limit(provider['name'])
            url = provider['url'].format(ip=ip)
            
            async with self.session.get(url) as response:
                if response.status != 200:
                    logger.warning(f"Provider {provider['name']} returned {response.status}")
                    return None
                
                data = await response.json()
                
                # Extract coordinates based on provider format
                lat, lon = None, None
                if provider['name'] == 'ipinfo' and 'loc' in data:
                    # ipinfo returns "lat,lon" in loc field
                    coords = data['loc'].split(',')
                    if len(coords) == 2:
                        lat, lon = float(coords[0]), float(coords[1])
                else:
                    # Standard lat/lon fields
                    lat = data.get(provider['fields']['lat'])
                    lon = data.get(provider['fields']['lon'])
                
                if lat is None or lon is None:
                    return None
                
                country = data.get(provider['fields']['country'], 'Unknown')
                city = data.get(provider['fields']['city'], 'Unknown')
                
                return GeolocationResult(
                    lat=float(lat), 
                    lon=float(lon), 
                    country=country, 
                    city=city,
                    provider=provider['name'],
                    confidence=0.8  # Moderate confidence for free providers
                )
                
        except Exception as e:
            logger.error(f"Error querying {provider['name']}: {e}")
            return None

    async def geolocate_ip(self, ip: str) -> Optional[GeolocationResult]:
        """Geolocate a single IP address using multiple providers with fallback"""
        if not self._is_valid_ip(ip):
            logger.debug(f"Invalid or private IP address: {ip}")
            return None

        # Check cache first
        cached = self._is_cached(ip)
        if cached:
            return cached

        # Try each provider until one succeeds
        for provider in self.providers:
            result = await self._query_provider(provider, ip)
            if result:
                self._cache_result(ip, result)
                logger.info(f"Geolocated {ip} to {result.lat}, {result.lon} via {provider['name']}")
                return result

        logger.warning(f"Failed to geolocate IP: {ip}")
        return None

    async def geolocate_batch(self, ips: List[str], max_concurrent: int = 5) -> Dict[str, Optional[GeolocationResult]]:
        """Geolocate multiple IP addresses concurrently"""
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def geolocate_with_semaphore(ip):
            async with semaphore:
                return ip, await self.geolocate_ip(ip)
        
        tasks = [geolocate_with_semaphore(ip) for ip in ips]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        return {ip: result for ip, result in results if not isinstance(result, Exception)}

# Convenience function for single IP geolocation
async def geolocate_ip(ip: str) -> Optional[GeolocationResult]:
    """Convenience function to geolocate a single IP"""
    async with GeolocationService() as geo_service:
        return await geo_service.geolocate_ip(ip)

# Function for batch geolocation
async def geolocate_ips(ips: List[str]) -> Dict[str, Optional[GeolocationResult]]:
    """Convenience function to geolocate multiple IPs"""
    async with GeolocationService() as geo_service:
        return await geo_service.geolocate_batch(ips)