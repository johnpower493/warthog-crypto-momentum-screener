# Order Flow (Footprint) End-to-End Test

## What we built
- **Backend**: `/ws/orderflow` websocket endpoint that ingests Binance/Bybit trades and aggregates them into 1m footprint candles (bid/ask volume per price level)
- **Frontend**: "Order Flow (Footprint)" section in the DetailsModal that connects to the backend WS and displays the last 8 candles

## Test Instructions

### 1. Start Backend (Terminal A)
From repo root:
```powershell
# If venv not created yet:
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt

# Start backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --app-dir backend
```

Check backend health:
```powershell
curl http://localhost:8000/health
```

### 2. Start Frontend (Terminal B)
```powershell
cd frontend
npm install  # if not done already
$env:NEXT_PUBLIC_BACKEND_HTTP="http://localhost:8000"
$env:NEXT_PUBLIC_BACKEND_WS="ws://localhost:8000"
npm run dev
```

Open: `http://localhost:3000`

### 3. Verify Order Flow Feature
1. **Click any symbol row** → the DetailsModal pops up
2. Scroll down in the modal → you should see a new section: **"Order Flow (Footprint) – 1m"**
3. Status should show:
   - "Loading..." briefly
   - Then "Connected" + a table with columns: **Time | Bid Vol | Ask Vol | Delta | Levels**
4. The table shows the **last 8 candles** (most recent at top)
5. **Delta** column is green (positive) or red (negative)
6. Every ~300ms the current candle updates live (you'll see the numbers change)

### 4. What to check
- ✅ Websocket connects (check browser DevTools → Network → WS)
- ✅ Initial snapshot arrives (`type: "snapshot"` with ~30 candles)
- ✅ Delta messages arrive every 300ms (`type: "delta"` with latest candle)
- ✅ Bid Vol (red), Ask Vol (green), Delta colored appropriately
- ✅ When you close the modal, WS disconnects cleanly
- ✅ When you click a different symbol, old WS closes and new one opens for that symbol

### 5. Backend logs to watch
Backend should log:
```
INFO:backend.app.exchanges.binance_trades_ws:Binance aggTrade WS connect BTCUSDT (attempt 1)
INFO:backend.app.exchanges.bybit_trades_ws:Bybit trades WS connect BTCUSDT (attempt 1)
```

(Depending on which exchange the clicked symbol is from)

### 6. Known behavior
- If you click a symbol with no recent trades, the table might show 0 candles or very old candles (this is expected—it only shows data from the moment you opened the modal forward).
- Price bucketing (`step=0.5`) means price levels are rounded to $0.50 increments. This is configurable via the WS query param.

### 7. Optional: test with direct WebSocket client
You can test the backend directly with `wscat` or similar:
```bash
npm install -g wscat
wscat -c "ws://localhost:8000/ws/orderflow?exchange=binance&symbol=BTCUSDT&tf=1m&step=0.5&lookback=30"
```

You should receive:
1. A `snapshot` message (JSON with `candles` array)
2. Periodic `delta` messages (JSON with `candle` object)

---

## Success Criteria
- [x] Backend `/ws/orderflow` route exists and accepts connections
- [x] Frontend modal shows "Order Flow (Footprint)" section
- [x] Table populates with live candle data
- [x] Delta updates every ~300ms
- [x] Closing modal disconnects WS cleanly

---

## Next enhancements (optional)
- Add a timeframe selector (1m, 5m, 15m)
- Add a price-step selector
- Render individual price levels in an expanded nested table or heatmap
- Add CVD (cumulative volume delta) chart
- Highlight imbalance levels (e.g., ask/bid ratio > 2:1)
