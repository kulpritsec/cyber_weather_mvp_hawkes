import argparse
from ..forecast.nowcast import compute_nowcast
def recalc():
    compute_nowcast()

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--recalc", action="store_true")
    args = ap.parse_args()
    if args.recalc: recalc()
