"""
Live Event Feed Ingestion — GDELT + RSS Hybrid

Continuously discovers global events (geopolitical, sporting, vulnerability,
financial, commerce, holiday) and classifies their cyber impact to feed into
the Hawkes covariate system (event_mult in forecasts).

Sources:
    GDELT:  Free real-time global event monitoring (250M+ events)
            API: https://api.gdeltproject.org/api/v2/doc/doc
    RSS:    Curated cybersecurity and world news feeds
            - CISA Alerts, US-CERT, MITRE CVE
            - Reuters World, BBC News
            - BleepingComputer, The Record, Dark Reading

Flow:
    1. Fetch GDELT events matching cyber-relevant themes
    2. Fetch RSS feeds for breaking cyber/geopolitical news
    3. Classify events into calendar categories with impact scoring
    4. Store in live_events table
    5. _compute_event_mult() reads from this table + static calendar
"""

import logging
import hashlib
import json
import re
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

import httpx
from sqlalchemy import Column, Integer, Float, String, DateTime, Boolean, Text
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import Base

logger = logging.getLogger(__name__)


# ─── Model ────────────────────────────────────────────────────────────────────

class LiveEvent(Base):
    __tablename__ = "live_events"
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(String, unique=True, index=True)  # dedup hash
    name = Column(String)
    category = Column(String, index=True)  # geopolitical, sporting, vulnerability, etc.
    start = Column(DateTime, index=True)
    end = Column(DateTime)
    region = Column(String)
    impact = Column(Float)  # 0.0 - 1.0
    vectors = Column(Text)  # JSON list of affected vectors
    description = Column(Text)
    source = Column(String)  # gdelt, rss:cisa, rss:reuters, etc.
    source_url = Column(String)
    confidence = Column(Float, default=0.5)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


# ─── GDELT Configuration ─────────────────────────────────────────────────────

# GDELT themes mapped to our event categories and cyber impact
GDELT_QUERIES = [
    {
        "query": "cyber attack OR cyberattack OR ransomware OR data breach",
        "category": "vulnerability",
        "base_impact": 0.55,
        "vectors": ["http", "ssh", "ransomware"],
    },
    {
        "query": "military conflict OR war OR sanctions OR escalation Iran",
        "category": "geopolitical",
        "base_impact": 0.70,
        "vectors": ["ssh", "http", "dns_amp", "botnet_c2"],
    },
    {
        "query": "military conflict OR war Russia Ukraine",
        "category": "geopolitical",
        "base_impact": 0.65,
        "vectors": ["ssh", "http", "dns_amp", "botnet_c2"],
    },
    {
        "query": "China Taiwan military OR strait tensions",
        "category": "geopolitical",
        "base_impact": 0.70,
        "vectors": ["ssh", "http", "dns_amp"],
    },
    {
        "query": "FIFA World Cup OR Olympics OR Super Bowl OR Champions League",
        "category": "sporting",
        "base_impact": 0.45,
        "vectors": ["http", "dns_amp", "brute_force"],
    },
    {
        "query": "election OR referendum OR political crisis",
        "category": "geopolitical",
        "base_impact": 0.55,
        "vectors": ["ssh", "http", "dns_amp", "botnet_c2"],
    },
    {
        "query": "critical infrastructure attack OR power grid OR water system hack",
        "category": "vulnerability",
        "base_impact": 0.80,
        "vectors": ["ssh", "http", "dns_amp"],
    },
    {
        "query": "zero day exploit OR CVE critical OR patch emergency",
        "category": "vulnerability",
        "base_impact": 0.60,
        "vectors": ["http", "ssh", "rdp"],
    },
    {
        "query": "Black Friday OR Cyber Monday OR Prime Day OR Singles Day shopping",
        "category": "commerce",
        "base_impact": 0.50,
        "vectors": ["http", "brute_force"],
    },
]

# ─── RSS Feed Configuration ──────────────────────────────────────────────────

RSS_FEEDS = [
    {
        "url": "https://www.cisa.gov/cybersecurity-advisories/all.xml",
        "source": "rss:cisa",
        "category": "vulnerability",
        "base_impact": 0.55,
        "vectors": ["http", "ssh", "rdp"],
    },
    {
        "url": "https://feeds.feedburner.com/TheHackersNews",
        "source": "rss:hackernews",
        "category": "vulnerability",
        "base_impact": 0.40,
        "vectors": ["http", "ssh"],
    },
    {
        "url": "https://www.bleepingcomputer.com/feed/",
        "source": "rss:bleeping",
        "category": "vulnerability",
        "base_impact": 0.40,
        "vectors": ["http", "ssh", "ransomware"],
    },
    {
        "url": "https://therecord.media/feed",
        "source": "rss:therecord",
        "category": "vulnerability",
        "base_impact": 0.45,
        "vectors": ["http", "ssh", "ransomware"],
    },
    {
        "url": "https://feeds.reuters.com/reuters/worldNews",
        "source": "rss:reuters",
        "category": "geopolitical",
        "base_impact": 0.35,
        "vectors": ["ssh", "http"],
    },
]

# ─── Impact Classification Keywords ──────────────────────────────────────────

IMPACT_BOOSTERS = {
    # High-impact cyber keywords boost impact score
    "critical infrastructure": 0.25,
    "power grid": 0.25,
    "water system": 0.25,
    "scada": 0.20,
    "ics": 0.20,
    "wiper": 0.20,
    "ransomware": 0.15,
    "zero-day": 0.20,
    "0-day": 0.20,
    "nation-state": 0.15,
    "apt": 0.15,
    "critical vulnerability": 0.15,
    "emergency patch": 0.15,
    "data breach": 0.10,
    "ddos": 0.10,
    "botnet": 0.10,
    "war": 0.15,
    "military strike": 0.20,
    "sanctions": 0.10,
    "nuclear": 0.15,
    "iran": 0.10,
    "russia": 0.08,
    "china": 0.08,
    "north korea": 0.10,
}

VECTOR_KEYWORDS = {
    "ssh": ["ssh", "brute force", "credential", "password", "authentication"],
    "rdp": ["rdp", "remote desktop", "terminal services"],
    "http": ["web", "http", "phishing", "xss", "sql injection", "api"],
    "dns_amp": ["dns", "amplification", "ddos", "flood"],
    "ransomware": ["ransomware", "ransom", "encrypt", "extort", "lockbit", "cl0p"],
    "botnet_c2": ["botnet", "c2", "command and control", "zombie", "trojan"],
    "brute_force": ["brute force", "credential stuffing", "password spray"],
}

REGION_KEYWORDS = {
    "middle_east": ["iran", "iraq", "israel", "saudi", "uae", "yemen", "syria", "lebanon", "hormuz", "gulf"],
    "europe": ["europe", "eu", "nato", "uk", "germany", "france", "ukraine", "russia"],
    "asia": ["china", "taiwan", "japan", "korea", "india", "singapore", "asean"],
    "north_america": ["us", "usa", "united states", "canada", "mexico"],
    "global": ["global", "worldwide", "international"],
}


# ─── Event Classification ────────────────────────────────────────────────────

def _classify_impact(title: str, desc: str, base_impact: float) -> float:
    """Score event cyber impact based on keyword analysis."""
    text_lower = (title + " " + desc).lower()
    boost = 0.0
    for keyword, weight in IMPACT_BOOSTERS.items():
        if keyword in text_lower:
            boost += weight
    return min(1.0, base_impact + boost)


def _classify_vectors(title: str, desc: str, base_vectors: List[str]) -> List[str]:
    """Determine affected attack vectors from event content."""
    text_lower = (title + " " + desc).lower()
    vectors = set(base_vectors)
    for vec, keywords in VECTOR_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            vectors.add(vec)
    return list(vectors)


def _classify_region(title: str, desc: str) -> str:
    """Determine event region from content."""
    text_lower = (title + " " + desc).lower()
    best_region = "global"
    best_score = 0
    for region, keywords in REGION_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in text_lower)
        if score > best_score:
            best_score = score
            best_region = region
    return best_region


def _event_hash(title: str, source: str) -> str:
    """Generate dedup hash for an event."""
    normalized = re.sub(r'\s+', ' ', title.strip().lower())
    return hashlib.sha256(f"{source}:{normalized}".encode()).hexdigest()[:32]


# ─── GDELT Fetcher ────────────────────────────────────────────────────────────

async def _fetch_gdelt_events() -> List[Dict[str, Any]]:
    """Fetch recent events from GDELT DOC 2.0 API."""
    events = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        for qconfig in GDELT_QUERIES:
            try:
                # GDELT DOC 2.0 API — free, no auth
                params = {
                    "query": qconfig["query"],
                    "mode": "artlist",
                    "maxrecords": "10",
                    "format": "json",
                    "timespan": "48h",
                    "sort": "datedesc",
                }
                resp = await client.get(
                    "https://api.gdeltproject.org/api/v2/doc/doc",
                    params=params,
                )
                if resp.status_code != 200:
                    continue

                data = resp.json()
                articles = data.get("articles", [])

                for article in articles[:5]:  # Top 5 per query
                    title = article.get("title", "")
                    desc = article.get("seendate", "")
                    url = article.get("url", "")
                    domain = article.get("domain", "")

                    if not title:
                        continue

                    # Parse GDELT date format (YYYYMMDDTHHMMSSZ)
                    seen = article.get("seendate", "")
                    try:
                        event_date = datetime.strptime(seen, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
                    except (ValueError, TypeError):
                        event_date = datetime.now(timezone.utc)

                    impact = _classify_impact(title, desc, qconfig["base_impact"])
                    vectors = _classify_vectors(title, desc, qconfig["vectors"])
                    region = _classify_region(title, desc)

                    events.append({
                        "event_id": _event_hash(title, "gdelt"),
                        "name": title[:200],
                        "category": qconfig["category"],
                        "start": event_date,
                        "end": event_date + timedelta(days=3),  # Default 3-day window
                        "region": region,
                        "impact": impact,
                        "vectors": vectors,
                        "description": f"Source: {domain}. {title}",
                        "source": "gdelt",
                        "source_url": url,
                        "confidence": 0.65,
                    })

            except Exception as e:
                logger.warning(f"GDELT query failed ({qconfig['query'][:30]}...): {e}")
                continue

    return events


# ─── RSS Fetcher ──────────────────────────────────────────────────────────────

def _parse_rss_xml(xml_text: str) -> List[Dict[str, str]]:
    """Minimal RSS/Atom parser — extract title, link, description, pubDate."""
    items = []
    # Simple regex-based parser (avoids xml.etree for malformed feeds)
    item_pattern = re.compile(r'<item>(.*?)</item>', re.DOTALL)
    entry_pattern = re.compile(r'<entry>(.*?)</entry>', re.DOTALL)

    for match in list(item_pattern.finditer(xml_text)) + list(entry_pattern.finditer(xml_text)):
        block = match.group(1)
        title = re.search(r'<title[^>]*>(.*?)</title>', block, re.DOTALL)
        link = re.search(r'<link[^>]*(?:href="([^"]*)"[^>]*/?>|>(.*?)</link>)', block, re.DOTALL)
        desc = re.search(r'<description[^>]*>(.*?)</description>', block, re.DOTALL)
        summary = re.search(r'<summary[^>]*>(.*?)</summary>', block, re.DOTALL)
        pub = re.search(r'<pubDate[^>]*>(.*?)</pubDate>', block, re.DOTALL)
        updated = re.search(r'<updated[^>]*>(.*?)</updated>', block, re.DOTALL)

        item = {
            "title": (title.group(1).strip() if title else "").replace("<![CDATA[", "").replace("]]>", ""),
            "link": (link.group(1) or link.group(2) if link else "").strip(),
            "description": ((desc or summary).group(1).strip() if (desc or summary) else "").replace("<![CDATA[", "").replace("]]>", ""),
            "pubDate": ((pub or updated).group(1).strip() if (pub or updated) else ""),
        }
        if item["title"]:
            items.append(item)

    return items[:10]  # Max 10 per feed


def _parse_rss_date(date_str: str) -> datetime:
    """Parse various RSS date formats."""
    formats = [
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%d %H:%M:%S",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(date_str.strip(), fmt).replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
    return datetime.now(timezone.utc)


async def _fetch_rss_events() -> List[Dict[str, Any]]:
    """Fetch and classify events from curated RSS feeds."""
    events = []
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        for feed in RSS_FEEDS:
            try:
                resp = await client.get(feed["url"])
                if resp.status_code != 200:
                    continue

                items = _parse_rss_xml(resp.text)
                for item in items:
                    title = item["title"]
                    desc = item["description"][:500] if item["description"] else ""
                    pub_date = _parse_rss_date(item["pubDate"]) if item["pubDate"] else datetime.now(timezone.utc)

                    # Skip old items (>7 days)
                    if (datetime.now(timezone.utc) - pub_date).days > 7:
                        continue

                    impact = _classify_impact(title, desc, feed["base_impact"])
                    vectors = _classify_vectors(title, desc, feed["vectors"])
                    region = _classify_region(title, desc)

                    # Auto-classify category from content
                    category = feed["category"]
                    text_lower = (title + " " + desc).lower()
                    if any(kw in text_lower for kw in ["war", "military", "sanction", "election", "conflict"]):
                        category = "geopolitical"
                    elif any(kw in text_lower for kw in ["cve", "vulnerability", "patch", "exploit", "zero-day"]):
                        category = "vulnerability"
                    elif any(kw in text_lower for kw in ["ransomware", "breach", "attack"]):
                        category = "vulnerability"

                    events.append({
                        "event_id": _event_hash(title, feed["source"]),
                        "name": title[:200],
                        "category": category,
                        "start": pub_date,
                        "end": pub_date + timedelta(days=5),  # Default 5-day impact window
                        "region": region,
                        "impact": impact,
                        "vectors": vectors,
                        "description": desc[:500],
                        "source": feed["source"],
                        "source_url": item.get("link", ""),
                        "confidence": 0.55,
                    })

            except Exception as e:
                logger.warning(f"RSS feed failed ({feed['source']}): {e}")
                continue

    return events


# ─── Main Ingestion ───────────────────────────────────────────────────────────

async def run_event_feed_ingest(db: Session) -> Dict[str, Any]:
    """
    Main entry point: fetch GDELT + RSS events, classify, and store.
    Called by pipeline scheduler every 15 minutes.
    """
    result = {
        "status": "ok",
        "gdelt_fetched": 0,
        "rss_fetched": 0,
        "new_events": 0,
        "updated_events": 0,
        "errors": [],
    }

    try:
        # Ensure table exists
        LiveEvent.__table__.create(bind=db.get_bind(), checkfirst=True)

        # Fetch from both sources in parallel
        import asyncio
        gdelt_events, rss_events = await asyncio.gather(
            _fetch_gdelt_events(),
            _fetch_rss_events(),
            return_exceptions=True,
        )

        if isinstance(gdelt_events, Exception):
            result["errors"].append(f"GDELT: {gdelt_events}")
            gdelt_events = []
        if isinstance(rss_events, Exception):
            result["errors"].append(f"RSS: {rss_events}")
            rss_events = []

        result["gdelt_fetched"] = len(gdelt_events)
        result["rss_fetched"] = len(rss_events)

        all_events = gdelt_events + rss_events

        for ev in all_events:
            try:
                # Check for existing event (dedup)
                existing = db.execute(
                    text("SELECT id, impact FROM live_events WHERE event_id = :eid"),
                    {"eid": ev["event_id"]},
                ).fetchone()

                if existing:
                    # Update impact if higher (escalation)
                    if ev["impact"] > (existing.impact or 0):
                        db.execute(
                            text("UPDATE live_events SET impact = :impact, updated_at = :now WHERE id = :id"),
                            {"impact": ev["impact"], "now": datetime.now(timezone.utc), "id": existing.id},
                        )
                        result["updated_events"] += 1
                    continue

                # Insert new event
                db.execute(
                    text("""
                        INSERT INTO live_events
                            (event_id, name, category, start, "end", region, impact,
                             vectors, description, source, source_url, confidence,
                             is_active, created_at, updated_at)
                        VALUES
                            (:event_id, :name, :category, :start, :end, :region, :impact,
                             :vectors, :description, :source, :source_url, :confidence,
                             :is_active, :created_at, :updated_at)
                    """),
                    {
                        "event_id": ev["event_id"],
                        "name": ev["name"],
                        "category": ev["category"],
                        "start": ev["start"],
                        "end": ev["end"],
                        "region": ev["region"],
                        "impact": ev["impact"],
                        "vectors": json.dumps(ev["vectors"]),
                        "description": ev["description"],
                        "source": ev["source"],
                        "source_url": ev.get("source_url", ""),
                        "confidence": ev.get("confidence", 0.5),
                        "is_active": True,
                        "created_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    },
                )
                result["new_events"] += 1

            except Exception as e:
                logger.warning(f"Event insert failed: {e}")
                continue

        # Expire old events (>14 days past end date)
        cutoff = datetime.now(timezone.utc) - timedelta(days=14)
        db.execute(
            text('UPDATE live_events SET is_active = false WHERE "end" < :cutoff AND is_active = true'),
            {"cutoff": cutoff},
        )

        db.commit()
        logger.info(
            f"Event feed: {result['new_events']} new, {result['updated_events']} updated "
            f"({result['gdelt_fetched']} GDELT, {result['rss_fetched']} RSS)"
        )

    except Exception as e:
        result["status"] = "error"
        result["errors"].append(str(e))
        logger.error(f"Event feed ingest failed: {e}", exc_info=True)
        db.rollback()

    return result


def get_active_live_events(db: Session) -> List[Dict[str, Any]]:
    """
    Get all currently active live events for calendar overlay.
    Called by context engine API and _compute_event_mult().
    """
    try:
        LiveEvent.__table__.create(bind=db.get_bind(), checkfirst=True)
    except Exception:
        pass

    now = datetime.now(timezone.utc)
    rows = db.execute(
        text("""
            SELECT name, category, start, "end", region, impact, vectors,
                   description, source, source_url, confidence
            FROM live_events
            WHERE is_active = true AND start <= :now AND "end" >= :now
            ORDER BY impact DESC
            LIMIT 50
        """),
        {"now": now},
    ).fetchall()

    events = []
    for r in rows:
        try:
            vectors = json.loads(r.vectors) if r.vectors else []
        except (json.JSONDecodeError, TypeError):
            vectors = []

        events.append({
            "id": f"live_{_event_hash(r.name, r.source)}",
            "name": r.name,
            "category": r.category,
            "start": r.start.strftime("%Y-%m-%d") if r.start else "",
            "end": r.end.strftime("%Y-%m-%d") if r.end else "",
            "region": r.region or "global",
            "impact": r.impact or 0.3,
            "vectors": vectors,
            "description": r.description or "",
            "source": r.source or "live_feed",
            "source_url": r.source_url or "",
            "confidence": r.confidence or 0.5,
        })

    return events
