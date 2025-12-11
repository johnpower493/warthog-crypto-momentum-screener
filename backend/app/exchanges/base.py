from __future__ import annotations
import abc
from typing import AsyncIterator
from ..models import Kline

class PerpKlineSource(abc.ABC):
    @abc.abstractmethod
    async def symbols(self) -> list[str]:
        ...

    @abc.abstractmethod
    async def stream_1m_klines(self) -> AsyncIterator[Kline]:
        ...
