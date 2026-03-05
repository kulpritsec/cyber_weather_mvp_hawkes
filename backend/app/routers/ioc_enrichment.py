"""
IOC Enrichment Router — /v1/ioc/*
Proxies enrichment requests to free threat intel APIs.
Required env vars: OTX_API_KEY, ABUSEIPDB_API_KEY, VT_API_KEY
No auth needed for URLhaus and ThreatFox.
"""

import asyncio
import os
import re
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/v1/ioc", tags=["ioc-enrichment"])

OTX_KEY = os.getenv("OTX_API_KEY", "")
ABUSEIPDB_KEY = os.getenv("ABUSEIPDB_API_KEY", "")
VT_KEY = os.getenv("VT_API_KEY", "")
_rate = {"vt_last": 0.0, "abuseipdb_count_day": 0, "abuseipdb_day": ""}
TIMEOUT = httpx.Timeout(10.0, connect=5.0)
ABUSECH_KEY = os.getenv("CYBER_WEATHER_ABUSECH_AUTH_KEY", "")


def _detect_ioc_type(indicator: str) -> str:
    indicator = indicator.strip()
    if re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$", indicator): return "ipv4"
    if ":" in indicator and re.match(r"^[0-9a-fA-F:]+$", indicator): return "ipv6"
    if re.match(r"^[a-fA-F0-9]{32}$", indicator): return "md5"
    if re.match(r"^[a-fA-F0-9]{40}$", indicator): return "sha1"
    if re.match(r"^[a-fA-F0-9]{64}$", indicator): return "sha256"
    if indicator.startswith("http://") or indicator.startswith("https://"): return "url"
    if re.match(r"^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$", indicator): return "domain"
    if re.match(r"^CVE-\d{4}-\d+$", indicator, re.IGNORECASE): return "cve"
    return "unknown"


async def _query_otx(indicator: str, ioc_type: str) -> dict:
    if not OTX_KEY:
        return {"source": "otx", "error": "OTX_API_KEY not configured", "data": None}
    type_map = {
        "ipv4": f"indicators/IPv4/{indicator}/general", "ipv6": f"indicators/IPv6/{indicator}/general",
        "domain": f"indicators/domain/{indicator}/general", "md5": f"indicators/file/{indicator}/general",
        "sha1": f"indicators/file/{indicator}/general", "sha256": f"indicators/file/{indicator}/general",
        "url": f"indicators/url/{indicator}/general", "cve": f"indicators/cve/{indicator}/general",
    }
    endpoint = type_map.get(ioc_type)
    if not endpoint:
        return {"source": "otx", "error": f"Unsupported: {ioc_type}", "data": None}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            headers = {"X-OTX-API-KEY": OTX_KEY}
            r = await client.get(f"https://otx.alienvault.com/api/v1/{endpoint}", headers=headers)
            general = r.json() if r.status_code == 200 else {}
            r2 = await client.get(f"https://otx.alienvault.com/api/v1/{endpoint.replace('/general', '/pulse_info')}", headers=headers)
            pulses = r2.json() if r2.status_code == 200 else {}
            geo, pdns = {}, {}
            if ioc_type in ("ipv4", "ipv6"):
                r3 = await client.get(f"https://otx.alienvault.com/api/v1/{endpoint.replace('/general', '/geo')}", headers=headers)
                geo = r3.json() if r3.status_code == 200 else {}
            if ioc_type in ("ipv4", "domain"):
                r4 = await client.get(f"https://otx.alienvault.com/api/v1/{endpoint.replace('/general', '/passive_dns')}", headers=headers)
                pdns = r4.json() if r4.status_code == 200 else {}
        return {"source": "otx", "error": None, "data": {
            "reputation": general.get("reputation", 0), "pulse_count": pulses.get("count", 0),
            "pulses": [{"name": p.get("name",""), "created": p.get("created",""), "tags": p.get("tags",[])[:5],
                        "adversary": p.get("adversary",""), "tlp": p.get("TLP",""),
                        "references": p.get("references",[])[:3]} for p in pulses.get("results",[])[:10]],
            "country": geo.get("country_name", general.get("country_name","")),
            "city": geo.get("city", general.get("city","")),
            "asn": general.get("asn",""),
            "latitude": geo.get("latitude", general.get("latitude")),
            "longitude": geo.get("longitude", general.get("longitude")),
            "passive_dns": [{"hostname": r.get("hostname",""), "address": r.get("address",""),
                            "first": r.get("first",""), "last": r.get("last",""),
                            "record_type": r.get("record_type","")} for r in pdns.get("passive_dns",[])[:15]],
            "validation": general.get("validation",[]), "type": general.get("type",""),
        }}
    except Exception as e:
        return {"source": "otx", "error": str(e), "data": None}


async def _query_abuseipdb(indicator: str, ioc_type: str) -> dict:
    if ioc_type not in ("ipv4", "ipv6"):
        return {"source": "abuseipdb", "error": "Only supports IP addresses", "data": None}
    if not ABUSEIPDB_KEY:
        return {"source": "abuseipdb", "error": "ABUSEIPDB_API_KEY not configured", "data": None}
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if _rate["abuseipdb_day"] != today:
        _rate["abuseipdb_day"] = today; _rate["abuseipdb_count_day"] = 0
    if _rate["abuseipdb_count_day"] >= 950:
        return {"source": "abuseipdb", "error": "Daily rate limit approaching", "data": None}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get("https://api.abuseipdb.com/api/v2/check",
                params={"ipAddress": indicator, "maxAgeInDays": 90, "verbose": ""},
                headers={"Key": ABUSEIPDB_KEY, "Accept": "application/json"})
            _rate["abuseipdb_count_day"] += 1
            if r.status_code != 200:
                return {"source": "abuseipdb", "error": f"HTTP {r.status_code}", "data": None}
            d = r.json().get("data", {})
            return {"source": "abuseipdb", "error": None, "data": {
                "abuse_confidence_score": d.get("abuseConfidenceScore",0),
                "total_reports": d.get("totalReports",0), "num_distinct_users": d.get("numDistinctUsers",0),
                "last_reported_at": d.get("lastReportedAt"), "is_whitelisted": d.get("isWhitelisted",False),
                "isp": d.get("isp",""), "domain": d.get("domain",""), "usage_type": d.get("usageType",""),
                "country_code": d.get("countryCode",""), "country_name": d.get("countryName",""),
                "is_tor": d.get("isTor",False),
            }}
    except Exception as e:
        return {"source": "abuseipdb", "error": str(e), "data": None}


async def _query_virustotal(indicator: str, ioc_type: str) -> dict:
    if not VT_KEY:
        return {"source": "virustotal", "error": "VT_API_KEY not configured", "data": None}
    now = time.time()
    if now - _rate["vt_last"] < 16:
        return {"source": "virustotal", "error": "Rate limited (4 req/min free tier)", "data": None}
    _rate["vt_last"] = now
    type_map = {"ipv4": f"ip_addresses/{indicator}", "domain": f"domains/{indicator}",
                "md5": f"files/{indicator}", "sha1": f"files/{indicator}", "sha256": f"files/{indicator}", "url": None}
    endpoint = type_map.get(ioc_type)
    if endpoint is None and ioc_type == "url":
        import base64; url_id = base64.urlsafe_b64encode(indicator.encode()).decode().rstrip("=")
        endpoint = f"urls/{url_id}"
    elif endpoint is None:
        return {"source": "virustotal", "error": f"Unsupported: {ioc_type}", "data": None}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(f"https://www.virustotal.com/api/v3/{endpoint}", headers={"x-apikey": VT_KEY})
            if r.status_code != 200:
                return {"source": "virustotal", "error": f"HTTP {r.status_code}", "data": None}
            attrs = r.json().get("data",{}).get("attributes",{})
            stats = attrs.get("last_analysis_stats",{})
            result = {"malicious": stats.get("malicious",0), "suspicious": stats.get("suspicious",0),
                      "harmless": stats.get("harmless",0), "undetected": stats.get("undetected",0),
                      "total_engines": sum(stats.values()) if stats else 0,
                      "reputation": attrs.get("reputation",0), "last_analysis_date": attrs.get("last_analysis_date")}
            if ioc_type == "ipv4":
                result.update({"asn": attrs.get("asn"), "as_owner": attrs.get("as_owner",""),
                              "country": attrs.get("country",""), "network": attrs.get("network","")})
            elif ioc_type == "domain":
                result.update({"registrar": attrs.get("registrar",""), "creation_date": attrs.get("creation_date"),
                              "categories": attrs.get("categories",{})})
            elif ioc_type in ("md5","sha1","sha256"):
                result.update({"type_description": attrs.get("type_description",""), "size": attrs.get("size"),
                              "names": attrs.get("names",[])[:5], "tags": attrs.get("tags",[])[:10],
                              "popular_threat_name": attrs.get("popular_threat_classification",{}).get("suggested_threat_label","")})
            return {"source": "virustotal", "error": None, "data": result}
    except Exception as e:
        return {"source": "virustotal", "error": str(e), "data": None}


async def _query_urlhaus(indicator: str, ioc_type: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            if ioc_type in ("ipv4","domain"):
                r = await client.post("https://urlhaus-api.abuse.ch/v1/host/", data={"host": indicator}, headers={"Auth-Key": ABUSECH_KEY})
            elif ioc_type == "url":
                r = await client.post("https://urlhaus-api.abuse.ch/v1/url/", data={"url": indicator}, headers={"Auth-Key": ABUSECH_KEY})
            elif ioc_type in ("md5","sha256"):
                hash_type = "md5_hash" if ioc_type == "md5" else "sha256_hash"
                r = await client.post("https://urlhaus-api.abuse.ch/v1/payload/", data={hash_type: indicator}, headers={"Auth-Key": ABUSECH_KEY})
            else:
                return {"source": "urlhaus", "error": f"Unsupported: {ioc_type}", "data": None}
            if r.status_code != 200:
                return {"source": "urlhaus", "error": f"HTTP {r.status_code}", "data": None}
            d = r.json()
            if d.get("query_status") == "no_results":
                return {"source": "urlhaus", "error": None, "data": {"found": False}}
            result = {"found": True}
            if "urls" in d:
                result["url_count"] = d.get("url_count",0)
                result["urls"] = [{"url": u.get("url",""), "status": u.get("url_status",""),
                    "threat": u.get("threat",""), "tags": u.get("tags"), "date_added": u.get("date_added","")}
                    for u in d.get("urls",[])[:10]]
            if "payloads" in d:
                result["payloads"] = [{"filename": p.get("filename",""), "file_type": p.get("file_type",""),
                    "signature": p.get("signature"), "firstseen": p.get("firstseen","")}
                    for p in d.get("payloads",[])[:5]]
            return {"source": "urlhaus", "error": None, "data": result}
    except Exception as e:
        return {"source": "urlhaus", "error": str(e), "data": None}


async def _query_threatfox(indicator: str, ioc_type: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.post("https://threatfox-api.abuse.ch/api/v1/", headers={"Auth-Key": ABUSECH_KEY},
                json={"query": "search_ioc", "search_term": indicator})
            if r.status_code != 200:
                return {"source": "threatfox", "error": f"HTTP {r.status_code}", "data": None}
            d = r.json()
            if d.get("query_status") == "no_result":
                return {"source": "threatfox", "error": None, "data": {"found": False}}
            results = d.get("data", [])
            return {"source": "threatfox", "error": None, "data": {"found": True, "ioc_count": len(results),
                "iocs": [{"ioc_type": i.get("ioc_type",""), "threat_type": i.get("threat_type",""),
                    "malware": i.get("malware",""), "malware_alias": i.get("malware_alias"),
                    "confidence_level": i.get("confidence_level",0), "first_seen": i.get("first_seen_utc",""),
                    "last_seen": i.get("last_seen_utc",""), "tags": i.get("tags"),
                    "reporter": i.get("reporter",""), "reference": i.get("reference","")}
                    for i in results[:10]]}}
    except Exception as e:
        return {"source": "threatfox", "error": str(e), "data": None}


@router.get("/enrich")
async def enrich_ioc(
    indicator: str = Query(..., description="IOC to enrich"),
    ioc_type: Optional[str] = Query(None, description="Force IOC type"),
):
    indicator = indicator.strip()
    if not indicator:
        raise HTTPException(status_code=400, detail="indicator required")
    detected = ioc_type or _detect_ioc_type(indicator)
    if detected == "unknown":
        raise HTTPException(status_code=400, detail=f"Cannot detect IOC type for '{indicator}'")
    results = await asyncio.gather(
        _query_otx(indicator, detected), _query_abuseipdb(indicator, detected),
        _query_virustotal(indicator, detected), _query_urlhaus(indicator, detected),
        _query_threatfox(indicator, detected), return_exceptions=True)
    enrichment = {}
    for r in results:
        if isinstance(r, Exception): enrichment["error_"+str(r)[:20]] = {"source":"error","error":str(r),"data":None}
        elif isinstance(r, dict): enrichment[r["source"]] = r
    # Aggregate score
    signals = []
    otx_d = enrichment.get("otx",{}).get("data")
    if otx_d:
        if otx_d.get("pulse_count",0) > 0: signals.append(min(otx_d["pulse_count"]*10, 40))
        if otx_d.get("reputation",0) > 0: signals.append(otx_d["reputation"])
    abuse_d = enrichment.get("abuseipdb",{}).get("data")
    if abuse_d: signals.append(abuse_d.get("abuse_confidence_score",0))
    vt_d = enrichment.get("virustotal",{}).get("data")
    if vt_d and vt_d.get("total_engines",0) > 0:
        signals.append(int(vt_d["malicious"]/vt_d["total_engines"]*100))
    urlh_check = enrichment.get("urlhaus",{}); urlh_d2 = urlh_check.get("data") if urlh_check else None
    if urlh_d2 and urlh_d2.get("found"): signals.append(60)
    tfox = enrichment.get("threatfox",{}); tfox_data = tfox.get("data") if tfox else None
    if tfox_data and tfox_data.get("found"): signals.append(70)
    agg = min(int(sum(signals)/len(signals)),100) if signals else 0
    # Timeline
    timeline = []
    if otx_d:
        for p in otx_d.get("pulses",[]): 
            if p.get("created"): timeline.append({"source":"OTX Pulse","date":p["created"],"label":p.get("name","")[:60]})
        for d in otx_d.get("passive_dns",[]):
            if d.get("first"): timeline.append({"source":"OTX PDNS","date":d["first"],"label":d.get("hostname",d.get("address",""))})
    if abuse_d and abuse_d.get("last_reported_at"):
        timeline.append({"source":"AbuseIPDB","date":abuse_d["last_reported_at"],
            "label":f"Last reported ({abuse_d.get('total_reports',0)} total)"})
    urlh_d = enrichment.get("urlhaus",{}).get("data")
    if urlh_d and urlh_d.get("found"):
        for u in urlh_d.get("urls",[]):
            if u.get("date_added"): timeline.append({"source":"URLhaus","date":u["date_added"],"label":u.get("threat","malware URL")})
    tfox_d = enrichment.get("threatfox",{}).get("data")
    if tfox_d and tfox_d.get("found"):
        for i in tfox_d.get("iocs",[]):
            if i.get("first_seen"): timeline.append({"source":"ThreatFox","date":i["first_seen"],"label":i.get("malware","IOC")})
    timeline.sort(key=lambda x: x.get("date",""), reverse=True)
    return {"indicator": indicator, "ioc_type": detected, "aggregate_score": agg,
            "sources": enrichment, "timeline": timeline[:25], "queried_at": datetime.now(timezone.utc).isoformat()}


@router.get("/health")
async def ioc_health():
    return {"otx": bool(OTX_KEY), "abuseipdb": bool(ABUSEIPDB_KEY),
            "virustotal": bool(VT_KEY), "urlhaus": True, "threatfox": True}
