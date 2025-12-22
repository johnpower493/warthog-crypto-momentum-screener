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
