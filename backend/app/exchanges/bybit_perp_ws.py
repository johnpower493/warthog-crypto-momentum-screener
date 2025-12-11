from __future__ import annotations
import asyncio
import json
import logging
from typing import AsyncIterator, List

import httpx
import websockets

from ..config import TOP_SYMBOLS, INCLUDE_SYMBOLS, EXCLUDE_SYMBOLS
from ..config import (
    WS_PING_INTERVAL,
)
from ..models import Kline
from .base import PerpKlineSource

log = logging.getLogger(__name__)

BYBIT_REST = "https://api.bybit.com"
# v5 market instruments and tickers (linear = USDT/USDC perps)
INSTRUMENTS = "/v5/market/instruments-info?category=linear"
TICKERS = "/v5/market/tickers?category=linear"

# Public WS linear
BYBIT_WS_LINEAR = "wss://stream.bybit.com/v5/public/linear"

class BybitPerpKlineSource(PerpKlineSource):
    def __init__(self) -> None:
        self._symbols: List[str] = []

    async def symbols(self) -> list[str]:
        if self._symbols:
            return self._symbols
        async with httpx.AsyncClient(base_url=BYBIT_REST, timeout=20) as client:
            # Discover active linear perps (USDT/USDC), status Trading
            r = await client.get(INSTRUMENTS)
            r.raise_for_status()
            info = r.json()
            syms = []
            for it in info.get("result", {}).get("list", []):
                if it.get("status") == "Trading" and it.get("contractType") == "LinearPerpetual":
                    sym = it.get("symbol")
                    if sym:
                        syms.append(sym)
            # Rank by quote volume via tickers (turnover24h)
            r2 = await client.get(TICKERS)
            r2.raise_for_status()
            tick = r2.json().get("result", {}).get("list", [])
            vols = {}
            for t in tick:
                sym = t.get("symbol")
                try:
                    vol = float(t.get("turnover24h", 0.0))
                except Exception:
                    vol = 0.0
                vols[sym] = vol
            rows = [(s, vols.get(s, 0.0)) for s in syms]
            rows.sort(key=lambda x: x[1], reverse=True)
            symbols = [s for s, _ in rows]
            if INCLUDE_SYMBOLS:
                symbols = [s for s in symbols if s in set(INCLUDE_SYMBOLS)]
            if EXCLUDE_SYMBOLS:
                excl = set(EXCLUDE_SYMBOLS)
                symbols = [s for s in symbols if s not in excl]
            self._symbols = symbols[:TOP_SYMBOLS]
            log.info(f"Bybit selected symbols: {len(self._symbols)}")
            return self._symbols

    async def stream_1m_klines(self) -> AsyncIterator[Kline]:
        syms = await self.symbols()
        if not syms:
            return
        url = BYBIT_WS_LINEAR
        async for msg in _connect_and_stream(url, syms):
            try:
                data = json.loads(msg)
                if not isinstance(data, dict):
                    continue
                if data.get("topic", "").startswith("kline.1."):
                    for item in data.get("data", []) or []:
                        symbol = item.get("symbol") or data.get("topic", "").split(".")[-1]
                        start = int(item.get("start"))
                        end = int(item.get("end"))
                        o = float(item.get("open"))
                        h = float(item.get("high"))
                        l = float(item.get("low"))
                        c = float(item.get("close"))
                        # turnover = quote volume
                        vol = float(item.get("turnover", 0.0)) if item.get("turnover") is not None else 0.0
                        closed = bool(item.get("confirm", False))
                        yield Kline(
                            symbol=symbol,
                            open_time=start,
                            close_time=end,
                            open=o, high=h, low=l, close=c,
                            volume=vol,
                            closed=closed,
                            exchange="bybit",
                        )
            except Exception:
                continue

async def _connect_and_stream(url: str, symbols: List[str]) -> AsyncIterator[str]:
    # Subscribe in batches to avoid frame limits
    batch = 50
    args = [f"kline.1.{s}" for s in symbols]
    for i in range(0, len(args), batch):
        pass
    backoff = 1.0
    while True:
        try:
            log.info(f"Connecting to Bybit WS: {url}")
            async with websockets.connect(url, ping_interval=WS_PING_INTERVAL, max_queue=2048) as ws:
                backoff = 1.0
                log.info("Bybit WS connected")
                # Subscribe in batches
                for i in range(0, len(args), batch):
                    sub = {"op": "subscribe", "args": args[i:i+batch]}
                    await ws.send(json.dumps(sub))
                    await asyncio.sleep(0.2)
                async for message in ws:
                    yield message
        except Exception as e:
            log.warning(f"Bybit WS error: {e}; reconnecting in {backoff:.1f}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)
