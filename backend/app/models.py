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

    # Cipher B (WaveTrend) core fields
    wt1: Optional[float] = None
    wt2: Optional[float] = None
    cipher_buy: Optional[bool] = None   # WT cross up while oversold
    cipher_sell: Optional[bool] = None  # WT cross down while overbought
    cipher_source_tf: Optional[str] = None  # '15m' | '4h' indicating which timeframe triggered
    cipher_reason: Optional[str] = None  # human-readable explanation for the signal

    # %R Trend Exhaustion fields
    percent_r_fast: Optional[float] = None  # Fast period %R (21)
    percent_r_slow: Optional[float] = None  # Slow period %R (112)
    percent_r_ob_trend_start: Optional[bool] = None  # Entered overbought zone ⏹
    percent_r_os_trend_start: Optional[bool] = None  # Entered oversold zone ⏹
    percent_r_ob_reversal: Optional[bool] = None  # Exited overbought (bearish reversal ▼)
    percent_r_os_reversal: Optional[bool] = None  # Exited oversold (bullish reversal ▲)
    percent_r_cross_bull: Optional[bool] = None  # Bullish crossover ⏺
    percent_r_cross_bear: Optional[bool] = None  # Bearish crossover ⏺
    percent_r_source_tf: Optional[str] = None  # '15m' | '4h' indicating which timeframe triggered
    percent_r_reason: Optional[str] = None  # Human-readable explanation for %R signal

    # Liquidity cohorting
    liquidity_rank: Optional[int] = None
    liquidity_top200: Optional[bool] = None
    market_cap: Optional[float] = None  # Market cap in USD

    # Setup grading (for feed/alerts)
    setup_score: Optional[float] = None
    setup_grade: Optional[str] = None
    avoid_reasons: Optional[list[str]] = None

    # Scalping impulse
    impulse_score: Optional[float] = None  # 0..100 (higher = more impulsive)
    impulse_dir: Optional[int] = None  # -1, 0, +1 direction based on 1m change
    # Returns
    change_1m: Optional[float] = None
    change_5m: Optional[float] = None
    change_15m: Optional[float] = None
    change_60m: Optional[float] = None
    change_1d: Optional[float] = None
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
    oi_change_1d: Optional[float] = None  # OI % change over 1d
    # Momentum indicators
    momentum_5m: Optional[float] = None  # rate of change 5m
    momentum_15m: Optional[float] = None  # rate of change 15m
    momentum_score: Optional[float] = None  # composite momentum score (-100 to +100)
    # Combined signal
    signal_score: Optional[float] = None  # combined signal strength (-100 to +100)
    signal_strength: Optional[str] = None  # "strong_bull", "bull", "neutral", "bear", "strong_bear"
    
    # Technical Indicators (15m - default for scalping)
    rsi_14: Optional[float] = None  # RSI (14 period) - 0 to 100
    macd: Optional[float] = None  # MACD line
    macd_signal: Optional[float] = None  # MACD signal line
    macd_histogram: Optional[float] = None  # MACD histogram
    stoch_k: Optional[float] = None  # Stochastic RSI %K (0 to 100)
    stoch_d: Optional[float] = None  # Stochastic RSI %D (0 to 100)
    
    # Technical Indicators - 1h timeframe (swing trading)
    rsi_1h: Optional[float] = None
    macd_1h: Optional[float] = None
    macd_signal_1h: Optional[float] = None
    macd_histogram_1h: Optional[float] = None
    stoch_k_1h: Optional[float] = None
    stoch_d_1h: Optional[float] = None
    
    # Technical Indicators - 4h timeframe (swing trading)
    rsi_4h: Optional[float] = None
    macd_4h: Optional[float] = None
    macd_signal_4h: Optional[float] = None
    macd_histogram_4h: Optional[float] = None
    stoch_k_4h: Optional[float] = None
    stoch_d_4h: Optional[float] = None
    
    # Technical Indicators - 1d (Daily) timeframe (position trading)
    rsi_1d: Optional[float] = None
    macd_1d: Optional[float] = None
    macd_signal_1d: Optional[float] = None
    macd_histogram_1d: Optional[float] = None
    stoch_k_1d: Optional[float] = None
    stoch_d_1d: Optional[float] = None
    
    # Money Flow Index (Cipher B style) - Multiple Timeframes
    mfi_1h: Optional[float] = None  # MFI on 1m data, 60 period (1 hour lookback)
    mfi_15m: Optional[float] = None  # MFI on 15m data, 60 period
    mfi_4h: Optional[float] = None  # MFI on 4h data, 60 period
    
    # Multi-Timeframe Confluence
    mtf_bull_count: Optional[int] = None  # How many TFs are bullish (0-5)
    mtf_bear_count: Optional[int] = None  # How many TFs are bearish (0-5)
    mtf_summary: Optional[str] = None  # "4/5 Bullish", "3/5 Bearish", etc.
    
    # Volatility Analysis
    volatility_percentile: Optional[float] = None  # 0-100 percentile vs last 30 1m-ATR periods

    # Volatility Due / Squeeze (multi-timeframe)
    # "Volatility due" ~= a fresh transition into volatility compression.
    vol_due_15m: Optional[bool] = None
    vol_due_4h: Optional[bool] = None
    vol_due_source_tf: Optional[str] = None  # '15m' | '4h'
    vol_due_reason: Optional[str] = None
    vol_due_age_ms: Optional[int] = None

    # Squeeze (state): True while the symbol remains in compression on that timeframe.
    vol_squeeze_15m: Optional[bool] = None
    vol_squeeze_4h: Optional[bool] = None

    # Bollinger Bands (20-period, 2 std dev)
    # 15m
    bb_upper: Optional[float] = None  # Upper band
    bb_middle: Optional[float] = None  # Middle band (SMA 20)
    bb_lower: Optional[float] = None  # Lower band
    bb_width: Optional[float] = None  # Band width as % of middle
    bb_position: Optional[float] = None  # Price position within bands (0=lower, 0.5=middle, 1=upper)

    # 4h
    bb_width_4h: Optional[float] = None
    bb_position_4h: Optional[float] = None
    
    # Time Since Signal
    cipher_signal_age_ms: Optional[int] = None  # Time since last cipher signal (ms)
    percent_r_signal_age_ms: Optional[int] = None  # Time since last %R signal (ms)
    
    # Sector Tags
    sector_tags: Optional[List[str]] = None  # ["L1", "DeFi", "Top 20"]
    
    # Swing strategy (4h) - long-only pullback
    swing_long_buy: Optional[bool] = None
    swing_long_source_tf: Optional[str] = None  # '4h'
    swing_long_reason: Optional[str] = None

    # ATR on 4h timeframe (useful for swing stops)
    atr_4h: Optional[float] = None

    # Funding Rate (Perpetual Futures)
    funding_rate: Optional[float] = None  # Current funding rate (e.g., 0.0001 = 0.01%)
    funding_rate_annual: Optional[float] = None  # Annualized funding rate (%)
    next_funding_time: Optional[int] = None  # Next funding time (milliseconds timestamp)
    
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
