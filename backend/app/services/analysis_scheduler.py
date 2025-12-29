from __future__ import annotations
import asyncio
import logging

from ..config import ANALYSIS_AUTORUN_INTERVAL_SEC, ANALYSIS_AUTORUN_WINDOWS, ANALYSIS_AUTORUN_TOP200_ONLY
from .analysis_backtester import run_analysis_backtest

log = logging.getLogger(__name__)


async def analysis_autorun_loop():
    """Periodically recompute analysis backtest tables."""
    # small startup delay to allow streams/backfills
    await asyncio.sleep(10)
    while True:
        try:
            for w in ANALYSIS_AUTORUN_WINDOWS:
                # combined across exchanges
                run_analysis_backtest(window_days=w, exchange='all', top200_only=ANALYSIS_AUTORUN_TOP200_ONLY)
            log.info(f"Analysis autorun complete for windows={ANALYSIS_AUTORUN_WINDOWS}")
        except Exception as e:
            log.warning(f"Analysis autorun failed: {e}")
        await asyncio.sleep(ANALYSIS_AUTORUN_INTERVAL_SEC)
