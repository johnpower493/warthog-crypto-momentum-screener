from __future__ import annotations
import asyncio
import json
from typing import Dict, List

from ..models import Kline, SymbolMetrics, ScreenerSnapshot
from ..metrics.calculator import SymbolState
from ..services.redis_client import publish_json

class Aggregator:
    def __init__(self, exchange: str):
        # initialize OHLC store
        try:
            from .ohlc_store import init_db
            init_db()
        except Exception:
            pass
        self.exchange = exchange
        self._states: Dict[str, SymbolState] = {}
        # Per-symbol last update timestamps (epoch ms)
        self._last_kline_by_symbol: Dict[str, int] = {}
        self._last_ticker_by_symbol: Dict[str, int] = {}
        self._subscribers: List[asyncio.Queue] = []
        self._lock = asyncio.Lock()
        # Initialize timestamps to current time to prevent false watchdog triggers
        import time
        now_ms = int(time.time() * 1000)
        self.last_emit_ts: int = now_ms
        # NOTE: We track kline and ticker ingest separately so watchdogs can
        # detect when one stream dies while the other continues.
        self.last_kline_ingest_ts: int = now_ms
        self.last_ticker_ingest_ts: int = now_ms
        # Backwards-compatible aggregate timestamp (max of the above)
        self.last_ingest_ts: int = now_ms
        from ..config import SNAPSHOT_INTERVAL_MS
        self._throttle_ms: int = SNAPSHOT_INTERVAL_MS

    async def ingest(self, k: Kline):
        state = self._states.get(k.symbol)
        if state is None:
            state = SymbolState(symbol=k.symbol, exchange=self.exchange)
            self._states[k.symbol] = state
        state.update(k)
        import time
        now_ms = int(time.time() * 1000)
        self.last_kline_ingest_ts = now_ms
        self._last_kline_by_symbol[k.symbol] = now_ms
        self.last_ingest_ts = max(self.last_kline_ingest_ts, self.last_ticker_ingest_ts)
        # Throttled emit
        await self.emit_if_due()

    async def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._subscribers.append(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue):
        async with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def build_snapshot(self) -> ScreenerSnapshot:
        metrics = [st.compute_metrics() for st in self._states.values()]
        # Enrich with liquidity ranks/cohort
        try:
            from .universe_provider import compute_liquidity_ranks
            ranks, top = compute_liquidity_ranks(self.exchange, metrics)
            for m in metrics:
                m.liquidity_rank = ranks.get(m.symbol)
                m.liquidity_top200 = m.symbol in top
        except Exception:
            pass
        # Enrich with market cap data
        try:
            from .market_cap import get_provider
            mc_provider = get_provider()
            for m in metrics:
                mc = mc_provider.get_market_cap(m.symbol)
                m.market_cap = mc
        except Exception as e:
            import logging
            logging.getLogger(__name__).debug(f"Market cap enrichment error: {e}")
        snap = ScreenerSnapshot(exchange=self.exchange, ts=max((m.ts for m in metrics), default=0), metrics=metrics)
        try:
            import logging
            logging.getLogger(__name__).debug(f"Emit snapshot: {len(metrics)} metrics")
        except Exception:
            pass
        return snap

    def _build_snapshot_payload(self) -> str:
        snap = self.build_snapshot()
        payload = snap.model_dump_json()
        return payload

    async def emit_if_due(self):
        now_ms = int(__import__('time').time() * 1000)
        if now_ms - self.last_emit_ts < self._throttle_ms:
            return
        await self._emit_snapshot()

    async def heartbeat_emit(self):
        await self._emit_snapshot()

    async def _emit_snapshot(self):
        # Build snapshot object (for alerts) and payload
        snap = self.build_snapshot()
        payload = snap.model_dump_json()
        try:
            self.last_emit_ts = int(__import__('time').time()*1000)
        except Exception:
            pass
        # Persist alerts + trade plans, then fire notifications
        try:
            from ..config import TRADEPLAN_ENABLE
            if TRADEPLAN_ENABLE:
                from .trade_plan import build_trade_plan
                from .alert_store import insert_alert, insert_trade_plan
                from .ohlc_store import get_recent
                import json
                from ..config import TRADEPLAN_SWING_LOOKBACK_15M
                for m in snap.metrics:
                    if not (m.cipher_buy is True or m.cipher_sell is True):
                        continue
                    side = "BUY" if m.cipher_buy else "SELL"
                    # get 15m structure from store
                    rows15 = get_recent(m.exchange, m.symbol, '15m', limit=TRADEPLAN_SWING_LOOKBACK_15M)
                    highs = [float(r[3]) for r in rows15] if rows15 else []
                    lows = [float(r[4]) for r in rows15] if rows15 else []
                    swing_high = max(highs) if highs else None
                    swing_low = min(lows) if lows else None
                    plan = build_trade_plan(side=side, entry_price=float(m.last_price), atr=m.atr, swing_high_15m=swing_high, swing_low_15m=swing_low)
                    md = m.model_dump()
                    try:
                        from .grader import grade_alert
                        setup_score, setup_grade, avoid = grade_alert(md, side)
                        # attach to in-memory metric for downstream (web UI + telegram/discord)
                        m.setup_score = setup_score
                        m.setup_grade = setup_grade
                        m.avoid_reasons = avoid
                    except Exception:
                        setup_score, setup_grade, avoid = None, None, None

                    alert_id = insert_alert(
                        ts=int(m.ts),
                        exchange=m.exchange,
                        symbol=m.symbol,
                        signal=side,
                        source_tf=m.cipher_source_tf,
                        price=float(m.last_price),
                        reason=m.cipher_reason,
                        metrics=md,
                        created_ts=int(__import__('time').time() * 1000),
                        setup_score=setup_score,
                        setup_grade=setup_grade,
                        avoid_reasons=avoid,
                    )
                    if alert_id:
                        insert_trade_plan(
                            alert_id=alert_id,
                            ts=int(m.ts),
                            exchange=m.exchange,
                            symbol=m.symbol,
                            side=side,
                            entry_type=plan.entry_type,
                            entry_price=plan.entry_price,
                            stop_loss=plan.stop_loss,
                            tp1=plan.tp1,
                            tp2=plan.tp2,
                            tp3=plan.tp3,
                            atr=plan.atr,
                            atr_mult=plan.atr_mult,
                            swing_ref=plan.swing_ref,
                            risk_per_unit=plan.risk_per_unit,
                            rr_tp1=plan.rr_tp1,
                            rr_tp2=plan.rr_tp2,
                            rr_tp3=plan.rr_tp3,
                            plan=plan.plan_json,
                        )
        except Exception:
            pass
        # Fire alerts (non-blocking best-effort)
        try:
            from .alerter import process_metrics
            await process_metrics(snap.metrics)
        except Exception:
            pass
        # fan out to subscribers (non-blocking)
        async with self._lock:
            for q in list(self._subscribers):
                try:
                    if q.full():
                        _ = q.get_nowait()
                    q.put_nowait(payload)
                except Exception:
                    try:
                        self._subscribers.remove(q)
                    except ValueError:
                        pass
        # publish to redis channel
        await publish_json("screener:snapshot", payload)

    def state_count(self) -> int:
        return len(self._states)

    def stale_symbols(
        self,
        now_ms: int,
        ticker_stale_ms: int = 30_000,
        kline_stale_ms: int = 90_000,
        include_lists: bool = False,
    ) -> dict:
        """Return stale symbols for ticker/kline.

        ticker_stale_ms: threshold for last ticker update age
        kline_stale_ms: threshold for last kline update age
        """
        stale_ticker = [] if include_lists else None
        stale_kline = [] if include_lists else None
        ticker_count = 0
        kline_count = 0

        for sym in self._states.keys():
            t = self._last_ticker_by_symbol.get(sym)
            k = self._last_kline_by_symbol.get(sym)
            if t is None or now_ms - t > ticker_stale_ms:
                ticker_count += 1
                if include_lists:
                    stale_ticker.append(sym)  # type: ignore[union-attr]
            if k is None or now_ms - k > kline_stale_ms:
                kline_count += 1
                if include_lists:
                    stale_kline.append(sym)  # type: ignore[union-attr]

        if include_lists:
            stale_ticker.sort()  # type: ignore[union-attr]
            stale_kline.sort()  # type: ignore[union-attr]

        return {
            "ticker": stale_ticker if include_lists else [],
            "kline": stale_kline if include_lists else [],
            "ticker_count": ticker_count,
            "kline_count": kline_count,
            "include_lists": include_lists,
            "ticker_stale_ms": ticker_stale_ms,
            "kline_stale_ms": kline_stale_ms,
        }

    def get_history(self, symbol: str, limit: int = 60):
        st = self._states.get(symbol)
        if not st:
            return []
        vals = list(st.close_1m.values)
        return vals[-limit:]

    def get_oi_history(self, symbol: str, limit: int = 60):
        st = self._states.get(symbol)
        if not st:
            return []
        vals = list(st.oi_1m.values)
        return vals[-limit:]

    def seed_htf_from_db(self, symbol: str):
        """Reload 15m/4h series for a symbol from the OHLC store"""
        st = self._states.get(symbol)
        if not st:
            return
        try:
            from ..services.ohlc_store import get_recent
            for tf in ['15m', '4h']:
                rows = get_recent(st.exchange, symbol, tf, limit=300)
                # Clear existing HTF series
                st._htf[tf]['close'] = type(st._htf[tf]['close'])(maxlen=st._htf[tf]['close'].values.maxlen)  # type: ignore
                st._htf[tf]['high'] = type(st._htf[tf]['high'])(maxlen=st._htf[tf]['high'].values.maxlen)    # type: ignore
                st._htf[tf]['low'] = type(st._htf[tf]['low'])(maxlen=st._htf[tf]['low'].values.maxlen)      # type: ignore
                st._htf[tf]['vol'] = type(st._htf[tf]['vol'])(maxlen=st._htf[tf]['vol'].values.maxlen)      # type: ignore
                st._htf[tf]['current'] = None
                for (ot, ct, o, h, l, c, v) in rows:
                    st._htf[tf]['close'].append(c)
                    st._htf[tf]['high'].append(h)
                    st._htf[tf]['low'].append(l)
                    st._htf[tf]['vol'].append(v)
        except Exception:
            pass

    async def update_ticker(self, symbol: str, price: float, ts_ms: int | None = None):
        state = self._states.get(symbol)
        if state is None:
            state = SymbolState(symbol=symbol, exchange=self.exchange)
            self._states[symbol] = state
        state.last_price = price
        import time
        now_ms = ts_ms or int(time.time() * 1000)
        self.last_ticker_ingest_ts = now_ms
        self._last_ticker_by_symbol[symbol] = now_ms
        self.last_ingest_ts = max(self.last_kline_ingest_ts, self.last_ticker_ingest_ts)
        await self.emit_if_due()
    
    async def update_open_interest(self, symbol: str, oi_value: float):
        """Update open interest for a symbol"""
        state = self._states.get(symbol)
        if state is None:
            state = SymbolState(symbol=symbol, exchange=self.exchange)
            self._states[symbol] = state
        state.open_interest = oi_value
        state.oi_1m.append(oi_value)
        # Don't emit on OI update - let the regular throttle handle it
