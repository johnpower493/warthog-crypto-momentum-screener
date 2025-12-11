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
        self.last_price: Optional[float] = None
        self.atr: Optional[float] = None

    def update(self, k: Kline):
        self.close_1m.append(k.close)
        self.high_1m.append(k.high)
        self.low_1m.append(k.low)
        self.vol_1m.append(k.volume)
        self.last_price = k.close
        if len(self.close_1m.values) >= ATR_PERIOD+1:
            self.atr = compute_atr(list(self.high_1m.values), list(self.low_1m.values), list(self.close_1m.values))

    def compute_metrics(self) -> SymbolMetrics:
        ch_1 = pct_change(self.close_1m.values, 1)
        ch_5 = pct_change(self.close_1m.values, WINDOW_SHORT)
        ch_15 = pct_change(self.close_1m.values, WINDOW_MEDIUM)
        ch_60 = pct_change(self.close_1m.values, 60)
        vol_z = zscore_abs_ret(self.close_1m.values, VOL_LOOKBACK)
        v1 = sum_tail(self.vol_1m.values, 1)
        v5 = sum_tail(self.vol_1m.values, 5)
        v15 = sum_tail(self.vol_1m.values, 15)
        rvol = rvol_ratio(self.vol_1m.values, 1, VOL_LOOKBACK)
        brk = breakout(self.close_1m.values, self.high_1m.values, 15)
        brkd = breakdown(self.close_1m.values, self.low_1m.values, 15)
        vwap15 = vwap(self.close_1m.values, self.vol_1m.values, 15)
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
