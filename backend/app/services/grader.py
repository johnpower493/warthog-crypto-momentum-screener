from __future__ import annotations
import json
from typing import Dict, Any, List, Optional, Tuple

# Simple transparent scoring model
# A: score >= 4
# B: score in [2,3]
# C: score <= 1


def grade_alert(metrics: Dict[str, Any], signal: str) -> Tuple[float, str, List[str]]:
    """Return (setup_score, setup_grade, avoid_reasons)."""
    score = 0.0
    avoid: List[str] = []

    # Base: cipher fired
    score += 2.0

    # OI delta alignment: use 5m OI change if present (preferred), else none
    oi5m = metrics.get('oi_change_5m')
    if oi5m is not None:
        if signal == 'BUY':
            if oi5m > 0:
                score += 2.0
            elif oi5m < 0:
                score -= 2.0
                avoid.append('OI decreasing on BUY')
        elif signal == 'SELL':
            if oi5m < 0:
                score += 2.0
            elif oi5m > 0:
                score -= 2.0
                avoid.append('OI increasing on SELL')

    # RVOL
    rvol = metrics.get('rvol_1m')
    if rvol is not None:
        try:
            rvol = float(rvol)
            if rvol >= 1.5:
                score += 1.0
            elif rvol < 0.8:
                score -= 1.0
                avoid.append('Low RVOL')
        except Exception:
            pass

    # Momentum alignment
    mom = metrics.get('momentum_score')
    if mom is not None:
        try:
            mom = float(mom)
            if signal == 'BUY':
                if mom > 0:
                    score += 1.0
                elif mom < 0:
                    score -= 1.0
                    avoid.append('Momentum bearish on BUY')
            elif signal == 'SELL':
                if mom < 0:
                    score += 1.0
                elif mom > 0:
                    score -= 1.0
                    avoid.append('Momentum bullish on SELL')
        except Exception:
            pass

    # Liquidity proxy: vol_1m very low
    vol1m = metrics.get('vol_1m')
    if vol1m is not None:
        try:
            vol1m = float(vol1m)
            if vol1m <= 0:
                avoid.append('No volume data')
            elif vol1m < 10_000:
                score -= 1.0
                avoid.append('Low volume')
        except Exception:
            pass

    # Grade mapping
    if score >= 4:
        grade = 'A'
    elif score >= 2:
        grade = 'B'
    else:
        grade = 'C'

    return score, grade, avoid
