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
        self._subscribers: List[asyncio.Queue] = []
        self._lock = asyncio.Lock()
        self.last_emit_ts: int = 0
        self.last_ingest_ts: int = 0
        from ..config import SNAPSHOT_INTERVAL_MS
        self._throttle_ms: int = SNAPSHOT_INTERVAL_MS

    async def ingest(self, k: Kline):
        state = self._states.get(k.symbol)
        if state is None:
            state = SymbolState(symbol=k.symbol, exchange=self.exchange)
            self._states[k.symbol] = state
        state.update(k)
        self.last_ingest_ts = int(asyncio.get_event_loop().time() * 1000)
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
        self.last_ingest_ts = ts_ms or int(__import__('time').time()*1000)
        await self.emit_if_due()
