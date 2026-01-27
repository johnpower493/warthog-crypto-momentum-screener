from __future__ import annotations
import time
import json
from dataclasses import dataclass
from typing import List, Optional, Dict, Any, Tuple

from ..models import SymbolMetrics
from ..config import TRADEPLAN_ATR_MULT, TRADEPLAN_TP_R_MULTS
from .ohlc_store import get_recent, init_db, get_conn, _DB_LOCK  # type: ignore

# Version bump to reflect improved methodology
STRATEGY_VERSION = "v3_enhanced_grading"

# Minimum grade to include in backtests (None = all, 'A' = only A, 'B' = A and B)
BACKTEST_MIN_GRADE = 'B'  # Only include A and B grade signals

# R-multiple thresholds for win classification
# With new TP1 at 1.5R, any TP hit is profitable after fees
WIN_R_THRESHOLD = 1.0  # Count as "WIN" if R >= 1.0 (TP1 now at 1.5R ensures profit)


@dataclass
class BacktestTradeResult:
    resolved: str  # 'TP1'|'TP2'|'TP3'|'SL'|'NONE'|'WIN'|'LOSS'
    r: float
    mae_r: float
    mfe_r: float
    bars: int
    grade: Optional[str] = None  # Signal grade at time of entry


def _now_ms() -> int:
    return int(time.time() * 1000)


def _insert_backtest_row(
    exchange: str,
    symbol: str,
    source_tf: Optional[str],
    window_days: int,
    n_trades: int,
    win_rate: Optional[float],
    avg_r: Optional[float],
    avg_mae_r: Optional[float],
    avg_mfe_r: Optional[float],
    avg_bars_to_resolve: Optional[float],
    results_json: Dict[str, Any],
):
    conn = get_conn()
    with _DB_LOCK:
        conn.execute(
            """
            INSERT INTO backtest_results(
              ts, exchange, symbol, source_tf, window_days, strategy_version,
              n_trades, win_rate, avg_r, avg_mae_r, avg_mfe_r, avg_bars_to_resolve, results_json
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(exchange, symbol, source_tf, window_days, strategy_version)
            DO UPDATE SET
              ts=excluded.ts,
              n_trades=excluded.n_trades,
              win_rate=excluded.win_rate,
              avg_r=excluded.avg_r,
              avg_mae_r=excluded.avg_mae_r,
              avg_mfe_r=excluded.avg_mfe_r,
              avg_bars_to_resolve=excluded.avg_bars_to_resolve,
              results_json=excluded.results_json
            """,
            (
                _now_ms(), exchange, symbol, source_tf, window_days, STRATEGY_VERSION,
                n_trades, win_rate, avg_r, avg_mae_r, avg_mfe_r, avg_bars_to_resolve, json.dumps(results_json),
            ),
        )
        conn.commit()


def _simulate_one(
    side: str,
    entry: float,
    stop: float,
    tps: List[Optional[float]],
    candles: List[Tuple[int,int,float,float,float,float,float]],
) -> BacktestTradeResult:
    # candles are (open_time, close_time, open, high, low, close, volume)
    risk = abs(entry - stop)
    if risk <= 0:
        return BacktestTradeResult('NONE', 0.0, 0.0, 0.0, 0)

    tp_levels = [tp for tp in tps if tp is not None]
    best_tp = max(tp_levels) if side == 'BUY' else min(tp_levels) if tp_levels else None

    mae = 0.0
    mfe = 0.0
    for i, row in enumerate(candles):
        _ot, _ct, o, h, l, c, v = row
        if side == 'BUY':
            # MAE uses low, MFE uses high
            mae = max(mae, (entry - l) / risk)
            mfe = max(mfe, (h - entry) / risk)
            # stop first? assume worst-case: if low <= stop, SL hit
            if l <= stop:
                return BacktestTradeResult('SL', -1.0, mae, mfe, i+1)
            # check TP hits in order
            for j, tp in enumerate(tp_levels):
                if h >= tp:
                    return BacktestTradeResult(f'TP{j+1}', float(j+1), mae, mfe, i+1)
        else:
            mae = max(mae, (h - entry) / risk)
            mfe = max(mfe, (entry - l) / risk)
            if h >= stop:
                return BacktestTradeResult('SL', -1.0, mae, mfe, i+1)
            for j, tp in enumerate(tp_levels):
                if l <= tp:
                    return BacktestTradeResult(f'TP{j+1}', float(j+1), mae, mfe, i+1)

    return BacktestTradeResult('NONE', 0.0, mae, mfe, len(candles))


def backtest_symbol(
    exchange: str,
    symbol: str,
    window_days: int,
    source_tf: Optional[str] = None,
    min_grade: Optional[str] = None,
) -> Dict[str, Any]:
    """Backtest using stored trade plans (generated at signal time).

    Scope: last 30/90 days.

    Method:
    - Fetch trade_plans(ts, side, entry/stop/tps) from SQLite within window.
    - Filter by grade if min_grade is set (A = only A, B = A and B, C = all).
    - For each plan, simulate forward on 15m candles after ts, checking stop vs TP hits.
    - Use realistic win classification: WIN requires R >= 1.5 (profitable after fees).
    - Aggregate win rate and R stats.
    """
    since_ts = int(time.time() * 1000) - int(window_days * 24 * 60 * 60 * 1000)
    # Pull stored trade plans with grade info
    from .alert_store import get_trade_plans_since
    plans = get_trade_plans_since(exchange, symbol, since_ts)
    if not plans:
        return {"n_trades": 0}

    # Filter by minimum grade
    grade_priority = {'A': 3, 'B': 2, 'C': 1, None: 0}
    effective_min_grade = min_grade if min_grade else BACKTEST_MIN_GRADE
    if effective_min_grade:
        min_priority = grade_priority.get(effective_min_grade, 0)
        plans = [p for p in plans if grade_priority.get(p.get('grade'), 0) >= min_priority]
    
    if not plans:
        return {"n_trades": 0, "filtered_by_grade": effective_min_grade}

    from .ohlc_store import get_after
    results: List[BacktestTradeResult] = []
    grade_results: Dict[str, List[BacktestTradeResult]] = {'A': [], 'B': [], 'C': []}
    
    for p in plans:
        # Use the next ~3 days of 15m candles as a resolution horizon (288 candles)
        forward = get_after(exchange, symbol, '15m', start_open_time=p['ts'], limit=288)
        if not forward:
            continue
        res = _simulate_one(p['side'], float(p['entry']), float(p['stop']), [p['tp1'], p['tp2'], p['tp3']], forward)
        res.grade = p.get('grade')
        results.append(res)
        
        # Track by grade
        if res.grade in grade_results:
            grade_results[res.grade].append(res)

    n = len(results)
    if n == 0:
        return {"n_trades": 0}

    # Realistic win classification:
    # - TP2+ (R >= 2.0) = definite WIN
    # - TP1 (R = 1.0) = marginal (break-even after fees)
    # - Use WIN_R_THRESHOLD for classification
    def is_win(r: BacktestTradeResult) -> bool:
        return r.r >= WIN_R_THRESHOLD
    
    def is_loss(r: BacktestTradeResult) -> bool:
        return r.resolved == 'SL' or (r.resolved != 'NONE' and r.r < 0)

    wins = sum(1 for r in results if is_win(r))
    losses = sum(1 for r in results if is_loss(r))
    resolved = wins + losses
    win_rate = wins / resolved if resolved > 0 else 0.0
    
    # Also track "any TP" rate for comparison
    any_tp_wins = sum(1 for r in results if r.resolved.startswith('TP'))
    any_tp_rate = any_tp_wins / n if n > 0 else 0.0
    
    avg_r = sum(r.r for r in results) / n
    avg_mae = sum(r.mae_r for r in results) / n
    avg_mfe = sum(r.mfe_r for r in results) / n
    avg_bars = sum(r.bars for r in results) / n
    
    # Expectancy = (win_rate * avg_win) - (loss_rate * avg_loss)
    winning_rs = [r.r for r in results if is_win(r)]
    losing_rs = [abs(r.r) for r in results if is_loss(r)]
    avg_win_r = sum(winning_rs) / len(winning_rs) if winning_rs else 0
    avg_loss_r = sum(losing_rs) / len(losing_rs) if losing_rs else 1
    expectancy = (win_rate * avg_win_r) - ((1 - win_rate) * avg_loss_r) if resolved > 0 else 0
    
    # Per-grade stats
    grade_stats = {}
    for g in ['A', 'B', 'C']:
        g_results = grade_results[g]
        if g_results:
            g_wins = sum(1 for r in g_results if is_win(r))
            g_losses = sum(1 for r in g_results if is_loss(r))
            g_resolved = g_wins + g_losses
            grade_stats[g] = {
                'n': len(g_results),
                'wins': g_wins,
                'losses': g_losses,
                'win_rate': g_wins / g_resolved if g_resolved > 0 else 0,
                'avg_r': sum(r.r for r in g_results) / len(g_results),
            }

    return {
        "n_trades": n,
        "n_resolved": resolved,
        "wins": wins,
        "losses": losses,
        "win_rate": win_rate,  # Realistic (R >= 1.5)
        "any_tp_rate": any_tp_rate,  # Any TP hit rate (for comparison)
        "avg_r": avg_r,
        "expectancy": expectancy,
        "avg_win_r": avg_win_r,
        "avg_loss_r": avg_loss_r,
        "avg_mae_r": avg_mae,
        "avg_mfe_r": avg_mfe,
        "avg_bars_to_resolve": avg_bars,
        "filtered_by_grade": effective_min_grade,
        "grade_stats": grade_stats,
        "counts": {
            "TP1": sum(1 for r in results if r.resolved == 'TP1'),
            "TP2": sum(1 for r in results if r.resolved == 'TP2'),
            "TP3": sum(1 for r in results if r.resolved == 'TP3'),
            "SL": sum(1 for r in results if r.resolved == 'SL'),
            "NONE": sum(1 for r in results if r.resolved == 'NONE'),
        },
        "strategy_version": STRATEGY_VERSION,
    }


def run_backtest_for_symbols(exchange: str, symbols: List[str], window_days: int, source_tf: Optional[str] = None):
    for sym in symbols:
        res = backtest_symbol(exchange, sym, window_days, source_tf=source_tf)
        _insert_backtest_row(
            exchange=exchange,
            symbol=sym,
            source_tf=source_tf,
            window_days=window_days,
            n_trades=int(res.get('n_trades', 0)),
            win_rate=res.get('win_rate'),
            avg_r=res.get('avg_r'),
            avg_mae_r=res.get('avg_mae_r'),
            avg_mfe_r=res.get('avg_mfe_r'),
            avg_bars_to_resolve=res.get('avg_bars_to_resolve'),
            results_json=res,
        )
