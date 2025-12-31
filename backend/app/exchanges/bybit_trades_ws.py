from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

import websockets

from ..config import BYBIT_WS_LINEAR, WS_PING_INTERVAL

log = logging.getLogger(__name__)


async def stream_trades(symbol: str) -> AsyncIterator[dict]:
    """Yield normalized trade events for a single Bybit linear perp symbol.

    Normalized event:
      {
        "exchange": "bybit",
        "symbol": "BTCUSDT",
        "ts": 173... (ms),
        "price": float,
        "qty": float,
        "side": "BUY"|"SELL"
      }

    Bybit v5 public trade topic: publicTrade.<symbol>
    """

    topic = f"publicTrade.{symbol}"
    url = BYBIT_WS_LINEAR

    backoff = 1.0
    attempt = 0
    while True:
        try:
            attempt += 1
            log.info(f"Bybit trades WS connect {symbol} (attempt {attempt})")
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
                        if data.get("topic") != topic:
                            continue
                        for t in data.get("data", []) or []:
                            # Fields typically: T (ms), p (price), v (size), S (side)
                            ts = int(t.get("T") or t.get("ts") or 0)
                            price = float(t.get("p"))
                            qty = float(t.get("v"))
                            side_raw = (t.get("S") or t.get("side") or "").upper()
                            side = "BUY" if side_raw == "BUY" else "SELL" if side_raw == "SELL" else None
                            if side is None:
                                continue
                            yield {
                                "exchange": "bybit",
                                "symbol": symbol,
                                "ts": ts,
                                "price": price,
                                "qty": qty,
                                "side": side,
                            }
                    except Exception:
                        continue
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning(f"Bybit trades WS error {symbol}: {type(e).__name__}: {e} (reconnect {backoff:.1f}s)")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 20)
