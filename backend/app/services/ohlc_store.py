from __future__ import annotations
import sqlite3
import threading
from typing import List, Tuple, Optional

_DB_LOCK = threading.Lock()
_CONN: Optional[sqlite3.Connection] = None


def init_db(path: str = "ohlc.sqlite3"):
    global _CONN
    with _DB_LOCK:
        if _CONN is None:
            _CONN = sqlite3.connect(path, check_same_thread=False)
            _CONN.execute(
                """
                CREATE TABLE IF NOT EXISTS ohlc (
                  exchange TEXT NOT NULL,
                  symbol   TEXT NOT NULL,
                  interval TEXT NOT NULL,
                  open_time  INTEGER NOT NULL,
                  close_time INTEGER NOT NULL,
                  open   REAL NOT NULL,
                  high   REAL NOT NULL,
                  low    REAL NOT NULL,
                  close  REAL NOT NULL,
                  volume REAL NOT NULL,
                  PRIMARY KEY (exchange, symbol, interval, open_time)
                )
                """
            )
            _CONN.execute("CREATE INDEX IF NOT EXISTS idx_ohlc_symbol_it ON ohlc(symbol, interval, open_time)")
            _CONN.commit()


def upsert_candle(
    exchange: str,
    symbol: str,
    interval: str,
    open_time: int,
    close_time: int,
    open_: float,
    high: float,
    low: float,
    close: float,
    volume: float,
):
    if _CONN is None:
        init_db()
    with _DB_LOCK:
        _CONN.execute(
            """
            INSERT INTO ohlc(exchange, symbol, interval, open_time, close_time, open, high, low, close, volume)
            VALUES(?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(exchange, symbol, interval, open_time) DO UPDATE SET
              close_time=excluded.close_time,
              open=excluded.open,
              high=excluded.high,
              low=excluded.low,
              close=excluded.close,
              volume=excluded.volume
            """,
            (exchange, symbol, interval, open_time, close_time, open_, high, low, close, volume),
        )
        _CONN.commit()


def get_recent(
    exchange: str,
    symbol: str,
    interval: str,
    limit: int = 300,
) -> List[Tuple[int,int,float,float,float,float,float]]:
    """Return rows ordered by open_time ascending.
    Each row: (open_time, close_time, open, high, low, close, volume)
    """
    if _CONN is None:
        init_db()
    with _DB_LOCK:
        cur = _CONN.execute(
            """
            SELECT open_time, close_time, open, high, low, close, volume
            FROM ohlc
            WHERE exchange=? AND symbol=? AND interval=?
            ORDER BY open_time DESC
            LIMIT ?
            """,
            (exchange, symbol, interval, limit),
        )
        rows = cur.fetchall()
    rows.reverse()
    return rows
