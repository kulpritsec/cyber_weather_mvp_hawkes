#!/usr/bin/env python3
"""
Cyber Weather MVP - Unified Startup Script
Handles database migration, data generation, model fitting, and server startup
"""
import os
import sys
import time
import subprocess
import argparse
import asyncio
from pathlib import Path

# Add the app directory to Python path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from app.db import engine, Base, SessionLocal
from app.forecast.nowcast import compute_nowcast
from app.services.hawkes_fit import run as fit_hawkes

def setup_database():
    """Initialize database schema"""
    print("🔧 Setting up database schema...")
    Base.metadata.create_all(bind=engine)
    print("✅ Database schema ready")

def build_nowcast():
    """Compute current threat nowcast"""
    print("🔮 Computing nowcast data...")
    compute_nowcast()
    print("✅ Nowcast data ready")

def fit_models(hours=24, min_events=50, bootstrap=True):
    """Fit Hawkes process models"""
    print(f"Fitting Hawkes models (min_events={min_events}, bootstrap={bootstrap})...")
    # bootstrap_samples is already configured via hawkes_fit.py (default=5)
    # and via core/config.py Settings.hawkes_bootstrap_samples
    fit_hawkes(hours=hours, min_events=min_events)
    print("Hawkes models fitted")

def ingest_threat_feeds():
    """Ingest real-time threat intelligence feeds via pipeline."""
    print("Ingesting threat intelligence feeds...")
    try:
        from app.services.pipeline import run_ingest_cycle
        count = asyncio.run(run_ingest_cycle())
        total = count.get("total_events", 0) if isinstance(count, dict) else 0
        print(f"Processed {total} threat events")
        return total
    except Exception as e:
        print(f"Error ingesting threat feeds: {e}")
        return 0

def start_server(port=8000, reload=True):
    """Start the FastAPI server"""
    print(f"🚀 Starting FastAPI server on port {port}...")
    
    # Set environment variables
    env = os.environ.copy()
    env["PYTHONPATH"] = str(backend_dir)
    
    cmd = [
        sys.executable, "-m", "uvicorn", 
        "app.main:app", 
        "--port", str(port),
        "--host", "0.0.0.0"
    ]
    if reload:
        cmd.append("--reload")
    
    try:
        subprocess.run(cmd, cwd=backend_dir, env=env)
    except KeyboardInterrupt:
        print("\n👋 Server shutdown")

def main():
    parser = argparse.ArgumentParser(description="Cyber Weather MVP Startup")
    parser.add_argument("--skip-feeds", action="store_true", help="Skip CTI feed ingestion")
    parser.add_argument("--skip-models", action="store_true", help="Skip model fitting")
    parser.add_argument("--hours", type=int, default=24, help="Hours of data for model fitting")
    parser.add_argument("--min-events", type=int, default=50, help="Minimum events for model fitting")
    parser.add_argument("--port", type=int, default=8000, help="Server port")
    parser.add_argument("--no-reload", action="store_true", help="Disable auto-reload")
    parser.add_argument("--no-bootstrap", action="store_true", help="Disable bootstrap uncertainty")

    args = parser.parse_args()

    print("🌐 Cyber Weather MVP - Starting Up (Production)")
    print("=" * 50)

    start_time = time.time()

    # Step 1: Database setup
    setup_database()

    # Step 2: Ingest real CTI feeds (DShield, Abuse.ch, CrowdSec, OTX, AbuseIPDB, Shodan, Ransomware.live)
    if not args.skip_feeds:
        ingest_threat_feeds()
        time.sleep(1)
        build_nowcast()
        time.sleep(1)

    # Step 3: Model fitting (optional)
    if not args.skip_models:
        fit_models(
            hours=args.hours,
            min_events=args.min_events,
            bootstrap=not args.no_bootstrap
        )
    
    elapsed = time.time() - start_time
    print(f"⚡ Initialization complete in {elapsed:.1f}s")
    print("=" * 50)
    
    # Step 5: Start server
    start_server(port=args.port, reload=not args.no_reload)

if __name__ == "__main__":
    main()