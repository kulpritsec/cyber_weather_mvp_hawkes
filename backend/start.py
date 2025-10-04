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
from app.ingest.generate_synthetic import seed_synthetic
from app.forecast.nowcast import compute_nowcast
from app.services.hawkes_fit import run as fit_hawkes

def setup_database():
    """Initialize database schema"""
    print("🔧 Setting up database schema...")
    Base.metadata.create_all(bind=engine)
    print("✅ Database schema ready")

def generate_data(hours=24, rate=1200, seed=42):
    """Generate synthetic cyber threat data"""
    print(f"📊 Generating {hours}h of synthetic data (rate={rate}/hr)...")
    seed_synthetic(hours=hours, rate=rate, seed=seed)
    print("✅ Synthetic data generated")

def build_nowcast():
    """Compute current threat nowcast"""
    print("🔮 Computing nowcast data...")
    compute_nowcast()
    print("✅ Nowcast data ready")

def fit_models(hours=24, min_events=50, bootstrap=True):
    """Fit Hawkes process models"""
    print(f"🧠 Fitting Hawkes models (min_events={min_events}, bootstrap={bootstrap})...")
    if bootstrap:
        # Temporarily modify the hawkes_fit to use bootstrap
        original_file = backend_dir / "app" / "services" / "hawkes_fit.py"
        with open(original_file, 'r') as f:
            content = f.read()
        if "bootstrap_samples=20" not in content:
            content = content.replace(
                "params = fit_hawkes_exponential(times, counts, T)",
                "params = fit_hawkes_exponential(times, counts, T, bootstrap_samples=20)"
            )
            with open(original_file, 'w') as f:
                f.write(content)
    
    fit_hawkes(hours=hours, min_events=min_events)
    print("✅ Hawkes models fitted")

def ingest_threat_feeds():
    """Ingest real-time threat intelligence feeds"""
    print("🛡️ Ingesting threat intelligence feeds...")
    try:
        from app.services.threat_feeds import ingest_threat_feeds
        count = asyncio.run(ingest_threat_feeds())
        print(f"✅ Processed {count} threat indicators")
        return count
    except ImportError as e:
        print(f"⚠️ Threat feeds disabled: {e}")
        return 0
    except Exception as e:
        print(f"❌ Error ingesting threat feeds: {e}")
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
    parser.add_argument("--skip-data", action="store_true", help="Skip data generation")
    parser.add_argument("--skip-models", action="store_true", help="Skip model fitting")
    parser.add_argument("--threat-feeds", action="store_true", help="Ingest real threat intelligence feeds")
    parser.add_argument("--hours", type=int, default=24, help="Hours of data to generate")
    parser.add_argument("--rate", type=int, default=1200, help="Events per hour")
    parser.add_argument("--min-events", type=int, default=50, help="Minimum events for model fitting")
    parser.add_argument("--port", type=int, default=8000, help="Server port")
    parser.add_argument("--no-reload", action="store_true", help="Disable auto-reload")
    parser.add_argument("--no-bootstrap", action="store_true", help="Disable bootstrap uncertainty")
    
    args = parser.parse_args()
    
    print("🌐 Cyber Weather MVP - Starting Up")
    print("=" * 50)
    
    start_time = time.time()
    
    # Step 1: Database setup
    setup_database()
    
    # Step 2: Data generation (optional)
    if not args.skip_data:
        generate_data(hours=args.hours, rate=args.rate)
        time.sleep(1)  # Brief pause for database commit
        
        # Step 3: Nowcast computation
        build_nowcast()
        time.sleep(1)
    
    # Step 3.5: Threat feeds ingestion (optional)
    if args.threat_feeds:
        ingest_threat_feeds()
        time.sleep(1)
        # Recompute nowcast with new threat data
        build_nowcast()
        time.sleep(1)
    
    # Step 4: Model fitting (optional)
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