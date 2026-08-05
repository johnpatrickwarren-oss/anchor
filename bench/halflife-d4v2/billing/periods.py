"""Billing periods and period bucketing.

A Period is a closed date interval with a display label. The report
runs one quarter at a time; items dated outside the period are simply
not billed in this run (they belong to another invoice).
"""

from dataclasses import dataclass
from datetime import date as Date, timedelta

_QUARTER_START_MONTH = {1: 1, 2: 4, 3: 7, 4: 10}


@dataclass(frozen=True)
class Period:
    """A closed billing interval: start and end are both billable days."""

    label: str
    start: Date
    end: Date

    def __post_init__(self):
        if self.end < self.start:
            raise ValueError(f"period {self.label}: end before start")

    def contains(self, day):
        """True when *day* falls inside the period, inclusive."""
        return self.start <= day <= self.end

    @property
    def days(self):
        """Number of billable days in the period."""
        return (self.end - self.start).days + 1


def quarter(year, q):
    """Build the Period for calendar quarter *q* of *year*."""
    if q not in _QUARTER_START_MONTH:
        raise ValueError(f"quarter must be 1-4, got {q}")
    start = Date(year, _QUARTER_START_MONTH[q], 1)
    if q == 4:
        next_start = Date(year + 1, 1, 1)
    else:
        next_start = Date(year, _QUARTER_START_MONTH[q + 1], 1)
    end = next_start - timedelta(days=1)
    return Period(label=f"{year} Q{q}", start=start, end=end)


def month(year, m):
    """Build the Period for one calendar month (used by ad-hoc reruns)."""
    start = Date(year, m, 1)
    if m == 12:
        next_start = Date(year + 1, 1, 1)
    else:
        next_start = Date(year, m + 1, 1)
    return Period(label=f"{year}-{m:02d}", start=start, end=next_start - timedelta(days=1))


def filter_items(items, period):
    """Keep only the items whose service date falls inside *period*."""
    return [item for item in items if period.contains(item.service_date)]


def split_by_month(items):
    """Bucket items by (year, month) of service date, for detail views."""
    buckets = {}
    for item in items:
        key = (item.service_date.year, item.service_date.month)
        buckets.setdefault(key, []).append(item)
    return dict(sorted(buckets.items()))
