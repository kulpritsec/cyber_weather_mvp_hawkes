#!/usr/bin/env python3
"""
Database migration script for threat intelligence support
Adds source and metadata fields to the events table
"""

import sys
from pathlib import Path

# Add the app directory to Python path
sys.path.append(str(Path(__file__).parent / "app"))

from app.db import engine, Base
from app.models import Event
import sqlalchemy as sa

def migrate_events_table():
    """Add new columns to events table for threat intelligence"""
    print("🔄 Migrating events table for threat intelligence support...")
    
    with engine.connect() as conn:
        # Check if columns already exist
        inspector = sa.inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('events')]
        
        # Add source column if it doesn't exist
        if 'source' not in columns:
            print("   Adding 'source' column...")
            conn.execute(sa.text('ALTER TABLE events ADD COLUMN source VARCHAR DEFAULT "synthetic"'))
            conn.execute(sa.text('CREATE INDEX ix_events_source ON events (source)'))
        
        # Add threat_metadata column if it doesn't exist
        if 'threat_metadata' not in columns:
            print("   Adding 'threat_metadata' column...")
            conn.execute(sa.text('ALTER TABLE events ADD COLUMN threat_metadata TEXT'))
        
        conn.commit()
    
    print("✅ Events table migration complete!")

def recreate_database():
    """Drop and recreate all tables with current schema"""
    print("🗄️  Recreating database with threat intelligence schema...")
    
    # Drop all tables
    Base.metadata.drop_all(bind=engine)
    print("   Dropped existing tables")
    
    # Create all tables with current schema
    Base.metadata.create_all(bind=engine)
    print("   Created tables with updated schema")
    
    print("✅ Database recreated successfully!")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Database migration for threat intelligence")
    parser.add_argument("--recreate", action="store_true", help="Recreate entire database (loses data)")
    
    args = parser.parse_args()
    
    if args.recreate:
        recreate_database()
    else:
        migrate_events_table()