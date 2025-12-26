from __future__ import annotations
import time
from typing import Dict, List, Tuple
from ..models import SymbolMetrics
from ..config import LIQ_TOP_N, LIQ_WEIGHTS

# Simple in-memory provider computing liquidity ranks from current metrics
# We compute on-demand and cache for a short time-window.

_cache: Dict[str, Tuple[float, Dict[str, int], set[str]]] = {}
_CACHE_TTL_SEC = 60.0


def _now() -> float:
    return time.time()


def _normalize(values: List[float]) -> Dict[int, float]:
    # returns index->normalized [0,1]
    if not values:
        return {}
    vmin = min(values)
    vmax = max(values)
    span = vmax - vmin
    out: Dict[int, float] = {}
    for i, v in enumerate(values):
        out[i] = 0.0 if span == 0 else (v - vmin) / span
    return out


def compute_liquidity_ranks(exchange: str, metrics: List[SymbolMetrics]) -> Tuple[Dict[str, int], set[str]]:
    key = exchange.lower()
    now = _now()
    cached = _cache.get(key)
    if cached and (now - cached[0] < _CACHE_TTL_SEC):
        return cached[1], cached[2]

    # Build feature arrays
    syms: List[str] = []
    f_turnover: List[float] = []  # proxy: latest 1m volume
    f_oi: List[float] = []        # open interest
    f_activity: List[float] = []  # proxy: abs 5m change or vol zscore

    for m in metrics:
        syms.append(m.symbol)
        turnover = float(m.vol_1m or 0.0)
        oi = float(m.open_interest or 0.0)
        activity = float(abs(m.change_5m or 0.0)) if (m.change_5m is not None) else float(abs(m.vol_zscore_1m or 0.0))
        f_turnover.append(turnover)
        f_oi.append(oi)
        f_activity.append(activity)

    n_turn = _normalize(f_turnover)
    n_oi = _normalize(f_oi)
    n_act = _normalize(f_activity)

    w_turn, w_oi, w_act = LIQ_WEIGHTS
    scores: List[float] = []
    for i in range(len(syms)):
        s = w_turn * n_turn.get(i, 0.0) + w_oi * n_oi.get(i, 0.0) + w_act * n_act.get(i, 0.0)
        scores.append(s)

    # Rank high->low
    idx_sorted = sorted(range(len(syms)), key=lambda i: scores[i], reverse=True)
    rank_map: Dict[str, int] = {}
    for r, idx in enumerate(idx_sorted, start=1):
        rank_map[syms[idx]] = r

    top_set = set()
    for idx in idx_sorted[: LIQ_TOP_N]:
        top_set.add(syms[idx])

    _cache[key] = (now, rank_map, top_set)
    return rank_map, top_set
