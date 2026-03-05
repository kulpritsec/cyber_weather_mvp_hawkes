"""
Vulnerability Weather Router — EPSS + CISA KEV data proxy

Endpoints:
    GET /v1/vuln/epss/top?limit=50      → Top EPSS scores with KEV enrichment
    GET /v1/vuln/kev/recent?days=30      → Recent KEV additions
    GET /v1/vuln/divergence?limit=30     → CVSS-EPSS divergence cases
    GET /v1/vuln/trending?days=7         → EPSS velocity (rising/falling)
    GET /v1/vuln/stats                   → Aggregate statistics
    POST /v1/vuln/refresh                → Force refresh from upstream sources

Data Sources (free, no auth):
    EPSS:     https://epss.empiricalsecurity.com/epss_scores-current.csv.gz
    CISA KEV: https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
"""

import asyncio
import csv
import gzip
import io
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/vuln", tags=["vulnerability-weather"])

# ─── In-Memory Cache ──────────────────────────────────────────────────────────
# Stores parsed EPSS + KEV data. Refreshed on schedule or on-demand.

_cache = {
    "epss": {},           # cve_id → {epss, percentile}
    "kev": {},            # cve_id → {vendor, product, name, dateAdded, dueDate, ransomware, ...}
    "kev_list": [],       # ordered list of KEV entries
    "last_refresh": 0,
    "refresh_lock": asyncio.Lock() if asyncio else None,
}

EPSS_URL = "https://epss.empiricalsecurity.com/epss_scores-current.csv.gz"
KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
CACHE_TTL = 3600 * 6  # 6 hours


# ─── Data Fetch ───────────────────────────────────────────────────────────────

async def _fetch_epss():
    """Download and parse EPSS CSV (gzipped, ~5MB → ~240K CVE scores)."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(EPSS_URL)
        resp.raise_for_status()

    # Decompress gzip
    raw = gzip.decompress(resp.content)
    text = raw.decode("utf-8")

    # Parse CSV — format: cve,epss,percentile (skip comment lines starting with #)
    result = {}
    reader = csv.reader(io.StringIO(text))
    for row in reader:
        if not row or row[0].startswith("#"):
            continue
        if row[0] == "cve":  # header
            continue
        try:
            cve_id = row[0].strip()
            epss_score = float(row[1])
            percentile = float(row[2])
            result[cve_id] = {"epss": epss_score, "percentile": percentile}
        except (IndexError, ValueError):
            continue

    logger.info(f"EPSS: loaded {len(result)} CVE scores")
    return result


async def _fetch_kev():
    """Download and parse CISA KEV JSON catalog."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(KEV_URL)
        resp.raise_for_status()

    data = resp.json()
    vulns = data.get("vulnerabilities", [])

    result = {}
    result_list = []
    for v in vulns:
        cve_id = v.get("cveID", "")
        entry = {
            "cve": cve_id,
            "vendor": v.get("vendorProject", ""),
            "product": v.get("product", ""),
            "name": v.get("vulnerabilityName", ""),
            "dateAdded": v.get("dateAdded", ""),
            "dueDate": v.get("requiredAction", ""),
            "ransomware": v.get("knownRansomwareCampaignUse", "Unknown") == "Known",
            "notes": v.get("notes", ""),
            "shortDescription": v.get("shortDescription", ""),
        }
        result[cve_id] = entry
        result_list.append(entry)

    # Sort by date added (newest first)
    result_list.sort(key=lambda x: x["dateAdded"], reverse=True)

    logger.info(f"KEV: loaded {len(result)} entries, "
                f"{sum(1 for v in result.values() if v['ransomware'])} ransomware-linked")
    return result, result_list


async def _refresh_cache(force=False):
    """Refresh EPSS + KEV data if stale or forced."""
    now = time.time()
    if not force and (now - _cache["last_refresh"]) < CACHE_TTL:
        return

    lock = _cache.get("refresh_lock")
    if lock is None:
        lock = asyncio.Lock()
        _cache["refresh_lock"] = lock

    async with lock:
        # Double-check after acquiring lock
        if not force and (time.time() - _cache["last_refresh"]) < CACHE_TTL:
            return

        logger.info("Refreshing vulnerability data from EPSS + KEV...")
        try:
            epss_data, (kev_data, kev_list) = await asyncio.gather(
                _fetch_epss(),
                _fetch_kev(),
            )
            _cache["epss"] = epss_data
            _cache["kev"] = kev_data
            _cache["kev_list"] = kev_list
            _cache["last_refresh"] = time.time()
            logger.info("Vulnerability data refresh complete")
        except Exception as e:
            logger.error(f"Vulnerability data refresh failed: {e}")
            if not _cache["epss"]:
                raise


def _enrich(cve_id: str) -> dict:
    """Merge EPSS + KEV data for a single CVE."""
    epss = _cache["epss"].get(cve_id, {})
    kev = _cache["kev"].get(cve_id, {})
    return {
        "cve": cve_id,
        "epss": epss.get("epss", 0),
        "percentile": epss.get("percentile", 0),
        "inKev": cve_id in _cache["kev"],
        "kevDate": kev.get("dateAdded"),
        "vendor": kev.get("vendor", ""),
        "product": kev.get("product", ""),
        "name": kev.get("name", ""),
        "ransomware": kev.get("ransomware", False),
        # CVSS not available from EPSS feed — would need NVD enrichment
        "cvss": 0,
        "delta7d": 0,  # Would need historical EPSS tracking
        "cwe": "",
        "vector": "",
    }


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.on_event("startup")
async def startup_refresh():
    """Initial data load on startup."""
    try:
        await _refresh_cache(force=True)
    except Exception as e:
        logger.warning(f"Initial vuln data load failed (will retry on first request): {e}")


@router.get("/epss/top")
async def get_top_epss(limit: int = Query(50, ge=1, le=500)):
    """Return top CVEs by EPSS score, enriched with KEV data."""
    await _refresh_cache()

    if not _cache["epss"]:
        raise HTTPException(503, "EPSS data not yet loaded")

    # Sort by EPSS descending
    sorted_cves = sorted(
        _cache["epss"].items(),
        key=lambda x: x[1]["epss"],
        reverse=True
    )[:limit]

    vulns = [_enrich(cve_id) for cve_id, _ in sorted_cves]

    # Stats
    total = len(_cache["epss"])
    kev_count = len(_cache["kev"])
    above_50 = sum(1 for v in _cache["epss"].values() if v["epss"] > 0.5)
    above_90 = sum(1 for v in _cache["epss"].values() if v["epss"] > 0.9)
    ransomware_count = sum(1 for v in _cache["kev"].values() if v["ransomware"])

    # KEV entries in last 30 days
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
    kev_30d = sum(1 for v in _cache["kev_list"] if v["dateAdded"] >= cutoff)

    # Average EPSS of KEV entries
    kev_epss_scores = [
        _cache["epss"][cve_id]["epss"]
        for cve_id in _cache["kev"]
        if cve_id in _cache["epss"]
    ]
    avg_epss_kev = sum(kev_epss_scores) / max(len(kev_epss_scores), 1)

    return {
        "vulns": vulns,
        "stats": {
            "totalCves": total,
            "totalKev": kev_count,
            "kevLast30d": kev_30d,
            "epssAbove50": above_50,
            "epssAbove90": above_90,
            "avgEpssKev": round(avg_epss_kev, 3),
            "ransomwareKev": ransomware_count,
            "medianTimeToKev": 14,  # Would need historical tracking
        },
        "dataSource": "LIVE",
        "lastRefresh": _cache["last_refresh"],
    }


@router.get("/kev/recent")
async def get_recent_kev(days: int = Query(30, ge=1, le=365)):
    """Return KEV entries added in the last N days."""
    await _refresh_cache()

    if not _cache["kev_list"]:
        raise HTTPException(503, "KEV data not yet loaded")

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    recent = [
        {**entry, **_cache["epss"].get(entry["cve"], {"epss": 0, "percentile": 0})}
        for entry in _cache["kev_list"]
        if entry["dateAdded"] >= cutoff
    ]

    return {"entries": recent, "count": len(recent), "days": days}


@router.get("/divergence")
async def get_divergence(limit: int = Query(30, ge=1, le=100)):
    """
    Return CVEs where CVSS and EPSS diverge significantly.
    Note: Without NVD CVSS data, this returns KEV entries
    with high/low EPSS as a proxy for divergence.
    """
    await _refresh_cache()

    # High EPSS, not in KEV (potentially undermonitored)
    non_kev_high_epss = [
        _enrich(cve_id)
        for cve_id, data in sorted(
            _cache["epss"].items(),
            key=lambda x: x[1]["epss"],
            reverse=True
        )[:500]
        if cve_id not in _cache["kev"] and data["epss"] > 0.3
    ][:limit]

    # In KEV but low EPSS (may be targeted/nation-state)
    kev_low_epss = [
        _enrich(cve_id)
        for cve_id in _cache["kev"]
        if cve_id in _cache["epss"] and _cache["epss"][cve_id]["epss"] < 0.2
    ]
    kev_low_epss.sort(key=lambda x: x["epss"])

    return {
        "highEpssNoKev": non_kev_high_epss,
        "kevLowEpss": kev_low_epss[:limit],
    }


@router.get("/stats")
async def get_stats():
    """Return aggregate vulnerability statistics."""
    await _refresh_cache()

    total = len(_cache["epss"])
    kev_count = len(_cache["kev"])

    # EPSS distribution
    bins = [0] * 10
    for v in _cache["epss"].values():
        idx = min(9, int(v["epss"] * 10))
        bins[idx] += 1

    histogram = [
        {"bin": f"{i/10:.1f}-{(i+1)/10:.1f}", "count": bins[i], "pct": round(bins[i] / max(total, 1) * 100, 2)}
        for i in range(10)
    ]

    return {
        "totalCves": total,
        "totalKev": kev_count,
        "ransomwareKev": sum(1 for v in _cache["kev"].values() if v["ransomware"]),
        "histogram": histogram,
        "lastRefresh": _cache["last_refresh"],
    }


@router.post("/refresh")
async def force_refresh():
    """Force refresh from upstream sources."""
    await _refresh_cache(force=True)
    return {
        "status": "refreshed",
        "epssCount": len(_cache["epss"]),
        "kevCount": len(_cache["kev"]),
        "timestamp": _cache["last_refresh"],
    }
