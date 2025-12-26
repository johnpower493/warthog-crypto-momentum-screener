import os
from typing import List

BACKEND_HOST = os.getenv("BACKEND_HOST", "0.0.0.0")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))

# How many top-volume symbols to track initially (Binance USDT-margined perpetuals)
TOP_SYMBOLS = int(os.getenv("TOP_SYMBOLS", "30"))

# Rolling window sizes (minutes)
WINDOW_SHORT = int(os.getenv("WINDOW_SHORT", "5"))
WINDOW_MEDIUM = int(os.getenv("WINDOW_MEDIUM", "15"))
ATR_PERIOD = int(os.getenv("ATR_PERIOD", "14"))
VOL_LOOKBACK = int(os.getenv("VOL_LOOKBACK", "30"))

# Redis configuration (optional)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
ENABLE_REDIS = os.getenv("ENABLE_REDIS", "false").lower() in {"1", "true", "yes"}

# Binance futures endpoints
BINANCE_FUTURES_REST = os.getenv("BINANCE_FUTURES_REST", "https://fapi.binance.com")
BINANCE_FUTURES_WS = os.getenv("BINANCE_FUTURES_WS", "wss://fstream.binance.com/stream")

# Websocket heartbeat/ping
WS_PING_INTERVAL = float(os.getenv("WS_PING_INTERVAL", "15"))

# Emission cadence
SNAPSHOT_INTERVAL_MS = int(os.getenv("SNAPSHOT_INTERVAL_MS", "30000"))  # throttle aggregator emits (30 seconds)
WS_HEARTBEAT_SEC = float(os.getenv("WS_HEARTBEAT_SEC", "30"))  # periodic WS snapshot sender (30 seconds)

# Cipher B thresholds (relaxed to increase frequency)
CIPHERB_OS_LEVEL = float(os.getenv("CIPHERB_OS_LEVEL", "-40"))
CIPHERB_OB_LEVEL = float(os.getenv("CIPHERB_OB_LEVEL", "40"))

# Liquidity cohorting
LIQ_TOP_N = int(os.getenv("LIQ_TOP_N", "200"))
# weights for turnover, open interest, recent activity
LIQ_WEIGHTS = (
    float(os.getenv("LIQ_W_TURNOVER", "0.6")),
    float(os.getenv("LIQ_W_OI", "0.3")),
    float(os.getenv("LIQ_W_ACTIVITY", "0.1")),
)

# Trade plan generation
TRADEPLAN_ATR_MULT = float(os.getenv("TRADEPLAN_ATR_MULT", "2.0"))
TRADEPLAN_SWING_LOOKBACK_15M = int(os.getenv("TRADEPLAN_SWING_LOOKBACK_15M", "24"))  # last 24 x 15m candles (~6h)
TRADEPLAN_TP_R_MULTS = (
    float(os.getenv("TRADEPLAN_TP1_R", "1.0")),
    float(os.getenv("TRADEPLAN_TP2_R", "2.0")),
    float(os.getenv("TRADEPLAN_TP3_R", "3.0")),
)
TRADEPLAN_ENABLE = os.getenv("TRADEPLAN_ENABLE", "true").lower() in {"1","true","yes"}

# Optional periodic "full refresh" (restart streams + backfill + refetch OI) aligned to 5m boundaries
ENABLE_FULL_REFRESH_5M = os.getenv("ENABLE_FULL_REFRESH_5M", "false").lower() in {"1", "true", "yes"}
FULL_REFRESH_BACKFILL_LIMIT = int(os.getenv("FULL_REFRESH_BACKFILL_LIMIT", "200"))
FULL_REFRESH_OFFSET_SEC = int(os.getenv("FULL_REFRESH_OFFSET_SEC", "2"))  # wait N seconds after boundary

# Staleness thresholds (used by /debug/status)
STALE_TICKER_MS = int(os.getenv("STALE_TICKER_MS", "30000"))
STALE_KLINE_MS = int(os.getenv("STALE_KLINE_MS", "90000"))
DEBUG_STATUS_INCLUDE_LISTS_DEFAULT = os.getenv("DEBUG_STATUS_INCLUDE_LISTS_DEFAULT", "false").lower() in {"1", "true", "yes"}

# Bybit endpoints (public)
BYBIT_REST = os.getenv("BYBIT_REST", "https://api.bybit.com")
BYBIT_WS_LINEAR = os.getenv("BYBIT_WS_LINEAR", "wss://stream.bybit.com/v5/public/linear")

# Symbols allow/deny lists (optional)
INCLUDE_SYMBOLS: List[str] = [s.strip().upper() for s in os.getenv("INCLUDE_SYMBOLS", "").split(",") if s.strip()]
EXCLUDE_SYMBOLS: List[str] = [s.strip().upper() for s in os.getenv("EXCLUDE_SYMBOLS", "").split(",") if s.strip()]

# Alerting configuration
ENABLE_ALERTS = os.getenv("ENABLE_ALERTS", "false").lower() in {"1", "true", "yes"}
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")
ALERT_DEDUP_MIN_MS = int(os.getenv("ALERT_DEDUP_MIN_MS", "60000"))  # 1 minute default
ALERT_COOLDOWN_PER_SYMBOL_MS = int(os.getenv("ALERT_COOLDOWN_PER_SYMBOL_MS", "300000"))  # legacy/global fallback
ALERT_COOLDOWN_TOP_MS = int(os.getenv("ALERT_COOLDOWN_TOP_MS", "120000"))  # 2 min for Top 200
ALERT_COOLDOWN_SMALL_MS = int(os.getenv("ALERT_COOLDOWN_SMALL_MS", "300000"))  # 5 min for Small Caps
ALERT_INCLUDE_EXPLANATION = os.getenv("ALERT_INCLUDE_EXPLANATION", "true").lower() in {"1","true","yes"}
