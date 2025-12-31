from __future__ import annotations

import asyncio
import math
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple


def _tf_ms(tf: str) -> int:
    tf = tf.strip().lower()
    if tf.endswith('m'):
        return int(float(tf[:-1]) * 60_000)
    if tf.endswith('h'):
        return int(float(tf[:-1]) * 60 * 60_000)
    raise ValueError(f"Unsupported timeframe: {tf}")


def _candle_open(ts_ms: int, tf_ms: int) -> int:
    return ts_ms - (ts_ms % tf_ms)


def _round_step(price: float, step: float) -> float:
    if step <= 0:
        return price
    # Decimal-safe enough for typical steps; avoids float drift via scaling.
    k = round(price / step)
    return k * step


@dataclass
class LevelAgg:
    bid: float = 0.0
    ask: float = 0.0
    n: int = 0


@dataclass
class CandleAgg:
    open_ts: int
    levels: Dict[float, LevelAgg] = field(default_factory=dict)
    total_bid: float = 0.0
    total_ask: float = 0.0
    cvd: float = 0.0  # cumulative volume delta for this candle (ask - bid)

    def apply_trade(self, price: float, qty: float, side: str, step: float) -> None:
        lvl = _round_step(price, step)
        a = self.levels.get(lvl)
        if a is None:
            a = LevelAgg()
            self.levels[lvl] = a
        a.n += 1
        if side == 'BUY':
            a.ask += qty
            self.total_ask += qty
        else:
            a.bid += qty
            self.total_bid += qty
        # Update CVD (cumulative delta within this candle)
        self.cvd = self.total_ask - self.total_bid


class OrderFlowEngine:
    """In-memory footprint aggregation for a single (exchange, symbol).

    - Aggregates trades into candle -> price-level buckets.
    - Maintains a rolling window in memory.
    - Provides snapshot and incremental delta payloads for WS streaming.
    """

    def __init__(self, exchange: str, symbol: str):
        self.exchange = exchange
        self.symbol = symbol
        self._lock = asyncio.Lock()
        # key: (tf_ms, step) -> {open_ts -> CandleAgg}
        self._series: Dict[Tuple[int, float], Dict[int, CandleAgg]] = {}
        self._last_emit_state: Dict[Tuple[int, float], Tuple[int, int]] = {}
        self._last_trade_ts: int = 0

    @property
    def last_trade_ts(self) -> int:
        return self._last_trade_ts

    async def ingest_trade(self, ts: int, price: float, qty: float, side: str, tf_ms: int, step: float, max_candles: int) -> None:
        async with self._lock:
            self._last_trade_ts = max(self._last_trade_ts, int(ts or 0))
            key = (tf_ms, float(step))
            series = self._series.get(key)
            if series is None:
                series = {}
                self._series[key] = series

            o = _candle_open(int(ts), tf_ms)
            c = series.get(o)
            if c is None:
                c = CandleAgg(open_ts=o)
                series[o] = c

            c.apply_trade(price=float(price), qty=float(qty), side=side, step=float(step))

            # Trim old candles
            if len(series) > max_candles:
                for k in sorted(series.keys())[:-max_candles]:
                    series.pop(k, None)

    async def snapshot(self, tf_ms: int, step: float, lookback: int) -> dict:
        async with self._lock:
            key = (tf_ms, float(step))
            series = self._series.get(key, {})
            opens = sorted(series.keys())[-lookback:]
            candles = []
            for o in opens:
                c = series[o]
                levels = [
                    {"p": float(p), "bid": float(a.bid), "ask": float(a.ask), "n": int(a.n)}
                    for p, a in c.levels.items()
                    if (a.bid or a.ask)
                ]
                # Sort price levels high->low for display
                levels.sort(key=lambda x: x["p"], reverse=True)
                candles.append(
                    {
                        "open_ts": c.open_ts,
                        "bid": float(c.total_bid),
                        "ask": float(c.total_ask),
                        "delta": float(c.total_ask - c.total_bid),
                        "cvd": float(c.cvd),
                        "levels": levels,
                    }
                )
            return {
                "type": "snapshot",
                "exchange": self.exchange,
                "symbol": self.symbol,
                "tf_ms": tf_ms,
                "step": float(step),
                "server_ts": int(time.time() * 1000),
                "candles": candles,
            }

    async def delta(self, tf_ms: int, step: float) -> Optional[dict]:
        """Return an incremental update for the latest candle.

        To keep things simple and robust, we send the whole latest candle as 'delta'.
        (The UI treats it as replace-current-candle.)
        """
        async with self._lock:
            key = (tf_ms, float(step))
            series = self._series.get(key)
            if not series:
                return None
            o = max(series.keys())
            c = series[o]
            # A basic dedup: if candle open + total trades count hasn't changed, skip.
            trade_count = sum(a.n for a in c.levels.values())
            last = self._last_emit_state.get(key)
            if last == (o, trade_count):
                return None
            self._last_emit_state[key] = (o, trade_count)

            levels = [
                {"p": float(p), "bid": float(a.bid), "ask": float(a.ask), "n": int(a.n)}
                for p, a in c.levels.items()
                if (a.bid or a.ask)
            ]
            levels.sort(key=lambda x: x["p"], reverse=True)
            return {
                "type": "delta",
                "exchange": self.exchange,
                "symbol": self.symbol,
                "tf_ms": tf_ms,
                "step": float(step),
                "server_ts": int(time.time() * 1000),
                "candle": {
                    "open_ts": c.open_ts,
                    "bid": float(c.total_bid),
                    "ask": float(c.total_ask),
                    "delta": float(c.total_ask - c.total_bid),
                    "cvd": float(c.cvd),
                    "levels": levels,
                },
            }
