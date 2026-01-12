from __future__ import annotations
from collections import deque
from typing import Deque, Dict, Optional, Callable, Any
import math
import time

from ..models import Kline, SymbolMetrics
from ..config import WINDOW_SHORT, WINDOW_MEDIUM, ATR_PERIOD, VOL_LOOKBACK, CIPHERB_OS_LEVEL, CIPHERB_OB_LEVEL

class RollingSeries:
    def __init__(self, maxlen: int):
        self.values: Deque[float] = deque(maxlen=maxlen)
    def append(self, v: float):
        self.values.append(v)
    def __len__(self):
        return len(self.values)
    def last(self) -> Optional[float]:
        return self.values[-1] if self.values else None

class SymbolState:
    def __init__(self, symbol: str, exchange: str):
        self.symbol = symbol
        self.exchange = exchange
        # maxlen needs to accommodate %R slow period (112) + smoothing (3) + buffer = 120
        maxlen = max(120, 61, WINDOW_MEDIUM+1, ATR_PERIOD+1, VOL_LOOKBACK+1)
        self.close_1m = RollingSeries(maxlen=maxlen)
        self.high_1m = RollingSeries(maxlen=maxlen)
        self.low_1m = RollingSeries(maxlen=maxlen)
        self.vol_1m = RollingSeries(maxlen=maxlen)
        self.oi_1m = RollingSeries(maxlen=maxlen)  # open interest series
        self.last_price: Optional[float] = None
        self.atr: Optional[float] = None
        self.open_interest: Optional[float] = None
        
        # Open prices for MFI calculation
        self.open_1m = RollingSeries(maxlen=maxlen)
        
        # ATR history for volatility percentile
        self.atr_history: list[float] = []
        
        # Signal timestamps for "time since signal"
        self.last_cipher_signal_ts: Optional[int] = None
        self.last_percent_r_signal_ts: Optional[int] = None
        
        # Indicator cache to avoid recalculating expensive indicators
        # Cache structure: {indicator_key: (timestamp_ms, cached_value)}
        self._indicator_cache: Dict[str, tuple[int, any]] = {}
        self._cache_ttl_ms: int = 15000  # 15 seconds (shorter than 15m candle)

        # Higher timeframe rolling series (closed candles only)
        maxlen_htf = 400
        self._htf = {
            '15m': {
                'interval_ms': 15 * 60_000,
                'current': None,  # type: ignore
                'close': RollingSeries(maxlen=maxlen_htf),
                'high': RollingSeries(maxlen=maxlen_htf),
                'low': RollingSeries(maxlen=maxlen_htf),
                'vol': RollingSeries(maxlen=maxlen_htf),
            },
            '4h': {
                'interval_ms': 240 * 60_000,
                'current': None,  # type: ignore
                'close': RollingSeries(maxlen=maxlen_htf),
                'high': RollingSeries(maxlen=maxlen_htf),
                'low': RollingSeries(maxlen=maxlen_htf),
                'vol': RollingSeries(maxlen=maxlen_htf),
            }
        }
        # Indicator cache to avoid recalculating expensive indicators
        # Cache structure: {indicator_key: (timestamp_ms, cached_value)}
        self._indicator_cache: Dict[str, tuple[int, Any]] = {}
        self._cache_ttl_ms: int = 15000  # 15 seconds (shorter than 15m candle)
        
        # Seed from DB if available (note: batch loading is done at aggregator level)
        # Individual symbols can still use get_recent for lazy loading
        try:
            from ..services.ohlc_store import get_recent
            for tf in ['15m', '4h']:
                rows = get_recent(self.exchange, self.symbol, tf, limit=300)
                for (ot, ct, o, h, l, c, v) in rows:
                    self._htf[tf]['close'].append(c)
                    self._htf[tf]['high'].append(h)
                    self._htf[tf]['low'].append(l)
                    self._htf[tf]['vol'].append(v)
        except Exception:
            pass
    
    def _get_cached_or_compute(self, cache_key: str, compute_fn: Callable[[], Any]) -> Any:
        """Get cached value or compute and cache it."""
        now_ms = int(time.time() * 1000)
        
        # Check if we have a valid cached value
        if cache_key in self._indicator_cache:
            cached_ts, cached_val = self._indicator_cache[cache_key]
            if now_ms - cached_ts < self._cache_ttl_ms:
                return cached_val
        
        # Compute new value and cache it
        new_val = compute_fn()
        self._indicator_cache[cache_key] = (now_ms, new_val)
        return new_val

    def _resample_htf(self, k: Kline):
        # Only resample on closed 1m candles to avoid intrabar noise
        if not getattr(k, 'closed', True):
            return
        # Update 15m and 4h aggregations using incoming 1m closed candle
        for tf in ['15m', '4h']:
            cfg = self._htf[tf]
            interval_ms = cfg['interval_ms']
            bucket_open = k.open_time - (k.open_time % interval_ms)
            cur = cfg['current']
            if cur is None or cur['open_time'] != bucket_open:
                # finalize previous if exists
                if cur is not None:
                    # append to rolling series and persist
                    cfg['close'].append(cur['close'])
                    cfg['high'].append(cur['high'])
                    cfg['low'].append(cur['low'])
                    cfg['vol'].append(cur['volume'])
                    try:
                        from ..services.ohlc_store import upsert_candle
                        upsert_candle(
                            self.exchange, self.symbol, tf,
                            cur['open_time'], cur['close_time'],
                            cur['open'], cur['high'], cur['low'], cur['close'], cur['volume']
                        )
                    except Exception:
                        pass
                # start new
                cfg['current'] = {
                    'open_time': bucket_open,
                    'close_time': bucket_open + interval_ms,
                    'open': k.open,
                    'high': k.high,
                    'low': k.low,
                    'close': k.close,
                    'volume': k.volume,
                }
            else:
                # update existing bucket
                cur['high'] = max(cur['high'], k.high)
                cur['low'] = min(cur['low'], k.low)
                cur['close'] = k.close
                cur['volume'] += k.volume

    def update(self, k: Kline):
        # 1m series
        self.close_1m.append(k.close)
        self.high_1m.append(k.high)
        self.low_1m.append(k.low)
        self.vol_1m.append(k.volume)
        self.open_1m.append(k.open)  # For MFI calculation
        self.last_price = k.close
        if len(self.close_1m.values) >= ATR_PERIOD+1:
            self.atr = compute_atr(list(self.high_1m.values), list(self.low_1m.values), list(self.close_1m.values))
            # Track ATR history for volatility percentile
            if self.atr is not None:
                self.atr_history.append(self.atr)
                # Keep last 100 ATR values
                if len(self.atr_history) > 100:
                    self.atr_history = self.atr_history[-100:]
        # update higher timeframe resamplers
        try:
            self._resample_htf(k)
        except Exception:
            pass

    def compute_metrics(self) -> SymbolMetrics:
        # Use last_price for real-time changes if available, otherwise use close_1m
        current_price = self.last_price if self.last_price is not None else (self.close_1m.last() or 0.0)
        ch_1 = pct_change_with_current(self.close_1m.values, 1, current_price)
        ch_5 = pct_change_with_current(self.close_1m.values, WINDOW_SHORT, current_price)
        ch_15 = pct_change_with_current(self.close_1m.values, WINDOW_MEDIUM, current_price)
        ch_60 = pct_change_with_current(self.close_1m.values, 60, current_price)
        vol_z = zscore_abs_ret(self.close_1m.values, VOL_LOOKBACK)
        v1 = sum_tail(self.vol_1m.values, 1)
        v5 = sum_tail(self.vol_1m.values, 5)
        v15 = sum_tail(self.vol_1m.values, 15)
        rvol = rvol_ratio(self.vol_1m.values, 1, VOL_LOOKBACK)
        brk = breakout(self.close_1m.values, self.high_1m.values, 15)
        brkd = breakdown(self.close_1m.values, self.low_1m.values, 15)
        vwap15 = vwap(self.close_1m.values, self.vol_1m.values, 15)
        
        # Open Interest changes
        oi_5m = pct_change(self.oi_1m.values, WINDOW_SHORT)
        oi_15m = pct_change(self.oi_1m.values, WINDOW_MEDIUM)
        oi_60m = pct_change(self.oi_1m.values, 60)
        
        # Momentum indicators (use current price for real-time momentum)
        mom_5m = momentum_with_current(self.close_1m.values, WINDOW_SHORT, current_price)
        mom_15m = momentum_with_current(self.close_1m.values, WINDOW_MEDIUM, current_price)
        mom_score = momentum_score_with_current(self.close_1m.values, current_price)

        # Cipher B WaveTrend
        # 1m WT is kept for reference/visualization, but buy/sell uses higher TF confirmation
        wt1_1m, wt2_1m, wt1_prev_1m, wt2_prev_1m = wavetrend(
            self.close_1m.values,
            self.high_1m.values,
            self.low_1m.values,
            chlen=9,
            avg=12,
            malen=3,
        )

        # Compute HTF WT on closed candles only (15m and 4h)
        wt15 = wavetrend(
            self._htf['15m']['close'].values,
            self._htf['15m']['high'].values,
            self._htf['15m']['low'].values,
            chlen=9, avg=12, malen=3,
        )
        wt4h = wavetrend(
            self._htf['4h']['close'].values,
            self._htf['4h']['high'].values,
            self._htf['4h']['low'].values,
            chlen=9, avg=12, malen=3,
        )
        def _signals_from_tuple(wt_tuple: tuple[Optional[float],Optional[float],Optional[float],Optional[float]]):
            if not wt_tuple or len(wt_tuple) != 4:
                return (None, None)
            return cipher_b_signals(
                wt_tuple[0], wt_tuple[1], wt_tuple[2], wt_tuple[3],
                os_level=CIPHERB_OS_LEVEL, ob_level=CIPHERB_OB_LEVEL,
            )
        buy15, sell15 = _signals_from_tuple(wt15)
        buy4h, sell4h = _signals_from_tuple(wt4h)
        # EITHER policy: trigger if 15m OR 4h has a fresh cross at close
        cipher_buy = True if ((buy15 is True) or (buy4h is True)) else (False if ((buy15 is False) and (buy4h is False)) else None)
        cipher_sell = True if ((sell15 is True) or (sell4h is True)) else (False if ((sell15 is False) and (sell4h is False)) else None)

        # Explainability: which TF triggered and why
        cipher_source_tf = None
        cipher_reason = None
        if cipher_buy is True:
            tf = '15m' if buy15 else ('4h' if buy4h else None)
            cipher_source_tf = tf
            if tf == '15m' and wt15 and len(wt15) == 4:
                cipher_reason = f"CipherB BUY: {tf} cross-up at WT1={wt15[0]:.2f}, WT2={wt15[1]:.2f} (os<={CIPHERB_OS_LEVEL})"
            elif tf == '4h' and wt4h and len(wt4h) == 4:
                cipher_reason = f"CipherB BUY: {tf} cross-up at WT1={wt4h[0]:.2f}, WT2={wt4h[1]:.2f} (os<={CIPHERB_OS_LEVEL})"
        elif cipher_sell is True:
            tf = '15m' if sell15 else ('4h' if sell4h else None)
            cipher_source_tf = tf
            if tf == '15m' and wt15 and len(wt15) == 4:
                cipher_reason = f"CipherB SELL: {tf} cross-down at WT1={wt15[0]:.2f}, WT2={wt15[1]:.2f} (ob>={CIPHERB_OB_LEVEL})"
            elif tf == '4h' and wt4h and len(wt4h) == 4:
                cipher_reason = f"CipherB SELL: {tf} cross-down at WT1={wt4h[0]:.2f}, WT2={wt4h[1]:.2f} (ob>={CIPHERB_OB_LEVEL})"
        
        # %R Trend Exhaustion (HTF: 15m and 4h like Cipher B)
        # Calculate on both 15m and 4h closed candles for more reliable signals
        r15m = percent_r_trend_exhaustion(
            self._htf['15m']['high'].values,
            self._htf['15m']['low'].values,
            self._htf['15m']['close'].values,
            short_length=21,
            short_smoothing=7,
            long_length=112,
            long_smoothing=3,
            threshold=20,
            smoothing_type='ema',
        )
        r4h = percent_r_trend_exhaustion(
            self._htf['4h']['high'].values,
            self._htf['4h']['low'].values,
            self._htf['4h']['close'].values,
            short_length=21,
            short_smoothing=7,
            long_length=112,
            long_smoothing=3,
            threshold=20,
            smoothing_type='ema',
        )
        
        def _r_signals_from_tuple(r_tuple):
            """Extract reversal signals from %R tuple"""
            if not r_tuple or r_tuple[0] is None:
                return (None, None)
            # r_tuple = (fast_r, slow_r, fast_r_prev, slow_r_prev, 
            #            ob_trend_start, os_trend_start, ob_reversal, os_reversal, cross_bull, cross_bear)
            return (r_tuple[7], r_tuple[6])  # (os_reversal=BUY, ob_reversal=SELL)
        
        buy15m, sell15m = _r_signals_from_tuple(r15m)
        buy4h, sell4h = _r_signals_from_tuple(r4h)
        
        # EITHER policy: trigger if 15m OR 4h has a fresh reversal signal
        percent_r_os_reversal = True if ((buy15m is True) or (buy4h is True)) else (False if ((buy15m is False) and (buy4h is False)) else None)
        percent_r_ob_reversal = True if ((sell15m is True) or (sell4h is True)) else (False if ((sell15m is False) and (sell4h is False)) else None)
        
        # Extract values for display (use whichever timeframe triggered, prefer 15m)
        percent_r_fast = r15m[0] if r15m[0] is not None else r4h[0]
        percent_r_slow = r15m[1] if r15m[1] is not None else r4h[1]
        
        # For other signals, use 15m if available, otherwise 4h
        percent_r_ob_trend_start = r15m[4] if r15m[4] is not None else r4h[4]
        percent_r_os_trend_start = r15m[5] if r15m[5] is not None else r4h[5]
        percent_r_cross_bull = r15m[8] if r15m[8] is not None else r4h[8]
        percent_r_cross_bear = r15m[9] if r15m[9] is not None else r4h[9]
        
        # Build %R reason string with timeframe attribution
        percent_r_source_tf = None
        percent_r_reason = None
        if percent_r_os_reversal is True:
            tf = '15m' if buy15m else ('4h' if buy4h else None)
            percent_r_source_tf = tf
            fast = r15m[0] if tf == '15m' else r4h[0]
            slow = r15m[1] if tf == '15m' else r4h[1]
            if fast is not None and slow is not None:
                percent_r_reason = f"%RTE BUY: {tf} Bullish reversal ▲ (exited OS zone, fast=%R={fast:.1f}, slow=%R={slow:.1f})"
        elif percent_r_ob_reversal is True:
            tf = '15m' if sell15m else ('4h' if sell4h else None)
            percent_r_source_tf = tf
            fast = r15m[0] if tf == '15m' else r4h[0]
            slow = r15m[1] if tf == '15m' else r4h[1]
            if fast is not None and slow is not None:
                percent_r_reason = f"%RTE SELL: {tf} Bearish reversal ▼ (exited OB zone, fast=%R={fast:.1f}, slow=%R={slow:.1f})"
        
        # Impulse score (useful for scalping screens)
        # Goal: surface symbols with unusually large *current* movement + activity.
        impulse_sc, impulse_dir = calculate_impulse_score(
            change_1m=ch_1,
            vol_zscore=vol_z,
            rvol=rvol,
            momentum_score=mom_score,
        )

        # Combined signal score
        signal_sc, signal_str = calculate_signal_score(
            momentum_score=mom_score,
            oi_change_5m=oi_5m,
            rvol=rvol,
            breakout=brk,
            vol_zscore=vol_z
        )
        
        # Technical Indicators (calculated on 15m HTF for more stable signals)
        # Use caching to avoid expensive recalculations
        closes_15m = list(self._htf['15m']['close'].values)
        
        # Cache key includes data length to invalidate when new candle arrives
        cache_suffix = f"_{len(closes_15m)}"
        
        rsi_14_val = self._get_cached_or_compute(
            f"rsi_14{cache_suffix}",
            lambda: rsi(closes_15m, period=14) if len(closes_15m) >= 15 else None
        )
        
        macd_val, macd_sig_val, macd_hist_val = self._get_cached_or_compute(
            f"macd{cache_suffix}",
            lambda: macd(closes_15m, fast=12, slow=26, signal=9) if len(closes_15m) >= 35 else (None, None, None)
        )
        
        stoch_k_val, stoch_d_val = self._get_cached_or_compute(
            f"stoch_rsi{cache_suffix}",
            lambda: stochastic_rsi(closes_15m, rsi_period=14, stoch_period=14, k_smooth=3, d_smooth=3) if len(closes_15m) >= 35 else (None, None)
        )
        
        # Money Flow Index (Cipher B style) - Multiple Timeframes
        # 1h MFI (1m data, 60 periods = 1 hour)
        mfi_1h_val = money_flow_index(
            list(self.open_1m.values),
            list(self.high_1m.values),
            list(self.low_1m.values),
            list(self.close_1m.values),
            period=60,
            multiplier=150,
        )
        
        # 15m MFI (15m data, 60 periods = 15 hours)
        mfi_15m_val = None
        if len(self._htf['15m']['close'].values) >= 60:
            # Need to track opens for 15m - use close approximation or add open tracking
            closes_15m_list = list(self._htf['15m']['close'].values)
            highs_15m_list = list(self._htf['15m']['high'].values)
            lows_15m_list = list(self._htf['15m']['low'].values)
            # Approximate open as previous close (common approximation)
            opens_15m_approx = [closes_15m_list[0]] + closes_15m_list[:-1]
            mfi_15m_val = money_flow_index(
                opens_15m_approx,
                highs_15m_list,
                lows_15m_list,
                closes_15m_list,
                period=60,
                multiplier=150,
            )
        
        # 4h MFI (4h data, 60 periods = 10 days)
        mfi_4h_val = None
        if len(self._htf['4h']['close'].values) >= 60:
            closes_4h_list = list(self._htf['4h']['close'].values)
            highs_4h_list = list(self._htf['4h']['high'].values)
            lows_4h_list = list(self._htf['4h']['low'].values)
            opens_4h_approx = [closes_4h_list[0]] + closes_4h_list[:-1]
            mfi_4h_val = money_flow_index(
                opens_4h_approx,
                highs_4h_list,
                lows_4h_list,
                closes_4h_list,
                period=60,
                multiplier=150,
            )
        
        # Multi-Timeframe Confluence
        wt_1m_tuple = (wt1_1m, wt2_1m, wt1_prev_1m, wt2_prev_1m)
        mtf_bull, mtf_bear, mtf_summary_str = mtf_confluence(
            wt_1m_tuple, wt15, wt4h, r15m, r4h
        )
        
        # Volatility Percentile
        vol_pct = volatility_percentile(self.atr_history, self.atr, lookback=30) if self.atr else None
        
        # Time Since Signal - update timestamps if signal fired
        now_ms = int(time.time() * 1000)
        if cipher_buy is True or cipher_sell is True:
            self.last_cipher_signal_ts = now_ms
        if percent_r_os_reversal is True or percent_r_ob_reversal is True:
            self.last_percent_r_signal_ts = now_ms
        
        # Calculate age
        cipher_age = (now_ms - self.last_cipher_signal_ts) if self.last_cipher_signal_ts else None
        percent_r_age = (now_ms - self.last_percent_r_signal_ts) if self.last_percent_r_signal_ts else None
        
        # Sector Tags
        tags = get_sector_tags(self.symbol)
        
        return SymbolMetrics(
            symbol=self.symbol,
            exchange=self.exchange,
            last_price=self.last_price or 0.0,
            wt1=wt1_1m,
            wt2=wt2_1m,
            cipher_buy=cipher_buy,
            cipher_sell=cipher_sell,
            percent_r_fast=percent_r_fast,
            percent_r_slow=percent_r_slow,
            percent_r_ob_trend_start=percent_r_ob_trend_start,
            percent_r_os_trend_start=percent_r_os_trend_start,
            percent_r_ob_reversal=percent_r_ob_reversal,
            percent_r_os_reversal=percent_r_os_reversal,
            percent_r_cross_bull=percent_r_cross_bull,
            percent_r_cross_bear=percent_r_cross_bear,
            percent_r_source_tf=percent_r_source_tf,
            percent_r_reason=percent_r_reason,
            impulse_score=impulse_sc,
            impulse_dir=impulse_dir,
            change_1m=ch_1,
            change_5m=ch_5,
            change_15m=ch_15,
            change_60m=ch_60,
            atr=self.atr,
            vol_zscore_1m=vol_z,
            vol_1m=v1,
            vol_5m=v5,
            vol_15m=v15,
            rvol_1m=rvol,
            breakout_15m=brk,
            breakdown_15m=brkd,
            vwap_15m=vwap15,
            open_interest=self.open_interest,
            oi_change_5m=oi_5m,
            oi_change_15m=oi_15m,
            oi_change_1h=oi_60m,
            momentum_5m=mom_5m,
            momentum_15m=mom_15m,
            momentum_score=mom_score,
            signal_score=signal_sc,
            signal_strength=signal_str,
            cipher_source_tf=cipher_source_tf,
            cipher_reason=cipher_reason,
            rsi_14=rsi_14_val,
            macd=macd_val,
            macd_signal=macd_sig_val,
            macd_histogram=macd_hist_val,
            stoch_k=stoch_k_val,
            stoch_d=stoch_d_val,
            # New metrics
            mfi_1h=mfi_1h_val,
            mfi_15m=mfi_15m_val,
            mfi_4h=mfi_4h_val,
            mtf_bull_count=mtf_bull,
            mtf_bear_count=mtf_bear,
            mtf_summary=mtf_summary_str,
            volatility_percentile=vol_pct,
            cipher_signal_age_ms=cipher_age,
            percent_r_signal_age_ms=percent_r_age,
            sector_tags=tags if tags else None,
        )

def _ema_series(values: list[float], length: int) -> list[float]:
    """EMA series (TradingView-style) over a list of values."""
    if length <= 0:
        return values
    if not values:
        return []
    alpha = 2.0 / (length + 1.0)
    out: list[float] = [values[0]]
    for v in values[1:]:
        out.append(out[-1] + alpha * (v - out[-1]))
    return out


def _sma_last(values: list[float], length: int) -> Optional[float]:
    if length <= 0:
        return None
    if len(values) < length:
        return None
    return sum(values[-length:]) / length


def wavetrend(
    closes: Deque[float],
    highs: Deque[float],
    lows: Deque[float],
    chlen: int = 9,
    avg: int = 12,
    malen: int = 3,
) -> tuple[Optional[float], Optional[float], Optional[float], Optional[float]]:
    """Compute Cipher B/LazyBear WaveTrend wt1/wt2.

    Pine reference (from cipher_b.txt):
      esa = ema(hlc3, chlen)
      de  = ema(abs(hlc3 - esa), chlen)
      ci  = (hlc3 - esa) / (0.015 * de)
      wt1 = ema(ci, avg)
      wt2 = sma(wt1, malen)

    We compute this on the 1m series locally (no higher timeframe security()).
    """
    if len(closes) < max(chlen + 2, avg + 2, malen + 2):
        return None, None, None, None

    # hlc3
    c = list(closes)
    h = list(highs)
    l = list(lows)
    n = min(len(c), len(h), len(l))
    c = c[-n:]
    h = h[-n:]
    l = l[-n:]
    hlc3 = [(h[i] + l[i] + c[i]) / 3.0 for i in range(n)]

    esa = _ema_series(hlc3, chlen)
    de_src = [abs(hlc3[i] - esa[i]) for i in range(n)]
    de = _ema_series(de_src, chlen)

    ci: list[float] = []
    for i in range(n):
        denom = 0.015 * de[i]
        ci.append((hlc3[i] - esa[i]) / denom if denom != 0 else 0.0)

    wt1_series = _ema_series(ci, avg)
    if len(wt1_series) < malen + 2:
        return None, None, None, None

    wt1_last = wt1_series[-1]
    wt1_prev = wt1_series[-2]

    # wt2 is SMA of wt1
    wt2_last = _sma_last(wt1_series, malen)
    wt2_prev = _sma_last(wt1_series[:-1], malen)

    return wt1_last, wt2_last, wt1_prev, wt2_prev


def cipher_b_signals(
    wt1: Optional[float],
    wt2: Optional[float],
    wt1_prev: Optional[float],
    wt2_prev: Optional[float],
    os_level: float = -53.0,
    ob_level: float = 53.0,
) -> tuple[Optional[bool], Optional[bool]]:
    """Core Cipher B signals requested:

    A) buySignal = wtCross and wtCrossUp and wtOversold
    B) sellSignal = wtCross and wtCrossDown and wtOverbought

    We approximate `wtCross` using the latest difference sign; for exact cross
    detection we would need wt1/wt2 history. For screening, we instead expose
    conditions based on current wt1/wt2 relative position.

    If you want exact "cross just happened this candle" semantics, we can extend
    to compute and store wt1/wt2 series.
    """
    if wt1 is None or wt2 is None or wt1_prev is None or wt2_prev is None:
        return None, None

    oversold = wt2 <= os_level
    overbought = wt2 >= ob_level

    # Pine:
    #   wtCross = cross(wt1, wt2)
    #   wtCrossUp = wt2 - wt1 <= 0
    #   wtCrossDown = wt2 - wt1 >= 0
    # Together with wtCross this effectively means:
    #   cross up   when prev(wt1-wt2) < 0 and curr(wt1-wt2) >= 0
    #   cross down when prev(wt1-wt2) > 0 and curr(wt1-wt2) <= 0
    prev_diff = wt1_prev - wt2_prev
    curr_diff = wt1 - wt2

    cross_up = prev_diff < 0 and curr_diff >= 0
    cross_down = prev_diff > 0 and curr_diff <= 0

    return (oversold and cross_up), (overbought and cross_down)


def williams_r(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    length: int,
) -> Optional[float]:
    """Calculate Williams %R indicator.
    
    Formula: %R = 100 * (highest_high - close) / (highest_high - lowest_low)
    Range: 0 to -100 (inverted scale)
    
    Pine Script equivalent:
        max = ta.highest(length)
        min = ta.lowest(length)
        100 * (src - max) / (max - min)
    """
    if len(closes) < length or len(highs) < length or len(lows) < length:
        return None
    
    try:
        # Get the lookback window
        h_window = highs[-length:]
        l_window = lows[-length:]
        current_close = closes[-1]
        
        highest_high = max(h_window)
        lowest_low = min(l_window)
        
        if highest_high == lowest_low:
            return None
        
        # Williams %R formula (returns -100 to 0)
        r = 100 * (current_close - highest_high) / (highest_high - lowest_low)
        return r
    except Exception:
        return None


def percent_r_trend_exhaustion(
    highs: Deque[float],
    lows: Deque[float],
    closes: Deque[float],
    short_length: int = 21,
    short_smoothing: int = 7,
    long_length: int = 112,
    long_smoothing: int = 3,
    threshold: int = 20,
    smoothing_type: str = 'ema',
) -> tuple[
    Optional[float], Optional[float],  # fast_r, slow_r
    Optional[float], Optional[float],  # fast_r_prev, slow_r_prev
    Optional[bool], Optional[bool],    # ob_trend_start, os_trend_start
    Optional[bool], Optional[bool],    # ob_reversal, os_reversal
    Optional[bool], Optional[bool],    # cross_bull, cross_bear
]:
    """Calculate %R Trend Exhaustion signals.
    
    Based on upslidedown's %R Trend Exhaustion indicator.
    Uses dual Williams %R (fast and slow periods) with smoothing.
    
    Returns:
        (fast_r, slow_r, fast_r_prev, slow_r_prev, 
         ob_trend_start, os_trend_start, ob_reversal, os_reversal,
         cross_bull, cross_bear)
    
    Signals:
        - ob_trend_start: Entered overbought zone (both %R >= -threshold)
        - os_trend_start: Entered oversold zone (both %R <= -100+threshold)
        - ob_reversal: Exited overbought zone (bearish reversal ▼)
        - os_reversal: Exited oversold zone (bullish reversal ▲)
        - cross_bull: Fast crosses under slow (bullish)
        - cross_bear: Fast crosses over slow (bearish)
    """
    if len(closes) < max(long_length + long_smoothing + 2, short_length + short_smoothing + 2):
        return None, None, None, None, None, None, None, None, None, None
    
    try:
        h = list(highs)
        l = list(lows)
        c = list(closes)
        n = min(len(h), len(l), len(c))
        
        # Calculate raw %R series
        fast_r_series = []
        slow_r_series = []
        
        for i in range(n):
            if i >= short_length - 1:
                fr = williams_r(h[:i+1], l[:i+1], c[:i+1], short_length)
                if fr is not None:
                    fast_r_series.append(fr)
            
            if i >= long_length - 1:
                sr = williams_r(h[:i+1], l[:i+1], c[:i+1], long_length)
                if sr is not None:
                    slow_r_series.append(sr)
        
        # Apply smoothing if needed
        if short_smoothing > 1 and len(fast_r_series) >= short_smoothing:
            fast_r_series = _ema_series(fast_r_series, short_smoothing) if smoothing_type == 'ema' else fast_r_series
        
        if long_smoothing > 1 and len(slow_r_series) >= long_smoothing:
            slow_r_series = _ema_series(slow_r_series, long_smoothing) if smoothing_type == 'ema' else slow_r_series
        
        # Need at least 2 values for signal detection
        if len(fast_r_series) < 2 or len(slow_r_series) < 2:
            return None, None, None, None, None, None, None, None, None, None
        
        fast_r = fast_r_series[-1]
        slow_r = slow_r_series[-1]
        fast_r_prev = fast_r_series[-2]
        slow_r_prev = slow_r_series[-2]
        
        # Overbought/Oversold logic
        overbought = fast_r >= -threshold and slow_r >= -threshold
        oversold = fast_r <= (-100 + threshold) and slow_r <= (-100 + threshold)
        
        overbought_prev = fast_r_prev >= -threshold and slow_r_prev >= -threshold
        oversold_prev = fast_r_prev <= (-100 + threshold) and slow_r_prev <= (-100 + threshold)
        
        # Trend start: entering the zone
        ob_trend_start = overbought and not overbought_prev
        os_trend_start = oversold and not oversold_prev
        
        # Reversal: exiting the zone
        ob_reversal = not overbought and overbought_prev
        os_reversal = not oversold and oversold_prev
        
        # Crossovers
        # cross_bull: slow crosses under fast (fast becomes stronger/more bullish)
        # cross_bear: slow crosses over fast (fast becomes weaker/more bearish)
        prev_diff = slow_r_prev - fast_r_prev
        curr_diff = slow_r - fast_r
        
        cross_bull = prev_diff > 0 and curr_diff <= 0  # slow was above, now below (bullish)
        cross_bear = prev_diff < 0 and curr_diff >= 0  # slow was below, now above (bearish)
        
        return (
            fast_r, slow_r,
            fast_r_prev, slow_r_prev,
            ob_trend_start, os_trend_start,
            ob_reversal, os_reversal,
            cross_bull, cross_bear
        )
    
    except Exception:
        return None, None, None, None, None, None, None, None, None, None


def pct_change(values, window: int) -> Optional[float]:
    if len(values) <= window:
        return None
    try:
        a = values[-window-1]
        b = values[-1]
        if a == 0:
            return None
        return (b - a) / a
    except Exception:
        return None

def pct_change_with_current(values, window: int, current_price: float) -> Optional[float]:
    """Calculate percentage change using current real-time price against historical values"""
    if len(values) < window:
        return None
    try:
        # Look back 'window' periods from the last closed candle
        a = values[-window]
        if a == 0:
            return None
        return (current_price - a) / a
    except Exception:
        return None

def compute_atr(highs, lows, closes) -> Optional[float]:
    # Needs at least ATR_PERIOD+1 closes
    # Also ensure all arrays have the same minimum length
    n = min(len(closes), len(highs), len(lows))
    if n < ATR_PERIOD+1:
        return None
    trs = []
    for i in range(1, n):
        h = highs[i]
        l = lows[i]
        pc = closes[i-1]
        tr = max(h - l, abs(h - pc), abs(l - pc))
        trs.append(tr)
    # Wilder's smoothing: simple average of first ATR_PERIOD TRs
    if len(trs) < ATR_PERIOD:
        return None
    return sum(trs[-ATR_PERIOD:]) / ATR_PERIOD

def sum_tail(values, n: int) -> Optional[float]:
    if len(values) < 1:
        return None
    try:
        return float(sum(list(values)[-n:]))
    except Exception:
        return None

def rvol_ratio(volumes, n: int, lookback: int) -> Optional[float]:
    if len(volumes) <= lookback:
        return None
    cur = sum(list(volumes)[-n:])
    hist = list(volumes)[:-n][-lookback:]
    if not hist:
        return None
    avg = sum(hist)/len(hist)
    if avg == 0:
        return None
    return cur/avg

def breakout(closes, highs, n: int) -> Optional[float]:
    # Use last n CLOSED candles (exclude the most recent partially forming bar)
    if len(highs) < n+1 or len(closes) < n+1:
        return None
    try:
        h = list(highs)
        c = list(closes)
        mx = max(h[-n-1:-1])
        if mx == 0:
            return None
        return (c[-2] / mx) - 1.0
    except Exception:
        return None

def breakdown(closes, lows, n: int) -> Optional[float]:
    if len(lows) < n+1 or len(closes) < n+1:
        return None
    try:
        l = list(lows)
        c = list(closes)
        mn = min(l[-n-1:-1])
        if mn == 0:
            return None
        return (c[-2] / mn) - 1.0
    except Exception:
        return None

def vwap(closes, volumes, n: int) -> Optional[float]:
    # Use last n CLOSED candles (exclude most recent partial bar)
    if len(closes) < n+1 or len(volumes) < n+1:
        return None
    try:
        c = list(closes)
        v = list(volumes)
        c = c[-n-1:-1]
        v = v[-n-1:-1]
        totv = sum(v)
        if totv == 0:
            return None
        return sum(ci*vi for ci,vi in zip(c,v)) / totv
    except Exception:
        return None

def zscore_abs_ret(closes, lookback: int) -> Optional[float]:
    if len(closes) <= lookback:
        return None
    rets = []
    for i in range(1, len(closes)):
        prev = closes[i-1]
        cur = closes[i]
        if prev == 0:
            continue
        rets.append(abs(cur/prev - 1.0))
    if len(rets) <= lookback:
        return None
    window = rets[-lookback:]
    mean = sum(window)/len(window)
    var = sum((x-mean)**2 for x in window)/len(window)
    std = math.sqrt(var)
    if std == 0:
        return 0.0
    last = rets[-1]
    return (last - mean)/std

def momentum(closes, window: int) -> Optional[float]:
    """Calculate Rate of Change (ROC) momentum indicator"""
    if len(closes) <= window:
        return None
    try:
        old_price = closes[-window-1]
        current_price = closes[-1]
        if old_price == 0:
            return None
        # ROC = ((current - old) / old) * 100
        return ((current_price - old_price) / old_price) * 100
    except Exception:
        return None

def momentum_with_current(closes, window: int, current_price: float) -> Optional[float]:
    """Calculate Rate of Change (ROC) momentum indicator with current real-time price"""
    if len(closes) < window:
        return None
    try:
        old_price = closes[-window]
        if old_price == 0:
            return None
        # ROC = ((current - old) / old) * 100
        return ((current_price - old_price) / old_price) * 100
    except Exception:
        return None

def momentum_score(closes) -> Optional[float]:
    """
    Composite momentum score combining multiple timeframes
    Returns a score from -100 (strong bearish) to +100 (strong bullish)
    """
    if len(closes) < 16:
        return None
    
    try:
        # Calculate momentum across multiple timeframes
        weights = {
            1: 0.1,   # 1m - least weight
            3: 0.15,  # 3m
            5: 0.25,  # 5m
            10: 0.25, # 10m
            15: 0.25, # 15m - most weight
        }
        
        score = 0.0
        total_weight = 0.0
        
        for period, weight in weights.items():
            if len(closes) > period:
                old = closes[-period-1]
                curr = closes[-1]
                if old != 0:
                    pct_change = ((curr - old) / old) * 100
                    # Normalize to -100 to +100 range (cap at +/-10% = +/-100 score)
                    normalized = max(min(pct_change * 10, 100), -100)
                    score += normalized * weight
                    total_weight += weight
        
        if total_weight == 0:
            return None
        
        return score / total_weight
    except Exception:
        return None

def momentum_score_with_current(closes, current_price: float) -> Optional[float]:
    """
    Composite momentum score combining multiple timeframes using current real-time price
    Returns a score from -100 (strong bearish) to +100 (strong bullish)
    """
    if len(closes) < 15:
        return None
    
    try:
        # Calculate momentum across multiple timeframes
        weights = {
            1: 0.1,   # 1m - least weight
            3: 0.15,  # 3m
            5: 0.25,  # 5m
            10: 0.25, # 10m
            15: 0.25, # 15m - most weight
        }
        
        score = 0.0
        total_weight = 0.0
        
        for period, weight in weights.items():
            if len(closes) >= period:
                old = closes[-period]
                if old != 0:
                    pct_change = ((current_price - old) / old) * 100
                    # Normalize to -100 to +100 range (cap at +/-10% = +/-100 score)
                    normalized = max(min(pct_change * 10, 100), -100)
                    score += normalized * weight
                    total_weight += weight
        
        if total_weight == 0:
            return None
        
        return score / total_weight
    except Exception:
        return None

def calculate_impulse_score(
    change_1m: Optional[float],
    vol_zscore: Optional[float],
    rvol: Optional[float],
    momentum_score: Optional[float],
) -> tuple[Optional[float], Optional[int]]:
    """Compute a 0..100 impulse score.

    This is designed for scalpers to find symbols that are *moving now* with
    unusual activity.

    Inputs:
    - change_1m: fractional return (e.g. 0.002 for +0.2%)
    - vol_zscore: z-score of absolute return vs recent lookback
    - rvol: relative volume ratio (1m vol / avg 1m vol)
    - momentum_score: -100..+100 composite momentum

    Returns: (score, dir)
    - score: 0..100
    - dir: -1/0/+1 (based on sign of change_1m)
    """
    try:
        if change_1m is None and vol_zscore is None and rvol is None and momentum_score is None:
            return None, None

        # Direction
        dir_ = 0
        if change_1m is not None:
            if change_1m > 0:
                dir_ = 1
            elif change_1m < 0:
                dir_ = -1

        # Component 1: magnitude of 1m move (cap around ~0.75% for perps)
        # change_1m is fractional; convert to abs percent
        mag_pct = abs(change_1m) * 100 if change_1m is not None else 0.0
        mag_score = min(1.0, mag_pct / 0.75)  # 0..1

        # Component 2: vol z-score of abs return (cap at z=5)
        z = max(0.0, float(vol_zscore)) if vol_zscore is not None else 0.0
        z_score = min(1.0, z / 5.0)

        # Component 3: relative volume (cap at rvol=3)
        rv = max(0.0, float(rvol)) if rvol is not None else 0.0
        rv_score = min(1.0, rv / 3.0)

        # Component 4: momentum confirmation (use absolute momentum)
        mom = abs(float(momentum_score)) if momentum_score is not None else 0.0
        mom_score = min(1.0, mom / 100.0)

        # Weighted blend (tuned for "moving now" feel)
        # - move magnitude is most important
        # - vol z-score and rvol confirm abnormal activity
        # - momentum adds persistence
        w_mag, w_z, w_rv, w_mom = 0.45, 0.25, 0.20, 0.10
        raw = w_mag * mag_score + w_z * z_score + w_rv * rv_score + w_mom * mom_score

        score = max(0.0, min(100.0, raw * 100.0))
        return score, dir_
    except Exception:
        return None, None


def rsi(closes: list[float], period: int = 14) -> Optional[float]:
    """Calculate RSI (Relative Strength Index).
    
    Range: 0 to 100
    - Above 70: Overbought
    - Below 30: Oversold
    """
    if len(closes) < period + 1:
        return None
    
    try:
        # Calculate price changes
        gains = []
        losses = []
        
        for i in range(1, len(closes)):
            change = closes[i] - closes[i-1]
            if change > 0:
                gains.append(change)
                losses.append(0)
            else:
                gains.append(0)
                losses.append(abs(change))
        
        if len(gains) < period:
            return None
        
        # Calculate average gain and loss using Wilder's smoothing
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        
        if avg_loss == 0:
            return 100.0
        
        rs = avg_gain / avg_loss
        rsi_value = 100 - (100 / (1 + rs))
        
        return rsi_value
    except Exception:
        return None


def macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[Optional[float], Optional[float], Optional[float]]:
    """Calculate MACD (Moving Average Convergence Divergence).
    
    Returns: (macd_line, signal_line, histogram)
    - macd_line: Fast EMA - Slow EMA
    - signal_line: EMA of MACD line
    - histogram: MACD - Signal (momentum indicator)
    """
    if len(closes) < slow + signal:
        return None, None, None
    
    try:
        # Calculate EMAs
        fast_ema = _ema_series(closes, fast)
        slow_ema = _ema_series(closes, slow)
        
        if len(fast_ema) < slow or len(slow_ema) < slow:
            return None, None, None
        
        # MACD line = Fast EMA - Slow EMA
        macd_line_series = [fast_ema[i] - slow_ema[i] for i in range(len(slow_ema))]
        
        if len(macd_line_series) < signal:
            return None, None, None
        
        # Signal line = EMA of MACD line
        signal_line_series = _ema_series(macd_line_series, signal)
        
        if not signal_line_series:
            return None, None, None
        
        macd_value = macd_line_series[-1]
        signal_value = signal_line_series[-1]
        histogram = macd_value - signal_value
        
        return macd_value, signal_value, histogram
    except Exception:
        return None, None, None


def stochastic_rsi(closes: list[float], rsi_period: int = 14, stoch_period: int = 14, k_smooth: int = 3, d_smooth: int = 3) -> tuple[Optional[float], Optional[float]]:
    """Calculate Stochastic RSI.
    
    Applies Stochastic oscillator to RSI values.
    
    Returns: (k_value, d_value)
    - k_value: Fast stochastic (%K)
    - d_value: Slow stochastic (%D) - SMA of %K
    
    Range: 0 to 100
    - Above 80: Overbought
    - Below 20: Oversold
    """
    if len(closes) < rsi_period + stoch_period + k_smooth + d_smooth:
        return None, None
    
    try:
        # Calculate RSI series
        rsi_series = []
        for i in range(rsi_period, len(closes)):
            rsi_val = rsi(closes[:i+1], rsi_period)
            if rsi_val is not None:
                rsi_series.append(rsi_val)
        
        if len(rsi_series) < stoch_period:
            return None, None
        
        # Apply Stochastic to RSI
        stoch_k_series = []
        for i in range(stoch_period - 1, len(rsi_series)):
            window = rsi_series[i - stoch_period + 1:i + 1]
            max_rsi = max(window)
            min_rsi = min(window)
            
            if max_rsi == min_rsi:
                stoch_k_series.append(0)
            else:
                k = 100 * (rsi_series[i] - min_rsi) / (max_rsi - min_rsi)
                stoch_k_series.append(k)
        
        if len(stoch_k_series) < k_smooth:
            return None, None
        
        # Smooth %K
        k_smoothed = _sma_last(stoch_k_series, k_smooth)
        
        # Calculate %D (SMA of %K)
        if len(stoch_k_series) < d_smooth:
            return None, None
        
        d_value = _sma_last(stoch_k_series, d_smooth)
        
        return k_smoothed, d_value
    except Exception:
        return None, None


def money_flow_index(
    opens: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    period: int = 60,
    multiplier: float = 150,
) -> Optional[float]:
    """Calculate Money Flow Index (Cipher B style).
    
    This is based on the cipher_b.txt formula:
    MFI = SMA(((close - open) / (high - low)) * multiplier, period)
    
    Positive MFI = Buying pressure (close > open on average)
    Negative MFI = Selling pressure (close < open on average)
    
    Returns: MFI value (typically ranges from -50 to +50)
    """
    if len(closes) < period or len(opens) < period or len(highs) < period or len(lows) < period:
        return None
    
    try:
        mfi_series = []
        n = min(len(opens), len(highs), len(lows), len(closes))
        
        for i in range(n):
            high_low_range = highs[i] - lows[i]
            if high_low_range == 0:
                mfi_series.append(0)
            else:
                # ((close - open) / (high - low)) * multiplier
                mfi_val = ((closes[i] - opens[i]) / high_low_range) * multiplier
                mfi_series.append(mfi_val)
        
        if len(mfi_series) < period:
            return None
        
        # SMA of the MFI series
        mfi = sum(mfi_series[-period:]) / period
        return mfi
    except Exception:
        return None


def volatility_percentile(
    atr_history: list[float],
    current_atr: float,
    lookback: int = 30,
) -> Optional[float]:
    """Calculate what percentile current volatility (ATR) is vs recent history.
    
    Returns: 0-100 percentile
    - High percentile (>80) = High volatility, potential breakout/breakdown
    - Low percentile (<20) = Low volatility, compression, breakout expected
    """
    if len(atr_history) < lookback or current_atr is None:
        return None
    
    try:
        recent = atr_history[-lookback:]
        count_below = sum(1 for x in recent if x < current_atr)
        percentile = (count_below / len(recent)) * 100
        return percentile
    except Exception:
        return None


def mtf_confluence(
    wt_1m: tuple,
    wt_15m: tuple,
    wt_4h: tuple,
    r_15m: tuple,
    r_4h: tuple,
) -> tuple[int, int, str]:
    """Calculate Multi-Timeframe Confluence.
    
    Checks how many timeframes agree on direction.
    
    Returns: (bullish_count, bearish_count, summary)
    - bullish_count: 0-5 (how many TFs are bullish)
    - bearish_count: 0-5 (how many TFs are bearish)
    - summary: "5/5 Bullish", "3/5 Bearish", "Mixed", etc.
    """
    bullish = 0
    bearish = 0
    total = 0
    
    # Check 1m WT
    if wt_1m and len(wt_1m) >= 2 and wt_1m[0] is not None and wt_1m[1] is not None:
        total += 1
        if wt_1m[0] > wt_1m[1]:  # wt1 > wt2 = bullish
            bullish += 1
        else:
            bearish += 1
    
    # Check 15m WT
    if wt_15m and len(wt_15m) >= 2 and wt_15m[0] is not None and wt_15m[1] is not None:
        total += 1
        if wt_15m[0] > wt_15m[1]:
            bullish += 1
        else:
            bearish += 1
    
    # Check 4h WT
    if wt_4h and len(wt_4h) >= 2 and wt_4h[0] is not None and wt_4h[1] is not None:
        total += 1
        if wt_4h[0] > wt_4h[1]:
            bullish += 1
        else:
            bearish += 1
    
    # Check 15m %R (inverted: higher = more bullish on %R scale)
    if r_15m and len(r_15m) >= 2 and r_15m[0] is not None:
        total += 1
        if r_15m[0] > -50:  # Above -50 = bullish territory
            bullish += 1
        else:
            bearish += 1
    
    # Check 4h %R
    if r_4h and len(r_4h) >= 2 and r_4h[0] is not None:
        total += 1
        if r_4h[0] > -50:
            bullish += 1
        else:
            bearish += 1
    
    # Build summary
    if total == 0:
        return 0, 0, "No data"
    
    if bullish == total:
        summary = f"{bullish}/{total} Bullish ✓"
    elif bearish == total:
        summary = f"{bearish}/{total} Bearish ✗"
    elif bullish > bearish:
        summary = f"{bullish}/{total} Bullish"
    elif bearish > bullish:
        summary = f"{bearish}/{total} Bearish"
    else:
        summary = f"Mixed ({bullish}B/{bearish}S)"
    
    return bullish, bearish, summary


# Sector tags mapping
SECTOR_TAGS = {
    # Layer 1s
    'BTCUSDT': ['L1', 'Store of Value', 'Top 10'],
    'ETHUSDT': ['L1', 'Smart Contract', 'Top 10'],
    'SOLUSDT': ['L1', 'Smart Contract', 'Top 10'],
    'AVAXUSDT': ['L1', 'Smart Contract', 'Top 20'],
    'ADAUSDT': ['L1', 'Smart Contract', 'Top 20'],
    'DOTUSDT': ['L1', 'Interoperability', 'Top 20'],
    'ATOMUSDT': ['L1', 'Interoperability', 'Top 30'],
    'NEARUSDT': ['L1', 'Smart Contract', 'Top 30'],
    'APTUSDT': ['L1', 'Smart Contract', 'Top 30'],
    'SUIUSDT': ['L1', 'Smart Contract', 'Top 50'],
    'SEIUSDT': ['L1', 'Smart Contract', 'Top 100'],
    'INJUSDT': ['L1', 'DeFi', 'Top 50'],
    'TONUSDT': ['L1', 'Messaging', 'Top 20'],
    
    # Layer 2s
    'MATICUSDT': ['L2', 'Ethereum', 'Top 20'],
    'ARBUSDT': ['L2', 'Ethereum', 'Top 50'],
    'OPUSDT': ['L2', 'Ethereum', 'Top 50'],
    'STXUSDT': ['L2', 'Bitcoin', 'Top 50'],
    
    # DeFi
    'LINKUSDT': ['DeFi', 'Oracle', 'Top 20'],
    'UNIUSDT': ['DeFi', 'DEX', 'Top 30'],
    'AAVEUSDT': ['DeFi', 'Lending', 'Top 50'],
    'MKRUSDT': ['DeFi', 'Stablecoin', 'Top 50'],
    'CRVUSDT': ['DeFi', 'DEX', 'Top 100'],
    'COMPUSDT': ['DeFi', 'Lending', 'Top 100'],
    'SNXUSDT': ['DeFi', 'Derivatives', 'Top 100'],
    'LDOUSDT': ['DeFi', 'Staking', 'Top 50'],
    'RNDRUSDT': ['DeFi', 'AI', 'Top 50'],
    '1INCHUSDT': ['DeFi', 'DEX', 'Top 100'],
    'GMXUSDT': ['DeFi', 'Derivatives', 'Top 100'],
    'DYDXUSDT': ['DeFi', 'Derivatives', 'Top 100'],
    
    # Meme coins
    'DOGEUSDT': ['Meme', 'Top 10'],
    'SHIBUSDT': ['Meme', 'Top 20'],
    'PEPEUSDT': ['Meme', 'Top 50'],
    'FLOKIUSDT': ['Meme', 'Top 100'],
    'BONKUSDT': ['Meme', 'Solana', 'Top 100'],
    'WIFUSDT': ['Meme', 'Solana', 'Top 100'],
    
    # AI & Compute
    'FETUSDT': ['AI', 'Top 50'],
    'AGIXUSDT': ['AI', 'Top 100'],
    'OCEANUSDT': ['AI', 'Data', 'Top 100'],
    'TAOUSDT': ['AI', 'Top 100'],
    'AKTUSDT': ['AI', 'Compute', 'Top 100'],
    
    # Gaming & Metaverse
    'AXSUSDT': ['Gaming', 'Top 100'],
    'SANDUSDT': ['Metaverse', 'Top 100'],
    'MANAUSDT': ['Metaverse', 'Top 100'],
    'ENJUSDT': ['Gaming', 'NFT', 'Top 100'],
    'GALAUSDT': ['Gaming', 'Top 100'],
    'IMXUSDT': ['Gaming', 'L2', 'Top 50'],
    
    # Infrastructure
    'FILUSDT': ['Storage', 'Top 50'],
    'ARUSDT': ['Storage', 'Top 100'],
    'ICPUSDT': ['Compute', 'Top 30'],
    'GRTUSDT': ['Indexing', 'Top 50'],
    'QNTUSDT': ['Interoperability', 'Enterprise', 'Top 50'],
    
    # Exchange tokens
    'BNBUSDT': ['Exchange', 'Binance', 'Top 10'],
    
    # Privacy
    'XMRUSDT': ['Privacy', 'Top 50'],
    'ZECUSDT': ['Privacy', 'Top 100'],
}


def get_sector_tags(symbol: str) -> list[str]:
    """Get sector tags for a symbol."""
    return SECTOR_TAGS.get(symbol, [])


def calculate_signal_score(
    momentum_score: Optional[float],
    oi_change_5m: Optional[float],
    rvol: Optional[float],
    breakout: Optional[float],
    vol_zscore: Optional[float]
) -> tuple[Optional[float], Optional[str]]:
    """
    Calculate combined signal score for scalping opportunities
    
    Combines:
    - Momentum (40% weight)
    - OI change direction (25% weight)
    - Volume spike (20% weight)
    - Breakout/breakdown (15% weight)
    
    Returns: (score: -100 to +100, strength: "strong_bull"|"bull"|"neutral"|"bear"|"strong_bear")
    """
    try:
        score = 0.0
        weights_sum = 0.0
        
        # 1. Momentum Score (40% weight)
        if momentum_score is not None:
            score += momentum_score * 0.4
            weights_sum += 0.4
        
        # 2. OI Change (25% weight)
        # OI increasing + price up = bullish | OI increasing + price down = bearish liquidation
        if oi_change_5m is not None and momentum_score is not None:
            # OI direction aligned with momentum is strong signal
            oi_normalized = max(min(oi_change_5m * 1000, 100), -100)  # Scale OI % change
            # If OI and momentum align, boost signal
            if (oi_normalized > 0 and momentum_score > 0) or (oi_normalized < 0 and momentum_score < 0):
                score += oi_normalized * 0.25
            # If OI increases but price drops = bearish (liquidation cascade)
            elif oi_normalized > 0 and momentum_score < 0:
                score += -abs(oi_normalized) * 0.25
            # If OI decreases but price rises = less conviction
            elif oi_normalized < 0 and momentum_score > 0:
                score += oi_normalized * 0.25
            weights_sum += 0.25
        
        # 3. Volume Spike (20% weight)
        # RVOL > 2 = confirmation, Vol Z-score shows unusual activity
        if rvol is not None:
            rvol_score = 0.0
            if rvol > 3:
                rvol_score = 100
            elif rvol > 2:
                rvol_score = 70
            elif rvol > 1.5:
                rvol_score = 40
            elif rvol < 0.5:
                rvol_score = -40
            
            # Align with momentum direction
            if momentum_score is not None:
                if momentum_score > 0:
                    score += rvol_score * 0.2
                else:
                    score += -abs(rvol_score) * 0.2
            else:
                score += rvol_score * 0.2
            weights_sum += 0.2
        
        # 4. Breakout/Breakdown (15% weight)
        if breakout is not None:
            breakout_normalized = max(min(breakout * 1000, 100), -100)
            score += breakout_normalized * 0.15
            weights_sum += 0.15
        
        if weights_sum == 0:
            return None, None
        
        # Normalize to actual weight sum
        final_score = score / weights_sum * 100
        final_score = max(min(final_score, 100), -100)
        
        # Determine strength category
        if final_score >= 70:
            strength = "strong_bull"
        elif final_score >= 40:
            strength = "bull"
        elif final_score >= -40:
            strength = "neutral"
        elif final_score >= -70:
            strength = "bear"
        else:
            strength = "strong_bear"
        
        return final_score, strength
    
    except Exception:
        return None, None
