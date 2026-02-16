"""
MaxMind GeoLite2 geolocation service for CTI feed enrichment
Provides local, offline IP geolocation with zero API calls
"""

import logging
from typing import Optional, List, Dict
from functools import lru_cache
from dataclasses import dataclass
import ipaddress

try:
    import geoip2.database
    import geoip2.errors
    GEOIP2_AVAILABLE = True
except ImportError:
    GEOIP2_AVAILABLE = False
    logging.warning("geoip2 library not available - geolocation will be disabled")

from ..core.config import get_settings

logger = logging.getLogger(__name__)

@dataclass
class GeoResult:
    """Geolocation result from MaxMind"""
    lat: float
    lon: float
    country_iso: str
    asn: Optional[int] = None
    city_name: Optional[str] = None
    region: Optional[str] = None
    postal_code: Optional[str] = None
    accuracy_radius: Optional[int] = None

    def __post_init__(self):
        """Validate coordinates"""
        if not (-90 <= self.lat <= 90):
            raise ValueError(f"Invalid latitude: {self.lat}")
        if not (-180 <= self.lon <= 180):
            raise ValueError(f"Invalid longitude: {self.lon}")


class MaxMindGeolocation:
    """
    Local MaxMind GeoLite2 database geolocation service
    Recommended for production CTI feed processing (no rate limits, offline)
    """

    def __init__(self, db_path: Optional[str] = None):
        """
        Initialize MaxMind reader

        Args:
            db_path: Path to GeoLite2-City.mmdb file.
                    If None, uses CYBER_WEATHER_MAXMIND_DB_PATH from config.
        """
        if not GEOIP2_AVAILABLE:
            logger.error("geoip2 library not installed. Run: pip install geoip2")
            self.reader = None
            return

        self.db_path = db_path or get_settings().maxmind_db_path

        try:
            self.reader = geoip2.database.Reader(self.db_path)
            logger.info(f"MaxMind GeoLite2 database loaded from {self.db_path}")
        except FileNotFoundError:
            logger.error(
                f"MaxMind database not found at {self.db_path}. "
                f"Download from https://dev.maxmind.com/geoip/geolite2-free-geolocation-data"
            )
            self.reader = None
        except Exception as e:
            logger.error(f"Failed to load MaxMind database: {e}")
            self.reader = None

    def _is_valid_public_ip(self, ip: str) -> bool:
        """Check if IP is valid and publicly routable"""
        try:
            ip_obj = ipaddress.ip_address(ip)
            # Exclude private, loopback, multicast, reserved
            return not (
                ip_obj.is_private or
                ip_obj.is_loopback or
                ip_obj.is_multicast or
                ip_obj.is_reserved or
                ip_obj.is_unspecified or
                ip_obj.is_link_local
            )
        except ValueError:
            return False

    @lru_cache(maxsize=50000)
    def geolocate(self, ip: str) -> Optional[GeoResult]:
        """
        Geolocate a single IP address using MaxMind GeoLite2
        Results are cached in LRU cache (50k entries)

        Args:
            ip: IPv4 or IPv6 address string

        Returns:
            GeoResult with lat, lon, country, ASN, city, or None if lookup fails
        """
        if not self.reader:
            logger.warning("MaxMind reader not initialized, cannot geolocate")
            return None

        if not self._is_valid_public_ip(ip):
            logger.debug(f"Skipping private/invalid IP: {ip}")
            return None

        try:
            response = self.reader.city(ip)

            # Extract location data
            if not response.location.latitude or not response.location.longitude:
                logger.debug(f"No location data for IP: {ip}")
                return None

            result = GeoResult(
                lat=response.location.latitude,
                lon=response.location.longitude,
                country_iso=response.country.iso_code or "XX",
                city_name=response.city.name,
                region=response.subdivisions.most_specific.name if response.subdivisions else None,
                postal_code=response.postal.code,
                accuracy_radius=response.location.accuracy_radius
            )

            logger.debug(
                f"Geolocated {ip} -> ({result.lat:.2f}, {result.lon:.2f}) "
                f"{result.country_iso} {result.city_name or ''}"
            )
            return result

        except geoip2.errors.AddressNotFoundError:
            logger.debug(f"IP not found in GeoLite2 database: {ip}")
            return None
        except Exception as e:
            logger.error(f"Geolocation error for {ip}: {e}")
            return None

    def bulk_geolocate(self, ips: List[str]) -> Dict[str, Optional[GeoResult]]:
        """
        Geolocate multiple IPs in batch
        More efficient than individual calls due to LRU caching

        Args:
            ips: List of IP address strings

        Returns:
            Dict mapping IP -> GeoResult (or None if lookup failed)
        """
        results = {}
        for ip in ips:
            results[ip] = self.geolocate(ip)

        successful = sum(1 for r in results.values() if r is not None)
        logger.info(
            f"Bulk geolocation: {successful}/{len(ips)} IPs successfully located"
        )
        return results

    def clear_cache(self):
        """Clear the LRU cache (useful for testing or memory management)"""
        self.geolocate.cache_clear()
        logger.info("Geolocation cache cleared")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.reader:
            self.reader.close()


# Singleton instance for module-level convenience functions
_geolocator: Optional[MaxMindGeolocation] = None

def get_geolocator() -> MaxMindGeolocation:
    """Get or create singleton geolocator instance"""
    global _geolocator
    if _geolocator is None:
        _geolocator = MaxMindGeolocation()
    return _geolocator

def geolocate(ip: str) -> Optional[GeoResult]:
    """Convenience function to geolocate a single IP"""
    return get_geolocator().geolocate(ip)

def bulk_geolocate(ips: List[str]) -> Dict[str, Optional[GeoResult]]:
    """Convenience function for bulk geolocation"""
    return get_geolocator().bulk_geolocate(ips)
