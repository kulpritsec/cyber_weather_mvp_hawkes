import argparse, random
from datetime import timedelta
from ..db import engine, SessionLocal, Base
from ..models import Event
from ..utils.time import utcnow

VECTORS = ["ssh", "rdp", "http", "dns_amp"]

def seed_synthetic(hours=24, rate=1200, seed=42):
    random.seed(seed)
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    now = utcnow()
    start = now - timedelta(hours=hours)

    hotspots = {
        "ssh": [(35, 105, 10, 20), (52, 13, 6, 15), (40, -74, 5, 10)],
        "rdp": [(55, 37, 7, 12), (23, 113, 6, 10), (34, -118, 5, 8)],
        "http": [(1, 104, 12, 30), (51.5, -0.1, 5, 20), (35.7, 139.7, 5, 18)],
        "dns_amp": [(48, 2, 8, 10), (28, 77, 7, 8)]
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
