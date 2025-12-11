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
SNAPSHOT_INTERVAL_MS = int(os.getenv("SNAPSHOT_INTERVAL_MS", "5000"))  # throttle aggregator emits
WS_HEARTBEAT_SEC = float(os.getenv("WS_HEARTBEAT_SEC", "5"))  # periodic WS snapshot sender
# Bybit endpoints (public)
BYBIT_REST = os.getenv("BYBIT_REST", "https://api.bybit.com")
BYBIT_WS_LINEAR = os.getenv("BYBIT_WS_LINEAR", "wss://stream.bybit.com/v5/public/linear")

# Symbols allow/deny lists (optional)
INCLUDE_SYMBOLS: List[str] = [s.strip().upper() for s in os.getenv("INCLUDE_SYMBOLS", "").split(",") if s.strip()]
EXCLUDE_SYMBOLS: List[str] = [s.strip().upper() for s in os.getenv("EXCLUDE_SYMBOLS", "").split(",") if s.strip()]
