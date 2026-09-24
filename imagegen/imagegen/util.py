"""Small shared helpers: env, logging, time math, HTTP retry-after parsing."""
from __future__ import annotations

import email.utils
import logging
import os
import sys
from datetime import datetime, timedelta, timezone

log = logging.getLogger("imagegen")

VARIANTS = ("hero", "flatlay", "detail")


def setup_logging(verbose: bool = False) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


def env(name: str, default: str | None = None) -> str | None:
    """Read an env var; empty strings count as missing (GitHub passes '' for unset secrets)."""
    val = os.environ.get(name, "")
    return val.strip() if val.strip() else default


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_ts() -> float:
    return now_utc().timestamp()


def next_utc_midnight(ts: float | None = None) -> float:
    base = datetime.fromtimestamp(ts if ts is not None else now_ts(), timezone.utc)
    nxt = (base + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return nxt.timestamp()


def _us_pacific_offset_hours(dt_utc: datetime) -> int:
    """-7 during US DST (2nd Sun Mar 10:00 UTC .. 1st Sun Nov 09:00 UTC), else -8. No tzdata needed."""
    y = dt_utc.year

    def nth_sunday(month: int, n: int) -> datetime:
        d = datetime(y, month, 1, tzinfo=timezone.utc)
        first = d + timedelta(days=(6 - d.weekday()) % 7)
        return first + timedelta(weeks=n - 1)

    dst_start = nth_sunday(3, 2) + timedelta(hours=10)
    dst_end = nth_sunday(11, 1) + timedelta(hours=9)
    return -7 if dst_start <= dt_utc < dst_end else -8


def next_pacific_midnight(ts: float | None = None) -> float:
    """Gemini API free-tier daily quotas reset at midnight US Pacific time."""
    base = datetime.fromtimestamp(ts if ts is not None else now_ts(), timezone.utc)
    off = timedelta(hours=_us_pacific_offset_hours(base))
    local = base + off
    nxt_local = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    nxt = nxt_local - off
    # re-evaluate offset at the target instant (DST switch days)
    off2 = timedelta(hours=_us_pacific_offset_hours(nxt))
    return (nxt_local - off2).timestamp()


def parse_retry_after(value: str | None) -> float | None:
    """Retry-After header -> seconds from now (supports delta-seconds and HTTP-date)."""
    if not value:
        return None
    value = value.strip()
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        dt = email.utils.parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0.0, dt.timestamp() - now_ts())
    except (TypeError, ValueError):
        return None


def compact_ts() -> str:
    return now_utc().strftime("%Y%m%dT%H%M%SZ")
