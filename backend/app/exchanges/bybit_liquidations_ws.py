"""
Bybit Liquidations WebSocket Stream

Subscribes to the public liquidation topic to receive real-time forced liquidation events.
No API key required - this is public data.

Bybit v5 WebSocket: wss://stream.bybit.com/v5/public/linear
Topic: liquidation.<symbol>

Message format:
{
    "topic": "liquidation.BTCUSDT",
    "type": "snapshot",
    "ts": 1234567890123,
    "data": {
        "symbol": "BTCUSDT",
        "side": "Buy",      # Buy = short liquidated, Sell = long liquidated
        "size": "0.5",
        "price": "50000.00",
        "updatedTime": 1234567890123
    }
}
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import AsyncIterator, Dict, List, Any, Optional
from collections import deque

import websockets

from ..config import BYBIT_WS_LINEAR, WS_PING_INTERVAL

log = logging.getLogger(__name__)

# In-memory store for recent liquidations per symbol
# Structure: {symbol: deque([{liquidation_event}, ...])}
_liquidation_store: Dict[str, deque] = {}
_MAX_STORED_LIQUIDATIONS = 100  # Keep last 100 per symbol


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


async def stream_liquidations(symbol: str) -> AsyncIterator[dict]:
    """Yield normalized liquidation events for a single Bybit linear perp symbol.

    Normalized event:
      {
        "exchange": "bybit",
        "symbol": "BTCUSDT",
        "ts": 173... (ms),
        "price": float,
        "qty": float,
        "value_usd": float,
        "side": "BUY"|"SELL"  # BUY = short liquidated, SELL = long liquidated
      }

    Bybit v5 public liquidation topic: liquidation.<symbol>
    """

    topic = f"liquidation.{symbol}"
    url = BYBIT_WS_LINEAR

    backoff = 1.0
    attempt = 0
    while True:
        try:
            attempt += 1
            log.info(f"Bybit liquidations WS connect {symbol} (attempt {attempt})")
            async with websockets.connect(
                url,
                ping_interval=WS_PING_INTERVAL,
                ping_timeout=60,
                close_timeout=10,
                max_queue=4096,
            ) as ws:
                backoff = 1.0
                sub = {"op": "subscribe", "args": [topic]}
                await ws.send(json.dumps(sub))

                async for message in ws:
                    try:
                        data = json.loads(message)
                        if not isinstance(data, dict):
                            continue
                        
                        # Check for subscription confirmation
                        if data.get("op") == "subscribe":
                            if data.get("success"):
                                log.info(f"Bybit liquidations subscribed to {topic}")
                            else:
                                log.warning(f"Bybit liquidations subscription failed: {data}")
                            continue
                        
                        if data.get("topic") != topic:
                            continue
                        
                        liq_data = data.get("data", {})
                        if not liq_data:
                            continue
                        
                        # Parse liquidation event
                        ts = int(liq_data.get("updatedTime") or data.get("ts") or 0)
                        price = float(liq_data.get("price", 0))
                        qty = float(liq_data.get("size", 0))
                        
                        # Bybit: "Buy" = short position liquidated (market buys to close)
                        #        "Sell" = long position liquidated (market sells to close)
                        side_raw = (liq_data.get("side") or "").capitalize()
                        if side_raw == "Buy":
                            side = "BUY"  # Short liquidated
                        elif side_raw == "Sell":
                            side = "SELL"  # Long liquidated
                        else:
                            continue
                        
                        normalized = {
                            "exchange": "bybit",
                            "symbol": symbol,
                            "ts": ts,
                            "timestamp": ts,
                            "price": price,
                            "qty": qty,
                            "value_usd": price * qty,
                            "side": side,
                            "source": "bybit_ws"
                        }
                        
                        # Store in memory for REST API access
                        _store_liquidation(symbol, normalized)
                        
                        yield normalized
                        
                    except Exception as e:
                        log.debug(f"Bybit liquidations parse error: {e}")
                        continue
                        
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning(f"Bybit liquidations WS error {symbol}: {type(e).__name__}: {e} (reconnect {backoff:.1f}s)")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 20)


async def run_liquidation_collector(symbols: List[str]) -> None:
    """Run liquidation collectors for multiple symbols.
    
    This is a long-running task that collects liquidations in the background
    and stores them in memory for the REST API to access.
    """
    if not symbols:
        return
    
    log.info(f"Starting Bybit liquidation collectors for {len(symbols)} symbols")
    
    async def collect_for_symbol(symbol: str):
        """Collect liquidations for a single symbol."""
        try:
            async for liq in stream_liquidations(symbol):
                # Event is already stored in _store_liquidation
                # Log significant liquidations (> $100k)
                if liq.get("value_usd", 0) > 100_000:
                    side_label = "LONG" if liq["side"] == "SELL" else "SHORT"
                    log.info(f"Large {side_label} liquidation: {symbol} ${liq['value_usd']:,.0f} @ {liq['price']}")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.error(f"Liquidation collector error for {symbol}: {e}")
    
    # Run all collectors concurrently
    tasks = [asyncio.create_task(collect_for_symbol(s)) for s in symbols]
    
    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        for t in tasks:
            t.cancel()
        raise
