from __future__ import annotations
from dataclasses import dataclass
from typing import Optional, List, Tuple, Dict, Any

from ..config import TRADEPLAN_ATR_MULT, TRADEPLAN_SWING_LOOKBACK_15M, TRADEPLAN_TP_R_MULTS


@dataclass
class TradePlan:
    side: str  # 'BUY'|'SELL'
    entry_type: str
    entry_price: float
    stop_loss: float
    tp1: Optional[float]
    tp2: Optional[float]
    tp3: Optional[float]
    atr: Optional[float]
    atr_mult: float
    swing_ref: Optional[float]
    risk_per_unit: Optional[float]
    rr_tp1: Optional[float]
    rr_tp2: Optional[float]
    rr_tp3: Optional[float]
    plan_json: Dict[str, Any]


def compute_15m_swing(highs: List[float], lows: List[float]) -> Tuple[Optional[float], Optional[float]]:
    if not highs or not lows:
        return None, None
    return max(highs), min(lows)


def build_trade_plan(
    side: str,
    entry_price: float,
    atr: Optional[float],
    swing_high_15m: Optional[float],
    swing_low_15m: Optional[float],
) -> TradePlan:
    """Build a trade plan using 15m structure + ATR guardrail.

    Note: this is used for the fast screener signals (CipherB/%R).
    """

    atr_mult = TRADEPLAN_ATR_MULT
    tp_r1, tp_r2, tp_r3 = TRADEPLAN_TP_R_MULTS

    if side not in {"BUY", "SELL"}:
        raise ValueError("side must be BUY or SELL")

    # ATR guardrail stop
    atr_sl = None
    if atr is not None:
        atr_sl = entry_price - atr_mult * atr if side == "BUY" else entry_price + atr_mult * atr

    swing_ref = swing_low_15m if side == "BUY" else swing_high_15m

    # Structure + ATR: choose the more conservative (wider) stop
    if side == "BUY":
        candidates = [c for c in [swing_low_15m, atr_sl] if c is not None]
        stop = min(candidates) if candidates else (atr_sl if atr_sl is not None else entry_price)
    else:
        candidates = [c for c in [swing_high_15m, atr_sl] if c is not None]
        stop = max(candidates) if candidates else (atr_sl if atr_sl is not None else entry_price)

    risk = abs(entry_price - stop) if entry_price is not None and stop is not None else None
    if risk is None or risk == 0:
        tp1 = tp2 = tp3 = None
        rr1 = rr2 = rr3 = None
    else:
        sign = 1.0 if side == "BUY" else -1.0
        tp1 = entry_price + sign * tp_r1 * risk
        tp2 = entry_price + sign * tp_r2 * risk
        tp3 = entry_price + sign * tp_r3 * risk
        rr1 = tp_r1
        rr2 = tp_r2
        rr3 = tp_r3

    plan_json = {
        "version": "v1_structure_atr",
        "swing_lookback_15m": TRADEPLAN_SWING_LOOKBACK_15M,
        "atr_mult": atr_mult,
        "tp_r_mults": [tp_r1, tp_r2, tp_r3],
        "swing_high_15m": swing_high_15m,
        "swing_low_15m": swing_low_15m,
        "atr_sl": atr_sl,
    }

    return TradePlan(
        side=side,
        entry_type="market",
        entry_price=entry_price,
        stop_loss=stop,
        tp1=tp1,
        tp2=tp2,
        tp3=tp3,
        atr=atr,
        atr_mult=atr_mult,
        swing_ref=swing_ref,
        risk_per_unit=risk,
        rr_tp1=rr1,
        rr_tp2=rr2,
        rr_tp3=rr3,
        plan_json=plan_json,
    )


def build_trade_plan_swing_4h(
    entry_price: float,
    atr_4h: Optional[float],
    swing_low_4h: Optional[float],
    tp_r_mult: float = 1.25,
    atr_mult: float = 2.0,
) -> TradePlan:
    """4h swing long plan: structure stop at swing low with ATR fallback.

    - Stop uses min(swing_low_4h, entry - atr_mult*atr_4h) for BUY.
    - Single TP at tp_r_mult R, stored as TP1.
    """
    side = 'BUY'
    atr_sl = (entry_price - atr_mult * atr_4h) if atr_4h is not None else None
    candidates = [c for c in [swing_low_4h, atr_sl] if c is not None]
    stop = min(candidates) if candidates else (atr_sl if atr_sl is not None else entry_price)

    risk = abs(entry_price - stop) if entry_price is not None and stop is not None else None
    tp1 = None
    if risk and risk > 0:
        tp1 = entry_price + tp_r_mult * risk

    plan_json = {
        'version': 'v1_swing_4h_structure_atr',
        'atr_mult': atr_mult,
        'tp_r_mult': tp_r_mult,
        'swing_low_4h': swing_low_4h,
        'atr_sl': atr_sl,
    }

    return TradePlan(
        side=side,
        entry_type='market',
        entry_price=entry_price,
        stop_loss=stop,
        tp1=tp1,
        tp2=None,
        tp3=None,
        atr=atr_4h,
        atr_mult=atr_mult,
        swing_ref=swing_low_4h,
        risk_per_unit=risk,
        rr_tp1=tp_r_mult if tp1 is not None else None,
        rr_tp2=None,
        rr_tp3=None,
        plan_json=plan_json,
    )
