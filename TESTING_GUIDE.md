# UX Fixes Testing Guide

## Test Scenarios

### Test 1: Real-Time Modal Updates ✅

**Steps:**
1. Open screener page
2. Click any symbol to open details modal
3. Watch the price and metrics
4. **Expected:** Price updates every second without closing modal

**Pass Criteria:**
- ✅ Price changes in real-time
- ✅ All metrics update (not frozen)
- ✅ No modal flickering

---

### Test 2: Position Indicators ✅

**Steps:**
1. Go to Portfolio page
2. Add a new position (e.g., BTCUSDT)
3. Return to Screener page
4. Find BTCUSDT in the table

**Expected:** "OPEN" badge appears next to symbol

**Pass Criteria:**
- ✅ Badge shows for open positions
- ✅ Badge disappears when position closed
- ✅ Updates within 10 seconds

---

### Test 3: Quick Trade Buttons ✅

**Steps:**
1. Open any symbol's details modal
2. Click "🟢 LONG 0.01" button
3. Confirm the prompt
4. Check Portfolio page

**Expected:** Position added with auto-calculated stop/TP

**Pass Criteria:**
- ✅ Position appears in portfolio
- ✅ Stop loss = entry * 0.98 (for LONG)
- ✅ Take profit = entry * 1.04 (for LONG)
- ✅ Toast notification shows success

---

### Test 4: Keyboard Shortcuts ✅

**Test 4a: ESC to close modal**
1. Open details modal
2. Press ESC key
3. **Expected:** Modal closes

**Test 4b: / to focus search**
1. Press / key
2. **Expected:** Search input gains focus

**Test 4c: Arrows to navigate**
1. Open details modal
2. Press → key
3. **Expected:** Next symbol loads
4. Press ← key
5. **Expected:** Previous symbol loads

**Test 4d: ? for help**
1. Press ? key
2. **Expected:** Keyboard shortcuts help dialog appears

---

### Test 5: Mobile Layout ✅

**Steps:**
1. Open screener in mobile browser or resize to < 768px
2. Observe layout

**Expected:** Card layout replaces table

**Pass Criteria:**
- ✅ Cards stack vertically
- ✅ All key metrics visible
- ✅ Action buttons work (LONG/SHORT/Details)
- ✅ Touch-friendly tap targets

---

### Test 6: Loading States ✅

**Steps:**
1. Clear browser cache
2. Open details modal for any symbol
3. Observe loading behavior

**Expected:** Skeleton loaders appear briefly

**Pass Criteria:**
- ✅ Skeleton loaders show immediately
- ✅ Smooth transition to actual content
- ✅ No blank white screen

---

### Test 7: Visual Improvements ✅

**Test 7a: Table hover**
1. Hover over table rows
2. **Expected:** Subtle highlight effect

**Test 7b: Badge visibility**
1. Find symbols with signals
2. **Expected:** Badges readable without excessive glow

**Test 7c: Toolbar spacing**
1. Check toolbar on mobile
2. **Expected:** No overlapping elements

---

### Test 8: TradingView Integration ✅

**Steps:**
1. Open details modal
2. Click "📈 Chart" button
3. **Expected:** TradingView opens in new tab with correct symbol

---

### Test 9: Copy Symbol ✅

**Steps:**
1. Open details modal
2. Click "📋 Copy" button
3. Paste into text editor
4. **Expected:** Symbol copied to clipboard

---

## Browser Compatibility Tests

Test on:
- [ ] Chrome (desktop & mobile)
- [ ] Firefox
- [ ] Safari (desktop & iOS)
- [ ] Edge

---

## Performance Tests

### Load Time Test
1. Open DevTools > Network tab
2. Refresh screener page
3. Measure time to first interactive

**Target:** < 1 second on warm cache

### Modal Open Time
1. Open DevTools > Performance
2. Click symbol to open modal
3. Measure time to display

**Target:** < 100ms for cached data

---

## Common Issues & Solutions

**Issue:** Modal doesn't update in real-time  
**Solution:** Check that liveModalData useEffect is properly integrated

**Issue:** Position badges don't appear  
**Solution:** Verify backend /portfolio/positions endpoint returns data

**Issue:** Keyboard shortcuts don't work  
**Solution:** Ensure useEffect is in Home component, check for event listener conflicts

**Issue:** Mobile layout not showing  
**Solution:** Check isMobile state and conditional rendering logic

---

## Regression Tests

After implementing fixes, verify these still work:

- [ ] Favorites (star/unstar)
- [ ] Preset filters
- [ ] Search functionality
- [ ] Sorting by columns
- [ ] Alert log
- [ ] Portfolio tracking
- [ ] Backtesting results in modal

---

**All tests passing?** You're ready to deploy! 🚀
