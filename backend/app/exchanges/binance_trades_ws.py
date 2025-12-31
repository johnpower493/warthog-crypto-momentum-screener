from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator, Optional

import websockets

from ..config import BINANCE_FUTURES_WS, WS_PING_INTERVAL

log = logging.getLogger(__name__)


async def stream_agg_trades(symbol: str) -> AsyncIterator[dict]:
    """Yield normalized trade events for a single Binance USDT perpetual symbol.

    Uses Binance Futures combined stream endpoint with <symbol>@aggTrade.

    Normalized event:
      {
        "exchange": "binance",
        "symbol": "BTCUSDT",
        "ts": 173... (ms),
        "price": float,
        "qty": float,  # base qty
        "side": "BUY"|"SELL"  # aggressor side
      }
    """

    stream = f"{symbol.lower()}@aggTrade"
    # BINANCE_FUTURES_WS is a combined stream root like wss://fstream.binance.com/stream
    url = f"{BINANCE_FUTURES_WS}?streams={stream}"

    backoff = 1.0
    attempt = 0
    while True:
        try:
            attempt += 1
            log.info(f"Binance aggTrade WS connect {symbol} (attempt {attempt})")
            async with websockets.connect(
                url,
                ping_interval=WS_PING_INTERVAL,
                ping_timeout=60,
                close_timeout=10,
                max_queue=4096,
            ) as ws:
                backoff = 1.0
                async for message in ws:
                    try:
                        data = json.loads(message)
                        payload = data.get("data") if isinstance(data, dict) else None
                        if not payload or payload.get("e") not in {"aggTrade", "trade"}:
                            continue
                        # aggTrade fields
                        price = float(payload.get("p"))
                        qty = float(payload.get("q"))
                        ts = int(payload.get("T") or payload.get("E") or 0)
                        # m = is buyer the maker. If buyer is maker, trade was aggressive sell.
                        is_buyer_maker = bool(payload.get("m"))
                        side = "SELL" if is_buyer_maker else "BUY"
                        yield {
                            "exchange": "binance",
                            "symbol": payload.get("s") or symbol,
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
            log.warning(f"Binance aggTrade WS error {symbol}: {type(e).__name__}: {e} (reconnect {backoff:.1f}s)")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 20)
