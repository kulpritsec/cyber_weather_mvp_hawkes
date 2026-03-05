"""
Shodan Exposure Intelligence Ingest Module

Runs curated Shodan searches on a rotating schedule to track
exposed attack surface globally. Designed for the dev plan
(100 queries/month = ~3/day).

Query rotation strategy:
  - 21 queries total, grouped into 7 daily sets of 3
  - Each set covers: 1 critical service + 1 SLTT-relevant + 1 CVE-specific
  - Full rotation every 7 days = 21 queries/week = ~90/month (under 100 limit)
"""

import os
import json
import logging
import httpx
from datetime import datetime, timezone
from typing import Optional
from collections import Counter

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

SHODAN_API_KEY = os.getenv("SHODAN_API_KEY", "")
SHODAN_BASE = "https://api.shodan.io"

# ═══════════════════════════════════════════════════════════════════════════
# QUERY ROTATION — 7 daily sets × 3 queries = 21 queries/week
# ═══════════════════════════════════════════════════════════════════════════

QUERY_SETS = {
    0: [  # Monday
        {"tag": "rdp_open",          "query": "port:3389 !auth",                    "desc": "Open RDP — #1 ransomware entry point"},
        {"tag": "gov_exposed",       "query": "org:government port:443 http.status:200", "desc": "Government web services"},
        {"tag": "cve_fortinet",      "query": 'vuln:CVE-2024-47575 OR vuln:CVE-2024-21762', "desc": "FortiGate critical CVEs"},
    ],
    1: [  # Tuesday
        {"tag": "smb_exposed",       "query": "port:445 !port:443",                 "desc": "Exposed SMB/CIFS"},
        {"tag": "scada_exposed",     "query": "port:502 tag:ics",         "desc": "Industrial control systems"},
        {"tag": "cve_exchange",      "query": 'Exchange Server port:443', "desc": "Exchange critical CVEs"},
    ],
    2: [  # Wednesday
        {"tag": "ssh_password",      "query": "port:22 ssh !key",                   "desc": "SSH with password auth"},
        {"tag": "edu_exposed",       "query": 'org:university port:3389,445,23',    "desc": "University exposed services"},
        {"tag": "cve_cisco",         "query": 'vuln:CVE-2024-20353 OR vuln:CVE-2024-20359', "desc": "Cisco ASA/FTD CVEs"},
    ],
    3: [  # Thursday
        {"tag": "telnet_open",       "query": "port:23 -port:443",                  "desc": "Open Telnet"},
        {"tag": "healthcare_exposed","query": 'org:hospital OR org:health port:443,3389', "desc": "Healthcare sector exposure"},
        {"tag": "cve_moveit",        "query": 'MOVEit Transfer port:443',  "desc": "MOVEit Transfer CVE"},
    ],
    4: [  # Friday
        {"tag": "vnc_open",          "query": "port:5900 !auth",                    "desc": "Open VNC"},
        {"tag": "k12_exposed",       "query": 'org:"school district" port:443,3389', "desc": "K-12 school districts"},
        {"tag": "cve_citrix",        "query": 'Citrix ADC port:443',   "desc": "Citrix Bleed CVE"},
    ],
    5: [  # Saturday
        {"tag": "database_exposed",  "query": "port:3306,5432,27017,6379 -cloud",   "desc": "Exposed databases"},
        {"tag": "webcam_exposed",    "query": 'product:webcam OR tag:webcam',        "desc": "Exposed webcams/IoT"},
        {"tag": "cve_paloalto",      "query": 'PAN-OS GlobalProtect port:443', "desc": "Palo Alto GlobalProtect CVE"},
    ],
    6: [  # Sunday
        {"tag": "printer_exposed",   "query": "port:9100,515,631 product:printer",  "desc": "Network printers"},
        {"tag": "vpn_exposed",       "query": 'product:OpenVPN OR product:FortiGate port:443,10443', "desc": "VPN concentrators"},
        {"tag": "cve_ivanti",        "query": 'vuln:CVE-2024-21887 OR vuln:CVE-2023-46805', "desc": "Ivanti Connect Secure CVEs"},
    ],
}


async def run_shodan_ingest(db: Session) -> dict:
    """
    Run today's Shodan query set. Returns summary stats.
    """
    if not SHODAN_API_KEY:
        logger.warning("SHODAN_API_KEY not set — skipping Shodan ingest")
        return {"status": "skipped", "reason": "no_api_key"}

    today = datetime.now(timezone.utc).weekday()  # 0=Monday
    queries = QUERY_SETS.get(today, QUERY_SETS[0])

    results_summary = {
        "day": today,
        "queries_run": 0,
        "total_results_stored": 0,
        "errors": [],
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        for qdef in queries:
            tag = qdef["tag"]
            query = qdef["query"]
            desc = qdef["desc"]

            try:
                logger.info(f"Shodan query: [{tag}] {query}")

                # Search Shodan
                resp = await client.get(
                    f"{SHODAN_BASE}/shodan/host/search",
                    params={"key": SHODAN_API_KEY, "query": query, "minify": "true"},
                )

                if resp.status_code == 401:
                    results_summary["errors"].append(f"{tag}: invalid API key")
                    continue
                elif resp.status_code == 402:
                    results_summary["errors"].append(f"{tag}: query requires paid plan")
                    continue
                elif resp.status_code == 429:
                    results_summary["errors"].append(f"{tag}: rate limited")
                    continue
                elif resp.status_code != 200:
                    results_summary["errors"].append(f"{tag}: HTTP {resp.status_code}")
                    continue

                data = resp.json()
                total = data.get("total", 0)
                matches = data.get("matches", [])

                logger.info(f"Shodan [{tag}]: {total} total, {len(matches)} returned")

                # Aggregate stats for snapshot
                country_counts = Counter()
                port_counts = Counter()
                org_counts = Counter()
                all_vulns = Counter()

                stored = 0
                now = datetime.now(timezone.utc)

                for match in matches:
                    ip = match.get("ip_str", "")
                    port = match.get("port", 0)
                    transport = match.get("transport", "tcp")
                    product = match.get("product", "")
                    version = match.get("version", "")
                    op_sys = match.get("os", "")
                    org = match.get("org", "")
                    asn = match.get("asn", "")
                    loc = match.get("location", {})
                    country = loc.get("country_code", "")
                    city = loc.get("city", "")
                    lat = loc.get("latitude")
                    lon = loc.get("longitude")
                    vulns = list(match.get("vulns", {}).keys()) if match.get("vulns") else []
                    tags = match.get("tags", [])

                    # Aggregate
                    if country:
                        country_counts[country] += 1
                    port_counts[str(port)] += 1
                    if org:
                        org_counts[org] += 1
                    for v in vulns:
                        all_vulns[v] += 1

                    # Upsert into exposures table
                    try:
                        db.execute(text("""
                            INSERT INTO exposures
                                (query_tag, query_string, total_results, ip, port, transport,
                                 product, version, os, org, asn, country_code, city,
                                 lat, lon, vulns, tags, last_seen, fetched_at)
                            VALUES
                                (:tag, :query, :total, :ip, :port, :transport,
                                 :product, :version, :os, :org, :asn, :country, :city,
                                 :lat, :lon, :vulns, :tags, :last_seen, :now)
                            ON CONFLICT (query_tag, ip, port)
                            DO UPDATE SET
                                total_results = :total,
                                product = :product,
                                version = :version,
                                os = :os,
                                org = :org,
                                vulns = :vulns,
                                tags = :tags,
                                last_seen = :last_seen,
                                fetched_at = :now
                        """), {
                            "tag": tag, "query": query, "total": total,
                            "ip": ip, "port": port, "transport": transport,
                            "product": product, "version": version,
                            "os": op_sys, "org": org, "asn": asn,
                            "country": country, "city": city,
                            "lat": lat, "lon": lon,
                            "vulns": json.dumps(vulns) if vulns else None,
                            "tags": json.dumps(tags) if tags else None,
                            "last_seen": match.get("timestamp", now.isoformat()),
                            "now": now,
                        })
                        stored += 1
                    except Exception as e:
                        logger.warning(f"Shodan upsert error for {ip}:{port}: {e}")

                # Store snapshot
                db.execute(text("""
                    INSERT INTO exposure_snapshots
                        (query_tag, query_string, total_global, sample_count,
                         top_countries, top_ports, top_orgs, top_vulns, fetched_at)
                    VALUES
                        (:tag, :query, :total, :sample,
                         :countries, :ports, :orgs, :vulns, :now)
                """), {
                    "tag": tag, "query": query,
                    "total": total, "sample": stored,
                    "countries": json.dumps(dict(country_counts.most_common(20))),
                    "ports": json.dumps(dict(port_counts.most_common(10))),
                    "orgs": json.dumps(dict(org_counts.most_common(15))),
                    "vulns": json.dumps([v for v, _ in all_vulns.most_common(20)]),
                    "now": now,
                })

                db.commit()
                results_summary["queries_run"] += 1
                results_summary["total_results_stored"] += stored

                logger.info(f"Shodan [{tag}]: stored {stored} results, {total} global")

            except Exception as e:
                logger.error(f"Shodan [{tag}] error: {e}")
                results_summary["errors"].append(f"{tag}: {str(e)}")
                db.rollback()

    return results_summary
