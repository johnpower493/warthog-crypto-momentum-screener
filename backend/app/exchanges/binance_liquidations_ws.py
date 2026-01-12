"""
Binance Liquidations WebSocket Stream

Subscribes to the public forceOrder stream to receive real-time forced liquidation events.
No API key required - this is public data.

Binance Futures WebSocket: wss://fstream.binance.com/stream
Stream: !forceOrder@arr (all symbols) or <symbol>@forceOrder (single symbol)

Message format:
{
    "e": "forceOrder",          // Event Type
    "E": 1568014460893,         // Event Time
    "o": {
        "s": "BTCUSDT",         // Symbol
        "S": "SELL",            // Side (SELL = long liquidated, BUY = short liquidated)
        "o": "LIMIT",           // Order Type
        "f": "IOC",             // Time in Force
        "q": "0.014",           // Original Quantity
        "p": "9910",            // Price
        "ap": "9910",           // Average Price
        "X": "FILLED",          // Order Status
        "l": "0.014",           // Order Last Filled Quantity
        "z": "0.014",           // Order Filled Accumulated Quantity
        "T": 1568014460893      // Order Trade Time
    }
}
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import AsyncIterator, Dict, List, Any, Optional, Set
from collections import deque

import websockets

from ..config import BINANCE_FUTURES_WS, WS_PING_INTERVAL

log = logging.getLogger(__name__)

# In-memory store for recent liquidations per symbol
# Structure: {symbol: deque([{liquidation_event}, ...])}
_liquidation_store: Dict[str, deque] = {}
_MAX_STORED_LIQUIDATIONS = 100  # Keep last 100 per symbol

# Liquidation levels heatmap store
# Structure: {symbol: {price_bucket: {"long_value": float, "short_value": float, "count": int, "last_ts": int}}}
_liquidation_levels: Dict[str, Dict[float, Dict[str, Any]]] = {}
_LEVEL_EXPIRY_MS = 60 * 60 * 1000  # 1 hour - levels older than this are removed


def get_recent_liquidations(symbol: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Get recent liquidations from the in-memory store."""
    if symbol not in _liquidation_store:
        return []
    
    liqs = list(_liquidation_store[symbol])
    # Sort by timestamp descending (most recent first)
    liqs.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
    return liqs[:limit]


def get_liquidation_summary(symbol: str) -> Dict[str, Any]:
    """Get summary stats for recent liquidations."""
    liqs = get_recent_liquidations(symbol, limit=_MAX_STORED_LIQUIDATIONS)
    
    if not liqs:
        return {
            "recent_count": 0,
            "long_liq_count": 0,
            "short_liq_count": 0,
            "total_value_usd": 0,
            "long_liq_value": 0,
            "short_liq_value": 0,
        }
    
    # Filter to last 5 minutes for summary
    now_ms = int(time.time() * 1000)
    five_min_ago = now_ms - (5 * 60 * 1000)
    recent = [l for l in liqs if l.get("timestamp", 0) > five_min_ago]
    
    return {
        "recent_count": len(recent),
        "long_liq_count": sum(1 for l in recent if l.get("side") == "SELL"),
        "short_liq_count": sum(1 for l in recent if l.get("side") == "BUY"),
        "total_value_usd": sum(l.get("value_usd", 0) for l in recent),
        "long_liq_value": sum(l.get("value_usd", 0) for l in recent if l.get("side") == "SELL"),
        "short_liq_value": sum(l.get("value_usd", 0) for l in recent if l.get("side") == "BUY"),
    }


def _store_liquidation(symbol: str, liq: Dict[str, Any]) -> None:
    """Store a liquidation event in the in-memory store."""
    if symbol not in _liquidation_store:
        _liquidation_store[symbol] = deque(maxlen=_MAX_STORED_LIQUIDATIONS)
    
    _liquidation_store[symbol].append(liq)
    
    # Also aggregate into price levels for heatmap
    _aggregate_liquidation_level(symbol, liq)


def _get_price_bucket(price: float, bucket_size: float) -> float:
    """Round price to nearest bucket for aggregation."""
    return round(price / bucket_size) * bucket_size


def _calculate_bucket_size(price: float) -> float:
    """Calculate appropriate bucket size based on price magnitude.
    
    For BTC (~100k): bucket = $100
    For ETH (~3k): bucket = $5
    For small alts (~0.01): bucket = $0.0001
    """
    if price <= 0:
        return 0.01
    
    # Use ~0.1% of price as bucket size, rounded to nice numbers
    raw_bucket = price * 0.001
    
    # Round to nearest power of 10 with nice multipliers
    import math
    magnitude = 10 ** math.floor(math.log10(raw_bucket))
    normalized = raw_bucket / magnitude
    
    if normalized < 2:
        nice_bucket = magnitude
    elif normalized < 5:
        nice_bucket = 2 * magnitude
    else:
        nice_bucket = 5 * magnitude
    
    return nice_bucket


def _aggregate_liquidation_level(symbol: str, liq: Dict[str, Any]) -> None:
    """Aggregate a liquidation into price level buckets for heatmap."""
    price = liq.get("price", 0)
    value_usd = liq.get("value_usd", 0)
    side = liq.get("side", "")
    ts = liq.get("timestamp", int(time.time() * 1000))
    
    if price <= 0 or value_usd <= 0:
        return
    
    # Initialize symbol store if needed
    if symbol not in _liquidation_levels:
        _liquidation_levels[symbol] = {}
    
    # Calculate bucket size based on price
    bucket_size = _calculate_bucket_size(price)
    bucket = _get_price_bucket(price, bucket_size)
    
    # Initialize or update bucket
    if bucket not in _liquidation_levels[symbol]:
        _liquidation_levels[symbol][bucket] = {
            "long_value": 0,
            "short_value": 0,
            "long_count": 0,
            "short_count": 0,
            "total_value": 0,
            "total_count": 0,
            "last_ts": ts,
            "bucket_size": bucket_size,
        }
    
    level = _liquidation_levels[symbol][bucket]
    level["last_ts"] = ts
    level["total_value"] += value_usd
    level["total_count"] += 1
    
    if side == "SELL":  # Long liquidated
        level["long_value"] += value_usd
        level["long_count"] += 1
    elif side == "BUY":  # Short liquidated
        level["short_value"] += value_usd
        level["short_count"] += 1


def get_liquidation_levels(symbol: str, current_price: float = 0, range_pct: float = 5.0) -> List[Dict[str, Any]]:
    """Get liquidation levels for heatmap display.
    
    Args:
        symbol: Trading pair symbol
        current_price: Current price to filter levels around (0 = no filter)
        range_pct: Percentage range around current price to include (default 5%)
    
    Returns:
        List of price levels sorted by price, each containing:
        - price: The bucket price level
        - long_value: Total USD value of long liquidations at this level
        - short_value: Total USD value of short liquidations at this level
        - total_value: Combined value
        - long_count: Number of long liquidations
        - short_count: Number of short liquidations
        - intensity: Normalized intensity 0-1 for heatmap coloring
    """
    if symbol not in _liquidation_levels:
        return []
    
    now_ms = int(time.time() * 1000)
    levels = []
    max_value = 0
    
    # Clean up expired levels and collect valid ones
    expired_buckets = []
    for bucket, data in _liquidation_levels[symbol].items():
        # Remove levels older than expiry time
        if now_ms - data["last_ts"] > _LEVEL_EXPIRY_MS:
            expired_buckets.append(bucket)
            continue
        
        # Filter by price range if current_price provided
        if current_price > 0:
            price_diff_pct = abs(bucket - current_price) / current_price * 100
            if price_diff_pct > range_pct:
                continue
        
        level_data = {
            "price": bucket,
            "long_value": data["long_value"],
            "short_value": data["short_value"],
            "total_value": data["total_value"],
            "long_count": data["long_count"],
            "short_count": data["short_count"],
            "total_count": data["total_count"],
            "bucket_size": data["bucket_size"],
        }
        levels.append(level_data)
        max_value = max(max_value, data["total_value"])
    
    # Clean up expired buckets
    for bucket in expired_buckets:
        del _liquidation_levels[symbol][bucket]
    
    # Calculate intensity for each level (normalized 0-1)
    if max_value > 0:
        for level in levels:
            level["intensity"] = level["total_value"] / max_value
    
    # Sort by price ascending
    levels.sort(key=lambda x: x["price"])
    
    return levels


def clear_liquidation_levels(symbol: str = None) -> None:
    """Clear liquidation levels cache.
    
    Args:
        symbol: Specific symbol to clear, or None to clear all
    """
    global _liquidation_levels
    if symbol:
        if symbol in _liquidation_levels:
            del _liquidation_levels[symbol]
    else:
        _liquidation_levels = {}


async def stream_all_liquidations(symbols: Optional[Set[str]] = None) -> AsyncIterator[dict]:
    """Yield normalized liquidation events for all Binance USDT perpetual symbols.

    Uses the !forceOrder@arr stream which provides liquidations for ALL symbols
    in a single connection (much more efficient than per-symbol connections).

    Args:
        symbols: Optional set of symbols to filter. If None, yields all liquidations.

    Normalized event:
      {
        "exchange": "binance",
        "symbol": "BTCUSDT",
        "ts": 173... (ms),
        "price": float,
        "qty": float,
        "value_usd": float,
        "side": "BUY"|"SELL"  # BUY = short liquidated, SELL = long liquidated
      }
    """

    # Use the all-symbols liquidation stream - much more efficient
    stream = "!forceOrder@arr"
    url = f"{BINANCE_FUTURES_WS}?streams={stream}"

    backoff = 1.0
    attempt = 0
    while True:
        try:
            attempt += 1
            log.info(f"Binance liquidations WS connect (all symbols, attempt {attempt})")
            async with websockets.connect(
                url,
                ping_interval=WS_PING_INTERVAL,
                ping_timeout=60,
                close_timeout=10,
                max_queue=4096,
            ) as ws:
                backoff = 1.0
                log.info("Binance liquidations stream connected")
                
                async for message in ws:
                    try:
                        data = json.loads(message)
                        
                        # Handle combined stream format
                        payload = data.get("data") if isinstance(data, dict) else None
                        if not payload:
                            continue
                        
                        # Check event type
                        if payload.get("e") != "forceOrder":
                            continue
                        
                        order = payload.get("o", {})
                        if not order:
                            continue
                        
                        symbol = order.get("s", "")
                        
                        # Filter by symbols if provided
                        if symbols and symbol not in symbols:
                            continue
                        
                        # Parse liquidation data
                        price = float(order.get("ap") or order.get("p") or 0)  # Average price or limit price
                        qty = float(order.get("z") or order.get("q") or 0)  # Filled qty or original qty
                        ts = int(order.get("T") or payload.get("E") or 0)
                        
                        # Side: SELL = long position liquidated, BUY = short position liquidated
                        side = order.get("S", "")
                        
                        if not symbol or not price or not qty:
                            continue
                        
                        normalized = {
                            "exchange": "binance",
                            "symbol": symbol,
                            "ts": ts,
                            "timestamp": ts,
                            "price": price,
                            "qty": qty,
                            "value_usd": price * qty,
                            "side": side,
                            "status": order.get("X", ""),
                            "source": "binance_ws"
                        }
                        
                        # Store in memory for REST API access
                        _store_liquidation(symbol, normalized)
                        
                        # Log significant liquidations (> $100k)
                        if normalized["value_usd"] > 100_000:
                            side_label = "LONG" if side == "SELL" else "SHORT"
                            log.info(f"Large {side_label} liquidation: {symbol} ${normalized['value_usd']:,.0f} @ {price}")
                        
                        yield normalized
                        
                    except Exception as e:
                        log.debug(f"Binance liquidations parse error: {e}")
                        continue
                        
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning(f"Binance liquidations WS error: {type(e).__name__}: {e} (reconnect {backoff:.1f}s)")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 20)


async def run_liquidation_collector(symbols: Optional[List[str]] = None) -> None:
    """Run liquidation collector for all Binance symbols.
    
    This is a long-running task that collects liquidations in the background
    and stores them in memory for the REST API to access.
    
    Args:
        symbols: Optional list of symbols to filter. If None, collects all liquidations.
    """
    symbols_set = set(symbols) if symbols else None
    
    log.info(f"Starting Binance liquidation collector" + 
             (f" for {len(symbols_set)} symbols" if symbols_set else " for all symbols"))
    
    try:
        async for liq in stream_all_liquidations(symbols_set):
            # Event is already stored in _store_liquidation
            # Just consume the stream
            pass
    except asyncio.CancelledError:
        log.info("Binance liquidations collector cancelled")
        raise
    except Exception as e:
        log.error(f"Binance liquidation collector error: {e}")
        raise
