from __future__ import annotations
import asyncio
import json
import logging
from typing import AsyncIterator, List

import websockets

from ..config import WS_PING_INTERVAL, BYBIT_WS_LINEAR

log = logging.getLogger(__name__)

async def stream_tickers(symbols: List[str]) -> AsyncIterator[tuple[str, float, int]]:
    # Yields (symbol, price, ts_ms)
    if not symbols:
        return
    url = BYBIT_WS_LINEAR
    args = [f"tickers.{s}" for s in symbols]
    batch = 50
    backoff = 1.0
    connection_count = 0
    while True:
        try:
            connection_count += 1
            log.info(f"Connecting Bybit ticker WS (attempt #{connection_count})")
            async with websockets.connect(
                url, 
                ping_interval=WS_PING_INTERVAL, 
                ping_timeout=60,  # Wait up to 60s for pong response
                close_timeout=10,  # Timeout for close handshake
                max_queue=4096
            ) as ws:
                backoff = 1.0
                log.info(f"Bybit ticker WS connected (connection #{connection_count})")
                # Subscribe in batches
                for i in range(0, len(args), batch):
                    sub = {"op": "subscribe", "args": args[i:i+batch]}
                    await ws.send(json.dumps(sub))
                    await asyncio.sleep(0.2)
                message_count = 0
                async for message in ws:
                    message_count += 1
                    try:
                        data = json.loads(message)
                        topic = data.get("topic", "")
                        if not topic.startswith("tickers."):
                            continue
                        payload = data.get("data")
                        items = payload if isinstance(payload, list) else ([payload] if isinstance(payload, dict) else [])
                        for item in items:
                            sym = item.get("symbol")
                            p = item.get("lastPrice") or item.get("lp") or item.get("price")
                            if p is None or sym is None:
                                continue
                            price = float(p)
                            ts = int(item.get("ts") or item.get("timestamp") or data.get("ts") or 0)
                            yield sym, price, ts
                    except Exception as e:
                        log.debug(f"Bybit ticker parse error: {e}")
                        continue
                log.warning(f"Bybit ticker WS connection #{connection_count} closed after {message_count} messages")
        except websockets.exceptions.ConnectionClosed as e:
            log.warning(f"Bybit ticker WS connection #{connection_count} closed: code={e.code}, reason={e.reason}; reconnecting in {backoff:.1f}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)
        except Exception as e:
            log.error(f"Bybit ticker WS error: {type(e).__name__}: {e}; reconnecting in {backoff:.1f}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)
