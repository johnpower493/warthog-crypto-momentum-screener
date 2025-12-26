from __future__ import annotations
import json
from typing import Optional, Dict, Any, List, Tuple

from .ohlc_store import init_db, _DB_LOCK, _CONN  # type: ignore


def insert_alert(
    ts: int,
    exchange: str,
    symbol: str,
    signal: str,
    source_tf: Optional[str],
    price: Optional[float],
    reason: Optional[str],
    metrics: Optional[Dict[str, Any]] = None,
    created_ts: Optional[int] = None,
) -> int:
    if _CONN is None:
        init_db()
    metrics_json = json.dumps(metrics) if metrics is not None else None
    if created_ts is None:
        import time
        created_ts = int(time.time() * 1000)
    with _DB_LOCK:
        cur = _CONN.execute(
            """
            INSERT OR IGNORE INTO alerts(ts, created_ts, exchange, symbol, signal, source_tf, price, reason, metrics_json)
            VALUES(?,?,?,?,?,?,?,?,?)
            """,
            (ts, created_ts, exchange, symbol, signal, source_tf, price, reason, metrics_json),
        )
        _CONN.commit()
        # If ignored due to UNIQUE, fetch existing id
        if cur.lastrowid:
            return int(cur.lastrowid)
        cur2 = _CONN.execute(
            """SELECT id FROM alerts WHERE exchange=? AND symbol=? AND signal=? AND ts=?""",
            (exchange, symbol, signal, ts),
        )
        row = cur2.fetchone()
        return int(row[0]) if row else 0


def insert_trade_plan(
    alert_id: int,
    ts: int,
    exchange: str,
    symbol: str,
    side: str,
    entry_type: str,
    entry_price: float,
    stop_loss: float,
    tp1: Optional[float],
    tp2: Optional[float],
    tp3: Optional[float],
    atr: Optional[float],
    atr_mult: Optional[float],
    swing_ref: Optional[float],
    risk_per_unit: Optional[float],
    rr_tp1: Optional[float],
    rr_tp2: Optional[float],
    rr_tp3: Optional[float],
    plan: Optional[Dict[str, Any]] = None,
) -> int:
    if _CONN is None:
        init_db()
    plan_json = json.dumps(plan) if plan is not None else None
    with _DB_LOCK:
        cur = _CONN.execute(
            """
            INSERT INTO trade_plans(
              alert_id, ts, exchange, symbol, side, entry_type, entry_price,
              stop_loss, tp1, tp2, tp3, atr, atr_mult, swing_ref,
              risk_per_unit, rr_tp1, rr_tp2, rr_tp3, plan_json
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (alert_id, ts, exchange, symbol, side, entry_type, entry_price,
             stop_loss, tp1, tp2, tp3, atr, atr_mult, swing_ref,
             risk_per_unit, rr_tp1, rr_tp2, rr_tp3, plan_json),
        )
        _CONN.commit()
        return int(cur.lastrowid)


def get_recent_alerts(exchange: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
    if _CONN is None:
        init_db()
    with _DB_LOCK:
        if exchange:
            cur = _CONN.execute(
                """SELECT id, ts, exchange, symbol, signal, source_tf, price, reason FROM alerts WHERE exchange=? ORDER BY ts DESC LIMIT ?""",
                (exchange, limit),
            )
        else:
            cur = _CONN.execute(
                """SELECT id, ts, exchange, symbol, signal, source_tf, price, reason FROM alerts ORDER BY ts DESC LIMIT ?""",
                (limit,),
            )
        rows = cur.fetchall()
    out = []
    for r in rows:
        out.append({
            "id": r[0],
            "ts": r[1],
            "exchange": r[2],
            "symbol": r[3],
            "signal": r[4],
            "source_tf": r[5],
            "price": r[6],
            "reason": r[7],
        })
    return out


def get_latest_trade_plan(exchange: str, symbol: str) -> Optional[Dict[str, Any]]:
    if _CONN is None:
        init_db()
    with _DB_LOCK:
        cur = _CONN.execute(
            """
            SELECT id, ts, side, entry_type, entry_price, stop_loss, tp1, tp2, tp3, atr, atr_mult, swing_ref, risk_per_unit, rr_tp1, rr_tp2, rr_tp3
            FROM trade_plans
            WHERE exchange=? AND symbol=?
            ORDER BY ts DESC
            LIMIT 1
            """,
            (exchange, symbol),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "ts": row[1],
        "side": row[2],
        "entry_type": row[3],
        "entry_price": row[4],
        "stop_loss": row[5],
        "tp1": row[6],
        "tp2": row[7],
        "tp3": row[8],
        "atr": row[9],
        "atr_mult": row[10],
        "swing_ref": row[11],
        "risk_per_unit": row[12],
        "rr_tp1": row[13],
        "rr_tp2": row[14],
        "rr_tp3": row[15],
    }


def get_trade_plans_since(exchange: str, symbol: str, since_ts: int) -> List[Dict[str, Any]]:
    if _CONN is None:
        init_db()
    with _DB_LOCK:
        cur = _CONN.execute(
            """
            SELECT ts, side, entry_price, stop_loss, tp1, tp2, tp3
            FROM trade_plans
            WHERE exchange=? AND symbol=? AND ts >= ?
            ORDER BY ts ASC
            """,
            (exchange, symbol, since_ts),
        )
        rows = cur.fetchall()
    out = []
    for r in rows:
        out.append({
            "ts": int(r[0]),
            "side": r[1],
            "entry": float(r[2]),
            "stop": float(r[3]),
            "tp1": float(r[4]) if r[4] is not None else None,
            "tp2": float(r[5]) if r[5] is not None else None,
            "tp3": float(r[6]) if r[6] is not None else None,
        })
    return out