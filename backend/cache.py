import os
from datetime import datetime, timedelta


def stale_hours():
    return float(os.environ.get("CACHE_STALE_HOURS", 24))


def is_stale(last_fetched):
    """A timestamp is stale if it's missing, or older than the configured window."""
    if last_fetched is None:
        return True
    return datetime.utcnow() - last_fetched > timedelta(hours=stale_hours())


def now():
    return datetime.utcnow()
