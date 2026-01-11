from __future__ import annotations
import json
import time
from typing import Optional, Dict, Any, List, Tuple

from .ohlc_store import init_db, get_conn, _DB_LOCK  # type: ignore

# Simple in-memory cache for recent alerts (feed page)
_alerts_cache: Dict[str, tuple[float, List[Dict[str, Any]]]] = {}
_ALERTS_CACHE_TTL_SEC = 5.0  # 5 second cache for feed page


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
    setup_score: Optional[float] = None,
    setup_grade: Optional[str] = None,
    avoid_reasons: Optional[list[str]] = None,
) -> int:
    conn = get_conn()
    metrics_json = json.dumps(metrics) if metrics is not None else None
    if created_ts is None:
        import time
        created_ts = int(time.time() * 1000)
    avoid_json = json.dumps(avoid_reasons) if avoid_reasons is not None else None
    with _DB_LOCK:
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO alerts(
              ts, created_ts, exchange, symbol, signal, source_tf, price, reason,
              setup_score, setup_grade, avoid_reasons, metrics_json
            )
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (ts, created_ts, exchange, symbol, signal, source_tf, price, reason, setup_score, setup_grade, avoid_json, metrics_json),
        )
        conn.commit()
        # If ignored due to UNIQUE, fetch existing id
        if cur.lastrowid:
            return int(cur.lastrowid)
        cur2 = conn.execute(
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
    conn = get_conn()
    plan_json = json.dumps(plan) if plan is not None else None
    with _DB_LOCK:
        cur = conn.execute(
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
        conn.commit()
        return int(cur.lastrowid)


def get_recent_alerts(
    exchange: Optional[str] = None,
    limit: int = 200,
    since_ts: Optional[int] = None,
    signal: Optional[str] = None,
    source_tf: Optional[str] = None,
    min_grade: Optional[str] = None,
) -> List[Dict[str, Any]]:
    # Build cache key from params
    cache_key = f"{exchange}:{limit}:{since_ts}:{signal}:{source_tf}:{min_grade}"
    now = time.time()
    
    # Check cache first
    if cache_key in _alerts_cache:
        cached_ts, cached_data = _alerts_cache[cache_key]
        if now - cached_ts < _ALERTS_CACHE_TTL_SEC:
            return cached_data
    
    conn = get_conn()
    where = []
    params: list[Any] = []
    if exchange:
        where.append("exchange = ?")
        params.append(exchange)
    if since_ts is not None:
        where.append("created_ts >= ?")
        params.append(int(since_ts))
    if signal:
        where.append("signal = ?")
        params.append(signal)
    if source_tf:
        where.append("source_tf = ?")
        params.append(source_tf)
    if min_grade:
        # Lexicographic doesn't work; use explicit set
        min_grade = min_grade.upper()
        if min_grade == 'A':
            where.append("setup_grade = 'A'")
        elif min_grade == 'B':
            where.append("setup_grade IN ('A','B')")
        elif min_grade == 'C':
            where.append("setup_grade IN ('A','B','C')")

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    q = f"""
      SELECT id, ts, created_ts, exchange, symbol, signal, source_tf, price, reason, setup_score, setup_grade, avoid_reasons
      FROM alerts
      {where_sql}
      ORDER BY created_ts DESC
      LIMIT ?
    """
    params.append(limit)

    with _DB_LOCK:
        cur = conn.execute(q, tuple(params))
        rows = cur.fetchall()
    out = []
    for r in rows:
        avoid = None
        try:
            avoid = json.loads(r[11]) if r[11] else None
        except Exception:
            avoid = None
        out.append({
            "id": r[0],
            "ts": r[1],
            "created_ts": r[2],
            "exchange": r[3],
            "symbol": r[4],
            "signal": r[5],
            "source_tf": r[6],
            "price": r[7],
            "reason": r[8],
            "setup_score": r[9],
            "setup_grade": r[10],
            "avoid_reasons": avoid,
        })
    
    # Cache the result
    _alerts_cache[cache_key] = (now, out)
    
    # Clean old cache entries (keep cache size bounded)
    if len(_alerts_cache) > 100:
        oldest_keys = sorted(_alerts_cache.keys(), key=lambda k: _alerts_cache[k][0])[:50]
        for k in oldest_keys:
            _alerts_cache.pop(k, None)
    
    return out


def get_latest_trade_plan(exchange: str, symbol: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    with _DB_LOCK:
        cur = conn.execute(
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
    conn = get_conn()
    with _DB_LOCK:
        cur = conn.execute(
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