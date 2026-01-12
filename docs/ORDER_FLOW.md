# Order Flow (Footprint) Feature

## Overview

The Order Flow feature provides real-time trade-based footprint analysis for Binance and Bybit perpetual futures. It aggregates tick-by-tick trades into candle-level and price-level buckets, displaying bid/ask volume, delta, and CVD (Cumulative Volume Delta) to help identify buyer/seller dominance and potential reversal points.

---

## What is Order Flow Analysis?

Order flow trading focuses on **actual executed trades** (market orders) rather than just price and volume bars. Key concepts:

- **Bid Volume (Sell Volume)**: Volume from market sell orders (aggressive sellers hitting bids)
- **Ask Volume (Buy Volume)**: Volume from market buy orders (aggressive buyers lifting asks)
- **Delta**: `Ask Volume - Bid Volume` (positive = buyers dominant, negative = sellers dominant)
- **CVD (Cumulative Volume Delta)**: Running sum of delta over time; shows sustained buying/selling pressure
- **Imbalance**: Extreme bid/ask ratio (e.g., 3:1 or higher) indicating absorption or exhaustion

---

## Features

### 1. Real-Time Footprint Table
- **Per-Candle View**: Last 8 candles (1-minute timeframe)
- **Columns**:
  - **Time**: Candle open time
  - **Bid Vol**: Total volume from aggressive sellers (red)
  - **Ask Vol**: Total volume from aggressive buyers (green)
  - **Delta**: `Ask Vol - Bid Vol` (green if positive, red if negative)
  - **CVD**: Cumulative Volume Delta (running sum of delta)
  - **Levels**: Number of price levels with activity in this candle

### 2. CVD Chart
- **Line chart** showing CVD over the last 30 candles
- **Color-coded**: Green when CVD ≥ 0 (buyers winning), red when CVD < 0 (sellers winning)
- **Current value** displayed in top-right corner
- **Auto-scaled** to fit the visible range

### 3. Imbalance Highlighting
- **Automatic detection**: Rows where bid/ask ratio exceeds 3:1
- **Visual indicators**:
  - 🔥 Fire emoji next to time
  - Subtle background tint (green for ask-dominated, red for bid-dominated)
- **Interpretation**:
  - High ask volume with low bid volume = strong buying pressure (potential support)
  - High bid volume with low ask volume = strong selling pressure (potential resistance)
  - Absorption: Big volume at a level without price movement (often precedes reversal)

---

## How to Use

### Opening the Order Flow Panel

1. **Navigate** to the screener (`http://localhost:3000`)
2. **Click any symbol** in the table → DetailsModal opens
3. **Scroll down** to the "Order Flow (Footprint) – 1m" section
4. **Wait 2-3 seconds** for the websocket to connect and data to populate

### Reading the Footprint

#### Example 1: Strong Bullish Momentum
```
Time      Bid Vol  Ask Vol  Delta   CVD
5:10:00   12.5     45.3     +32.8   +32.8  🔥
5:11:00   8.2      38.1     +29.9   +62.7
5:12:00   15.0     22.4     +7.4    +70.1
```
- **High ask volume**, **positive delta**, **rising CVD** → Buyers in control
- **Fire emoji** on 5:10:00 indicates 3:1+ imbalance (strong buy pressure)

#### Example 2: Bearish Divergence (Reversal Warning)
```
Price: Rising (+$50 in last 10 candles)
CVD:   Falling (-15 → -45 → -62)
```
- **Price up but CVD down** → Weak rally, sellers absorbing, potential reversal

#### Example 3: Absorption at Support
```
Time      Bid Vol  Ask Vol  Delta   CVD
5:15:00   85.2     18.3     -66.9   -120.5  🔥
5:16:00   12.1     55.8     +43.7   -76.8
5:17:00   5.2      72.4     +67.2   -9.6
```
- **Huge bid volume (85.2) at 5:15:00** with fire emoji → Big seller dumping
- **Price didn't crash** → Buyers absorbed the sell
- **Next candles: high ask volume, CVD recovering** → Support confirmed, reversal incoming

---

## Architecture

### Backend (Python/FastAPI)

#### Exchange Trade Streams
- **`backend/app/exchanges/binance_trades_ws.py`**: Binance Futures `aggTrade` stream
- **`backend/app/exchanges/bybit_trades_ws.py`**: Bybit public trade stream
- Both normalize trades into: `{exchange, symbol, ts, price, qty, side}`

#### Aggregation Engine
- **`backend/app/services/orderflow.py`**: `OrderFlowEngine` class
  - Maintains in-memory rolling window (default: last 500 candles per symbol/timeframe)
  - Buckets trades by:
    - **Candle**: `ts - (ts % tf_ms)` (e.g., 1m candles)
    - **Price level**: `round(price / step) * step` (e.g., $0.50 steps)
  - Tracks per-level `bid`, `ask`, `trade_count`
  - Computes per-candle `total_bid`, `total_ask`, `delta`, `cvd`

#### Hub Manager
- **`backend/app/services/orderflow_hub.py`**: `OrderFlowHub` class
  - **On-demand ingestion**: Starts trade stream only when a client subscribes
  - **Reference counting**: Multiple clients can share the same stream
  - **Auto-cleanup**: Stops stream when last client disconnects

#### WebSocket Endpoint
- **Route**: `GET /ws/orderflow?exchange={exchange}&symbol={symbol}&tf={tf}&step={step}&lookback={lookback}&emit_ms={emit_ms}`
- **Parameters**:
  - `exchange`: `binance` | `bybit` (default: `binance`)
  - `symbol`: e.g., `BTCUSDT` (default: `BTCUSDT`)
  - `tf`: `1m`, `5m`, `15m`, `1h` (default: `1m`)
  - `step`: Price bucketing size in dollars (default: `0.5`)
  - `lookback`: Candles in initial snapshot (default: `30`)
  - `emit_ms`: Delta emission interval in milliseconds (default: `300`)

- **Message Types**:
  - **`snapshot`**: Initial payload with last N candles
    ```json
    {
      "type": "snapshot",
      "exchange": "binance",
      "symbol": "BTCUSDT",
      "tf_ms": 60000,
      "step": 0.5,
      "server_ts": 1735689123456,
      "candles": [
        {
          "open_ts": 1735689060000,
          "bid": 12.5,
          "ask": 45.3,
          "delta": 32.8,
          "cvd": 32.8,
          "levels": [
            {"p": 42500.5, "bid": 2.1, "ask": 8.3, "n": 15},
            {"p": 42500.0, "bid": 10.4, "ask": 37.0, "n": 82}
          ]
        }
      ]
    }
    ```

  - **`delta`**: Incremental update for the current candle (sent every `emit_ms`)
    ```json
    {
      "type": "delta",
      "exchange": "binance",
      "symbol": "BTCUSDT",
      "tf_ms": 60000,
      "step": 0.5,
      "server_ts": 1735689123756,
      "candle": {
        "open_ts": 1735689120000,
        "bid": 8.2,
        "ask": 38.1,
        "delta": 29.9,
        "cvd": 62.7,
        "levels": [...]
      }
    }
    ```

### Frontend (Next.js/React/TypeScript)

#### Component: `DetailsModal` (in `frontend/pages/index.tsx`)

**State Management**:
```tsx
const [footprintCandles, setFootprintCandles] = useState<any[]>([]);
const [footprintStatus, setFootprintStatus] = useState<'idle'|'loading'|'connected'>('idle');
```

**WebSocket Connection**:
- Opens on modal mount (when `row` is set)
- Subscribes to `/ws/orderflow` for the selected symbol/exchange
- Handles `snapshot` and `delta` messages
- Closes on modal close or symbol change

**CVD Chart**:
- **SVG-based line chart** (no external charting library)
- Plots last 30 candles
- Auto-scales Y-axis to fit CVD range
- Green/red color based on CVD sign

**Footprint Table**:
- Shows last 8 candles (most recent at top)
- **Imbalance detection**: `max(ask/bid, bid/ask) > 3`
- **Visual indicators**:
  - Background tint (rgba green or red)
  - 🔥 emoji for imbalanced candles

---

## Configuration

### Backend Environment Variables
None required for basic operation. Optional:
- `WS_PING_INTERVAL`: WebSocket ping interval (default: 20s)
- `BINANCE_FUTURES_WS`: Binance WS URL (default: `wss://fstream.binance.com/stream`)
- `BYBIT_WS_LINEAR`: Bybit WS URL (default: `wss://stream.bybit.com/v5/public/linear`)

### Frontend Environment Variables
- `NEXT_PUBLIC_BACKEND_WS`: WebSocket base URL (e.g., `ws://localhost:8000`)

### Customization (UI-Level)
You can adjust these in `frontend/pages/index.tsx`:

- **Candles displayed in table**: Change `.slice(-8)` to `.slice(-N)`
- **CVD chart lookback**: Change `.slice(-30)` to `.slice(-N)`
- **Imbalance threshold**: Change `ratio > 3` to `ratio > X`
- **Timeframe**: Currently hardcoded to `1m`; can be made dynamic with a dropdown

### Customization (Backend-Level)
In `backend/app/services/orderflow_hub.py`:

- **Max candles in memory**: `max_candles=500` (line in `_run_ingest`)
- **Price step**: Pass as query param `?step=X` or set default in `backend/app/main.py`

---

## Performance & Scalability

### Resource Usage (Per Symbol)
- **Memory**: ~2-5 MB (500 candles × ~50 price levels)
- **CPU**: Minimal (<1% per symbol on modern hardware)
- **Network**: ~10-50 trades/sec per symbol (depends on volatility)

### Limits
- **Backend**: Can handle ~50-100 concurrent symbols before hitting memory limits (~500 MB)
- **Exchange**: Binance allows ~300 WebSocket streams per IP; Bybit similar
- **On-Demand Design**: Only active for symbols opened in the modal → typically 1-5 concurrent

### Scaling Tips
- For many users: Deploy multiple backend instances behind a load balancer
- For many symbols: Use Redis to share aggregated data across instances
- For historical playback: Persist footprint data to SQLite/Postgres (not currently implemented)

---

## Troubleshooting

### Issue: "Disconnected" Status
**Cause**: WebSocket connection failed.

**Checks**:
1. Backend running? `curl http://localhost:8000/health`
2. Correct WS URL in frontend? Check `NEXT_PUBLIC_BACKEND_WS` env var
3. Firewall blocking? Ensure port 8000 is open
4. Check browser DevTools → Network → WS for error messages

### Issue: No Data / Empty Table
**Cause**: No trades ingested yet (symbol inactive, or you just opened modal).

**Checks**:
1. Wait 10-30 seconds (some symbols trade infrequently)
2. Try a high-volume symbol (e.g., BTCUSDT, ETHUSDT)
3. Check backend logs for trade stream errors:
   ```
   INFO:backend.app.exchanges.binance_trades_ws:Binance aggTrade WS connect BTCUSDT
   ```

### Issue: CVD Chart Not Rendering
**Cause**: CVD values are all the same (flatline).

**Fix**: Wait for more data; the chart auto-scales when CVD changes.

### Issue: Backend Hangs / High CPU
**Cause**: Zombie websocket connections from repeated restarts.

**Fix**:
```powershell
# Kill all python processes
Get-Process -Name python | Stop-Process -Force

# Restart backend
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## Future Enhancements

### High Priority
- [ ] **Timeframe Selector**: Add dropdown to switch between 1m, 5m, 15m, 1h
- [ ] **Price-Level Drill-Down**: Click a candle to expand and see individual price levels
- [ ] **Volume Profile / POC**: Highlight the price level with the most volume (Point of Control)

### Medium Priority
- [ ] **Configurable Price Step**: Add slider/input to adjust bucketing (e.g., $0.10 to $10)
- [ ] **Delta Bars**: Visual bars next to each candle showing delta magnitude
- [ ] **Session Volume Profile**: Aggregate volume by price over entire session (24h)
- [ ] **Export to CSV**: Download footprint data for offline analysis

### Advanced
- [ ] **DOM / Order Book (L2)**: Show live bid/ask depth ladder
- [ ] **Heatmap**: 2D grid (time × price) colored by volume intensity
- [ ] **Smart Alerts**: Notify on CVD divergence, imbalance spikes, or volume at key levels
- [ ] **Comparison Mode**: Open multiple modals side-by-side to compare symbols

---

## Trading Strategies Using Order Flow

### 1. CVD Divergence (Reversal)
**Setup**: Price makes new high, but CVD makes lower high (or vice versa).

**Interpretation**: Weak momentum; likely reversal.

**Action**: Counter-trend trade (sell at highs if bearish divergence).

### 2. Absorption at Key Levels
**Setup**: Huge volume at support/resistance, price doesn't break.

**Interpretation**: Big player absorbed the pressure; level defended.

**Action**: Trade in direction of the defender (buy after absorption at support).

### 3. Exhaustion (Climax Volume)
**Setup**: Extreme imbalance (fire emoji), price spikes, then CVD flattens.

**Interpretation**: Buyers/sellers exhausted; no follow-through.

**Action**: Fade the move (take profit or counter-trend).

### 4. Breakout Confirmation
**Setup**: Price breaks resistance + CVD also breaks to new highs.

**Interpretation**: Real breakout with volume support.

**Action**: Trade in direction of breakout.

### 5. Imbalance Stacking
**Setup**: Multiple consecutive candles with fire emoji in same direction.

**Interpretation**: Strong trend; institutional flow.

**Action**: Trend-follow until imbalance stops.

---

## Credits & References

### Implementation
- **Backend**: FastAPI, asyncio, websockets
- **Frontend**: Next.js, React, TypeScript
- **Exchanges**: Binance Futures, Bybit Linear

### Concepts
- **Order Flow Trading**: Popularized by traders like Peter Brandt, Axia Futures, OrderFlowTrading.com
- **Footprint Charts**: Originated from Jigsaw Trading, Sierra Chart
- **CVD**: Standard indicator in platforms like TradingView, NinjaTrader

### Similar Tools
- **Exocharts**: Advanced order flow platform (paid)
- **FootprintChart.com**: Free web-based footprint
- **Sierra Chart**: Professional-grade (desktop, C++)
- **Bookmap**: Heatmap + DOM visualization (paid)

---

## License & Disclaimer

This feature is part of the Squeeze Screener project.

**Disclaimer**: Order flow analysis is a tool, not a crystal ball. It shows what traders *are doing* (not what they *will do*). Always combine with other analysis (price action, support/resistance, context). Not financial advice.

---

## Support

For issues or questions:
1. Check this documentation
2. Inspect browser DevTools console and backend logs
3. Refer to the troubleshooting section above
4. Open an issue in the project repository

---

*Last updated: 2025-12-31*
