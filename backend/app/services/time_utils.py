from __future__ import annotations

import time


def sleep_seconds_until_next_boundary(period_s: int, offset_s: int = 0) -> float:
    """Return seconds to sleep until the next multiple of period_s since epoch, plus offset.

    Example: period_s=300 aligns to 5-minute boundaries.
    """
    now = time.time()
    next_boundary = ((int(now) // period_s) + 1) * period_s
    target = next_boundary + offset_s
    return max(0.0, target - now)
