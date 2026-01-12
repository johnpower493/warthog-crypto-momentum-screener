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
class WallLevel:
    """Detected support/resistance wall at a price level."""
    price: float
    volume: float
    side: str  # 'support' (bid wall) or 'resistance' (ask wall)
    strength: float  # How much stronger than average (multiplier)
    touches: int  # Number of times price approached this level


@dataclass
class WallDetector:
    """Detects support/resistance walls from order flow data.
    
    A wall is identified when:
    1. A price level has significantly higher volume than surrounding levels
    2. The volume is predominantly on one side (bid = support, ask = resistance)
    3. The level has been "tested" multiple times (price approached it)
    
    Walls are useful for identifying:
    - Strong support levels where buyers absorb selling pressure
    - Strong resistance levels where sellers absorb buying pressure
    - Potential reversal points or breakout levels
    """
    
    # Configuration
    min_strength_multiplier: float = 2.0  # Must be 2x average volume
    min_volume_threshold: float = 0.0  # Minimum absolute volume (set dynamically)
    lookback_candles: int = 10  # How many candles to analyze
    
    def detect_walls(
        self, 
        candles: list,  # List of CandleAgg
        current_price: float = 0,
        max_walls: int = 10
    ) -> list:
        """Detect support and resistance walls from candle data.
        
        Returns list of WallLevel objects sorted by strength.
        """
        if not candles:
            return []
        
        # Aggregate volume across all candles by price level
        level_totals: Dict[float, Dict[str, float]] = {}
        
        for candle in candles[-self.lookback_candles:]:
            for price, agg in candle.levels.items():
                if price not in level_totals:
                    level_totals[price] = {"bid": 0.0, "ask": 0.0, "touches": 0}
                level_totals[price]["bid"] += agg.bid
                level_totals[price]["ask"] += agg.ask
                level_totals[price]["touches"] += 1
        
        if not level_totals:
            return []
        
        # Calculate average volume per level
        total_volumes = [(p, d["bid"] + d["ask"]) for p, d in level_totals.items()]
        avg_volume = sum(v for _, v in total_volumes) / len(total_volumes) if total_volumes else 0
        
        if avg_volume <= 0:
            return []
        
        # Dynamic minimum threshold based on data
        min_threshold = max(self.min_volume_threshold, avg_volume * 0.5)
        
        walls = []
        for price, data in level_totals.items():
            bid_vol = data["bid"]
            ask_vol = data["ask"]
            total_vol = bid_vol + ask_vol
            touches = data["touches"]
            
            # Skip levels with insufficient volume
            if total_vol < min_threshold:
                continue
            
            # Calculate strength (how much above average)
            strength = total_vol / avg_volume if avg_volume > 0 else 0
            
            # Must be at least min_strength_multiplier times average
            if strength < self.min_strength_multiplier:
                continue
            
            # Determine if it's support (bid-heavy) or resistance (ask-heavy)
            # Need at least 60% dominance on one side
            if total_vol > 0:
                bid_ratio = bid_vol / total_vol
                ask_ratio = ask_vol / total_vol
                
                if bid_ratio >= 0.6:
                    side = "support"
                    dominant_vol = bid_vol
                elif ask_ratio >= 0.6:
                    side = "resistance"
                    dominant_vol = ask_vol
                else:
                    # Mixed - classify by position relative to current price
                    if current_price > 0:
                        side = "support" if price < current_price else "resistance"
                    else:
                        side = "support" if bid_vol > ask_vol else "resistance"
                    dominant_vol = total_vol
                
                walls.append(WallLevel(
                    price=price,
                    volume=total_vol,
                    side=side,
                    strength=strength,
                    touches=touches
                ))
        
        # Sort by strength (strongest first) and limit
        walls.sort(key=lambda w: w.strength, reverse=True)
        return walls[:max_walls]
    
    def find_nearest_walls(
        self, 
        walls: list, 
        current_price: float,
        max_distance_pct: float = 5.0
    ) -> Dict[str, list]:
        """Find the nearest support and resistance walls to current price.
        
        Returns dict with 'support' and 'resistance' lists, each containing
        walls within max_distance_pct of current price, sorted by distance.
        """
        if not walls or current_price <= 0:
            return {"support": [], "resistance": []}
        
        support_walls = []
        resistance_walls = []
        
        for wall in walls:
            distance_pct = abs(wall.price - current_price) / current_price * 100
            
            if distance_pct > max_distance_pct:
                continue
            
            wall_with_distance = {
                "price": wall.price,
                "volume": wall.volume,
                "side": wall.side,
                "strength": wall.strength,
                "touches": wall.touches,
                "distance_pct": round(distance_pct, 2)
            }
            
            if wall.side == "support" and wall.price < current_price:
                support_walls.append(wall_with_distance)
            elif wall.side == "resistance" and wall.price > current_price:
                resistance_walls.append(wall_with_distance)
        
        # Sort by distance (nearest first)
        support_walls.sort(key=lambda w: w["distance_pct"])
        resistance_walls.sort(key=lambda w: w["distance_pct"])
        
        return {
            "support": support_walls[:5],  # Top 5 nearest
            "resistance": resistance_walls[:5]
        }


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
    - Detects support/resistance walls from order flow data.
    """

    def __init__(self, exchange: str, symbol: str):
        self.exchange = exchange
        self.symbol = symbol
        self._lock = asyncio.Lock()
        # key: (tf_ms, step) -> {open_ts -> CandleAgg}
        self._series: Dict[Tuple[int, float], Dict[int, CandleAgg]] = {}
        self._last_emit_state: Dict[Tuple[int, float], Tuple[int, int]] = {}
        self._last_trade_ts: int = 0
        self._wall_detector = WallDetector()
        self._current_price: float = 0.0

    @property
    def last_trade_ts(self) -> int:
        return self._last_trade_ts

    async def ingest_trade(self, ts: int, price: float, qty: float, side: str, tf_ms: int, step: float, max_candles: int) -> None:
        async with self._lock:
            self._last_trade_ts = max(self._last_trade_ts, int(ts or 0))
            self._current_price = float(price)  # Track latest price for wall detection
            
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
            candle_objs = []  # Keep CandleAgg objects for wall detection
            
            for o in opens:
                c = series[o]
                candle_objs.append(c)
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
            
            # Detect walls from order flow data
            all_walls = self._wall_detector.detect_walls(
                candles=candle_objs,
                current_price=self._current_price,
                max_walls=20
            )
            
            # Get nearest support/resistance walls
            nearest_walls = self._wall_detector.find_nearest_walls(
                walls=all_walls,
                current_price=self._current_price,
                max_distance_pct=3.0  # Within 3% of current price
            )
            
            return {
                "type": "snapshot",
                "exchange": self.exchange,
                "symbol": self.symbol,
                "tf_ms": tf_ms,
                "step": float(step),
                "server_ts": int(time.time() * 1000),
                "current_price": self._current_price,
                "candles": candles,
                "walls": {
                    "support": nearest_walls["support"],
                    "resistance": nearest_walls["resistance"],
                    "all": [
                        {
                            "price": w.price,
                            "volume": w.volume,
                            "side": w.side,
                            "strength": round(w.strength, 2),
                            "touches": w.touches
                        }
                        for w in all_walls[:10]  # Top 10 strongest walls
                    ]
                }
            }

    async def delta(self, tf_ms: int, step: float) -> Optional[dict]:
        """Return an incremental update for the latest candle.

        To keep things simple and robust, we send the whole latest candle as 'delta'.
        (The UI treats it as replace-current-candle.)
        Also includes updated wall detection data.
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
            
            # Detect walls from recent candles
            candle_objs = list(series.values())
            all_walls = self._wall_detector.detect_walls(
                candles=candle_objs[-10:],  # Last 10 candles
                current_price=self._current_price,
                max_walls=20
            )
            nearest_walls = self._wall_detector.find_nearest_walls(
                walls=all_walls,
                current_price=self._current_price,
                max_distance_pct=3.0
            )
            
            return {
                "type": "delta",
                "exchange": self.exchange,
                "symbol": self.symbol,
                "tf_ms": tf_ms,
                "step": float(step),
                "server_ts": int(time.time() * 1000),
                "current_price": self._current_price,
                "candle": {
                    "open_ts": c.open_ts,
                    "bid": float(c.total_bid),
                    "ask": float(c.total_ask),
                    "delta": float(c.total_ask - c.total_bid),
                    "cvd": float(c.cvd),
                    "levels": levels,
                },
                "walls": {
                    "support": nearest_walls["support"],
                    "resistance": nearest_walls["resistance"],
                }
            }
