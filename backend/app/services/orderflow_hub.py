from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Dict, Optional, Set, Tuple

from ..exchanges.binance_trades_ws import stream_agg_trades
from ..exchanges.bybit_trades_ws import stream_trades
from .orderflow import OrderFlowEngine, _tf_ms

log = logging.getLogger(__name__)


@dataclass
class _HubState:
    engine: OrderFlowEngine
    task: asyncio.Task
    refcount: int = 0


class OrderFlowHub:
    """One ingest task per (exchange, symbol); supports multiple subscribers with different tf/step.

    We ingest trades once, then apply them into multiple (tf_ms, step) series on the engine.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._streams: Dict[Tuple[str, str], _HubState] = {}
        # Per stream subscriptions: (exchange,symbol) -> set((tf_ms, step))
        self._subs: Dict[Tuple[str, str], Set[Tuple[int, float]]] = {}

    async def subscribe(self, exchange: str, symbol: str, tf: str, step: float) -> OrderFlowEngine:
        tf_ms = _tf_ms(tf)
        key = (exchange, symbol)
        async with self._lock:
            st = self._streams.get(key)
            if st is None:
                engine = OrderFlowEngine(exchange=exchange, symbol=symbol)
                task = asyncio.create_task(self._run_ingest(exchange, symbol, engine))
                st = _HubState(engine=engine, task=task, refcount=0)
                self._streams[key] = st
                self._subs[key] = set()
            st.refcount += 1
            self._subs[key].add((tf_ms, float(step)))
            return st.engine

    async def unsubscribe(self, exchange: str, symbol: str, tf: str, step: float) -> None:
        tf_ms = _tf_ms(tf)
        key = (exchange, symbol)
        async with self._lock:
            st = self._streams.get(key)
            if st is None:
                return
            st.refcount = max(0, st.refcount - 1)
            s = self._subs.get(key)
            if s is not None:
                s.discard((tf_ms, float(step)))

            # If nobody is subscribed anymore, cancel ingestion.
            if st.refcount == 0:
                try:
                    st.task.cancel()
                except Exception:
                    pass
                self._streams.pop(key, None)
                self._subs.pop(key, None)

    async def _run_ingest(self, exchange: str, symbol: str, engine: OrderFlowEngine) -> None:
        max_candles = 500

        async def iter_trades():
            if exchange == 'binance':
                async for t in stream_agg_trades(symbol):
                    yield t
            elif exchange == 'bybit':
                async for t in stream_trades(symbol):
                    yield t
            else:
                return

        try:
            async for t in iter_trades():
                # Apply trade to all currently-subscribed (tf_ms, step) series
                key = (exchange, symbol)
                async with self._lock:
                    targets = list(self._subs.get(key, set()))
                if not targets:
                    continue

                for tf_ms, step in targets:
                    try:
                        await engine.ingest_trade(
                            ts=int(t['ts']),
                            price=float(t['price']),
                            qty=float(t['qty']),
                            side=str(t['side']),
                            tf_ms=int(tf_ms),
                            step=float(step),
                            max_candles=max_candles,
                        )
                    except Exception:
                        continue
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning(f"orderflow ingest stopped {exchange}:{symbol}: {type(e).__name__}: {e}")
