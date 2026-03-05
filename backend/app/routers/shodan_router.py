"""
Shodan Exposure API Router — /v1/exposure/*

Serves exposure intelligence data from Shodan searches.
Used by the globe overlay and the Exposure Weather panel.
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Query, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import SessionLocal
from sqlalchemy.orm import Session

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/exposure", tags=["shodan-exposure"])


@router.get("/summary")
def get_exposure_summary(db: Session = Depends(get_db)):
    """
    High-level exposure summary across all query tags.
    Returns global counts, top countries, and trending queries.
    """
    # Get latest snapshot per query tag
    rows = db.execute(text("""
        SELECT DISTINCT ON (query_tag)
            query_tag, query_string, total_global, sample_count,
            top_countries, top_ports, top_orgs, top_vulns, fetched_at
        FROM exposure_snapshots
        ORDER BY query_tag, fetched_at DESC
    """)).fetchall()

    queries = []
    total_global_exposure = 0
    all_countries = {}
    all_vulns = []

    for row in rows:
        countries = json.loads(row.top_countries) if row.top_countries else {}
        ports = json.loads(row.top_ports) if row.top_ports else {}
        orgs = json.loads(row.top_orgs) if row.top_orgs else {}
        vulns = json.loads(row.top_vulns) if row.top_vulns else []

        total_global_exposure += row.total_global or 0

        for cc, cnt in countries.items():
            all_countries[cc] = all_countries.get(cc, 0) + cnt

        all_vulns.extend(vulns)

        queries.append({
            "tag": row.query_tag,
            "query": row.query_string,
            "total_global": row.total_global,
            "sample_stored": row.sample_count,
            "top_countries": dict(sorted(countries.items(), key=lambda x: -x[1])[:10]),
            "top_ports": dict(sorted(ports.items(), key=lambda x: -x[1])[:5]),
            "top_orgs": dict(sorted(orgs.items(), key=lambda x: -x[1])[:5]),
            "cves": vulns[:10],
            "last_updated": row.fetched_at.isoformat() if row.fetched_at else None,
        })

    # Dedupe vulns
    vuln_counts = {}
    for v in all_vulns:
        vuln_counts[v] = vuln_counts.get(v, 0) + 1

    return {
        "total_global_exposure": total_global_exposure,
        "query_count": len(queries),
        "top_countries": dict(sorted(all_countries.items(), key=lambda x: -x[1])[:15]),
        "top_vulns": sorted(vuln_counts.keys(), key=lambda v: -vuln_counts[v])[:20],
        "queries": queries,
    }


@router.get("/by-country")
def get_exposure_by_country(
    country: Optional[str] = Query(default=None, description="2-letter country code"),
    db: Session = Depends(get_db),
):
    """
    Exposure data grouped by country. If country specified, returns detail for that country.
    """
    if country:
        rows = db.execute(text("""
            SELECT query_tag, ip, port, product, version, org, city, lat, lon,
                   vulns, fetched_at
            FROM exposures
            WHERE country_code = :cc
            ORDER BY fetched_at DESC
            LIMIT 100
        """), {"cc": country.upper()}).fetchall()

        return {
            "country": country.upper(),
            "count": len(rows),
            "services": [
                {
                    "query": r.query_tag, "ip": r.ip, "port": r.port,
                    "product": r.product, "version": r.version, "org": r.org,
                    "city": r.city, "lat": r.lat, "lon": r.lon,
                    "vulns": json.loads(r.vulns) if r.vulns else [],
                    "fetched": r.fetched_at.isoformat() if r.fetched_at else None,
                }
                for r in rows
            ],
        }

    # Aggregate by country
    rows = db.execute(text("""
        SELECT country_code, COUNT(*) as cnt, COUNT(DISTINCT query_tag) as query_types,
               COUNT(DISTINCT port) as port_types
        FROM exposures
        WHERE country_code IS NOT NULL AND country_code != ''
        GROUP BY country_code
        ORDER BY cnt DESC
        LIMIT 50
    """)).fetchall()

    return {
        "countries": [
            {"code": r.country_code, "count": r.cnt,
             "query_types": r.query_types, "port_types": r.port_types}
            for r in rows
        ]
    }


@router.get("/geo")
def get_exposure_geo(
    query_tag: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    GeoJSON-compatible exposure points for globe overlay.
    Returns lat/lon + metadata for each exposed service.
    """
    params = {}
    where = "WHERE lat IS NOT NULL AND lon IS NOT NULL"
    if query_tag:
        where += " AND query_tag = :tag"
        params["tag"] = query_tag

    rows = db.execute(text(f"""
        SELECT query_tag, ip, port, product, org, country_code,
               lat, lon, vulns, fetched_at
        FROM exposures
        {where}
        ORDER BY fetched_at DESC
        LIMIT 500
    """), params).fetchall()

    features = []
    for r in rows:
        vulns = json.loads(r.vulns) if r.vulns else []
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r.lon, r.lat]},
            "properties": {
                "query": r.query_tag,
                "ip": r.ip,
                "port": r.port,
                "product": r.product or "",
                "org": r.org or "",
                "country": r.country_code or "",
                "vulns": vulns,
                "vuln_count": len(vulns),
            },
        })

    return {"type": "FeatureCollection", "features": features}


@router.get("/timeline")
def get_exposure_timeline(
    query_tag: Optional[str] = Query(default=None),
    days: int = Query(default=30),
    db: Session = Depends(get_db),
):
    """
    Historical exposure counts per query tag over time.
    Used for trending charts.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    params = {"cutoff": cutoff}
    where = "WHERE fetched_at >= :cutoff"

    if query_tag:
        where += " AND query_tag = :tag"
        params["tag"] = query_tag

    rows = db.execute(text(f"""
        SELECT query_tag, total_global, sample_count, fetched_at
        FROM exposure_snapshots
        {where}
        ORDER BY fetched_at ASC
    """), params).fetchall()

    # Group by tag
    series = {}
    for r in rows:
        if r.query_tag not in series:
            series[r.query_tag] = []
        series[r.query_tag].append({
            "timestamp": r.fetched_at.isoformat(),
            "total": r.total_global,
            "sample": r.sample_count,
        })

    return {"days": days, "series": series}


@router.get("/health")
def shodan_health(db: Session = Depends(get_db)):
    """Check Shodan integration status."""
    import os
    has_key = bool(os.getenv("SHODAN_API_KEY", ""))

    latest = db.execute(text("""
        SELECT MAX(fetched_at) as last_fetch, COUNT(*) as total_snapshots
        FROM exposure_snapshots
    """)).fetchone()

    exposure_count = db.execute(text(
        "SELECT COUNT(*) FROM exposures"
    )).scalar()

    return {
        "api_key_configured": has_key,
        "total_snapshots": latest.total_snapshots if latest else 0,
        "total_exposures_stored": exposure_count or 0,
        "last_fetch": latest.last_fetch.isoformat() if latest and latest.last_fetch else None,
    }
