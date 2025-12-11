# Stub adapter for OKX perpetuals websocket kline stream.
from __future__ import annotations
from typing import AsyncIterator
from .base import PerpKlineSource
from ..models import Kline

class OKXPerpKlineSource(PerpKlineSource):
    async def symbols(self) -> list[str]:
        # TODO: Fetch USDT/USDC margined perpetual instruments and rank.
        return []

    async def stream_1m_klines(self) -> AsyncIterator[Kline]:
        # TODO: Connect to OKX public WS (candle1m) and stream klines.
        if False:
            yield Kline(symbol="", open_time=0, close_time=0, open=0, high=0, low=0, close=0, volume=0, closed=False)
        return
