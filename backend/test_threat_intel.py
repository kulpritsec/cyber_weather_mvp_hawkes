#!/usr/bin/env python3
"""
Test script for threat intelligence feeds
Tests geolocation and threat feed ingestion
"""

import asyncio
import sys
from pathlib import Path

# Add the app directory to Python path
sys.path.append(str(Path(__file__).parent / "app"))

async def test_geolocation():
    """Test IP geolocation service"""
    print("🌐 Testing geolocation service...")
    
    try:
        from app.services.geolocation import geolocate_ip
        
        test_ips = [
            "8.8.8.8",        # Google DNS
            "1.1.1.1",        # Cloudflare DNS
            "208.67.222.222", # OpenDNS
            "77.88.8.8"       # Yandex DNS
        ]
        
        for ip in test_ips:
            result = await geolocate_ip(ip)
            if result:
                print(f"   {ip} -> {result.lat}, {result.lon} ({result.country}) via {result.provider}")
            else:
                print(f"   {ip} -> Failed to geolocate")
        
        print("✅ Geolocation test complete")
        
    except Exception as e:
        print(f"❌ Geolocation test failed: {e}")

async def test_threat_feeds():
    """Test threat feed ingestion"""
    print("🛡️ Testing threat feed ingestion...")
    
    try:
        from app.services.threat_feeds import ingest_threat_feeds
        
        count = await ingest_threat_feeds()
        print(f"✅ Processed {count} threat indicators")
        
    except Exception as e:
        print(f"❌ Threat feed test failed: {e}")

async def main():
    print("🧪 Cyber Weather - Threat Intelligence Testing")
    print("=" * 50)
    
    await test_geolocation()
    print()
    await test_threat_feeds()
    
    print("\n🎯 Testing complete!")

if __name__ == "__main__":
    asyncio.run(main())