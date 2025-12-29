from __future__ import annotations
import time
from typing import Optional, List, Dict, Any, Tuple

from .ohlc_store import init_db, get_conn, _DB_LOCK  # type: ignore
from .ohlc_store import get_after
from .backtester import STRATEGY_VERSION
from .backtester import _simulate_one, BacktestTradeResult  # type: ignore

# Horizon: 1 day of 15m candles
HORIZON_15M_BARS = 96


def run_analysis_backtest(window_days: int, exchange: str = 'all', top200_only: bool = True) -> Dict[str, Any]:
    """Populate backtest_trades table for alerts within window_days.

    - Uses persisted alerts + trade_plans.
    - Simulates forward using 15m candles for 96 bars (1 day).
    - Records NONE outcomes but analysis endpoints will exclude them from aggregates.
    """
    init_db()
    now = int(time.time() * 1000)
    since = now - int(window_days * 24 * 60 * 60 * 1000)

    # Build query to fetch alerts joined to latest trade_plan at same ts
    where = ["a.created_ts >= ?"]
    params: list[Any] = [since]
    if exchange != 'all':
        where.append("a.exchange = ?")
        params.append(exchange)
    if top200_only:
        where.append("(a.metrics_json LIKE '%\"liquidity_top200\": true%' OR a.metrics_json LIKE '%\"liquidity_top200\":true%')")

    where_sql = " AND ".join(where)

    q = f"""
    SELECT a.id, a.created_ts, a.exchange, a.symbol, a.signal, a.source_tf, a.setup_grade, a.setup_score,
           a.metrics_json,
           p.entry_price, p.stop_loss, p.tp1, p.tp2, p.tp3
    FROM alerts a
    JOIN trade_plans p ON p.alert_id = a.id
    WHERE {where_sql}
    ORDER BY a.created_ts ASC
    """

    conn = get_conn()
    with _DB_LOCK:
        cur = conn.execute(q, tuple(params))
        rows = cur.fetchall()

    inserted = 0
    updated = 0
    for r in rows:
        alert_id = int(r[0])
        created_ts = int(r[1])
        ex = r[2]
        sym = r[3]
        sig = r[4]
        source_tf = r[5]
        grade = r[6]
        score = r[7]
        metrics_json = r[8]
        entry = float(r[9])
        stop = float(r[10])
        tp1 = float(r[11]) if r[11] is not None else None
        tp2 = float(r[12]) if r[12] is not None else None
        tp3 = float(r[13]) if r[13] is not None else None

        # Backfill grade/score for historical alerts that predate grading.
        liquidity_top200 = None
        if metrics_json:
            try:
                import json
                md = json.loads(metrics_json)
                liquidity_top200 = md.get('liquidity_top200')
                if (grade is None) or (score is None):
                    from .grader import grade_alert
                    setup_score, setup_grade, _avoid = grade_alert(md, str(sig))
                    if score is None:
                        score = setup_score
                    if grade is None:
                        grade = setup_grade
            except Exception:
                pass

        forward = get_after(ex, sym, '15m', start_open_time=created_ts, limit=HORIZON_15M_BARS)
        if not forward:
            res = BacktestTradeResult('NONE', 0.0, 0.0, 0.0, 0)
        else:
            res = _simulate_one(sig, entry, stop, [tp1, tp2, tp3], forward)

        # resolved_ts approximation: use last candle close_time if any
        resolved_ts = None
        if forward:
            idx = max(0, min(res.bars - 1, len(forward) - 1))
            resolved_ts = int(forward[idx][1])

        conn = get_conn()
        with _DB_LOCK:
            # Upsert by unique key
            cur2 = conn.execute(
                """
                INSERT INTO backtest_trades(
                  alert_id, window_days, strategy_version, created_ts, exchange, symbol, signal, source_tf,
                  setup_grade, setup_score, liquidity_top200,
                  entry, stop, tp1, tp2, tp3,
                  resolved, r_multiple, mae_r, mfe_r, bars_to_resolve, resolved_ts
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(alert_id, window_days, strategy_version) DO UPDATE SET
                  created_ts=excluded.created_ts,
                  exchange=excluded.exchange,
                  symbol=excluded.symbol,
                  signal=excluded.signal,
                  source_tf=excluded.source_tf,
                  setup_grade=excluded.setup_grade,
                  setup_score=excluded.setup_score,
                  liquidity_top200=excluded.liquidity_top200,
                  entry=excluded.entry,
                  stop=excluded.stop,
                  tp1=excluded.tp1,
                  tp2=excluded.tp2,
                  tp3=excluded.tp3,
                  resolved=excluded.resolved,
                  r_multiple=excluded.r_multiple,
                  mae_r=excluded.mae_r,
                  mfe_r=excluded.mfe_r,
                  bars_to_resolve=excluded.bars_to_resolve,
                  resolved_ts=excluded.resolved_ts
                """,
                (
                    alert_id, window_days, STRATEGY_VERSION, created_ts, ex, sym, sig, source_tf,
                    grade, score, (1 if liquidity_top200 is True else 0 if liquidity_top200 is False else None),
                    entry, stop, tp1, tp2, tp3,
                    res.resolved, res.r, res.mae_r, res.mfe_r, res.bars, resolved_ts,
                ),
            )
            conn.commit()

    # Record run metadata
    try:
        conn = get_conn()
        with _DB_LOCK:
            conn.execute(
                """
                INSERT INTO analysis_runs(ts, window_days, exchange, top200_only, n_alerts)
                VALUES(?,?,?,?,?)
                ON CONFLICT(window_days, exchange, top200_only) DO UPDATE SET
                  ts=excluded.ts,
                  n_alerts=excluded.n_alerts
                """,
                (int(time.time()*1000), window_days, exchange, 1 if top200_only else 0, len(rows)),
            )
            conn.commit()
    except Exception:
        pass

    return {"window_days": window_days, "exchange": exchange, "top200_only": top200_only, "n": len(rows)}
