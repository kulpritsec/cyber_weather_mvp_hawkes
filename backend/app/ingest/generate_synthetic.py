import argparse, random
from datetime import timedelta
from ..db import engine, SessionLocal, Base
from ..models import Event
from ..utils.time import utcnow

VECTORS = ["ssh", "rdp", "http", "dns_amp", "botnet_c2", "ransomware"]

def seed_synthetic(hours=24, rate=1200, seed=42):
    random.seed(seed)
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    now = utcnow()
    start = now - timedelta(hours=hours)

    hotspots = {
        "ssh": [
            (40.71, -74.01, 3, 25),   # New York
            (35, 105, 10, 20),          # China
            (52, 13, 6, 15),            # Berlin
            (51.51, -0.13, 4, 18),      # London
            (55.76, 37.62, 5, 16),      # Moscow
        ],
        "rdp": [
            (40.71, -74.01, 3, 20),   # New York
            (55, 37, 7, 12),            # Moscow region
            (23, 113, 6, 10),           # Shenzhen/Guangzhou
            (34, -118, 5, 8),           # Los Angeles
            (50.11, 8.68, 4, 10),       # Frankfurt
        ],
        "http": [
            (40.71, -74.01, 3, 22),   # New York
            (1, 104, 12, 30),           # Singapore
            (51.5, -0.1, 5, 20),        # London
            (35.7, 139.7, 5, 18),       # Tokyo
            (37.77, -122.42, 3, 15),    # San Francisco
        ],
        "dns_amp": [
            (40.71, -74.01, 3, 12),   # New York
            (48, 2, 8, 10),             # Paris
            (28, 77, 7, 8),             # Delhi
            (52.37, 4.90, 4, 10),       # Amsterdam
        ],
        "botnet_c2": [
            (40.71, -74.01, 3, 15),   # New York
            (39.90, 116.40, 5, 20),     # Beijing
            (55.76, 37.62, 5, 14),      # Moscow
            (-23.55, -46.63, 5, 10),    # São Paulo
        ],
        "ransomware": [
            (40.71, -74.01, 3, 18),   # New York
            (51.51, -0.13, 4, 15),      # London
            (50.11, 8.68, 4, 12),       # Frankfurt
            (38.91, -77.04, 3, 14),     # Washington DC
        ],
    }

    def hotspot(center_lat, center_lon, spread, base_rate):
        lat = random.gauss(center_lat, spread)
        lon = random.gauss(center_lon, spread * 1.5)
        cnt = max(1, int(random.expovariate(1.0/base_rate)))
        return lat, lon, cnt

    t = start
    batch = []
    while t < now:
        # generate ~rate/hour events over 5-min bins
        for _ in range(int(rate/12)):
            v = random.choice(VECTORS)
            if random.random() < 0.7 and v in hotspots:
                hl = random.choice(hotspots[v])
                lat, lon, cnt = hotspot(*hl)
            else:
                lat = random.uniform(-70, 70)
                lon = random.uniform(-180, 180)
                cnt = max(1, int(random.expovariate(1/5)))
            batch.append(Event(ts=t, lat=lat, lon=lon, vector=v, count=cnt))
        t += timedelta(minutes=5)

    session.bulk_save_objects(batch)
    session.commit()
    session.close()
    print(f"Inserted {len(batch)} synthetic events.")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--rate", type=int, default=1200)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    seed_synthetic(args.hours, args.rate, args.seed)
