#!/usr/bin/env python3
"""
Database schema migration script
Recreates the database with the updated schema including bootstrap uncertainty columns
"""

import os
import sys
from pathlib import Path

# Add the app directory to Python path
sys.path.append(str(Path(__file__).parent / "app"))

from app.db import Base, engine
from app.models import GridCell, Nowcast, Forecast, Advisory, HawkesParam

def recreate_database():
    """Drop all tables and recreate with current schema"""
    print("🗄️  Recreating database with updated schema...")
    
    # Drop all tables
    Base.metadata.drop_all(bind=engine)
    print("   Dropped existing tables")
    
    # Create all tables with current schema
    Base.metadata.create_all(bind=engine)
    print("   Created tables with updated schema")
    
    print("✅ Database schema updated successfully!")
    print("   New columns added: mu_std, beta_std, n_br_std")
    print("   Note: All existing data has been cleared")

if __name__ == "__main__":
    recreate_database()