/**
 * UX FIXES - Code Snippets to Integrate
 * 
 * This file contains ready-to-use code for all critical UX fixes.
 * Copy and paste the relevant sections into your index.tsx file.
 */

// ============================================================================
// FIX #1: Real-Time Modal Updates
// ============================================================================

// ADD THIS STATE (near line 163 in Home component)
const [liveModalData, setLiveModalData] = useState<Metric | null>(null);

// ADD THIS USEEFFECT (around line 330)
useEffect(() => {
  if (!modal.open || !modal.row) {
    setLiveModalData(null);
    return;
  }

  // Find updates in the rows array
  const updateInterval = setInterval(() => {
    const updated = rows.find(
      (r) => r.symbol === modal.row?.symbol && r.exchange === modal.row?.exchange
    );
    if (updated) {
      setLiveModalData(updated);
      // Also update the modal state to keep other data in sync
      setModal((m) => ({
        ...m,
        row: updated, // Keep row updated too
      }));
    }
  }, 1000); // Check every second

  return () => clearInterval(updateInterval);
}, [modal.open, modal.row, rows]);

// UPDATE DETAILSMODAL CALL (line 1147) - Use live data
{modal.open && modal.row && (
  <DetailsModal
    row={liveModalData || modal.row}  // Use live data if available
    closes={modal.closes || []}
    oi={modal.oi || []}
    loading={!!modal.loading}
    plan={modal.plan || null}
    bt30={modal.bt30 || null}
    bt90={modal.bt90 || null}
    news={modal.news || []}
    newsLoading={!!modal.newsLoading}
    fundingRate={modal.fundingRate}
    fundingRateAnnual={modal.fundingRateAnnual}
    nextFundingTime={modal.nextFundingTime}
    fundingLoading={!!modal.fundingLoading}
    isFav={favs.includes(idOf(modal.row))}
    onToggleFav={() => toggleFav(idOf(modal.row!), favs, setFavs)}
    onClose={() => setModal({ open: false })}
    onNavigate={(dir) => {
      const i = sorted.findIndex((x) => idOf(x) === idOf(modal.row!));
      if (i < 0) return;
      const next = sorted[(i + dir + sorted.length) % sorted.length];
      openDetails(next);
    }}
    onQuickAddToPortfolio={() => {
      if (modal.row) {
        handleQuickAdd(modal.row, { stopPropagation: () => {} } as React.MouseEvent);
      }
    }}
    backendWs={resolvedWsUrl}
    backendHttp={resolvedBackendHttp} // ADD THIS
  />
)}


// ============================================================================
// FIX #2: Position Indicators in Main Table
// ============================================================================

// ADD THIS STATE (near line 136)
const [openPositions, setOpenPositions] = useState<string[]>([]);

// ADD THIS USEEFFECT (around line 330)
useEffect(() => {
  const loadPositions = async () => {
    if (!resolvedBackendHttp) return;
    
    try {
      const resp = await fetch(`${resolvedBackendHttp}/portfolio/positions`);
      if (resp.ok) {
        const data = await resp.json();
        const symbols = (data.positions || []).map(
          (p: any) => `${p.exchange}:${p.symbol}`
        );
        setOpenPositions(symbols);
      }
    } catch (e) {
      // Silent fail - not critical
      console.debug('Failed to load positions:', e);
    }
  };

  if (resolvedBackendHttp) {
    loadPositions();
    const interval = setInterval(loadPositions, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }
}, [resolvedBackendHttp]);

// UPDATE TABLE ROW (around line 1070) - Add position badge
<td style={{fontWeight:600}}>
  {r.symbol}
  {openPositions.includes(idOf(r)) && (
    <span 
      className="badge" 
      style={{
        marginLeft: 6,
        fontSize: 10,
        background: '#3b82f6',
        padding: '2px 6px',
        fontWeight: 700,
        color: '#fff',
        borderRadius: 3
      }}
      title="You have an open position"
    >
      📍 OPEN
    </span>
  )}
</td>


// ============================================================================
// FIX #3: Quick Trade Buttons in Modal
// ============================================================================

// UPDATE DETAILSMODAL PROPS (line 1359)
function DetailsModal({
  row,
  closes,
  oi,
  loading,
  plan,
  bt30,
  bt90,
  news,
  newsLoading,
  fundingRate,
  fundingRateAnnual,
  nextFundingTime,
  fundingLoading,
  isFav,
  onToggleFav,
  onClose,
  onNavigate,
  onQuickAddToPortfolio,
  backendWs,
  backendHttp, // ADD THIS
}: {
  row: Metric;
  closes: number[];
  oi: number[];
  loading: boolean;
  plan: TradePlan | null;
  bt30: any;
  bt90: any;
  news: NewsArticle[];
  newsLoading: boolean;
  fundingRate: number | null;
  fundingRateAnnual: number | null;
  nextFundingTime: number | null;
  fundingLoading: boolean;
  isFav: boolean;
  onToggleFav: () => void;
  onClose: () => void;
  onNavigate: (dir: number) => void;
  onQuickAddToPortfolio: () => void;
  backendWs: string;
  backendHttp: string; // ADD THIS
}) {
  // ADD QUICK TRADE HANDLER
  const handleQuickTrade = async (side: 'LONG' | 'SHORT', quantity: number) => {
    const stopMultiplier = side === 'LONG' ? 0.98 : 1.02; // 2% stop
    const tpMultiplier = side === 'LONG' ? 1.04 : 0.96;   // 4% target
    
    if (!confirm(`Quick ${side} ${quantity} ${row.symbol}?`)) return;
    
    try {
      const resp = await fetch(`${backendHttp}/portfolio/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: row.exchange || 'binance',
          symbol: row.symbol,
          side: side,
          entry_price: row.last_price,
          quantity: quantity,
          stop_loss: row.last_price * stopMultiplier,
          take_profit: row.last_price * tpMultiplier,
          notes: `Quick ${side} from signal (${new Date().toLocaleTimeString()})`,
        }),
      });
      
      if (resp.ok) {
        alert('✅ Position added to portfolio!');
      } else {
        const error = await resp.text();
        alert(`❌ Failed: ${error}`);
      }
    } catch (e) {
      console.error('Quick trade error:', e);
      alert('❌ Failed to add position');
    }
  };

  // ADD QUICK TRADE BUTTONS (after the modal header, before content)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {/* Header with nav buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          {/* ... existing header ... */}
        </div>

        {/* ADD QUICK TRADE BUTTONS HERE */}
        <div style={{ 
          display: 'flex', 
          gap: 8, 
          marginBottom: 16,
          flexWrap: 'wrap'
        }}>
          <button
            className="button"
            style={{
              flex: 1,
              minWidth: 100,
              background: '#10b981',
              color: '#fff',
              fontWeight: 600,
              padding: '10px 16px',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 6
            }}
            onClick={() => handleQuickTrade('LONG', 0.01)}
          >
            🟢 LONG 0.01
          </button>

          <button
            className="button"
            style={{
              flex: 1,
              minWidth: 100,
              background: '#10b981',
              color: '#fff',
              fontWeight: 600,
              padding: '10px 16px',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 6
            }}
            onClick={() => handleQuickTrade('LONG', 0.05)}
          >
            🟢 LONG 0.05
          </button>

          <button
            className="button"
            style={{
              flex: 1,
              minWidth: 100,
              background: '#ef4444',
              color: '#fff',
              fontWeight: 600,
              padding: '10px 16px',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 6
            }}
            onClick={() => handleQuickTrade('SHORT', 0.01)}
          >
            🔴 SHORT 0.01
          </button>

          <button
            className="button"
            style={{
              flex: 1,
              minWidth: 100,
              background: '#ef4444',
              color: '#fff',
              fontWeight: 600,
              padding: '10px 16px',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 6
            }}
            onClick={() => handleQuickTrade('SHORT', 0.05)}
          >
            🔴 SHORT 0.05
          </button>

          <button
            className="button"
            style={{
              flex: 1,
              minWidth: 100,
              padding: '10px 16px',
              borderRadius: 6
            }}
            onClick={onQuickAddToPortfolio}
          >
            ⚙️ Custom
          </button>
        </div>

        {/* Rest of modal content */}
      </div>
    </div>
  );
}


// ============================================================================
// FIX #4: Keyboard Shortcuts
// ============================================================================

// ADD THIS USEEFFECT in Home component (around line 330)
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Ignore if user is typing in an input/textarea
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      // Allow ESC to close modal even when in input
      if (e.key !== 'Escape') return;
    }

    // ESC - Close modal
    if (e.key === 'Escape') {
      if (modal.open) {
        setModal({ open: false });
      } else if (showQuickAdd) {
        setShowQuickAdd(false);
      } else if (showAlerts) {
        setShowAlerts(false);
      }
      return;
    }

    // / - Focus search (when nothing is open)
    if (e.key === '/' && !modal.open && !showQuickAdd) {
      e.preventDefault();
      const searchInput = document.querySelector<HTMLInputElement>(
        '.input[placeholder*="Search"]'
      );
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }

    // Arrow keys - Navigate between symbols in modal
    if (modal.open && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const direction = e.key === 'ArrowLeft' ? -1 : 1;
      const i = sorted.findIndex((x) => idOf(x) === idOf(modal.row!));
      if (i >= 0) {
        const next = sorted[(i + direction + sorted.length) % sorted.length];
        openDetails(next);
      }
      return;
    }

    // ? - Show keyboard shortcuts help
    if (e.key === '?' && !modal.open) {
      e.preventDefault();
      const helpText = 
        '⌨️ KEYBOARD SHORTCUTS\n\n' +
        'ESC          Close modal/dialog\n' +
        '/            Focus search box\n' +
        '← →          Navigate symbols (in modal)\n' +
        '?            Show this help\n\n' +
        'Coming soon:\n' +
        'Space        Quick add to watchlist\n' +
        'L            Quick LONG\n' +
        'S            Quick SHORT';
      
      alert(helpText);
      return;
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [modal, sorted, showQuickAdd, showAlerts]);


// ============================================================================
// FIX #5: Skeleton Loader Component
// ============================================================================

function SkeletonLoader({ width = '100%', height = 20 }: { width?: string | number; height?: number }) {
  return (
    <div 
      style={{ 
        width,
        height,
        background: 'linear-gradient(90deg, #1a1a2e 25%, #252542 50%, #1a1a2e 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s infinite',
        borderRadius: 4,
        marginBottom: 8
      }}
    >
      <style jsx>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

// USE IN DETAILSMODAL - Example for Trade Plan section
<div className="card" style={{ padding: 16 }}>
  <h3>Trade Plan</h3>
  {loading ? (
    <div>
      <SkeletonLoader width="80%" />
      <SkeletonLoader width="60%" />
      <SkeletonLoader width="90%" />
    </div>
  ) : plan ? (
    // ... existing trade plan content
  ) : (
    <div className="muted">No trade plan available</div>
  )}
</div>


// ============================================================================
// FIX #6: TradingView & Copy Links
// ============================================================================

// ADD TO DETAILSMODAL HEADER (after symbol title, around line 1380)
<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
  <h2 style={{ margin: 0, fontSize: 20 }}>{row.symbol}</h2>
  
  <a
    href={`https://www.tradingview.com/chart/?symbol=${(row.exchange || 'binance').toUpperCase()}:${row.symbol}`}
    target="_blank"
    rel="noopener noreferrer"
    className="button"
    style={{ 
      fontSize: 11, 
      padding: '4px 10px',
      textDecoration: 'none',
      background: '#1e88e5',
      color: '#fff'
    }}
    onClick={(e) => e.stopPropagation()}
  >
    📈 Chart
  </a>
  
  <button
    className="button"
    style={{ fontSize: 11, padding: '4px 10px' }}
    onClick={async () => {
      try {
        await navigator.clipboard.writeText(row.symbol);
        // Show temporary tooltip or use a toast library
        alert('✅ Symbol copied to clipboard!');
      } catch (e) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = row.symbol;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('✅ Symbol copied!');
      }
    }}
    title="Copy symbol to clipboard"
  >
    📋 Copy
  </button>

  <span className="badge" style={{ fontSize: 11, marginLeft: 'auto' }}>
    {row.exchange || 'binance'}
  </span>
</div>


// ============================================================================
// FIX #7: Visual Improvements
// ============================================================================

// A) IMPROVE TOOLBAR SPACING (line 686)
<div className="toolbar" style={{ gap: 12, padding: '12px 16px' }}>
  <div className="group" style={{ 
    flexWrap: 'wrap', 
    gap: 8,
    alignItems: 'center'
  }}>
    {/* badges with better spacing */}
  </div>
</div>

// B) ADD LAST UPDATE INDICATOR (replace status badge around line 690)
<span 
  className="badge" 
  title="Connection status and last update time"
  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
>
  <span>
    {status==='connected'?'🟢':status==='connecting'?'🟡':'🔴'}
  </span>
  <span>
    {source==='ws'?'WS':'HTTP'}
  </span>
  {lastUpdate > 0 && (
    <span style={{ fontSize: 11, opacity: 0.8 }}>
      ({Math.floor((Date.now() - lastUpdate) / 1000)}s ago)
    </span>
  )}
</span>

// C) REDUCE SIGNAL BADGE GLOW (line 1075-1078)
{r.cipher_buy && (
  <span 
    className="badge" 
    style={{
      marginLeft: 6,
      fontSize: 11,
      background: '#2a9d8f',
      padding: '3px 7px',
      fontWeight: 600,
      color: '#fff',
      boxShadow: '0 1px 3px rgba(42,157,143,0.3)', // Reduced glow
      borderRadius: 3
    }}
    title="Cipher B Buy Signal"
  >
    CB↑
  </span>
)}

{r.cipher_sell && (
  <span 
    className="badge" 
    style={{
      marginLeft: 6,
      fontSize: 11,
      background: '#e76f51',
      padding: '3px 7px',
      fontWeight: 600,
      color: '#fff',
      boxShadow: '0 1px 3px rgba(231,111,81,0.3)', // Reduced glow
      borderRadius: 3
    }}
    title="Cipher B Sell Signal"
  >
    CB↓
  </span>
)}

{r.percent_r_os_reversal && (
  <span 
    className="badge" 
    style={{
      marginLeft: 6,
      fontSize: 11,
      background: '#06d6a0',
      padding: '3px 7px',
      fontWeight: 600,
      color: '#000',
      boxShadow: '0 1px 3px rgba(6,214,160,0.3)', // Reduced glow
      borderRadius: 3
    }}
    title="%R Trend Exhaustion Buy"
  >
    %R↑
  </span>
)}

{r.percent_r_ob_reversal && (
  <span 
    className="badge" 
    style={{
      marginLeft: 6,
      fontSize: 11,
      background: '#ef476f',
      padding: '3px 7px',
      fontWeight: 600,
      color: '#fff',
      boxShadow: '0 1px 3px rgba(239,71,111,0.3)', // Reduced glow
      borderRadius: 3
    }}
    title="%R Trend Exhaustion Sell"
  >
    %R↓
  </span>
)}

// D) ADD TABLE ROW HOVER EFFECT
// Add this to your globals.css or in a <style jsx global> tag
.table tbody tr {
  transition: background-color 0.15s ease, transform 0.1s ease;
}

.table tbody tr:hover {
  background-color: rgba(255, 255, 255, 0.03);
  transform: translateX(2px);
}


// ============================================================================
// FIX #8: Keyboard Shortcut Hint Button
// ============================================================================

// ADD TO TOOLBAR (around line 703, after search input)
<button
  className="button"
  onClick={() => {
    const helpText = 
      '⌨️ KEYBOARD SHORTCUTS\n\n' +
      'ESC          Close modal/dialog\n' +
      '/            Focus search box\n' +
      '← →          Navigate symbols (in modal)\n' +
      '?            Show this help\n\n' +
      '💡 TIP: Click any row to see details';
    alert(helpText);
  }}
  title="Keyboard Shortcuts (press ? for help)"
  style={{ 
    fontSize: 16, 
    padding: '6px 12px',
    minWidth: 'auto'
  }}
>
  ⌨️
</button>


// ============================================================================
// FIX #9: Loading Indicator for Modal
// ============================================================================

// UPDATE openDetails function (around line 593) to show loading immediately
const openDetails = async (r: Metric) => {
  // Set modal to loading state immediately
  setModal({
    open: true,
    row: r,
    loading: true,
    closes: [],
    oi: [],
    plan: null,
    bt30: null,
    bt90: null,
    news: [],
    newsLoading: true,
    fundingLoading: true,
  });

  // Then fetch data
  try {
    const backendBase = resolvedBackendHttp || 'http://127.0.0.1:8000';
    const exchange = r.exchange || 'binance';
    
    const [histResp, oiResp, planResp, bt30Resp, bt90Resp, newsResp, fundingResp] = await Promise.all([
      fetch(`${backendBase}/history/${encodeURIComponent(exchange)}/${encodeURIComponent(r.symbol)}`),
      fetch(`${backendBase}/oi_history/${encodeURIComponent(exchange)}/${encodeURIComponent(r.symbol)}`),
      fetch(`${backendBase}/meta/trade_plan?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(r.symbol)}`),
      fetch(`${backendBase}/meta/backtest?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(r.symbol)}&window_days=30`),
      fetch(`${backendBase}/meta/backtest?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(r.symbol)}&window_days=90`),
      fetch(`${backendBase}/news/${encodeURIComponent(exchange)}/${encodeURIComponent(r.symbol)}`),
      fetch(`${backendBase}/funding_rate/${encodeURIComponent(exchange)}/${encodeURIComponent(r.symbol)}`),
    ]);
    
    const j = histResp.ok ? await histResp.json() : { closes: [] };
    const o = oiResp.ok ? await oiResp.json() : { oi: [] };
    const p = planResp.ok ? await planResp.json() : { plan: null };
    const b30 = bt30Resp.ok ? await bt30Resp.json() : null;
    const b90 = bt90Resp.ok ? await bt90Resp.json() : null;
    const n = newsResp.ok ? await newsResp.json() : { articles: [] };
    const f = fundingResp.ok ? await fundingResp.json() : { error: 'Failed' };
    
    setModal({
      open: true,
      row: r,
      closes: j.closes || [],
      oi: o.oi || [],
      plan: p.plan || null,
      bt30: b30 && b30.result ? ({ window_days: 30, ...b30 } as any) : null,
      bt90: b90 && b90.result ? ({ window_days: 90, ...b90 } as any) : null,
      news: n.articles || [],
      newsLoading: false,
      loading: false,
      fundingRate: f.error ? null : f.funding_rate,
      fundingRateAnnual: f.error ? null : f.funding_rate_annual,
      nextFundingTime: f.error ? null : f.next_funding_time,
      fundingLoading: false,
    });
  } catch (e) {
    setModal((m) => ({ 
      ...m, 
      loading: false, 
      newsLoading: false,
      fundingLoading: false 
    }));
  }
};


// ============================================================================
// FIX #10: Improve Search Placeholder
// ============================================================================

// UPDATE SEARCH INPUT (line 704)
<input 
  className="input" 
  placeholder="Search symbol (e.g. BTC) - Press / to focus" 
  value={query} 
  onChange={e=>setQuery(e.target.value)}
  style={{ minWidth: 200 }}
/>


// ============================================================================
// BONUS: Add Toast Notification System (Better than alert())
// ============================================================================

// Simple toast component (add at end of file)
function Toast({ message, type = 'success', onClose }: { 
  message: string; 
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6';

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      background: bgColor,
      color: '#fff',
      padding: '12px 20px',
      borderRadius: 8,
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      zIndex: 10001,
      animation: 'slideIn 0.3s ease',
      fontWeight: 500
    }}>
      {message}
      <style jsx>{`
        @keyframes slideIn {
          from {
            transform: translateY(100px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

// USE TOAST INSTEAD OF ALERT
// Add state
const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

// Replace alert() calls with:
setToast({ message: '✅ Position added to portfolio!', type: 'success' });

// Render toast
{toast && (
  <Toast 
    message={toast.message} 
    type={toast.type} 
    onClose={() => setToast(null)} 
  />
)}


// ============================================================================
// INTEGRATION SUMMARY
// ============================================================================

/**
 * To integrate all fixes:
 * 
 * 1. Copy state declarations to Home component
 * 2. Copy useEffects to Home component
 * 3. Update DetailsModal function signature to accept backendHttp
 * 4. Add quick trade buttons in DetailsModal
 * 5. Update table row to show position badges
 * 6. Add SkeletonLoader component at end of file
 * 7. Add Toast component and replace alert() calls
 * 8. Update CSS for hover effects
 * 
 * Total additions:
 * - ~150 lines of code
 * - 3 new components (SkeletonLoader, Toast, QuickTradeButtons)
 * - 3 new useEffects
 * - 2 new state variables
 * 
 * No new dependencies required!
 */
