from __future__ import annotations
import asyncio
import json
import logging
from typing import AsyncIterator, List

import websockets

from ..config import WS_PING_INTERVAL

log = logging.getLogger(__name__)

async def stream_minitickers(base_ws_url: str, symbols: List[str]) -> AsyncIterator[tuple[str, float, int]]:
    # Yields (symbol, price, ts_ms)
    if not symbols:
        return
    params = "/".join([f"{s.lower()}@miniTicker" for s in symbols])
    url = f"{base_ws_url}?streams={params}"
    backoff = 1.0
    while True:
        try:
            log.info(f"Connecting Binance miniTicker WS: {url}")
            async with websockets.connect(url, ping_interval=WS_PING_INTERVAL, max_queue=4096) as ws:
                backoff = 1.0
                async for message in ws:
                    try:
                        data = json.loads(message)
                        payload = data.get("data", {})
                        if payload.get("e") != "24hrMiniTicker":
                            continue
                        sym = payload.get("s")
                        c = float(payload.get("c"))
                        ts = int(payload.get("E", 0))
                        yield sym, c, ts
                    except Exception:
                        continue
        except Exception as e:
            log.warning(f"Binance miniTicker WS error: {e}; reconnecting in {backoff:.1f}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)
