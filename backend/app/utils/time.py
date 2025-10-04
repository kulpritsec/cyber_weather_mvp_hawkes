from datetime import datetime, timezone, timedelta

def utcnow():
    return datetime.now(timezone.utc)

def round_down(dt, minutes: int):
    delta = timedelta(minutes=minutes)
    return dt - (dt - datetime.min.replace(tzinfo=timezone.utc)) % delta
