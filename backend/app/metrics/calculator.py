from __future__ import annotations
from collections import deque
from typing import Deque, Dict, Optional
import math

from ..models import Kline, SymbolMetrics
from ..config import WINDOW_SHORT, WINDOW_MEDIUM, ATR_PERIOD, VOL_LOOKBACK

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
        maxlen = max(61, WINDOW_MEDIUM+1, ATR_PERIOD+1, VOL_LOOKBACK+1)
        self.close_1m = RollingSeries(maxlen=maxlen)
        self.high_1m = RollingSeries(maxlen=maxlen)
        self.low_1m = RollingSeries(maxlen=maxlen)
        self.vol_1m = RollingSeries(maxlen=maxlen)
        self.oi_1m = RollingSeries(maxlen=maxlen)  # open interest series
        self.last_price: Optional[float] = None
        self.atr: Optional[float] = None
        self.open_interest: Optional[float] = None

    def update(self, k: Kline):
        self.close_1m.append(k.close)
        self.high_1m.append(k.high)
        self.low_1m.append(k.low)
        self.vol_1m.append(k.volume)
        self.last_price = k.close
        if len(self.close_1m.values) >= ATR_PERIOD+1:
            self.atr = compute_atr(list(self.high_1m.values), list(self.low_1m.values), list(self.close_1m.values))

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

        # Cipher B WaveTrend (WT1/WT2) + core buy/sell dots
        wt1, wt2, wt1_prev, wt2_prev = wavetrend(
            self.close_1m.values,
            self.high_1m.values,
            self.low_1m.values,
            chlen=9,
            avg=12,
            malen=3,
        )
        cipher_buy, cipher_sell = cipher_b_signals(
            wt1,
            wt2,
            wt1_prev,
            wt2_prev,
            os_level=-53.0,
            ob_level=53.0,
        )
        
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
        
        return SymbolMetrics(
            symbol=self.symbol,
            exchange=self.exchange,
            last_price=self.last_price or 0.0,
            wt1=wt1,
            wt2=wt2,
            cipher_buy=cipher_buy,
            cipher_sell=cipher_sell,
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
        return None, None

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
    n = len(closes)
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
