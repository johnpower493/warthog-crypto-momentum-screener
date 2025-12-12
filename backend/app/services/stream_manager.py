from __future__ import annotations
import asyncio

from ..exchanges.binance_perp_ws import BinancePerpKlineSource
from .aggregator import Aggregator

from typing import Optional

from ..config import BINANCE_FUTURES_WS
from ..exchanges.binance_ticker_ws import stream_minitickers
import httpx
from ..config import BINANCE_FUTURES_REST

from .watchdog import StreamWatchdog
from .open_interest import OpenInterestFetcher

class StreamManager:
    def __init__(self):
        self.binance = BinancePerpKlineSource()
        from ..exchanges.bybit_perp_ws import BybitPerpKlineSource
        self.bybit = BybitPerpKlineSource()
        self._client = httpx.AsyncClient(timeout=20)  # for backfill
        self.agg = Aggregator(exchange="binance")
        self.agg_bybit = Aggregator(exchange="bybit")
        self.oi_fetcher = OpenInterestFetcher()
        self._task: Optional[asyncio.Task] = None
        self._task_bybit: Optional[asyncio.Task] = None
        self._task_bin_ticker: Optional[asyncio.Task] = None
        self._task_bybit_ticker: Optional[asyncio.Task] = None
        self._task_bin_oi: Optional[asyncio.Task] = None
        self._task_bybit_oi: Optional[asyncio.Task] = None

    async def start(self):
        if not self._task or self._task.done():
            self._task = asyncio.create_task(self._run_binance())
        if not self._task_bybit or self._task_bybit.done():
            self._task_bybit = asyncio.create_task(self._run_bybit())
        if not self._task_bin_ticker or self._task_bin_ticker.done():
            self._task_bin_ticker = asyncio.create_task(self._run_binance_ticker())
        if not self._task_bybit_ticker or self._task_bybit_ticker.done():
            self._task_bybit_ticker = asyncio.create_task(self._run_bybit_ticker())
        # seed history for metrics
        try:
            await self._backfill_binance()
        except Exception:
            pass
        try:
            await self._backfill_bybit()
        except Exception:
            pass
        
        # Start OI fetchers and fetch initial OI data
        await self.oi_fetcher.start()
        syms_bin = await self.binance.symbols()
        syms_bybit = await self.bybit.symbols()
        
        # Fetch initial OI data before emitting first snapshot
        try:
            import logging
            logging.getLogger(__name__).info("Fetching initial OI data for Binance...")
            oi_data_bin = await self.oi_fetcher.fetch_binance_oi(syms_bin)
            for symbol, oi_value in oi_data_bin.items():
                await self.agg.update_open_interest(symbol, oi_value)
            logging.getLogger(__name__).info(f"Loaded OI for {len(oi_data_bin)} Binance symbols")
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed to fetch initial Binance OI: {e}")
        
        try:
            import logging
            logging.getLogger(__name__).info("Fetching initial OI data for Bybit...")
            oi_data_bybit = await self.oi_fetcher.fetch_bybit_oi(syms_bybit)
            for symbol, oi_value in oi_data_bybit.items():
                await self.agg_bybit.update_open_interest(symbol, oi_value)
            logging.getLogger(__name__).info(f"Loaded OI for {len(oi_data_bybit)} Bybit symbols")
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed to fetch initial Bybit OI: {e}")
        
        # Emit initial snapshots with OI data
        await self.agg.heartbeat_emit()
        await self.agg_bybit.heartbeat_emit()
        
        # Start periodic OI fetching tasks
        if not self._task_bin_oi or self._task_bin_oi.done():
            self._task_bin_oi = asyncio.create_task(self._run_binance_oi(syms_bin))
        if not self._task_bybit_oi or self._task_bybit_oi.done():
            self._task_bybit_oi = asyncio.create_task(self._run_bybit_oi(syms_bybit))
        # start watchdogs
        self._wd_bin = StreamWatchdog(
            name="binance",
            get_last_ingest_ms=lambda: self.agg.last_ingest_ts,
            restart_cb=self._restart_binance
        )
        self._wd_bin.start()
        self._wd_bin_ticker = StreamWatchdog(
            name="binance_ticker",
            get_last_ingest_ms=lambda: self.agg.last_ingest_ts,
            restart_cb=self._restart_binance_ticker
        )
        self._wd_bin_ticker.start()
        self._wd_bybit = StreamWatchdog(
            name="bybit",
            get_last_ingest_ms=lambda: self.agg_bybit.last_ingest_ts,
            restart_cb=self._restart_bybit
        )
        self._wd_bybit.start()
        self._wd_bybit_ticker = StreamWatchdog(
            name="bybit_ticker",
            get_last_ingest_ms=lambda: self.agg_bybit.last_ingest_ts,
            restart_cb=self._restart_bybit_ticker
        )
        self._wd_bybit_ticker.start()


    async def _run_binance(self):
        async for k in self.binance.stream_1m_klines():
            await self.agg.ingest(k)

    async def _restart_binance(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except Exception:
                pass
        self._task = asyncio.create_task(self._run_binance())

    async def _restart_binance_ticker(self):
        if self._task_bin_ticker:
            self._task_bin_ticker.cancel()
            try:
                await self._task_bin_ticker
            except Exception:
                pass
        self._task_bin_ticker = asyncio.create_task(self._run_binance_ticker())

    async def _restart_bybit(self):
        if self._task_bybit:
            self._task_bybit.cancel()
            try:
                await self._task_bybit
            except Exception:
                pass
        self._task_bybit = asyncio.create_task(self._run_bybit())

    async def _restart_bybit_ticker(self):
        if self._task_bybit_ticker:
            self._task_bybit_ticker.cancel()
            try:
                await self._task_bybit_ticker
            except Exception:
                pass
        self._task_bybit_ticker = asyncio.create_task(self._run_bybit_ticker())

    async def _backfill_binance(self, limit: int = 200):
        syms = await self.binance.symbols()
        url = f"{BINANCE_FUTURES_REST}/fapi/v1/klines"
        for s in syms:
            try:
                r = await self._client.get(url, params={"symbol": s, "interval": "1m", "limit": limit})
                r.raise_for_status()
                arr = r.json()
                for row in arr:
                    open_time = int(row[0])
                    open_ = float(row[1]); high = float(row[2]); low = float(row[3]); close = float(row[4])
                    quote_vol = float(row[7])
                    from ..models import Kline
                    k = Kline(symbol=s, open_time=open_time, close_time=open_time+60_000, open=open_, high=high, low=low, close=close, volume=quote_vol, closed=True, exchange="binance")
                    await self.agg.ingest(k)
            except Exception:
                continue
    async def _run_binance_ticker(self):
        syms = await self.binance.symbols()
        async for sym, price, ts in stream_minitickers(BINANCE_FUTURES_WS, syms):
            try:
                await self.agg.update_ticker(sym, price, ts)
            except Exception:
                continue

    async def _run_bybit_ticker(self):
        syms = await self.bybit.symbols()
        from ..exchanges.bybit_ticker_ws import stream_tickers as bybit_stream_tickers
        async for sym, price, ts in bybit_stream_tickers(syms):
            try:
                await self.agg_bybit.update_ticker(sym, price, ts)
            except Exception as e:
                import logging
                logging.getLogger(__name__).debug(f"bybit ticker update error: {e}")
                continue

    async def _run_bybit(self):
        async for k in self.bybit.stream_1m_klines():
            await self.agg_bybit.ingest(k)
    
    async def _run_binance_oi(self, symbols: list[str]):
        """Periodically fetch and update OI data for Binance"""
        while True:
            try:
                oi_data = await self.oi_fetcher.fetch_binance_oi(symbols)
                for symbol, oi_value in oi_data.items():
                    await self.agg.update_open_interest(symbol, oi_value)
            except Exception as e:
                import logging
                logging.getLogger(__name__).debug(f"Binance OI fetch error: {e}")
            await asyncio.sleep(60)  # Fetch every 60 seconds
    
    async def _run_bybit_oi(self, symbols: list[str]):
        """Periodically fetch and update OI data for Bybit"""
        while True:
            try:
                oi_data = await self.oi_fetcher.fetch_bybit_oi(symbols)
                for symbol, oi_value in oi_data.items():
                    await self.agg_bybit.update_open_interest(symbol, oi_value)
            except Exception as e:
                import logging
                logging.getLogger(__name__).debug(f"Bybit OI fetch error: {e}")
            await asyncio.sleep(60)  # Fetch every 60 seconds

    async def subscribe(self):
        return await self.agg.subscribe()

    async def subscribe_bybit(self):
        return await self.agg_bybit.subscribe()

    def bybit_running(self) -> bool:
        return self._task_bybit is not None and not self._task_bybit.done()

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except Exception:
                pass
        if self._task_bybit:
            self._task_bybit.cancel()
            try:
                await self._task_bybit
            except Exception:
                pass
        if self._task_bin_ticker:
            self._task_bin_ticker.cancel()
            try:
                await self._task_bin_ticker
            except Exception:
                pass
        if self._task_bybit_ticker:
            self._task_bybit_ticker.cancel()
            try:
                await self._task_bybit_ticker
            except Exception:
                pass

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except Exception:
                pass
