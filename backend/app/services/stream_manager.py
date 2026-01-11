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
from .time_utils import sleep_seconds_until_next_boundary

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
        self._task_bybit_liquidations: Optional[asyncio.Task] = None

    async def start(self):
        import logging
        log = logging.getLogger(__name__)
        
        if not self._task or self._task.done():
            if self._task and self._task.done():
                try:
                    exc = self._task.exception()
                    if exc:
                        log.error(f"Previous Binance kline task failed: {exc}")
                except Exception:
                    pass
            log.info("Starting Binance kline stream...")
            self._task = asyncio.create_task(self._run_binance())
            
        if not self._task_bybit or self._task_bybit.done():
            if self._task_bybit and self._task_bybit.done():
                try:
                    exc = self._task_bybit.exception()
                    if exc:
                        log.error(f"Previous Bybit kline task failed: {exc}")
                except Exception:
                    pass
            log.info("Starting Bybit kline stream...")
            self._task_bybit = asyncio.create_task(self._run_bybit())
            
        if not self._task_bin_ticker or self._task_bin_ticker.done():
            if self._task_bin_ticker and self._task_bin_ticker.done():
                try:
                    exc = self._task_bin_ticker.exception()
                    if exc:
                        log.error(f"Previous Binance ticker task failed: {exc}")
                except Exception:
                    pass
            log.info("Starting Binance ticker stream...")
            self._task_bin_ticker = asyncio.create_task(self._run_binance_ticker())
            
        if not self._task_bybit_ticker or self._task_bybit_ticker.done():
            if self._task_bybit_ticker and self._task_bybit_ticker.done():
                try:
                    exc = self._task_bybit_ticker.exception()
                    if exc:
                        log.error(f"Previous Bybit ticker task failed: {exc}")
                except Exception:
                    pass
            log.info("Starting Bybit ticker stream...")
            self._task_bybit_ticker = asyncio.create_task(self._run_bybit_ticker())
        # seed history for metrics
        import logging
        log = logging.getLogger(__name__)
        try:
            log.info("Backfilling Binance historical data...")
            await self._backfill_binance()
            log.info(f"Binance backfill complete. States: {self.agg.state_count()}")
        except Exception as e:
            log.warning(f"Binance backfill failed: {e}")
        try:
            log.info("Backfilling Bybit historical data...")
            await self._backfill_bybit()
            log.info(f"Bybit backfill complete. States: {self.agg_bybit.state_count()}")
        except Exception as e:
            log.warning(f"Bybit backfill failed: {e}")
        
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
        
        # Start Bybit liquidations WebSocket collector
        if not self._task_bybit_liquidations or self._task_bybit_liquidations.done():
            log.info("Starting Bybit liquidations stream...")
            self._task_bybit_liquidations = asyncio.create_task(self._run_bybit_liquidations(syms_bybit))
        # start watchdogs
        self._wd_bin = StreamWatchdog(
            name="binance_kline",
            get_last_ingest_ms=lambda: getattr(self.agg, "last_kline_ingest_ts", self.agg.last_ingest_ts),
            restart_cb=self._restart_binance
        )
        self._wd_bin.start()
        self._wd_bin_ticker = StreamWatchdog(
            name="binance_ticker",
            get_last_ingest_ms=lambda: getattr(self.agg, "last_ticker_ingest_ts", self.agg.last_ingest_ts),
            restart_cb=self._restart_binance_ticker
        )
        self._wd_bin_ticker.start()
        self._wd_bybit = StreamWatchdog(
            name="bybit_kline",
            get_last_ingest_ms=lambda: getattr(self.agg_bybit, "last_kline_ingest_ts", self.agg_bybit.last_ingest_ts),
            restart_cb=self._restart_bybit
        )
        self._wd_bybit.start()
        self._wd_bybit_ticker = StreamWatchdog(
            name="bybit_ticker",
            get_last_ingest_ms=lambda: getattr(self.agg_bybit, "last_ticker_ingest_ts", self.agg_bybit.last_ingest_ts),
            restart_cb=self._restart_bybit_ticker
        )
        self._wd_bybit_ticker.start()
        
        # Start task health monitor
        if not hasattr(self, '_task_health_monitor') or not self._task_health_monitor or self._task_health_monitor.done():
            self._task_health_monitor = asyncio.create_task(self._monitor_task_health())

        # Optional periodic full refresh at each 5-minute candle close
        from ..config import ENABLE_FULL_REFRESH_5M
        if ENABLE_FULL_REFRESH_5M:
            if not hasattr(self, '_task_full_refresh') or not self._task_full_refresh or self._task_full_refresh.done():
                self._task_full_refresh = asyncio.create_task(self._run_full_refresh_loop())


    async def _run_binance(self):
        import logging
        log = logging.getLogger(__name__)
        try:
            async for k in self.binance.stream_1m_klines():
                await self.agg.ingest(k)
        except asyncio.CancelledError:
            log.info("Binance kline stream cancelled")
            raise
        except Exception as e:
            log.error(f"Binance kline stream fatal error: {e}", exc_info=True)
            raise

    async def _restart_binance(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        self._task = asyncio.create_task(self._run_binance())

    async def _restart_binance_ticker(self):
        if self._task_bin_ticker:
            self._task_bin_ticker.cancel()
            try:
                await self._task_bin_ticker
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        self._task_bin_ticker = asyncio.create_task(self._run_binance_ticker())

    async def _restart_bybit(self):
        if self._task_bybit:
            self._task_bybit.cancel()
            try:
                await self._task_bybit
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        self._task_bybit = asyncio.create_task(self._run_bybit())

    async def _restart_bybit_ticker(self):
        if self._task_bybit_ticker:
            self._task_bybit_ticker.cancel()
            try:
                await self._task_bybit_ticker
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        self._task_bybit_ticker = asyncio.create_task(self._run_bybit_ticker())
    
    async def _run_full_refresh_loop(self):
        """Periodically do a "full refresh" aligned to 5-minute boundaries.

        This is intentionally similar to backend startup behavior:
        - restart ws streams
        - backfill recent history
        - refetch OI
        - emit a snapshot

        This helps recover from edge cases where websockets appear connected but
        stop delivering updates for a subset of symbols.
        """
        import logging
        from ..config import FULL_REFRESH_BACKFILL_LIMIT, FULL_REFRESH_OFFSET_SEC

        log = logging.getLogger(__name__)
        while True:
            try:
                sleep_s = sleep_seconds_until_next_boundary(300, FULL_REFRESH_OFFSET_SEC)
                await asyncio.sleep(sleep_s)

                log.warning("Full refresh: restarting streams + backfilling + refetching OI")

                # Restart streams (kline + ticker)
                await self._restart_binance()
                await self._restart_binance_ticker()
                await self._restart_bybit()
                await self._restart_bybit_ticker()

                # Backfill recent history (keeps state fresh and heals gaps)
                try:
                    await self._backfill_binance(limit=FULL_REFRESH_BACKFILL_LIMIT)
                except Exception as e:
                    log.warning(f"Full refresh: Binance backfill failed: {e}")
                try:
                    await self._backfill_bybit(limit=FULL_REFRESH_BACKFILL_LIMIT)
                except Exception as e:
                    log.warning(f"Full refresh: Bybit backfill failed: {e}")

                # Refetch OI and update state
                try:
                    syms_bin = await self.binance.symbols()
                    oi_data_bin = await self.oi_fetcher.fetch_binance_oi(syms_bin)
                    for symbol, oi_value in oi_data_bin.items():
                        await self.agg.update_open_interest(symbol, oi_value)
                except Exception as e:
                    log.debug(f"Full refresh: Binance OI refetch failed: {e}")

                try:
                    syms_bybit = await self.bybit.symbols()
                    oi_data_bybit = await self.oi_fetcher.fetch_bybit_oi(syms_bybit)
                    for symbol, oi_value in oi_data_bybit.items():
                        await self.agg_bybit.update_open_interest(symbol, oi_value)
                except Exception as e:
                    log.debug(f"Full refresh: Bybit OI refetch failed: {e}")

                # Emit immediate snapshots
                try:
                    await self.agg.heartbeat_emit()
                except Exception:
                    pass
                try:
                    await self.agg_bybit.heartbeat_emit()
                except Exception:
                    pass

            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.error(f"Full refresh loop error: {e}", exc_info=True)
                await asyncio.sleep(5)

    async def _monitor_task_health(self):
        """Monitor stream tasks and restart them if they die unexpectedly"""
        import logging
        log = logging.getLogger(__name__)
        
        while True:
            await asyncio.sleep(15)  # Check every 15 seconds
            
            try:
                # Check if tasks are still running
                if self._task and self._task.done():
                    exc = None
                    try:
                        exc = self._task.exception()
                    except Exception:
                        pass
                    if exc:
                        log.error(f"Binance kline task died unexpectedly: {exc}")
                    else:
                        log.warning("Binance kline task completed unexpectedly")
                    log.info("Restarting Binance kline stream...")
                    self._task = asyncio.create_task(self._run_binance())
                
                if self._task_bin_ticker and self._task_bin_ticker.done():
                    exc = None
                    try:
                        exc = self._task_bin_ticker.exception()
                    except Exception:
                        pass
                    if exc:
                        log.error(f"Binance ticker task died unexpectedly: {exc}")
                    else:
                        log.warning("Binance ticker task completed unexpectedly")
                    log.info("Restarting Binance ticker stream...")
                    self._task_bin_ticker = asyncio.create_task(self._run_binance_ticker())
                
                if self._task_bybit and self._task_bybit.done():
                    exc = None
                    try:
                        exc = self._task_bybit.exception()
                    except Exception:
                        pass
                    if exc:
                        log.error(f"Bybit kline task died unexpectedly: {exc}")
                    else:
                        log.warning("Bybit kline task completed unexpectedly")
                    log.info("Restarting Bybit kline stream...")
                    self._task_bybit = asyncio.create_task(self._run_bybit())
                
                if self._task_bybit_ticker and self._task_bybit_ticker.done():
                    exc = None
                    try:
                        exc = self._task_bybit_ticker.exception()
                    except Exception:
                        pass
                    if exc:
                        log.error(f"Bybit ticker task died unexpectedly: {exc}")
                    else:
                        log.warning("Bybit ticker task completed unexpectedly")
                    log.info("Restarting Bybit ticker stream...")
                    self._task_bybit_ticker = asyncio.create_task(self._run_bybit_ticker())
                    
            except Exception as e:
                log.error(f"Error in task health monitor: {e}", exc_info=True)

    async def _backfill_binance(self, limit: int = 200):
        syms = await self.binance.symbols()
        url = f"{BINANCE_FUTURES_REST}/fapi/v1/klines"
        for s in syms:
            try:
                # 1m backfill (drives resampler)
                r = await self._client.get(url, params={"symbol": s, "interval": "1m", "limit": limit})
                r.raise_for_status()
                arr = r.json()
                for row in arr:
                    open_time = int(row[0])
                    open_ = float(row[1]); high = float(row[2]); low = float(row[3]); close = float(row[4])
                    quote_vol = float(row[7])
                    from ..models import Kline
                    k = Kline(symbol=s, open_time=open_time, close_time=int(row[6]), open=open_, high=high, low=low, close=close, volume=quote_vol, closed=True, exchange="binance")
                    await self.agg.ingest(k)
                # Direct HTF backfill into store (15m and 4h)
                try:
                    from ..services.ohlc_store import upsert_candle
                    for interval, iv in [("15m", "15m"), ("4h", "4h")]:
                        r15 = await self._client.get(url, params={"symbol": s, "interval": iv, "limit": 200})
                        r15.raise_for_status()
                        arr15 = r15.json()
                        for row in arr15:
                            ot = int(row[0]); ct = int(row[6])
                            o = float(row[1]); h = float(row[2]); l = float(row[3]); c = float(row[4]); v = float(row[7])
                            upsert_candle("binance", s, interval, ot, ct, o, h, l, c, v)
                    # Seed state from DB so WT has context
                    self.agg.seed_htf_from_db(s)
                except Exception:
                    pass
            except Exception:
                continue
    
    async def _backfill_bybit(self, limit: int = 200):
        """Backfill historical kline data for Bybit symbols"""
        from ..config import BYBIT_REST
        syms = await self.bybit.symbols()
        url = f"{BYBIT_REST}/v5/market/kline"
        import logging
        log = logging.getLogger(__name__)
        for s in syms:
            try:
                # Bybit v5 API parameters
                r = await self._client.get(url, params={
                    "category": "linear",
                    "symbol": s,
                    "interval": "1",  # 1 minute
                    "limit": limit
                })
                r.raise_for_status()
                result = r.json()
                klines = result.get("result", {}).get("list", [])
                # Bybit returns newest first, reverse to oldest first
                klines.reverse()
                for row in klines:
                    # [startTime, open, high, low, close, volume, turnover]
                    open_time = int(row[0])
                    open_ = float(row[1])
                    high = float(row[2])
                    low = float(row[3])
                    close = float(row[4])
                    turnover = float(row[6])  # quote volume
                    from ..models import Kline
                    k = Kline(
                        symbol=s, 
                        open_time=open_time, 
                        close_time=open_time+60_000, 
                        open=open_, 
                        high=high, 
                        low=low, 
                        close=close, 
                        volume=turnover, 
                        closed=True, 
                        exchange="bybit"
                    )
                    await self.agg_bybit.ingest(k)
                # Direct HTF backfill into store (15m and 4h)
                try:
                    from ..services.ohlc_store import upsert_candle
                    for interval, iv in [("15m", "15"), ("4h", "240")]:
                        r15 = await self._client.get(url, params={
                            "category": "linear",
                            "symbol": s,
                            "interval": iv,
                            "limit": 200
                        })
                        r15.raise_for_status()
                        result15 = r15.json()
                        rows15 = result15.get("result", {}).get("list", [])
                        # newest first
                        for row in rows15:
                            ot = int(row[0]); ct = ot + int(iv) * 60_000
                            o = float(row[1]); h = float(row[2]); l = float(row[3]); c = float(row[4]);
                            turnover = float(row[6]) if len(row) > 6 and row[6] is not None else 0.0
                            upsert_candle("bybit", s, interval, ot, ct, o, h, l, c, turnover)
                    # Seed state from DB so WT has context
                    self.agg_bybit.seed_htf_from_db(s)
                except Exception as e:
                    log.debug(f"Bybit HTF backfill error for {s}: {e}")
            except Exception as e:
                log.debug(f"Bybit backfill error for {s}: {e}")
                continue
    async def _run_binance_ticker(self):
        import logging
        log = logging.getLogger(__name__)
        try:
            syms = await self.binance.symbols()
            async for sym, price, ts in stream_minitickers(BINANCE_FUTURES_WS, syms):
                try:
                    await self.agg.update_ticker(sym, price, ts)
                except Exception as e:
                    log.debug(f"Error updating Binance ticker for {sym}: {e}")
                    continue
        except asyncio.CancelledError:
            log.info("Binance ticker stream cancelled")
            raise
        except Exception as e:
            log.error(f"Binance ticker stream fatal error: {e}", exc_info=True)
            raise

    async def _run_bybit_ticker(self):
        import logging
        log = logging.getLogger(__name__)
        try:
            syms = await self.bybit.symbols()
            from ..exchanges.bybit_ticker_ws import stream_tickers as bybit_stream_tickers
            async for sym, price, ts in bybit_stream_tickers(syms):
                try:
                    await self.agg_bybit.update_ticker(sym, price, ts)
                except Exception as e:
                    log.debug(f"Error updating Bybit ticker for {sym}: {e}")
                    continue
        except asyncio.CancelledError:
            log.info("Bybit ticker stream cancelled")
            raise
        except Exception as e:
            log.error(f"Bybit ticker stream fatal error: {e}", exc_info=True)
            raise

    async def _run_bybit(self):
        import logging
        log = logging.getLogger(__name__)
        try:
            async for k in self.bybit.stream_1m_klines():
                await self.agg_bybit.ingest(k)
        except asyncio.CancelledError:
            log.info("Bybit kline stream cancelled")
            raise
        except Exception as e:
            log.error(f"Bybit kline stream fatal error: {e}", exc_info=True)
            raise
    
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

    async def _run_bybit_liquidations(self, symbols: list):
        """Run Bybit liquidations WebSocket collectors for top symbols.
        
        Only subscribes to top N symbols by volume to avoid too many connections.
        Liquidations are stored in memory and accessible via the market_data service.
        """
        import logging
        log = logging.getLogger(__name__)
        
        # Limit to top 50 symbols to avoid overwhelming connections
        # Liquidations are most important for high-volume symbols
        top_symbols = symbols[:50] if len(symbols) > 50 else symbols
        
        log.info(f"Starting Bybit liquidations collectors for {len(top_symbols)} symbols")
        
        try:
            from ..exchanges.bybit_liquidations_ws import run_liquidation_collector
            await run_liquidation_collector(top_symbols)
        except asyncio.CancelledError:
            log.info("Bybit liquidations stream cancelled")
            raise
        except Exception as e:
            log.error(f"Bybit liquidations stream error: {e}", exc_info=True)
            raise

    async def stop(self):
        """Stop all running tasks and close clients."""
        tasks = [
            self._task,
            self._task_bybit,
            self._task_bin_ticker,
            self._task_bybit_ticker,
            self._task_bin_oi,
            self._task_bybit_oi,
            self._task_bybit_liquidations,
            getattr(self, "_task_health_monitor", None),
            getattr(self, "_task_full_refresh", None),
        ]

        for t in tasks:
            if t and not t.done():
                t.cancel()

        for t in tasks:
            if t:
                try:
                    await t
                except Exception:
                    pass

        try:
            await self.oi_fetcher.stop()
        except Exception:
            pass

        try:
            await self._client.aclose()
        except Exception:
            pass
