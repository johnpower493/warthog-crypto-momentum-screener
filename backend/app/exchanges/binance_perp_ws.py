from __future__ import annotations
import asyncio
import json
from typing import AsyncIterator, List

import httpx
import websockets

from ..config import (
    BINANCE_FUTURES_REST,
    BINANCE_FUTURES_WS,
    TOP_SYMBOLS,
    INCLUDE_SYMBOLS,
    EXCLUDE_SYMBOLS,
    WS_PING_INTERVAL,
)
from ..models import Kline
from .base import PerpKlineSource

REST_TICKER_24H = "/fapi/v1/ticker/24hr"
EXCHANGE_INFO = "/fapi/v1/exchangeInfo"

class BinancePerpKlineSource(PerpKlineSource):
    def __init__(self) -> None:
        self._symbols: List[str] = []

    async def symbols(self) -> list[str]:
        if self._symbols:
            return self._symbols
        async with httpx.AsyncClient(base_url=BINANCE_FUTURES_REST, timeout=20) as client:
            # Get exchange info to filter USDT-margined perpetuals
            r = await client.get(EXCHANGE_INFO)
            r.raise_for_status()
            info = r.json()
            usdt_perps = set()
            for s in info.get("symbols", []):
                if s.get("quoteAsset") == "USDT" and s.get("contractType") in {"PERPETUAL"} and s.get("status") == "TRADING":
                    usdt_perps.add(s.get("symbol"))
            # Fetch 24h tickers to rank by volume
            r2 = await client.get(REST_TICKER_24H)
            r2.raise_for_status()
            tickers = r2.json()
            rows = []
            for t in tickers:
                sym = t.get("symbol")
                if sym in usdt_perps:
                    try:
                        vol = float(t.get("quoteVolume", 0.0))
                    except Exception:
                        vol = 0.0
                    rows.append((sym, vol))
            rows.sort(key=lambda x: x[1], reverse=True)
            symbols = [s for s, _ in rows]
            if INCLUDE_SYMBOLS:
                symbols = [s for s in symbols if s in set(INCLUDE_SYMBOLS)]
            if EXCLUDE_SYMBOLS:
                excl = set(EXCLUDE_SYMBOLS)
                symbols = [s for s in symbols if s not in excl]
            self._symbols = symbols[:TOP_SYMBOLS]
            return self._symbols

    async def stream_1m_klines(self) -> AsyncIterator[Kline]:
        syms = await self.symbols()
        # Build combined stream: <symbol>@kline_1m
        params = "/".join([f"{s.lower()}@kline_1m" for s in syms])
        url = f"{BINANCE_FUTURES_WS}?streams={params}"
        async for msg in _connect_and_stream(url):
            try:
                data = json.loads(msg)
                payload = data.get("data", {})
                if payload.get("e") != "kline":
                    continue
                k = payload.get("k", {})
                yield Kline(
                    symbol=payload.get("s"),
                    open_time=k.get("t"),
                    close_time=k.get("T"),
                    open=float(k.get("o")),
                    high=float(k.get("h")),
                    low=float(k.get("l")),
                    close=float(k.get("c")),
                    volume=float(k.get("q")),
                    closed=bool(k.get("x")),
                    exchange="binance",
                )
            except Exception:
                continue

import logging
logger = logging.getLogger(__name__)

async def _connect_and_stream(url: str) -> AsyncIterator[str]:
    backoff = 1.0
    while True:
        try:
            logger.info(f"Connecting to Binance WS: {url}")
            async with websockets.connect(url, ping_interval=WS_PING_INTERVAL, max_queue=2048) as ws:
                backoff = 1.0
                logger.info("Binance WS connected")
                async for message in ws:
                    yield message
        except Exception as e:
            logger.warning(f"Binance WS error: {e}; reconnecting in {backoff:.1f}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)
