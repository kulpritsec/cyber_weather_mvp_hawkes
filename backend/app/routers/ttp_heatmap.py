"""
TTP Heatmap Router — /v1/ttp/*
Maps ingested events to MITRE ATT&CK techniques and provides
aggregated technique activity data for the Technique Weather Radar panel.
"""

import os
import json
import httpx
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..deps import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/ttp", tags=["ttp-heatmap"])

ALCHEMY_BASE = os.getenv("ALCHEMY_BASE_URL", "http://alchemy:8000")

# ═══ ATT&CK TECHNIQUE MAPPING ═══

TACTICS = [
    "reconnaissance", "resource-development", "initial-access",
    "execution", "persistence", "privilege-escalation",
    "defense-evasion", "credential-access", "discovery",
    "lateral-movement", "collection", "command-and-control",
    "exfiltration", "impact",
]

TACTIC_LABELS = {
    "reconnaissance": "Recon", "resource-development": "Resource Dev",
    "initial-access": "Initial Access", "execution": "Execution",
    "persistence": "Persistence", "privilege-escalation": "Priv Esc",
    "defense-evasion": "Defense Evasion", "credential-access": "Credential Access",
    "discovery": "Discovery", "lateral-movement": "Lateral Movement",
    "collection": "Collection", "command-and-control": "C2",
    "exfiltration": "Exfiltration", "impact": "Impact",
}

# Event → Technique mapping: (vector, port) → [(tid, name, tactic)]
TECHNIQUE_MAP = {
    ("ssh", 22): [
        ("T1110", "Brute Force", "credential-access"),
        ("T1110.001", "Password Guessing", "credential-access"),
        ("T1021.004", "SSH", "lateral-movement"),
    ],
    ("ssh", None): [
        ("T1110", "Brute Force", "credential-access"),
        ("T1021.004", "SSH", "lateral-movement"),
    ],
    ("rdp", 3389): [
        ("T1021.001", "Remote Desktop Protocol", "lateral-movement"),
        ("T1110", "Brute Force", "credential-access"),
        ("T1133", "External Remote Services", "persistence"),
    ],
    ("rdp", None): [
        ("T1021.001", "Remote Desktop Protocol", "lateral-movement"),
        ("T1110", "Brute Force", "credential-access"),
    ],
    ("http", 80): [
        ("T1190", "Exploit Public-Facing Application", "initial-access"),
        ("T1595.002", "Vulnerability Scanning", "reconnaissance"),
        ("T1046", "Network Service Discovery", "discovery"),
    ],
    ("http", 443): [
        ("T1190", "Exploit Public-Facing Application", "initial-access"),
        ("T1595.002", "Vulnerability Scanning", "reconnaissance"),
        ("T1071.001", "Web Protocols", "command-and-control"),
    ],
    ("http", 8080): [
        ("T1190", "Exploit Public-Facing Application", "initial-access"),
        ("T1595.002", "Vulnerability Scanning", "reconnaissance"),
    ],
    ("http", None): [
        ("T1190", "Exploit Public-Facing Application", "initial-access"),
        ("T1595.002", "Vulnerability Scanning", "reconnaissance"),
    ],
    ("dns_amp", 53): [
        ("T1498.002", "Reflection Amplification", "impact"),
        ("T1568", "Dynamic Resolution", "command-and-control"),
        ("T1071.004", "DNS", "command-and-control"),
    ],
    ("dns_amp", None): [
        ("T1498.002", "Reflection Amplification", "impact"),
        ("T1071.004", "DNS", "command-and-control"),
    ],
    ("botnet_c2", 443): [
        ("T1071.001", "Web Protocols", "command-and-control"),
        ("T1573.002", "Asymmetric Cryptography", "command-and-control"),
        ("T1105", "Ingress Tool Transfer", "command-and-control"),
    ],
    ("botnet_c2", 8080): [
        ("T1071.001", "Web Protocols", "command-and-control"),
        ("T1105", "Ingress Tool Transfer", "command-and-control"),
        ("T1571", "Non-Standard Port", "command-and-control"),
    ],
    ("botnet_c2", None): [
        ("T1071", "Application Layer Protocol", "command-and-control"),
        ("T1105", "Ingress Tool Transfer", "command-and-control"),
    ],
    ("ransomware", None): [
        ("T1486", "Data Encrypted for Impact", "impact"),
        ("T1490", "Inhibit System Recovery", "impact"),
        ("T1489", "Service Stop", "impact"),
        ("T1021.002", "SMB/Windows Admin Shares", "lateral-movement"),
        ("T1059.001", "PowerShell", "execution"),
    ],
    ("malware", None): [
        ("T1105", "Ingress Tool Transfer", "command-and-control"),
        ("T1059", "Command and Scripting Interpreter", "execution"),
        ("T1547.001", "Registry Run Keys / Startup Folder", "persistence"),
    ],
}

MALWARE_TECHNIQUE_MAP = {
    "win.xworm": [
        ("T1059.001", "PowerShell", "execution"),
        ("T1547.001", "Registry Run Keys / Startup Folder", "persistence"),
        ("T1056.001", "Keylogging", "collection"),
        ("T1113", "Screen Capture", "collection"),
        ("T1071.001", "Web Protocols", "command-and-control"),
    ],
    "win.meterpreter": [
        ("T1059", "Command and Scripting Interpreter", "execution"),
        ("T1055", "Process Injection", "defense-evasion"),
        ("T1003", "OS Credential Dumping", "credential-access"),
        ("T1071.001", "Web Protocols", "command-and-control"),
        ("T1573", "Encrypted Channel", "command-and-control"),
    ],
    "elf.moobot": [
        ("T1059.004", "Unix Shell", "execution"),
        ("T1498", "Network Denial of Service", "impact"),
        ("T1583.005", "Botnet", "resource-development"),
        ("T1071", "Application Layer Protocol", "command-and-control"),
    ],
    "win.cobalt_strike": [
        ("T1059.001", "PowerShell", "execution"),
        ("T1055", "Process Injection", "defense-evasion"),
        ("T1071.001", "Web Protocols", "command-and-control"),
        ("T1573.002", "Asymmetric Cryptography", "command-and-control"),
        ("T1021.006", "Windows Remote Management", "lateral-movement"),
    ],
    "win.asyncrat": [
        ("T1059.001", "PowerShell", "execution"),
        ("T1547.001", "Registry Run Keys / Startup Folder", "persistence"),
        ("T1056.001", "Keylogging", "collection"),
        ("T1113", "Screen Capture", "collection"),
    ],
    "win.remcos": [
        ("T1059.001", "PowerShell", "execution"),
        ("T1056.001", "Keylogging", "collection"),
        ("T1113", "Screen Capture", "collection"),
        ("T1071.001", "Web Protocols", "command-and-control"),
    ],
}


def _map_event_to_techniques(vector, target_port, tags_json):
    techniques = []
    key_specific = (vector, target_port)
    key_generic = (vector, None)
    if key_specific in TECHNIQUE_MAP:
        techniques.extend(TECHNIQUE_MAP[key_specific])
    elif key_generic in TECHNIQUE_MAP:
        techniques.extend(TECHNIQUE_MAP[key_generic])

    # Fallback: unknown vector → port-based heuristic
    if not techniques and target_port:
        port_map = {
            22: [("T1110", "Brute Force", "credential-access"), ("T1021.004", "SSH", "lateral-movement")],
            23: [("T1021", "Remote Services", "lateral-movement")],
            25: [("T1071.003", "Mail Protocols", "command-and-control")],
            53: [("T1071.004", "DNS", "command-and-control")],
            80: [("T1190", "Exploit Public-Facing Application", "initial-access")],
            110: [("T1071.003", "Mail Protocols", "command-and-control")],
            143: [("T1071.003", "Mail Protocols", "command-and-control")],
            443: [("T1071.001", "Web Protocols", "command-and-control")],
            445: [("T1021.002", "SMB/Windows Admin Shares", "lateral-movement")],
            993: [("T1071.003", "Mail Protocols", "command-and-control")],
            1433: [("T1190", "Exploit Public-Facing Application", "initial-access")],
            3306: [("T1190", "Exploit Public-Facing Application", "initial-access")],
            3389: [("T1021.001", "Remote Desktop Protocol", "lateral-movement")],
            5432: [("T1190", "Exploit Public-Facing Application", "initial-access")],
            5900: [("T1021.005", "VNC", "lateral-movement")],
            8080: [("T1190", "Exploit Public-Facing Application", "initial-access")],
            8443: [("T1071.001", "Web Protocols", "command-and-control")],
        }
        if target_port in port_map:
            techniques.extend(port_map[target_port])
        else:
            techniques.append(("T1046", "Network Service Discovery", "discovery"))

    if tags_json:
        try:
            tags = json.loads(tags_json) if isinstance(tags_json, str) else tags_json
            mf = tags.get("malware_family", "")
            if mf and mf in MALWARE_TECHNIQUE_MAP:
                techniques.extend(MALWARE_TECHNIQUE_MAP[mf])
            elif mf:
                for key in MALWARE_TECHNIQUE_MAP:
                    if key.split(".")[-1] in mf.lower():
                        techniques.extend(MALWARE_TECHNIQUE_MAP[key])
                        break
        except (json.JSONDecodeError, AttributeError):
            pass
    return techniques


# ═══ ALCHEMY CROSS-REFERENCE CACHE ═══

_alchemy_cache = {"data": None, "ts": None}
CACHE_TTL = 3600


async def _get_alchemy_technique_map():
    if (_alchemy_cache["data"] and _alchemy_cache["ts"]
            and (datetime.now(timezone.utc) - _alchemy_cache["ts"]).seconds < CACHE_TTL):
        return _alchemy_cache["data"]

    technique_to_groups = defaultdict(list)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(f"{ALCHEMY_BASE}/groups")
            if r.status_code != 200:
                return technique_to_groups
            groups = r.json().get("groups", [])

            for name in groups:
                try:
                    tr = await client.get(f"{ALCHEMY_BASE}/transmute/{name}", timeout=5.0)
                    if tr.status_code == 200:
                        data = tr.json()
                        for sub in data.get("substituents", []):
                            tech = sub.get("technique", "")
                            if "[" in tech and "]" in tech:
                                tid = tech.split("[")[-1].rstrip("]")
                                technique_to_groups[tid].append(name)
                except Exception:
                    continue

        _alchemy_cache["data"] = dict(technique_to_groups)
        _alchemy_cache["ts"] = datetime.now(timezone.utc)
        logger.info(f"Alchemy cache: {len(technique_to_groups)} techniques from {len(groups)} groups")
    except Exception as e:
        logger.error(f"Alchemy cache build failed: {e}")
    return technique_to_groups


# ═══ ENDPOINTS ═══

@router.get("/heatmap")
async def ttp_heatmap(
    hours: int = Query(24, description="Lookback window in hours"),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)
    cutoff_7d = now - timedelta(days=7)

    technique_counts = defaultdict(lambda: {
        "count": 0, "count_7d": 0,
        "sources": defaultdict(int), "countries": defaultdict(int),
        "hourly": defaultdict(int),
    })
    technique_meta = {}

    result = db.execute(text("""
        SELECT vector, target_port, tags, source, source_country,
               count, ts, EXTRACT(EPOCH FROM ts) as ts_epoch
        FROM events WHERE ts >= :cutoff_7d ORDER BY ts DESC
    """), {"cutoff_7d": cutoff_7d})

    for row in result:
        vector, port, tags, source, country = row[0], row[1], row[2], row[3], row[4]
        evt_count, ts, ts_epoch = row[5] or 1, row[6], row[7]

        techniques = _map_event_to_techniques(vector, port, tags)
        for tid, tname, tactic in techniques:
            technique_meta[tid] = (tname, tactic)
            bucket = technique_counts[tid]
            if ts >= cutoff:
                bucket["count"] += evt_count
                bucket["hourly"][int(ts_epoch // 3600)] += evt_count
            bucket["count_7d"] += evt_count
            if source: bucket["sources"][source] += evt_count
            if country and country != "XX": bucket["countries"][country] += evt_count

    alchemy_map = await _get_alchemy_technique_map()

    now_epoch = now.timestamp()
    sparkline_start = int((now_epoch - hours * 3600) // 3600)
    sparkline_hours = list(range(sparkline_start, int(now_epoch // 3600) + 1))

    techniques_out = {}
    for tid, bucket in technique_counts.items():
        if tid not in technique_meta: continue
        name, tactic = technique_meta[tid]
        sparkline = [bucket["hourly"].get(h, 0) for h in sparkline_hours]

        recent = sum(sparkline[-6:]) if len(sparkline) >= 6 else sum(sparkline)
        prior = sum(sparkline[-12:-6]) if len(sparkline) >= 12 else sum(sparkline[:len(sparkline)//2])
        if prior > 0:
            ratio = recent / prior
            trend = "increasing" if ratio > 1.3 else "decreasing" if ratio < 0.7 else "stable"
        else:
            trend = "increasing" if recent > 0 else "stable"

        top_sources = sorted(bucket["sources"].items(), key=lambda x: -x[1])[:5]
        top_countries = sorted(bucket["countries"].items(), key=lambda x: -x[1])[:5]

        techniques_out[tid] = {
            "id": tid, "name": name, "tactic": tactic,
            "count_24h": bucket["count"], "count_7d": bucket["count_7d"],
            "trend": trend,
            "sparkline": sparkline,
            "groups": alchemy_map.get(tid, [])[:10],
            "top_sources": [s[0] for s in top_sources],
            "top_countries": [c[0] for c in top_countries],
        }

    top_techniques = sorted(techniques_out.values(), key=lambda t: t["count_24h"], reverse=True)

    return {
        "tactics": [{"id": t, "label": TACTIC_LABELS[t]} for t in TACTICS],
        "techniques": techniques_out,
        "top_techniques": [t["id"] for t in top_techniques[:20]],
        "total_events_mapped": sum(t["count_24h"] for t in techniques_out.values()),
        "unique_techniques_active": len([t for t in techniques_out.values() if t["count_24h"] > 0]),
        "queried_at": now.isoformat(),
        "window_hours": hours,
    }


@router.get("/technique/{technique_id}")
async def technique_detail(
    technique_id: str,
    hours: int = Query(24),
    db: Session = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    result = db.execute(text("""
        SELECT vector, target_port, tags, source, source_ip,
               source_country, count, ts, severity_raw, lat, lon
        FROM events WHERE ts >= :cutoff ORDER BY ts DESC LIMIT 5000
    """), {"cutoff": cutoff})

    hourly, sources, countries, ips = defaultdict(int), defaultdict(int), defaultdict(int), defaultdict(int)
    matching_events = []

    for row in result:
        vector, port, tags, source, src_ip = row[0], row[1], row[2], row[3], row[4]
        country, count, ts, severity, lat, lon = row[5], row[6], row[7], row[8], row[9], row[10]
        techniques = _map_event_to_techniques(vector, port, tags)
        if technique_id not in [t[0] for t in techniques]: continue

        evt_count = count or 1
        hour_key = ts.strftime("%Y-%m-%d %H:00") if ts else "unknown"
        hourly[hour_key] += evt_count
        if source: sources[source] += evt_count
        if country and country != "XX": countries[country] += evt_count
        if src_ip: ips[src_ip] += evt_count

        if len(matching_events) < 20:
            matching_events.append({
                "ts": ts.isoformat() if ts else None,
                "source_ip": src_ip, "country": country,
                "vector": vector, "port": port, "source": source,
                "severity": severity, "count": count,
                "lat": lat, "lon": lon,
            })

    alchemy_map = await _get_alchemy_technique_map()
    return {
        "technique_id": technique_id,
        "total_events": sum(hourly.values()),
        "timeline": dict(sorted(hourly.items())),
        "top_sources": dict(sorted(sources.items(), key=lambda x: -x[1])[:10]),
        "top_countries": dict(sorted(countries.items(), key=lambda x: -x[1])[:10]),
        "top_ips": dict(sorted(ips.items(), key=lambda x: -x[1])[:10]),
        "recent_events": matching_events,
        "alchemy_groups": alchemy_map.get(technique_id, []),
        "queried_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/health")
async def ttp_health(db: Session = Depends(get_db)):
    result = db.execute(text(
        "SELECT COUNT(*), MAX(ts) FROM events WHERE ts >= :cutoff"
    ), {"cutoff": datetime.now(timezone.utc) - timedelta(hours=24)})
    row = result.fetchone()
    alchemy_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{ALCHEMY_BASE}/groups")
            alchemy_ok = r.status_code == 200
    except Exception: pass
    return {
        "events_24h": row[0] if row else 0,
        "latest_event": row[1].isoformat() if row and row[1] else None,
        "alchemy_connected": alchemy_ok,
        "technique_rules": len(TECHNIQUE_MAP),
        "malware_rules": len(MALWARE_TECHNIQUE_MAP),
    }
