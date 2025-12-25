from __future__ import annotations
import asyncio
import json
from typing import Dict, List

from ..models import Kline, SymbolMetrics, ScreenerSnapshot
from ..metrics.calculator import SymbolState
from ..services.redis_client import publish_json

class Aggregator:
    def __init__(self, exchange: str):
        self.exchange = exchange
        self._states: Dict[str, SymbolState] = {}
        # Per-symbol last update timestamps (epoch ms)
        self._last_kline_by_symbol: Dict[str, int] = {}
        self._last_ticker_by_symbol: Dict[str, int] = {}
        self._subscribers: List[asyncio.Queue] = []
        self._lock = asyncio.Lock()
        # Initialize timestamps to current time to prevent false watchdog triggers
        import time
        now_ms = int(time.time() * 1000)
        self.last_emit_ts: int = now_ms
        # NOTE: We track kline and ticker ingest separately so watchdogs can
        # detect when one stream dies while the other continues.
        self.last_kline_ingest_ts: int = now_ms
        self.last_ticker_ingest_ts: int = now_ms
        # Backwards-compatible aggregate timestamp (max of the above)
        self.last_ingest_ts: int = now_ms
        from ..config import SNAPSHOT_INTERVAL_MS
        self._throttle_ms: int = SNAPSHOT_INTERVAL_MS

    async def ingest(self, k: Kline):
        state = self._states.get(k.symbol)
        if state is None:
            state = SymbolState(symbol=k.symbol, exchange=self.exchange)
            self._states[k.symbol] = state
        state.update(k)
        import time
        now_ms = int(time.time() * 1000)
        self.last_kline_ingest_ts = now_ms
        self._last_kline_by_symbol[k.symbol] = now_ms
        self.last_ingest_ts = max(self.last_kline_ingest_ts, self.last_ticker_ingest_ts)
        # Throttled emit
        await self.emit_if_due()

    async def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._subscribers.append(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue):
        async with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def build_snapshot(self) -> ScreenerSnapshot:
        metrics = [st.compute_metrics() for st in self._states.values()]
        snap = ScreenerSnapshot(exchange=self.exchange, ts=max((m.ts for m in metrics), default=0), metrics=metrics)
        try:
            import logging
            logging.getLogger(__name__).debug(f"Emit snapshot: {len(metrics)} metrics")
        except Exception:
            pass
        return snap

    def _build_snapshot_payload(self) -> str:
        snap = self.build_snapshot()
        payload = snap.model_dump_json()
        return payload

    async def emit_if_due(self):
        now_ms = int(__import__('time').time() * 1000)
        if now_ms - self.last_emit_ts < self._throttle_ms:
            return
        await self._emit_snapshot()

    async def heartbeat_emit(self):
        await self._emit_snapshot()

    async def _emit_snapshot(self):
        payload = self._build_snapshot_payload()
        try:
            self.last_emit_ts = int(__import__('time').time()*1000)
        except Exception:
            pass
        # fan out to subscribers (non-blocking)
        async with self._lock:
            for q in list(self._subscribers):
                try:
                    if q.full():
                        _ = q.get_nowait()
                    q.put_nowait(payload)
                except Exception:
                    try:
                        self._subscribers.remove(q)
                    except ValueError:
                        pass
        # publish to redis channel
        await publish_json("screener:snapshot", payload)

    def state_count(self) -> int:
        return len(self._states)

    def stale_symbols(self, now_ms: int, ticker_stale_ms: int = 30_000, kline_stale_ms: int = 90_000) -> dict:
        """Return stale symbols for ticker/kline.

        ticker_stale_ms: threshold for last ticker update age
        kline_stale_ms: threshold for last kline update age
        """
        stale_ticker = []
        stale_kline = []
        for sym in self._states.keys():
            t = self._last_ticker_by_symbol.get(sym)
            k = self._last_kline_by_symbol.get(sym)
            if t is None or now_ms - t > ticker_stale_ms:
                stale_ticker.append(sym)
            if k is None or now_ms - k > kline_stale_ms:
                stale_kline.append(sym)
        # keep small payloads
        stale_ticker.sort()
        stale_kline.sort()
        return {
            "ticker": stale_ticker,
            "kline": stale_kline,
            "ticker_count": len(stale_ticker),
            "kline_count": len(stale_kline),
        }

    def get_history(self, symbol: str, limit: int = 60):
        st = self._states.get(symbol)
        if not st:
            return []
        vals = list(st.close_1m.values)
        return vals[-limit:]

    async def update_ticker(self, symbol: str, price: float, ts_ms: int | None = None):
        state = self._states.get(symbol)
        if state is None:
            state = SymbolState(symbol=symbol, exchange=self.exchange)
            self._states[symbol] = state
        state.last_price = price
        import time
        now_ms = ts_ms or int(time.time() * 1000)
        self.last_ticker_ingest_ts = now_ms
        self._last_ticker_by_symbol[symbol] = now_ms
        self.last_ingest_ts = max(self.last_kline_ingest_ts, self.last_ticker_ingest_ts)
        await self.emit_if_due()
    
    async def update_open_interest(self, symbol: str, oi_value: float):
        """Update open interest for a symbol"""
        state = self._states.get(symbol)
        if state is None:
            state = SymbolState(symbol=symbol, exchange=self.exchange)
            self._states[symbol] = state
        state.open_interest = oi_value
        state.oi_1m.append(oi_value)
        # Don't emit on OI update - let the regular throttle handle it
