from __future__ import annotations
import asyncio
import logging
from typing import Optional

class StreamWatchdog:
    def __init__(self, name: str, get_last_ingest_ms, restart_cb, interval_s: float = 30.0, timeout_s: float = 90.0):
        self.name = name
        self._get_last_ingest_ms = get_last_ingest_ms
        self._restart_cb = restart_cb
        self._interval_s = interval_s
        self._timeout_s = timeout_s
        self._task: Optional[asyncio.Task] = None
        self._log = logging.getLogger(__name__)

    def start(self):
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run())

    async def _run(self):
        while True:
            try:
                await asyncio.sleep(self._interval_s)
                last = self._get_last_ingest_ms()
                now_ms = int(__import__('time').time()*1000)
                if last and now_ms - last > int(self._timeout_s*1000):
                    self._log.warning(f"Watchdog: restarting stream {self.name} after {now_ms-last}ms without ingest")
                    await self._restart_cb()
            except Exception as e:
                self._log.warning(f"Watchdog error for {self.name}: {e}")
