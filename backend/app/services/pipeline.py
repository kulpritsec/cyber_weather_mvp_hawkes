"""
Pipeline Orchestrator - Automated CTI Feed Ingestion & Hawkes Fitting
Coordinates the full data pipeline: ingest → fit → nowcast → forecast → advisory

Uses APScheduler for automated execution cycles:
- Ingest cycle: every 15 minutes (configurable)
- Fitting cycle: every 60 minutes (configurable)
- Advisory cycle: every 60 minutes (after fitting)
"""

import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List
from uuid import uuid4

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.events import EVENT_JOB_EXECUTED, EVENT_JOB_ERROR

from sqlalchemy.orm import Session
from sqlalchemy import func

from ..db import SessionLocal
from ..core.config import get_settings
from ..models import Event, HawkesParam, Advisory, ForecastSnapshot, VectorConfig
from ..ingest import dshield, greynoise, abusech
from ..ingest import otx
from ..ingest import abuseipdb
from ..ingest.shodan_exposure import run_shodan_ingest
from ..ingest.crowdsec import run_crowdsec_ingest
from ..ingest.ransomware_live import run_ransomware_ingest
from ..ingest.event_feed import run_event_feed_ingest

logger = logging.getLogger(__name__)

# Pipeline state tracking
_pipeline_state: Dict[str, Any] = {
    "last_ingest_run": None,
    "last_ingest_events": 0,
    "last_ingest_errors": [],
    "last_fitting_run": None,
    "last_fitting_cells": 0,
    "last_fitting_errors": [],
    "last_advisory_run": None,
    "last_advisory_count": 0,
    "scheduler_running": False,
    "total_ingest_runs": 0,
    "total_fitting_runs": 0,
    "total_advisory_runs": 0,
}

# Global scheduler instance
_scheduler: BackgroundScheduler = None


async def run_ingest_cycle() -> Dict[str, Any]:
    """
    Execute full CTI feed ingest cycle
    Calls all feed modules in parallel: DShield, GreyNoise, Abuse.ch

    Returns:
        Dict with ingest statistics
    """
    logger.info("=" * 60)
    logger.info("STARTING INGEST CYCLE")
    logger.info("=" * 60)

    start_time = datetime.now(timezone.utc)
    session = SessionLocal()
    results = {
        "timestamp": start_time.isoformat(),
        "feeds": {},
        "total_events": 0,
        "errors": [],
    }

    try:
        # Run all feeds concurrently
        tasks = [
            ("dshield", dshield.ingest(session, hours_back=1)),
            ("abusech", abusech.ingest(session, hours_back=1)),
        ]

        # Add GreyNoise if API key is configured
        settings = get_settings()
        if settings.greynoise_api_key:
            tasks.append(("greynoise", greynoise.ingest(session, hours_back=1)))
        else:
            logger.info("GreyNoise API key not configured, skipping")

        # Add OTX if API key is configured
        if getattr(settings, "otx_api_key", "") and settings.otx_api_key:
            tasks.append(("otx", otx.ingest(session, hours_back=24)))
        else:
            logger.info("OTX API key not configured, skipping")

        # Add AbuseIPDB if API key is configured
        if getattr(settings, "abuseipdb_api_key", "") and settings.abuseipdb_api_key:
            tasks.append(("abuseipdb", abuseipdb.ingest(session, hours_back=24)))
        else:
            logger.info("AbuseIPDB API key not configured, skipping")

        # Shodan exposure intelligence
        try:
            shodan_result = await run_shodan_ingest(session)
            results["feeds"]["shodan"] = shodan_result
        except Exception as e:
            logger.error(f"Shodan ingest failed: {e}")
            results["feeds"]["shodan"] = {"status": "error", "error": str(e)}

        # CrowdSec community blocklist (free, no API key needed)
        try:
            crowdsec_result = await run_crowdsec_ingest(session)
            results["feeds"]["crowdsec"] = crowdsec_result
            results["total_events"] += crowdsec_result.get("new", 0)
            logger.info(f"✓ crowdsec: {crowdsec_result.get('new', 0)} new events")
        except Exception as e:
            logger.error(f"CrowdSec ingest failed: {e}")
            results["feeds"]["crowdsec"] = {"status": "error", "error": str(e)}

        # Ransomware.live (free, no API key needed)
        try:
            ransomware_result = await run_ransomware_ingest(session)
            results["feeds"]["ransomware_live"] = ransomware_result
            results["total_events"] += ransomware_result.get("victims", 0)
            logger.info(f"✓ ransomware_live: {ransomware_result.get('victims', 0)} victims ingested")
        except Exception as e:
            logger.error(f"Ransomware.live ingest failed: {e}")
            results["feeds"]["ransomware_live"] = {"status": "error", "error": str(e)}

        # GDELT + RSS event feed (live calendar events for pressure/forecast covariates)
        try:
            event_feed_result = await run_event_feed_ingest(session)
            results["feeds"]["event_feed"] = event_feed_result
            logger.info(f"✓ event_feed: {event_feed_result.get('new_events', 0)} new events")
        except Exception as e:
            logger.error(f"Event feed ingest failed: {e}")
            results["feeds"]["event_feed"] = {"status": "error", "error": str(e)}

        # Execute all feeds in parallel
        feed_results = await asyncio.gather(*[task for _, task in tasks], return_exceptions=True)

        # Process results
        for i, (feed_name, _) in enumerate(tasks):
            result = feed_results[i]
            if isinstance(result, Exception):
                error_msg = f"{feed_name} failed: {str(result)}"
                logger.error(error_msg)
                results["errors"].append(error_msg)
                results["feeds"][feed_name] = {"status": "error", "events": 0, "error": str(result)}
            else:
                event_count = result if isinstance(result, int) else 0
                results["feeds"][feed_name] = {"status": "success", "events": event_count}
                results["total_events"] += event_count
                logger.info(f"✓ {feed_name}: {event_count} events inserted")

    except Exception as e:
        error_msg = f"Ingest cycle failed: {str(e)}"
        logger.error(error_msg, exc_info=True)
        results["errors"].append(error_msg)
    finally:
        session.close()

    # Update global state
    _pipeline_state["last_ingest_run"] = start_time
    _pipeline_state["last_ingest_events"] = results["total_events"]
    _pipeline_state["last_ingest_errors"] = results["errors"]
    _pipeline_state["total_ingest_runs"] += 1

    duration = (datetime.now(timezone.utc) - start_time).total_seconds()
    logger.info(f"INGEST CYCLE COMPLETE: {results['total_events']} events in {duration:.1f}s")
    logger.info("=" * 60)

    return results


async def run_fitting_cycle() -> Dict[str, Any]:
    """
    Execute Hawkes model fitting cycle
    Fits parameters for all (grid_cell, vector) pairs with sufficient events
    Updates HawkesParam, Nowcast, Forecast, and ForecastSnapshot tables

    Returns:
        Dict with fitting statistics
    """
    logger.info("=" * 60)
    logger.info("STARTING FITTING CYCLE")
    logger.info("=" * 60)

    start_time = datetime.now(timezone.utc)
    session = SessionLocal()
    results = {
        "timestamp": start_time.isoformat(),
        "run_id": str(uuid4()),
        "cells_fitted": 0,
        "vectors_processed": [],
        "errors": [],
    }

    try:
        # Read active vectors from VectorConfig table; fall back to seed list
        vc_rows = session.query(VectorConfig).filter(VectorConfig.is_active == True).order_by(VectorConfig.sort_order).all()
        vectors = [r.name for r in vc_rows] if vc_rows else ["ssh", "rdp", "http", "dns_amp", "brute_force", "botnet_c2", "ransomware"]
        results["vectors_processed"] = vectors

        # Import Hawkes fitting service
        from . import hawkes_fit

        # Run fitting for each vector
        for vector_name in vectors:
            logger.info(f"Fitting Hawkes model for vector: {vector_name}")

            try:
                # Run Hawkes fit (this updates HawkesParam table)
                fit_results = hawkes_fit.fit_vector(session, vector_name)
                results["cells_fitted"] += fit_results.get("cells_fitted", 0)
                logger.info(f"✓ {vector_name}: {fit_results.get('cells_fitted', 0)} cells fitted")

            except Exception as e:
                error_msg = f"Fitting failed for {vector_name}: {str(e)}"
                logger.error(error_msg, exc_info=True)
                results["errors"].append(error_msg)

        # After fitting, recompute nowcast
        from .aggregator import recompute_all_nowcasts
        logger.info("Recomputing nowcasts...")
        recompute_all_nowcasts(session)

        # Write ForecastSnapshot rows for temporal replay
        # Write ForecastSnapshot rows with covariate multipliers applied
        snap_at = datetime.now(timezone.utc)
        snap_count = 0
        current_month_idx = snap_at.month - 1  # 0-indexed for seasonal
        current_month_1 = snap_at.month
        date_str = snap_at.strftime("%Y-%m-%d")

        # Import covariate helpers from unified router
        try:
            from ..routers.unified import (
                _compute_seasonal, _compute_event_mult, _compute_campaign_mult
            )
            covariates_available = True
        except ImportError:
            covariates_available = False

        params_all = session.query(HawkesParam).all()
        for p in params_all:
            if p.mu and p.mu > 0:
                s_t = _compute_seasonal(p.vector, current_month_idx) if covariates_available else 1.0
                e_t = _compute_event_mult(p.vector, date_str) if covariates_available else 1.0
                c_t = _compute_campaign_mult(p.vector, current_month_1) if covariates_available else 1.0
                mu_t = p.mu * s_t * e_t * c_t

                snap = ForecastSnapshot(
                    run_id=results["run_id"],
                    grid_id=p.grid_id,
                    vector=p.vector,
                    horizon_h=0,
                    mu_base=p.mu,
                    s_t=s_t,
                    event_mult=e_t,
                    campaign_mult=c_t,
                    mu_t=mu_t,
                    snapshot_at=snap_at,
                )
                session.add(snap)
                snap_count += 1
        logger.info(f"✓ Wrote {snap_count} ForecastSnapshot rows (run_id={results['run_id'][:8]}…)")

        session.commit()

    except Exception as e:
        error_msg = f"Fitting cycle failed: {str(e)}"
        logger.error(error_msg, exc_info=True)
        results["errors"].append(error_msg)
        session.rollback()
    finally:
        session.close()

    # Update global state
    _pipeline_state["last_fitting_run"] = start_time
    _pipeline_state["last_fitting_cells"] = results["cells_fitted"]
    _pipeline_state["last_fitting_errors"] = results["errors"]
    _pipeline_state["total_fitting_runs"] += 1

    duration = (datetime.now(timezone.utc) - start_time).total_seconds()
    logger.info(f"FITTING CYCLE COMPLETE: {results['cells_fitted']} cells in {duration:.1f}s")
    logger.info("=" * 60)

    return results


async def run_advisory_cycle() -> Dict[str, Any]:
    """
    Generate threat advisories based on Hawkes parameters
    Scans for cells with high branching ratios (n̂ > 0.5) or rapid increases

    Advisory severity mapping (weather metaphor):
    - n̂ >= 0.9: EMERGENCY (Level 5) - "Category 5 cyber hurricane"
    - n̂ >= 0.7: WARNING (Level 4) - "Severe storm warning"
    - n̂ >= 0.5: WATCH (Level 3) - "Storm system developing"
    - n̂ >= 0.3: ADVISORY (Level 2) - "Isolated showers"
    - n̂ < 0.3: CLEAR (Level 1) - "Clear skies"

    Returns:
        Dict with advisory generation statistics
    """
    logger.info("=" * 60)
    logger.info("STARTING ADVISORY CYCLE")
    logger.info("=" * 60)

    start_time = datetime.now(timezone.utc)
    session = SessionLocal()
    results = {
        "timestamp": start_time.isoformat(),
        "advisories_created": 0,
        "advisories_expired": 0,
        "errors": [],
    }

    try:
        # Expire old advisories (>24 hours)
        expiry_time = datetime.now(timezone.utc) - timedelta(hours=24)
        expired = session.query(Advisory).filter(
            Advisory.expires_at < datetime.now(timezone.utc)
        ).delete()
        results["advisories_expired"] = expired
        logger.info(f"Expired {expired} old advisories")

        # Find cells with concerning branching ratios
        high_risk_params = session.query(HawkesParam).filter(
            HawkesParam.n_br >= 0.5  # Watch level and above
        ).all()

        logger.info(f"Found {len(high_risk_params)} cells with n̂ >= 0.5")

        for param in high_risk_params:
            # Determine severity level
            n_br = param.n_br
            if n_br >= 0.9:
                severity = 5
                title = f"EMERGENCY: Critical instability detected - {param.vector.upper()}"
                body = (
                    f"Category 5 cyber hurricane conditions. "
                    f"Branching ratio n̂={n_br:.3f} indicates imminent cascade. "
                    f"Immediate defensive posture recommended."
                )
            elif n_br >= 0.7:
                severity = 4
                title = f"WARNING: Severe storm system - {param.vector.upper()}"
                body = (
                    f"Severe storm warning. Near-critical branching ratio n̂={n_br:.3f}. "
                    f"Cascading events likely. Elevated defensive measures advised."
                )
            elif n_br >= 0.5:
                severity = 3
                title = f"WATCH: Storm system developing - {param.vector.upper()}"
                body = (
                    f"Significant threat clustering detected. Branching ratio n̂={n_br:.3f}. "
                    f"Monitor for escalation. Consider preventive measures."
                )
            else:
                continue  # Skip advisory creation for lower levels

            # Check if advisory already exists for this cell/vector
            existing = session.query(Advisory).filter(
                Advisory.grid_id == param.grid_id,
                Advisory.vector == param.vector,
                Advisory.severity == severity,
                Advisory.expires_at > datetime.now(timezone.utc)
            ).first()

            if existing:
                logger.debug(f"Advisory already exists for grid {param.grid_id}, {param.vector}")
                continue

            # Create new advisory
            advisory = Advisory(
                vector=param.vector,
                severity=severity,
                title=title,
                body=body,
                grid_id=param.grid_id,
                issued_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
            )
            session.add(advisory)
            results["advisories_created"] += 1

        session.commit()
        logger.info(f"✓ Created {results['advisories_created']} new advisories")

    except Exception as e:
        error_msg = f"Advisory cycle failed: {str(e)}"
        logger.error(error_msg, exc_info=True)
        results["errors"].append(error_msg)
        session.rollback()
    finally:
        session.close()

    # Update global state
    _pipeline_state["last_advisory_run"] = start_time
    _pipeline_state["last_advisory_count"] = results["advisories_created"]
    _pipeline_state["total_advisory_runs"] += 1

    duration = (datetime.now(timezone.utc) - start_time).total_seconds()
    logger.info(f"ADVISORY CYCLE COMPLETE: {results['advisories_created']} advisories in {duration:.1f}s")
    logger.info("=" * 60)

    return results


def _run_cycle_sync(cycle_func, cycle_name: str):
    """Wrapper to run async cycle functions synchronously in scheduler"""
    try:
        logger.info(f"Scheduler triggered: {cycle_name}")
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(cycle_func())
        loop.close()
        return result
    except Exception as e:
        logger.error(f"Scheduler job {cycle_name} failed: {e}", exc_info=True)
        raise


def start_scheduler():
    """
    Start the APScheduler background scheduler
    Schedules ingest, fitting, and advisory cycles at configured intervals
    """
    global _scheduler

    if _scheduler and _scheduler.running:
        logger.warning("Scheduler already running")
        return

    settings = get_settings()

    logger.info("=" * 60)
    logger.info("INITIALIZING PIPELINE SCHEDULER")
    logger.info("=" * 60)
    logger.info(f"Ingest interval: {settings.ingest_interval_min} minutes")
    logger.info(f"Fitting interval: {settings.fit_interval_min} minutes")
    logger.info("=" * 60)

    # Create scheduler
    _scheduler = BackgroundScheduler(timezone="UTC")

    # Schedule ingest cycle (every N minutes)
    _scheduler.add_job(
        func=lambda: _run_cycle_sync(run_ingest_cycle, "ingest_cycle"),
        trigger=IntervalTrigger(minutes=settings.ingest_interval_min),
        id="ingest_cycle",
        name="CTI Feed Ingest Cycle",
        replace_existing=True,
        next_run_time=datetime.now(),
    )

    # Schedule fitting cycle (every N minutes)
    _scheduler.add_job(
        func=lambda: _run_cycle_sync(run_fitting_cycle, "fitting_cycle"),
        trigger=IntervalTrigger(minutes=settings.fit_interval_min),
        id="fitting_cycle",
        name="Hawkes Fitting Cycle",
        replace_existing=True,
        next_run_time=datetime.now(),
    )

    # Schedule advisory cycle (every N minutes, offset by 5 min after fitting)
    _scheduler.add_job(
        func=lambda: _run_cycle_sync(run_advisory_cycle, "advisory_cycle"),
        trigger=IntervalTrigger(minutes=settings.fit_interval_min),
        id="advisory_cycle",
        name="Advisory Generation Cycle",
        replace_existing=True,
        next_run_time=datetime.now(),
    )

    # Add event listeners
    def job_listener(event):
        if event.exception:
            logger.error(f"Job {event.job_id} crashed: {event.exception}")
        else:
            logger.info(f"Job {event.job_id} completed successfully")

    _scheduler.add_listener(job_listener, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)

    # Start scheduler
    _scheduler.start()
    _pipeline_state["scheduler_running"] = True

    logger.info("✓ Pipeline scheduler started successfully")
    logger.info("=" * 60)


def stop_scheduler():
    """Stop the APScheduler background scheduler"""
    global _scheduler

    if _scheduler and _scheduler.running:
        logger.info("Stopping pipeline scheduler...")
        _scheduler.shutdown(wait=True)
        _pipeline_state["scheduler_running"] = False
        logger.info("✓ Pipeline scheduler stopped")
    else:
        logger.warning("Scheduler not running")


def get_pipeline_status() -> Dict[str, Any]:
    """
    Get current pipeline status for health check endpoint

    Returns:
        Dict with scheduler status and last run timestamps
    """
    status = {
        "scheduler_running": _pipeline_state["scheduler_running"],
        "ingest": {
            "last_run": _pipeline_state["last_ingest_run"].isoformat() if _pipeline_state["last_ingest_run"] else None,
            "last_events": _pipeline_state["last_ingest_events"],
            "last_errors": _pipeline_state["last_ingest_errors"],
            "total_runs": _pipeline_state["total_ingest_runs"],
        },
        "fitting": {
            "last_run": _pipeline_state["last_fitting_run"].isoformat() if _pipeline_state["last_fitting_run"] else None,
            "last_cells_fitted": _pipeline_state["last_fitting_cells"],
            "last_errors": _pipeline_state["last_fitting_errors"],
            "total_runs": _pipeline_state["total_fitting_runs"],
        },
        "advisory": {
            "last_run": _pipeline_state["last_advisory_run"].isoformat() if _pipeline_state["last_advisory_run"] else None,
            "last_count": _pipeline_state["last_advisory_count"],
            "total_runs": _pipeline_state["total_advisory_runs"],
        },
    }

    # Add staleness warnings
    now = datetime.now(timezone.utc)
    if _pipeline_state["last_ingest_run"]:
        minutes_since = (now - _pipeline_state["last_ingest_run"]).total_seconds() / 60
        status["ingest"]["minutes_since_last_run"] = int(minutes_since)
        status["ingest"]["is_stale"] = minutes_since > 30  # Stale if >30 min

    if _pipeline_state["last_fitting_run"]:
        minutes_since = (now - _pipeline_state["last_fitting_run"]).total_seconds() / 60
        status["fitting"]["minutes_since_last_run"] = int(minutes_since)
        status["fitting"]["is_stale"] = minutes_since > 90  # Stale if >90 min

    return status
