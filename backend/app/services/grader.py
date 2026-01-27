from __future__ import annotations
import json
from typing import Dict, Any, List, Optional, Tuple

# Enhanced scoring model with MTF confluence
# A: score >= 6 AND MTF aligned (strict filter)
# B: score in [3,5] OR (score >= 6 but MTF not aligned)
# C: score <= 2

# Symbol performance cache (loaded from backtester results)
_symbol_win_rates: Dict[str, float] = {}

def set_symbol_win_rates(rates: Dict[str, float]):
    """Update the cached symbol win rates from backtest results."""
    global _symbol_win_rates
    _symbol_win_rates = rates


def _check_mtf_alignment(metrics: Dict[str, Any], signal: str) -> Tuple[bool, int, List[str]]:
    """
    Check if 1h and 4h timeframes align with the signal direction.
    Returns (is_aligned, alignment_count, reasons).
    
    For BUY signals: RSI not overbought, MACD histogram positive or improving
    For SELL signals: RSI not oversold, MACD histogram negative or declining
    """
    aligned_count = 0
    reasons = []
    
    # 1h RSI check
    rsi_1h = metrics.get('rsi_1h')
    if rsi_1h is not None:
        if signal == 'BUY':
            if rsi_1h < 70:  # Not overbought on 1h
                aligned_count += 1
            else:
                reasons.append(f'1h RSI overbought ({rsi_1h:.0f})')
        elif signal == 'SELL':
            if rsi_1h > 30:  # Not oversold on 1h
                aligned_count += 1
            else:
                reasons.append(f'1h RSI oversold ({rsi_1h:.0f})')
    
    # 4h RSI check
    rsi_4h = metrics.get('rsi_4h')
    if rsi_4h is not None:
        if signal == 'BUY':
            if rsi_4h < 75:  # More lenient on 4h
                aligned_count += 1
            else:
                reasons.append(f'4h RSI overbought ({rsi_4h:.0f})')
        elif signal == 'SELL':
            if rsi_4h > 25:
                aligned_count += 1
            else:
                reasons.append(f'4h RSI oversold ({rsi_4h:.0f})')
    
    # 1h MACD histogram check
    macd_hist_1h = metrics.get('macd_histogram_1h')
    if macd_hist_1h is not None:
        if signal == 'BUY' and macd_hist_1h > 0:
            aligned_count += 1
        elif signal == 'SELL' and macd_hist_1h < 0:
            aligned_count += 1
        else:
            reasons.append(f'1h MACD against signal')
    
    # 4h MACD histogram check
    macd_hist_4h = metrics.get('macd_histogram_4h')
    if macd_hist_4h is not None:
        if signal == 'BUY' and macd_hist_4h > 0:
            aligned_count += 1
        elif signal == 'SELL' and macd_hist_4h < 0:
            aligned_count += 1
        else:
            reasons.append(f'4h MACD against signal')
    
    # Need at least 3 out of 4 checks to pass for "aligned"
    is_aligned = aligned_count >= 3
    
    return is_aligned, aligned_count, reasons


def grade_alert(metrics: Dict[str, Any], signal: str) -> Tuple[float, str, List[str]]:
    """
    Enhanced grading with MTF confluence, RSI extremes, funding rate, and volatility.
    Returns (setup_score, setup_grade, avoid_reasons).
    """
    score = 0.0
    avoid: List[str] = []
    bonuses: List[str] = []  # Track positive factors for debugging

    # ===== BASE SCORE =====
    # Signal fired
    score += 2.0
    bonuses.append('Signal fired (+2)')

    # ===== OPEN INTEREST ALIGNMENT =====
    oi5m = metrics.get('oi_change_5m')
    if oi5m is not None:
        try:
            oi5m = float(oi5m)
            if signal == 'BUY':
                if oi5m > 0.5:  # Strong OI increase
                    score += 2.0
                    bonuses.append('Strong OI increase (+2)')
                elif oi5m > 0:
                    score += 1.0
                    bonuses.append('OI increasing (+1)')
                elif oi5m < -0.5:
                    score -= 2.0
                    avoid.append('OI decreasing strongly on BUY')
            elif signal == 'SELL':
                if oi5m < -0.5:
                    score += 2.0
                    bonuses.append('Strong OI decrease (+2)')
                elif oi5m < 0:
                    score += 1.0
                    bonuses.append('OI decreasing (+1)')
                elif oi5m > 0.5:
                    score -= 2.0
                    avoid.append('OI increasing strongly on SELL')
        except Exception:
            pass

    # ===== RVOL (Relative Volume) =====
    rvol = metrics.get('rvol_1m')
    if rvol is not None:
        try:
            rvol = float(rvol)
            if rvol >= 2.0:
                score += 2.0
                bonuses.append('High RVOL (+2)')
            elif rvol >= 1.5:
                score += 1.0
                bonuses.append('Good RVOL (+1)')
            elif rvol < 0.5:
                score -= 2.0
                avoid.append('Very low RVOL')
            elif rvol < 0.8:
                score -= 1.0
                avoid.append('Low RVOL')
        except Exception:
            pass

    # ===== MOMENTUM ALIGNMENT =====
    mom = metrics.get('momentum_score')
    if mom is not None:
        try:
            mom = float(mom)
            if signal == 'BUY':
                if mom > 30:
                    score += 1.5
                    bonuses.append('Strong momentum (+1.5)')
                elif mom > 0:
                    score += 0.5
                elif mom < -30:
                    score -= 1.5
                    avoid.append('Strong bearish momentum')
            elif signal == 'SELL':
                if mom < -30:
                    score += 1.5
                    bonuses.append('Strong momentum (+1.5)')
                elif mom < 0:
                    score += 0.5
                elif mom > 30:
                    score -= 1.5
                    avoid.append('Strong bullish momentum')
        except Exception:
            pass

    # ===== LIQUIDITY/VOLUME =====
    vol1m = metrics.get('vol_1m')
    if vol1m is not None:
        try:
            vol1m = float(vol1m)
            if vol1m <= 0:
                avoid.append('No volume data')
            elif vol1m < 10_000:
                score -= 1.0
                avoid.append('Low volume (<$10k)')
            elif vol1m > 100_000:
                score += 0.5
                bonuses.append('High liquidity (+0.5)')
        except Exception:
            pass

    # ===== NEW: RSI EXTREME ALIGNMENT (15m) =====
    rsi_14 = metrics.get('rsi_14')
    if rsi_14 is not None:
        try:
            rsi_14 = float(rsi_14)
            if signal == 'BUY':
                if rsi_14 < 30:  # Oversold - good for buy
                    score += 1.5
                    bonuses.append('RSI oversold (+1.5)')
                elif rsi_14 > 75:  # Overbought - bad for buy
                    score -= 1.5
                    avoid.append('15m RSI overbought')
            elif signal == 'SELL':
                if rsi_14 > 70:  # Overbought - good for sell
                    score += 1.5
                    bonuses.append('RSI overbought (+1.5)')
                elif rsi_14 < 25:  # Oversold - bad for sell
                    score -= 1.5
                    avoid.append('15m RSI oversold')
        except Exception:
            pass

    # ===== NEW: FUNDING RATE SENTIMENT =====
    funding_rate = metrics.get('funding_rate')
    if funding_rate is not None:
        try:
            funding_rate = float(funding_rate)
            # Positive funding = longs pay shorts (market bullish/overleveraged long)
            # Negative funding = shorts pay longs (market bearish/overleveraged short)
            if signal == 'BUY':
                if funding_rate < -0.0005:  # Negative funding, shorts overleveraged
                    score += 1.0
                    bonuses.append('Negative funding (+1)')
                elif funding_rate > 0.001:  # High positive funding, crowded long
                    score -= 1.0
                    avoid.append('High positive funding (crowded long)')
            elif signal == 'SELL':
                if funding_rate > 0.0005:  # Positive funding, longs overleveraged
                    score += 1.0
                    bonuses.append('Positive funding (+1)')
                elif funding_rate < -0.001:  # High negative funding, crowded short
                    score -= 1.0
                    avoid.append('High negative funding (crowded short)')
        except Exception:
            pass

    # ===== NEW: VOLATILITY CONTEXT =====
    vol_percentile = metrics.get('volatility_percentile')
    if vol_percentile is not None:
        try:
            vol_percentile = float(vol_percentile)
            if vol_percentile > 90:
                # Very high volatility - more risk but can be opportunity
                avoid.append('Extreme volatility (90th+ percentile)')
            elif vol_percentile < 20:
                # Very low volatility - breakout potential
                score += 0.5
                bonuses.append('Low volatility (breakout potential)')
        except Exception:
            pass

    # ===== NEW: MTF CONFLUENCE (Strict Filter for A-Grade) =====
    mtf_aligned, mtf_count, mtf_reasons = _check_mtf_alignment(metrics, signal)
    
    if mtf_aligned:
        score += 2.0
        bonuses.append(f'MTF aligned ({mtf_count}/4) (+2)')
    else:
        # Add MTF misalignment reasons to avoid list
        avoid.extend(mtf_reasons)

    # ===== NEW: HISTORICAL SYMBOL PERFORMANCE =====
    symbol = metrics.get('symbol', '')
    if symbol in _symbol_win_rates:
        win_rate = _symbol_win_rates[symbol]
        if win_rate < 0.35:  # Less than 35% win rate historically
            score -= 2.0
            avoid.append(f'Poor historical win rate ({win_rate*100:.0f}%)')
        elif win_rate > 0.55:  # Greater than 55% win rate
            score += 1.0
            bonuses.append(f'Good historical win rate ({win_rate*100:.0f}%)')

    # ===== NEW: MTF BULL/BEAR COUNT =====
    mtf_bull = metrics.get('mtf_bull_count', 0) or 0
    mtf_bear = metrics.get('mtf_bear_count', 0) or 0
    if signal == 'BUY' and mtf_bull >= 4:
        score += 1.0
        bonuses.append(f'Strong MTF bullish ({mtf_bull}/5)')
    elif signal == 'SELL' and mtf_bear >= 4:
        score += 1.0
        bonuses.append(f'Strong MTF bearish ({mtf_bear}/5)')
    elif signal == 'BUY' and mtf_bear >= 4:
        score -= 1.0
        avoid.append(f'MTF bearish ({mtf_bear}/5) on BUY')
    elif signal == 'SELL' and mtf_bull >= 4:
        score -= 1.0
        avoid.append(f'MTF bullish ({mtf_bull}/5) on SELL')

    # ===== NEW: BOLLINGER BANDS POSITION =====
    bb_position = metrics.get('bb_position')
    bb_width = metrics.get('bb_width')
    if bb_position is not None:
        if signal == 'BUY':
            if bb_position < 0.15:  # Near lower band - good for buy
                score += 1.5
                bonuses.append(f'Price near BB lower ({bb_position:.2f})')
            elif bb_position > 0.90:  # Near upper band - risky for buy
                score -= 1.0
                avoid.append(f'Price near BB upper ({bb_position:.2f})')
        elif signal == 'SELL':
            if bb_position > 0.85:  # Near upper band - good for sell
                score += 1.5
                bonuses.append(f'Price near BB upper ({bb_position:.2f})')
            elif bb_position < 0.10:  # Near lower band - risky for sell
                score -= 1.0
                avoid.append(f'Price near BB lower ({bb_position:.2f})')
    
    # Bollinger Band squeeze (low width = potential breakout)
    if bb_width is not None:
        if bb_width < 0.03:  # Very tight bands - squeeze
            score += 0.5
            bonuses.append('BB squeeze (breakout potential)')
        elif bb_width > 0.15:  # Very wide bands - extended move
            avoid.append('BB wide (extended volatility)')

    # ===== NEW: ATR-BASED RISK FILTER =====
    atr = metrics.get('atr')
    last_price = metrics.get('last_price')
    if atr is not None and last_price is not None and last_price > 0:
        atr_pct = (atr / last_price) * 100  # ATR as % of price
        if atr_pct > 8:  # Very high volatility (>8% ATR)
            score -= 1.0
            avoid.append(f'Very high ATR ({atr_pct:.1f}%)')
        elif atr_pct < 1:  # Very low volatility
            score += 0.5
            bonuses.append('Low ATR (controlled risk)')

    # ===== NEW: VWAP ALIGNMENT =====
    vwap = metrics.get('vwap_15m')
    if vwap is not None and last_price is not None:
        vwap_diff_pct = ((last_price - vwap) / vwap) * 100 if vwap > 0 else 0
        if signal == 'BUY':
            if vwap_diff_pct < -1:  # Price below VWAP - good for buy
                score += 0.5
                bonuses.append(f'Price below VWAP ({vwap_diff_pct:.1f}%)')
            elif vwap_diff_pct > 3:  # Price well above VWAP - extended
                avoid.append(f'Price extended above VWAP ({vwap_diff_pct:.1f}%)')
        elif signal == 'SELL':
            if vwap_diff_pct > 1:  # Price above VWAP - good for sell
                score += 0.5
                bonuses.append(f'Price above VWAP ({vwap_diff_pct:.1f}%)')
            elif vwap_diff_pct < -3:  # Price well below VWAP - extended
                avoid.append(f'Price extended below VWAP ({vwap_diff_pct:.1f}%)')

    # ===== GRADE MAPPING WITH STRICT MTF FILTER =====
    # A-grade requires BOTH high score AND MTF alignment
    if score >= 6 and mtf_aligned:
        grade = 'A'
    elif score >= 3:
        grade = 'B'
    else:
        grade = 'C'

    return score, grade, avoid
