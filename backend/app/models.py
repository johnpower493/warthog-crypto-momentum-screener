from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import datetime

class Kline(BaseModel):
    symbol: str
    exchange: str = "binance"
    interval: str = "1m"
    open_time: int
    close_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    closed: bool

class SymbolMetrics(BaseModel):
    symbol: str
    exchange: str
    last_price: float
    # Returns
    change_1m: Optional[float] = None
    change_5m: Optional[float] = None
    change_15m: Optional[float] = None
    change_60m: Optional[float] = None
    # Volatility/vol
    atr: Optional[float] = None
    vol_zscore_1m: Optional[float] = None
    vol_1m: Optional[float] = None
    vol_5m: Optional[float] = None
    vol_15m: Optional[float] = None
    rvol_1m: Optional[float] = None  # 1m volume / avg 1m volume over lookback
    # Breakouts and VWAP
    breakout_15m: Optional[float] = None  # close/max(high 15m) - 1
    breakdown_15m: Optional[float] = None  # close/min(low 15m) - 1
    vwap_15m: Optional[float] = None
    # Open Interest
    open_interest: Optional[float] = None  # current open interest
    oi_change_5m: Optional[float] = None  # OI % change over 5m
    oi_change_15m: Optional[float] = None  # OI % change over 15m
    oi_change_1h: Optional[float] = None  # OI % change over 1h
    # Momentum indicators
    momentum_5m: Optional[float] = None  # rate of change 5m
    momentum_15m: Optional[float] = None  # rate of change 15m
    momentum_score: Optional[float] = None  # composite momentum score (-100 to +100)
    # Combined signal
    signal_score: Optional[float] = None  # combined signal strength (-100 to +100)
    signal_strength: Optional[str] = None  # "strong_bull", "bull", "neutral", "bear", "strong_bear"
    ts: int = Field(default_factory=lambda: int(datetime.utcnow().timestamp()*1000))

class ScreenerSnapshot(BaseModel):
    exchange: str
    ts: int
    metrics: List[SymbolMetrics]

class NormalizedTicker(BaseModel):
    symbol: str
    exchange: str
    price: float
    ts: int
