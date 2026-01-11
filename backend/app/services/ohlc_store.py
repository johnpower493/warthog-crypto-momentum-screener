from __future__ import annotations
import sqlite3
import threading
from typing import List, Tuple, Optional, Any, Dict

_DB_LOCK = threading.Lock()
_CONN: Optional[sqlite3.Connection] = None


def get_conn() -> sqlite3.Connection:
    """Return a sqlite connection (initializing if needed)."""
    if _CONN is None:
        init_db()
    return _CONN  # type: ignore[return-value]


def init_db(path: str = "ohlc.sqlite3"):
    global _CONN
    with _DB_LOCK:
        if _CONN is None:
            _CONN = sqlite3.connect(path, check_same_thread=False)
            _CONN.execute("PRAGMA journal_mode=WAL")
            _CONN.execute("PRAGMA synchronous=NORMAL")

            # OHLC store
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
            _CONN.execute("CREATE INDEX IF NOT EXISTS idx_ohlc_symbol_it ON ohlc(exchange, symbol, interval, open_time)")

            # Alert log (signals)
            # Note: created_ts is used for "last N hours" aggregations (sentiment), so it must exist
            # before we create indexes that reference it.
            _CONN.execute(
                """
                CREATE TABLE IF NOT EXISTS alerts (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ts INTEGER NOT NULL,                            -- event/candle timestamp (from metric)
                  created_ts INTEGER NOT NULL DEFAULT 0,           -- wall-clock when stored/emitted
                  exchange TEXT NOT NULL,
                  symbol TEXT NOT NULL,
                  signal TEXT NOT NULL,                           -- 'BUY' | 'SELL'
                  source_tf TEXT,                                 -- '15m' | '4h'
                  price REAL,
                  reason TEXT,
                  setup_score REAL,
                  setup_grade TEXT,
                  avoid_reasons TEXT,
                  metrics_json TEXT,
                  UNIQUE(exchange, symbol, signal, ts)
                )
                """
            )

            # lightweight migrations for existing DBs
            try:
                cols = [r[1] for r in _CONN.execute("PRAGMA table_info(alerts)").fetchall()]
                if 'created_ts' not in cols:
                    _CONN.execute("ALTER TABLE alerts ADD COLUMN created_ts INTEGER NOT NULL DEFAULT 0")
                    _CONN.execute("UPDATE alerts SET created_ts = ts WHERE created_ts = 0")
                if 'setup_score' not in cols:
                    _CONN.execute("ALTER TABLE alerts ADD COLUMN setup_score REAL")
                if 'setup_grade' not in cols:
                    _CONN.execute("ALTER TABLE alerts ADD COLUMN setup_grade TEXT")
                if 'avoid_reasons' not in cols:
                    _CONN.execute("ALTER TABLE alerts ADD COLUMN avoid_reasons TEXT")
            except Exception:
                pass

            # migrations for analysis_runs
            try:
                _CONN.execute("SELECT 1 FROM analysis_runs LIMIT 1")
            except Exception:
                try:
                    _CONN.execute(
                        """
                        CREATE TABLE IF NOT EXISTS analysis_runs (
                          id INTEGER PRIMARY KEY AUTOINCREMENT,
                          ts INTEGER NOT NULL,
                          window_days INTEGER NOT NULL,
                          exchange TEXT NOT NULL,
                          top200_only INTEGER NOT NULL,
                          n_alerts INTEGER,
                          UNIQUE(window_days, exchange, top200_only)
                        )
                        """
                    )
                    _CONN.execute("CREATE INDEX IF NOT EXISTS idx_analysis_runs_ts ON analysis_runs(ts)")
                except Exception:
                    pass

            # migrations for backtest_trades
            try:
                _CONN.execute("SELECT 1 FROM backtest_trades LIMIT 1")
            except Exception:
                try:
                    _CONN.execute(
                        """
                        CREATE TABLE IF NOT EXISTS backtest_trades (
                          id INTEGER PRIMARY KEY AUTOINCREMENT,
                          alert_id INTEGER NOT NULL,
                          window_days INTEGER NOT NULL,
                          strategy_version TEXT NOT NULL,
                          created_ts INTEGER NOT NULL,
                          exchange TEXT NOT NULL,
                          symbol TEXT NOT NULL,
                          signal TEXT NOT NULL,
                          source_tf TEXT,
                          setup_grade TEXT,
                          setup_score REAL,
                          liquidity_top200 INTEGER,
                          entry REAL,
                          stop REAL,
                          tp1 REAL,
                          tp2 REAL,
                          tp3 REAL,
                          resolved TEXT NOT NULL,
                          r_multiple REAL,
                          mae_r REAL,
                          mfe_r REAL,
                          bars_to_resolve INTEGER,
                          resolved_ts INTEGER,
                          UNIQUE(alert_id, window_days, strategy_version)
                        )
                        """
                    )
                    _CONN.execute("CREATE INDEX IF NOT EXISTS idx_bt_trades_lookup ON backtest_trades(exchange, window_days, created_ts)")
                    _CONN.execute("CREATE INDEX IF NOT EXISTS idx_bt_trades_symbol ON backtest_trades(exchange, symbol, window_days)")
                except Exception:
                    pass

            except Exception:
                pass

            _CONN.execute("CREATE INDEX IF NOT EXISTS idx_alerts_lookup ON alerts(exchange, symbol, ts)")
            _CONN.execute("CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(exchange, created_ts)")
            # Performance indices for filtered queries (feed page, analysis)
            _CONN.execute("CREATE INDEX IF NOT EXISTS idx_alerts_grade ON alerts(setup_grade)")
            _CONN.execute("CREATE INDEX IF NOT EXISTS idx_alerts_signal ON alerts(signal)")
            _CONN.execute("CREATE INDEX IF NOT EXISTS idx_alerts_source_tf ON alerts(source_tf)")
            # Composite index for common feed query pattern
            _CONN.execute("CREATE INDEX IF NOT EXISTS idx_alerts_feed ON alerts(created_ts, setup_grade, signal, source_tf)")

            # Trade plans linked to alerts
            _CONN.execute(
                """
                CREATE TABLE IF NOT EXISTS trade_plans (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  alert_id INTEGER NOT NULL,
                  ts INTEGER NOT NULL,
                  exchange TEXT NOT NULL,
                  symbol TEXT NOT NULL,
                  side TEXT NOT NULL,               -- 'BUY' | 'SELL'
                  entry_type TEXT NOT NULL,         -- 'market'
                  entry_price REAL NOT NULL,
                  stop_loss REAL NOT NULL,
                  tp1 REAL,
                  tp2 REAL,
                  tp3 REAL,
                  atr REAL,
                  atr_mult REAL,
                  swing_ref REAL,                   -- swing level used
                  risk_per_unit REAL,
                  rr_tp1 REAL,
                  rr_tp2 REAL,
                  rr_tp3 REAL,
                  plan_json TEXT,
                  FOREIGN KEY(alert_id) REFERENCES alerts(id)
                )
                """
            )
            _CONN.execute("CREATE INDEX IF NOT EXISTS idx_trade_plans_lookup ON trade_plans(exchange, symbol, ts)")

            # Backtest results (aggregated by symbol/exchange/tf/window)
            _CONN.execute(
                """
                CREATE TABLE IF NOT EXISTS backtest_results (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ts INTEGER NOT NULL,
                  exchange TEXT NOT NULL,
                  symbol TEXT NOT NULL,
                  source_tf TEXT,
                  window_days INTEGER NOT NULL,     -- 30 or 90
                  strategy_version TEXT NOT NULL,
                  n_trades INTEGER NOT NULL,
                  win_rate REAL,
                  avg_r REAL,
                  avg_mae_r REAL,
                  avg_mfe_r REAL,
                  avg_bars_to_resolve REAL,
                  results_json TEXT,
                  UNIQUE(exchange, symbol, source_tf, window_days, strategy_version)
                )
                """
            )
            _CONN.execute("CREATE INDEX IF NOT EXISTS idx_backtest_lookup ON backtest_results(exchange, symbol, window_days)")

            # Analysis run metadata (last recompute tracking)
            _CONN.execute(
                """
                CREATE TABLE IF NOT EXISTS analysis_runs (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ts INTEGER NOT NULL,
                  window_days INTEGER NOT NULL,
                  exchange TEXT NOT NULL,
                  top200_only INTEGER NOT NULL,
                  n_alerts INTEGER,
                  UNIQUE(window_days, exchange, top200_only)
                )
                """
            )
            _CONN.execute("CREATE INDEX IF NOT EXISTS idx_analysis_runs_ts ON analysis_runs(ts)")

            # Per-alert backtest outcomes for analysis dashboard
            _CONN.execute(
                """
                CREATE TABLE IF NOT EXISTS backtest_trades (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  alert_id INTEGER NOT NULL,
                  window_days INTEGER NOT NULL,
                  strategy_version TEXT NOT NULL,
                  created_ts INTEGER NOT NULL,
                  exchange TEXT NOT NULL,
                  symbol TEXT NOT NULL,
                  signal TEXT NOT NULL,
                  source_tf TEXT,
                  setup_grade TEXT,
                  setup_score REAL,
                  liquidity_top200 INTEGER,

                  entry REAL,
                  stop REAL,
                  tp1 REAL,
                  tp2 REAL,
                  tp3 REAL,

                  resolved TEXT NOT NULL,           -- TP1/TP2/TP3/SL/NONE
                  r_multiple REAL,
                  mae_r REAL,
                  mfe_r REAL,
                  bars_to_resolve INTEGER,
                  resolved_ts INTEGER,

                  UNIQUE(alert_id, window_days, strategy_version),
                  FOREIGN KEY(alert_id) REFERENCES alerts(id)
                )
                """
            )
            _CONN.execute("CREATE INDEX IF NOT EXISTS idx_bt_trades_lookup ON backtest_trades(exchange, window_days, created_ts)")
            _CONN.execute("CREATE INDEX IF NOT EXISTS idx_bt_trades_symbol ON backtest_trades(exchange, symbol, window_days)")

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


def get_recent_batch(
    exchange: str,
    symbols: List[str],
    interval: str,
    limit: int = 300,
) -> Dict[str, List[Tuple[int,int,float,float,float,float,float]]]:
    """Fetch OHLC data for multiple symbols in one query.
    
    Returns: Dict mapping symbol -> list of (open_time, close_time, o, h, l, c, v) tuples
    """
    if _CONN is None:
        init_db()
    
    if not symbols:
        return {}
    
    with _DB_LOCK:
        # Use subquery to limit rows per symbol
        placeholders = ','.join('?' * len(symbols))
        query = f"""
            SELECT symbol, open_time, close_time, open, high, low, close, volume
            FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY open_time DESC) as rn
                FROM ohlc
                WHERE exchange=? AND symbol IN ({placeholders}) AND interval=?
            ) 
            WHERE rn <= ?
            ORDER BY symbol, open_time ASC
        """
        cur = _CONN.execute(query, (exchange, *symbols, interval, limit))
        rows = cur.fetchall()
    
    # Group by symbol
    result: Dict[str, List[Tuple[int,int,float,float,float,float,float]]] = {}
    for row in rows:
        sym = row[0]
        data = row[1:]  # (open_time, close_time, o, h, l, c, v)
        if sym not in result:
            result[sym] = []
        result[sym].append(data)
    
    return result


def get_after(
    exchange: str,
    symbol: str,
    interval: str,
    start_open_time: int,
    limit: int = 400,
) -> List[Tuple[int,int,float,float,float,float,float]]:
    """Return rows with open_time >= start_open_time, ordered ascending."""
    if _CONN is None:
        init_db()
    with _DB_LOCK:
        cur = _CONN.execute(
            """
            SELECT open_time, close_time, open, high, low, close, volume
            FROM ohlc
            WHERE exchange=? AND symbol=? AND interval=? AND open_time >= ?
            ORDER BY open_time ASC
            LIMIT ?
            """,
            (exchange, symbol, interval, start_open_time, limit),
        )
        rows = cur.fetchall()
    return rows
