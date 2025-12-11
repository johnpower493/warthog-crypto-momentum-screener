# Stub adapter for Kraken Futures websocket kline stream.
from __future__ import annotations
from typing import AsyncIterator
from .base import PerpKlineSource
from ..models import Kline

class KrakenPerpKlineSource(PerpKlineSource):
    async def symbols(self) -> list[str]:
        # TODO: Discover and rank perpetual futures symbols.
        return []

    async def stream_1m_klines(self) -> AsyncIterator[Kline]:
        # TODO: Connect to Kraken Futures WS and stream 1m klines.
        if False:
            yield Kline(symbol="", open_time=0, close_time=0, open=0, high=0, low=0, close=0, volume=0, closed=False)
        return
