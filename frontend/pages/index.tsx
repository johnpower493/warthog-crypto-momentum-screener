import { useEffect, useMemo, useRef, useState } from 'react';
import MobileSymbolCard from '../components/MobileSymbolCard';

type Metric = {
  symbol: string;
  exchange: string;
  last_price: number;
  // Explainable Cipher B fields (from backend)
  cipher_source_tf?: string | null;
  cipher_reason?: string | null;
  change_1m?: number | null;
  change_5m?: number | null;
  change_15m?: number | null;
  change_60m?: number | null;
  change_1d?: number | null;
  market_cap?: number | null;
  atr?: number | null;
  vol_zscore_1m?: number | null;
  vol_1m?: number | null;
  vol_5m?: number | null;
  vol_15m?: number | null;
  rvol_1m?: number | null;
  breakout_15m?: number | null;
  breakdown_15m?: number | null;
  vwap_15m?: number | null;
  // Open Interest
  open_interest?: number | null;
  oi_change_5m?: number | null;
  oi_change_15m?: number | null;
  oi_change_1h?: number | null;
  oi_change_1d?: number | null;
  // Momentum
  momentum_5m?: number | null;
  momentum_15m?: number | null;
  momentum_score?: number | null;
  // Cipher B (WaveTrend)
  wt1?: number | null;
  wt2?: number | null;
  cipher_buy?: boolean | null;
  cipher_sell?: boolean | null;
  percent_r_fast?: number | null;
  percent_r_slow?: number | null;
  percent_r_ob_trend_start?: boolean | null;
  percent_r_os_trend_start?: boolean | null;
  percent_r_ob_reversal?: boolean | null;
  percent_r_os_reversal?: boolean | null;
  percent_r_cross_bull?: boolean | null;
  percent_r_cross_bear?: boolean | null;
  percent_r_source_tf?: string | null;
  percent_r_reason?: string | null;

  // Scalping impulse
  impulse_score?: number | null;
  impulse_dir?: number | null;
  // Combined signal
  signal_score?: number | null;
  signal_strength?: string | null;
  
  // Technical Indicators
  rsi_14?: number | null;
  macd?: number | null;
  macd_signal?: number | null;
  macd_histogram?: number | null;
  stoch_k?: number | null;
  stoch_d?: number | null;
  
  // Money Flow Index (Cipher B style) - Multiple Timeframes
  mfi_1h?: number | null;
  mfi_15m?: number | null;
  mfi_4h?: number | null;
  
  // Multi-Timeframe Confluence
  mtf_bull_count?: number | null;
  mtf_bear_count?: number | null;
  mtf_summary?: string | null;
  
  // Volatility Analysis
  volatility_percentile?: number | null;

  // Volatility Due / Squeeze (multi-timeframe)
  vol_due_15m?: boolean | null;
  vol_due_4h?: boolean | null;
  vol_due_source_tf?: string | null;
  vol_due_reason?: string | null;
  vol_due_age_ms?: number | null;

  // Squeeze (state): true while in compression
  vol_squeeze_15m?: boolean | null;
  vol_squeeze_4h?: boolean | null;

  bb_width_4h?: number | null;
  bb_position_4h?: number | null;
  
  // Time Since Signal
  cipher_signal_age_ms?: number | null;
  percent_r_signal_age_ms?: number | null;
  
  // Sector Tags
  sector_tags?: string[] | null;
  
  // Funding Rate
  funding_rate?: number | null;
  funding_rate_annual?: number | null;
  next_funding_time?: number | null;
  
  ts: number;
};

type Snapshot = {
  exchange: string;
  ts: number;
  metrics: Metric[];
};

type TradePlan = {
  id: number;
  ts: number;
  side: string;
  entry_type: string;
  entry_price: number;
  stop_loss: number;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  atr?: number | null;
  atr_mult?: number | null;
  swing_ref?: number | null;
  risk_per_unit?: number | null;
  rr_tp1?: number | null;
  rr_tp2?: number | null;
  rr_tp3?: number | null;
};

type Backtest = {
  window_days: number;
  n_trades: number;
  win_rate: number;
  avg_r: number;
  avg_mae_r: number;
  avg_mfe_r: number;
  avg_bars_to_resolve: number;
};

// Backtest object returned by backend endpoints (e.g. /symbol/details)
type BacktestResponse = Backtest & {
  ts?: number;
  // Optional larger payload; may be null/empty while summary stats still exist
  result?: any;
};

type NewsArticle = {
  id: string;
  title: string;
  body: string;
  url: string;
  source: string;
  published: number;
  image_url?: string;
  tags?: string[];
};

type SortKey =
  | 'change_1m'
  | 'change_5m'
  | 'change_15m'
  | 'change_60m'
  | 'change_1d'
  | 'market_cap'
  | 'atr'
  | 'vol_zscore_1m'
  | 'last_price'
  | 'symbol'
  | 'momentum_score'
  | 'oi_change_5m'
  | 'oi_change_15m'
  | 'oi_change_1h'
  | 'oi_change_1d'
  | 'open_interest'
  | 'signal_score'
  | 'impulse_score'
  | 'breakout_15m'
  | 'vwap_15m';

export default function Home() {
  const [rows, setRows] = useState<Metric[]>([]);
  const [showAlerts, setShowAlerts] = useState<boolean>(false);
  const [alertLog, setAlertLog] = useState<{ts:number; text:string}[]>([]);
  const [pendingSnapshot, setPendingSnapshot] = useState<Snapshot | null>(null);
  
  // UX Fixes: Real-time modal updates and position tracking
  const [liveModalData, setLiveModalData] = useState<Metric | null>(null);
  const [openPositions, setOpenPositions] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Avoid SSR/CSR hydration mismatches by resolving host-based URLs client-side
  const [resolvedBackendHttp, setResolvedBackendHttp] = useState<string>(process.env.NEXT_PUBLIC_BACKEND_HTTP || '');
  const [resolvedWsUrl, setResolvedWsUrl] = useState<string>(process.env.NEXT_PUBLIC_BACKEND_WS || '');
  const [isClient, setIsClient] = useState(false);
  
  // Mobile detection for card view
  const [isMobile, setIsMobile] = useState(false);
  // Manual override for card/table view: null = auto (use isMobile), 'card' = force cards, 'table' = force table
  const [viewMode, setViewMode] = useState<'auto' | 'card' | 'table'>('auto');
  const binState = useRef<Map<string, Metric>>(new Map());
  const httpState = useRef<Map<string, Metric>>(new Map());
  const [modal, setModal] = useState<{
    open: boolean;
    row?: Metric;
    closes?: number[];
    oi?: number[];
    loading?: boolean;
    plan?: TradePlan | null;
    bt30?: BacktestResponse | null;
    bt90?: BacktestResponse | null;
    news?: NewsArticle[];
    newsLoading?: boolean;
    fundingRate?: number | null;
    fundingRateAnnual?: number | null;
    nextFundingTime?: number | null;
    fundingLoading?: boolean;
    // Long/Short Ratio
    longShortRatio?: {
      long_ratio: number;
      short_ratio: number;
      long_short_ratio: number;
      long_account: number;
      short_account: number;
      timestamp: number;
    } | null;
    // Liquidations
    liquidations?: {
      symbol: string;
      side: string;
      price: number;
      qty: number;
      value_usd: number;
      timestamp: number;
    }[];
    liquidationSummary?: {
      recent_count: number;
      long_liq_count: number;
      short_liq_count: number;
      total_value_usd: number;
      long_liq_value: number;
      short_liq_value: number;
    } | null;
    // Liquidation Levels Heatmap
    liquidationLevels?: {
      price: number;
      long_value: number;
      short_value: number;
      total_value: number;
      long_count: number;
      short_count: number;
      total_count: number;
      intensity: number;
      bucket_size: number;
    }[];
  }>({ open: false });
  const [query, setQuery] = useState('');

  // Quick filters / presets
  const [preset, setPreset] = useState<
    | 'none'
    | 'gainers5m'
    | 'losers5m'
    | 'volatile5m'
    | 'highOiDelta5m'
    | 'breakout15m'
    | 'highSignal'
    | 'impulse'
    | 'cipherBuy'
    | 'cipherSell'
    | 'rBuy'
    | 'rSell'
  >('none');
  // (Removed) manual numeric threshold inputs. If you'd like these back later,
  // we can reintroduce them with validation.

  const [sortKey, setSortKey] = useState<SortKey>('signal_score');
  const [sortDir, setSortDir] = useState<'desc'|'asc'>('desc');
  
  const handleHeaderClick = (key: SortKey) => {
    if (sortKey === key) {
      // Toggle direction if clicking same column
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      // New column - default to desc
      setSortKey(key);
      setSortDir('desc');
    }
  };
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [volDueOnly, setVolDueOnly] = useState(false);
  const [squeezeOnly, setSqueezeOnly] = useState(false);
  const [favs, setFavs] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<'disconnected'|'connecting'|'connected'>('connecting');
  const [source, setSource] = useState<'ws'|'http'>('ws');
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const pollTimer = useRef<number | null>(null);

  const [staleCount, setStaleCount] = useState<{binanceTicker:number; binanceKline:number; bybitTicker:number; bybitKline:number}>({
    binanceTicker: 0,
    binanceKline: 0,
    bybitTicker: 0,
    bybitKline: 0,
  });

  const [sentiment, setSentiment] = useState<{buy:number; sell:number; total:number; score:number; bias:string} | null>(null);
  const [sentimentBinance, setSentimentBinance] = useState<{buy:number; sell:number; total:number; score:number; bias:string} | null>(null);
  const [sentimentBybit, setSentimentBybit] = useState<{buy:number; sell:number; total:number; score:number; bias:string} | null>(null);

  // Column picker (persisted)
  const columnMeta: { key: string; label: string; group: string; mobileDefault: boolean }[] = [
    { key: 'exchange', label: 'Exchange', group: 'Core', mobileDefault: false },
    { key: 'signal', label: 'Signal', group: 'Core', mobileDefault: true },
    { key: 'impulse', label: 'Impulse', group: 'Core', mobileDefault: false },
    { key: 'marketcap', label: 'Market Cap', group: 'Core', mobileDefault: false },
    { key: 'action', label: 'Action', group: 'Core', mobileDefault: false },

    { key: 'chg1m', label: '1m %', group: 'Returns', mobileDefault: false },
    { key: 'chg5m', label: '5m %', group: 'Returns', mobileDefault: true },
    { key: 'chg15m', label: '15m %', group: 'Returns', mobileDefault: true },
    { key: 'chg60m', label: '60m %', group: 'Returns', mobileDefault: false },
    { key: 'chg1d', label: '1d %', group: 'Returns', mobileDefault: false },

    { key: 'momentum', label: 'Momentum', group: 'Momentum', mobileDefault: false },
    { key: 'mom5m', label: 'Mom 5m', group: 'Momentum', mobileDefault: false },
    { key: 'mom15m', label: 'Mom 15m', group: 'Momentum', mobileDefault: false },

    { key: 'oi', label: 'Open Interest', group: 'Open Interest', mobileDefault: false },
    { key: 'oi5m', label: 'OI Δ 5m', group: 'Open Interest', mobileDefault: false },
    { key: 'oi15m', label: 'OI Δ 15m', group: 'Open Interest', mobileDefault: false },
    { key: 'oi1h', label: 'OI Δ 1h', group: 'Open Interest', mobileDefault: false },
    { key: 'oi1d', label: 'OI Δ 1d', group: 'Open Interest', mobileDefault: false },

    { key: 'atr', label: 'ATR', group: 'Volatility', mobileDefault: false },
    { key: 'volz', label: 'Vol Z', group: 'Volatility', mobileDefault: false },
    { key: 'vol1m', label: 'Vol 1m', group: 'Volatility', mobileDefault: false },
    { key: 'rvol1m', label: 'RVOL 1m', group: 'Volatility', mobileDefault: false },

    { key: 'breakout15m', label: 'Breakout 15m', group: 'Levels', mobileDefault: false },
    { key: 'vwap15m', label: 'VWAP 15m', group: 'Levels', mobileDefault: false },
  ];

  const mobileDefaultCols: Record<string, boolean> = Object.fromEntries(
    columnMeta.map((c) => [c.key, c.mobileDefault])
  );

  // Desktop defaults: a bit richer than mobile
  const desktopDefaultCols: Record<string, boolean> = {
    ...mobileDefaultCols,
    exchange: true,
    impulse: true,
    chg1m: true,
    chg60m: true,
    chg1d: false,
    oi: true,
    oi5m: true,
    oi1d: false,
    atr: true,
    volz: true,
    rvol1m: true,
    vwap15m: true,
  };
  const [showColumns, setShowColumns] = useState(false);
  const [mobileMode, setMobileMode] = useState<boolean>(true);
  const [colsInitialized, setColsInitialized] = useState(false);

  const [cols, setCols] = useState<Record<string, boolean>>({});

  // Quick add to portfolio
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddSymbol, setQuickAddSymbol] = useState<Metric | null>(null);
  // UI state
  const [topMoversCollapsed, setTopMoversCollapsed] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({
    side: 'LONG' as 'LONG' | 'SHORT',
    quantity: '',
    stop_loss: '',
    take_profit: '',
    notes: '',
  });

  useEffect(() => {
    if (!colsInitialized) return; // Don't save until after initial load
    try { localStorage.setItem('cols', JSON.stringify(cols)); } catch {}
  }, [cols, colsInitialized]);

  useEffect(() => {
    try { localStorage.setItem('mobileMode', JSON.stringify(mobileMode)); } catch {}
  }, [mobileMode]);

  const col = (k: string) => !!cols[k];
  
  // Determine whether to show card view: manual override or auto-detect mobile
  const showCardView = viewMode === 'card' || (viewMode === 'auto' && isMobile);

  useEffect(() => {
    // Resolve URLs + hydrate persisted state from localStorage (client-only)
    setIsClient(true);
    
    // Mobile detection
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    try {
      const backendHttp = process.env.NEXT_PUBLIC_BACKEND_HTTP || `${window.location.protocol}//${window.location.hostname}:8000`;
      setResolvedBackendHttp(backendHttp);
    } catch {}

    try {
      const override = new URL(window.location.href).searchParams.get('ws') || undefined;
      const envUrl = process.env.NEXT_PUBLIC_BACKEND_WS;
      const defaultWs = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:8000/ws/screener`;
      setResolvedWsUrl(override || envUrl || defaultWs);
    } catch {}

    try {
      const storedFavs = JSON.parse(localStorage.getItem('favs') || '[]') as string[];
      setFavs(Array.isArray(storedFavs) ? storedFavs : []);
    } catch {}

    // mobileMode from storage first, then columns defaulting can use it
    let mm = mobileMode;
    try {
      const rawMm = localStorage.getItem('mobileMode');
      if (rawMm) {
        mm = !!JSON.parse(rawMm);
        setMobileMode(mm);
      }
    } catch {}

    try {
      const rawCols = localStorage.getItem('cols');
      if (rawCols) {
        setCols(JSON.parse(rawCols));
      } else {
        const isSmall = window.matchMedia && window.matchMedia('(max-width: 520px)').matches;
        setCols(isSmall && mm ? mobileDefaultCols : desktopDefaultCols);
      }
      setColsInitialized(true);
    } catch {
      setColsInitialized(true);
    }
    
    return () => window.removeEventListener('resize', checkMobile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // persist favorites
    try { localStorage.setItem('favs', JSON.stringify(favs)); } catch {}
  }, [favs]);

  // Throttle UI updates to prevent render lag
  useEffect(() => {
    const throttleTimer = setInterval(() => {
      if (pendingSnapshot) {
        setRows(pendingSnapshot.metrics);
        setLastUpdate(Date.now());
        setPendingSnapshot(null);
      }
    }, 500); // Update UI max 2 times per second
    
    return () => clearInterval(throttleTimer);
  }, [pendingSnapshot]);

  // WebSocket reconnection banner state
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  // UX Fix: Real-time modal updates
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
          row: updated,
        }));
      }
    }, 1000); // Check every second

    return () => clearInterval(updateInterval);
  }, [modal.open, modal.row, rows]);

  // UX Fix: Load open positions for indicator badges
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

  // UX Fix: Keyboard shortcuts (moved after sorted is defined below)

  useEffect(() => {
    const url = resolvedWsUrl || 'ws://localhost:8000/ws/screener';
    const backendHttp = resolvedBackendHttp || 'http://127.0.0.1:8000';
    let cancelled = false;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let failCount = 0;

    function sleep(ms: number) {
      return new Promise((r) => setTimeout(r, ms));
    }

    function startHttpPolling() {
      try {
        if (pollTimer.current) window.clearInterval(pollTimer.current);
      } catch {}
      setSource('http');
      setStatus('connected');
      const poll = async () => {
        try {
          const endAll = url.endsWith('/all');
          const endpoint = endAll ? '/debug/snapshot/all' : '/debug/snapshot';
          const resp = await fetch(backendHttp + endpoint);
          if (!resp.ok) return;
          const s: Snapshot = await resp.json();
          const map = httpState.current;
          map.clear();
          for (const m of s.metrics || []) map.set(`${(m.exchange || 'binance')}:${m.symbol}`, m);
          // Use throttled update for HTTP polling too
          setPendingSnapshot({ exchange: s.exchange, ts: s.ts, metrics: Array.from(map.values()) });
        } catch {}
      };
      poll();
      pollTimer.current = window.setInterval(poll, 5000);
    }

    async function pollStatusOnce() {
      try {
        const resp = await fetch(backendHttp + '/debug/status');
        if (resp.ok) {
          const j = await resp.json();
          const b = j.binance?.stale || {};
          const y = j.bybit?.stale || {};
          setStaleCount({
            binanceTicker: b.ticker_count || 0,
            binanceKline: b.kline_count || 0,
            bybitTicker: y.ticker_count || 0,
            bybitKline: y.kline_count || 0,
          });
        }
      } catch {}

      // sentiment (4h) - best effort - use combined endpoint for efficiency
      try {
        const sentimentResp = await fetch(backendHttp + '/meta/sentiment/all');
        if (sentimentResp.ok) {
          const data = await sentimentResp.json();
          // Map combined response to individual state format
          if (data.all) setSentiment({ ...data.all, exchange: 'all', window_minutes: data.window_minutes, since_ts: data.since_ts });
          if (data.binance) setSentimentBinance({ ...data.binance, exchange: 'binance', window_minutes: data.window_minutes, since_ts: data.since_ts });
          if (data.bybit) setSentimentBybit({ ...data.bybit, exchange: 'bybit', window_minutes: data.window_minutes, since_ts: data.since_ts });
        }
      } catch {}
    }

    const statusTimer = window.setInterval(pollStatusOnce, 5000);
    pollStatusOnce();

    async function connectLoop() {
      if (!url.startsWith('ws')) {
        startHttpPolling();
        return;
      }

      setSource('ws');

      while (!cancelled) {
        setStatus('connecting');

        try {
          ws = new WebSocket(url);
          wsRef.current = ws;

          await new Promise<void>((resolve, reject) => {
            if (!ws) return reject(new Error('ws null'));
            ws.onopen = () => resolve();
            ws.onerror = () => reject(new Error('ws error'));
          });

          attempt = 0;
          failCount = 0;
          setStatus('connected');
          setIsReconnecting(false);
          setReconnectAttempt(0);

          ws.onmessage = (ev) => {
            try {
              const snap: Snapshot | { type: string } = JSON.parse(ev.data);
              if ((snap as any).type === 'ping') return;
              const s = snap as Snapshot;
              
              // Use throttled update instead of immediate setState
              setPendingSnapshot(s);
              
              // Append any fresh cipher signals to alert log (still immediate)
              const newAlerts: {ts:number; text:string}[] = [];
              for (const m of s.metrics) {
                // Cipher B signals
                if (m && (m.cipher_buy === true || m.cipher_sell === true)) {
                  const side = m.cipher_buy ? 'BUY' : 'SELL';
                  const tf = m.cipher_source_tf ? `[${m.cipher_source_tf}]` : '';
                  const reason = m.cipher_reason ? `\n${m.cipher_reason}` : '';
                  newAlerts.push({ ts: Date.now(), text: `${side} ${tf} ${(m.exchange||'binance')} ${m.symbol} @ ${m.last_price}${reason}`});
                }
                // %R Trend Exhaustion signals
                if (m && (m.percent_r_ob_reversal === true || m.percent_r_os_reversal === true)) {
                  const side = m.percent_r_os_reversal ? 'BUY' : 'SELL';
                  const reason = m.percent_r_reason ? `\n${m.percent_r_reason}` : '';
                  newAlerts.push({ ts: Date.now(), text: `${side} [%RTE] ${(m.exchange||'binance')} ${m.symbol} @ ${m.last_price}${reason}`});
                }
              }
              if (newAlerts.length>0) setAlertLog(prev => [...newAlerts, ...prev].slice(0, 200));
            } catch {}
          };

          await new Promise<void>((resolve) => {
            if (!ws) return resolve();
            ws.onclose = () => resolve();
            ws.onerror = () => resolve();
          });

          setStatus('disconnected');
          failCount += 1;
        } catch {
          setStatus('disconnected');
          setIsReconnecting(true);
          failCount += 1;
          setReconnectAttempt(failCount);
        }

        // If WS repeatedly fails, fall back to HTTP polling.
        if (failCount >= 3) {
          startHttpPolling();
          return;
        }

        attempt += 1;
        const base = Math.min(10_000, 500 * Math.pow(2, Math.min(attempt, 5)));
        const jitter = Math.floor(Math.random() * 250);
        await sleep(base + jitter);
      }
    }

    connectLoop();

    return () => {
      cancelled = true;
      try { if (ws) ws.close(); } catch {}
      try { if (pollTimer.current) window.clearInterval(pollTimer.current); } catch {}
      window.clearInterval(statusTimer);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    let base = onlyFavs ? rows.filter((r) => favs.includes(idOf(r))) : rows;

    if (q) base = base.filter((r) => r.symbol.includes(q));

    // Presets
    if (preset === 'gainers5m') base = base.filter((r) => (r.change_5m ?? -Infinity) > 0);
    if (preset === 'losers5m') base = base.filter((r) => (r.change_5m ?? Infinity) < 0);
    if (preset === 'highSignal') base = base.filter((r) => (r.signal_score ?? -Infinity) >= 70);
    // Impulse preset: sort-first (do not hard-filter). We keep this as a preset
    // so it can set sorting to impulse_score.
    if (preset === 'volatile5m') base = base.filter((r) => Math.abs(r.change_5m ?? 0) > 0);
    if (preset === 'highOiDelta5m') base = base.filter((r) => Math.abs(r.oi_change_5m ?? 0) > 0);
    if (preset === 'breakout15m') base = base.filter((r) => (r.breakout_15m ?? 0) > 0);
    if (preset === 'cipherBuy') base = base.filter((r) => r.cipher_buy);
    if (preset === 'cipherSell') base = base.filter((r) => r.cipher_sell);
    if (preset === 'rBuy') base = base.filter((r) => r.percent_r_os_reversal);
    if (preset === 'rSell') base = base.filter((r) => r.percent_r_ob_reversal);

    // Volatility Due (event) filter: only symbols that JUST triggered vol-due
    if (volDueOnly) base = base.filter((r) => r.vol_due_15m === true || r.vol_due_4h === true);

    // Squeeze (state) filter: symbols currently in compression
    if (squeezeOnly) base = base.filter((r) => r.vol_squeeze_15m === true || r.vol_squeeze_4h === true);

    return base;
  }, [rows, query, onlyFavs, volDueOnly, squeezeOnly, favs, preset]);

  const sorted = useMemo(() => {
    const cmpString = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

    const cmp = (a: Metric, b: Metric) => {
      const va = (a as any)[sortKey];
      const vb = (b as any)[sortKey];

      // String sort (e.g. Symbol)
      if (sortKey === 'symbol') {
        const res = cmpString(a.symbol ?? '', b.symbol ?? '');
        return sortDir === 'desc' ? -res : res;
      }

      // Numeric-ish sort for all other keys
      let na = (va === null || va === undefined || Number.isNaN(va))
        ? (sortDir === 'desc' ? -Infinity : Infinity)
        : (va as number);
      let nb = (vb === null || vb === undefined || Number.isNaN(vb))
        ? (sortDir === 'desc' ? -Infinity : Infinity)
        : (vb as number);

      // If we're in an "absolute" preset, sort by absolute value for the relevant key
      if (preset === 'volatile5m' && sortKey === 'change_5m') {
        na = Math.abs(na);
        nb = Math.abs(nb);
      }
      if (preset === 'highOiDelta5m' && sortKey === 'oi_change_5m') {
        na = Math.abs(na);
        nb = Math.abs(nb);
      }

      if (na === nb) {
        // Stable tie-breaker: always alphabetical symbol (case-insensitive, numeric-aware)
        return cmpString(a.symbol ?? '', b.symbol ?? '');
      }
      return sortDir === 'desc' ? nb - na : na - nb;
    };

    return [...filtered].sort(cmp);
  }, [filtered, sortKey, sortDir, preset]);

  // UX Fix: Keyboard shortcuts (placed after sorted is defined)
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
          '?            Show this help';
        
        alert(helpText);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modal, sorted, showQuickAdd, showAlerts]);

  // Top movers (based on full universe, not filtered)
  const movers5mUp = useMemo(() => topMovers(rows, 'change_5m', 'up'), [rows]);
  const movers5mDown = useMemo(() => topMovers(rows, 'change_5m', 'down'), [rows]);
  const movers15mUp = useMemo(() => topMovers(rows, 'change_15m', 'up'), [rows]);
  const movers15mDown = useMemo(() => topMovers(rows, 'change_15m', 'down'), [rows]);

  const favRows = useMemo(() => rows.filter(r => favs.includes(idOf(r))), [rows, favs]);

  const toBacktestResponse = (bt: any, windowDays: 30 | 90): BacktestResponse | null => {
    if (!bt || typeof bt !== 'object') return null;
    // Normalize/override window_days just in case
    return { window_days: windowDays, ...bt } as BacktestResponse;
  };

  const openDetails = async (r: Metric) => {
    const exchange = r.exchange || 'binance';
    const backendBase =
      process.env.NEXT_PUBLIC_BACKEND_HTTP ||
      (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8000` : 'http://127.0.0.1:8000');

    // Show modal immediately with row data; load all details via combined endpoint
    setModal({ open: true, row: r, closes: [], oi: [], loading: true, plan: null, bt30: null, bt90: null, news: [], newsLoading: true, fundingRate: null, fundingRateAnnual: null, nextFundingTime: null, fundingLoading: true, longShortRatio: null, liquidations: [], liquidationSummary: null, liquidationLevels: [] });

    try {
      // Use combined endpoint - reduces API calls
      const resp = await fetch(`${backendBase}/symbol/details?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(r.symbol)}`);
      if (resp.ok) {
        const data = await resp.json();
        setModal((m) => ({
          ...m,
          open: true,
          row: r,
          closes: data.closes || [],
          oi: data.oi || [],
          plan: data.plan || null,
          // bt30/bt90 should render even if `result` is null/empty; UI uses the summary fields.
          // The backend returns bt30/bt90 as an object with summary stats plus an optional `result` payload.
          bt30: toBacktestResponse(data.bt30, 30),
          bt90: toBacktestResponse(data.bt90, 90),
          news: data.news || [],
          newsLoading: false,
          loading: false,
          fundingRate: data.funding?.funding_rate ?? null,
          fundingRateAnnual: data.funding?.funding_rate_annual ?? null,
          nextFundingTime: data.funding?.next_funding_time ?? null,
          fundingLoading: false,
          longShortRatio: data.long_short_ratio || null,
          liquidations: data.liquidations || [],
          liquidationSummary: data.liquidation_summary || null,
          liquidationLevels: data.liquidation_levels || [],
        }));
      } else {
        throw new Error('Failed to fetch details');
      }
    } catch (e) {
      setModal((m) => ({ ...m, open: true, row: r, closes: [], oi: [], news: [], newsLoading: false, loading: false, fundingLoading: false, longShortRatio: null, liquidations: [], liquidationSummary: null, liquidationLevels: [] }));
    }
  };

  const handleQuickAdd = (r: Metric, e: React.MouseEvent) => {
    e.stopPropagation();
    setQuickAddSymbol(r);
    setQuickAddForm({
      side: 'LONG',
      quantity: '',
      stop_loss: '',
      take_profit: '',
      notes: '',
    });
    setShowQuickAdd(true);
  };

  const submitQuickAdd = async () => {
    if (!quickAddSymbol || !quickAddForm.quantity) {
      alert('Please enter quantity');
      return;
    }

    try {
      const resp = await fetch(`${resolvedBackendHttp}/portfolio/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: quickAddSymbol.exchange || 'binance',
          symbol: quickAddSymbol.symbol,
          side: quickAddForm.side,
          entry_price: quickAddSymbol.last_price,
          quantity: parseFloat(quickAddForm.quantity),
          stop_loss: quickAddForm.stop_loss ? parseFloat(quickAddForm.stop_loss) : null,
          take_profit: quickAddForm.take_profit ? parseFloat(quickAddForm.take_profit) : null,
          notes: quickAddForm.notes || null,
        }),
      });

      if (resp.ok) {
        setShowQuickAdd(false);
        setQuickAddSymbol(null);
        alert('✅ Position added to portfolio!');
      } else {
        alert('Failed to add position');
      }
    } catch (e) {
      console.error('Error adding position:', e);
      alert('Error adding position');
    }
  };

  return (
    <div className="container">
      {/* Top Navigation Header - Desktop only */}
      <header className="desktop-header" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        background: 'linear-gradient(180deg, #0f1520 0%, #0b0f14 100%)',
        borderBottom: '1px solid #1f2a37'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 18 }}>🍋 Squeeze</span>
          <span style={{ fontSize: 11, color: '#4cc9f0', padding: '2px 8px', background: 'rgba(76,201,240,0.1)', borderRadius: 4 }}>Screener</span>
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {[
            { href: '/alerts', label: 'History' },
            { href: '/feed', label: 'Feed' },
            { href: '/analysis', label: 'Analysis' },
            { href: '/portfolio', label: 'Portfolio' },
            { href: '/about', label: 'About' }
          ].map(({ href, label }) => (
            <a
              key={href}
              href={href}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                color: '#7d8aa5',
                textDecoration: 'none',
                borderRadius: 6,
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => { 
                e.currentTarget.style.background = 'rgba(76,201,240,0.1)'; 
                e.currentTarget.style.color = '#e6edf3'; 
              }}
              onMouseLeave={(e) => { 
                e.currentTarget.style.background = 'transparent'; 
                e.currentTarget.style.color = '#7d8aa5'; 
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      {/* Reconnection Banner */}
      {(isReconnecting || status === 'disconnected') && (
        <div className={`reconnect-banner ${reconnectAttempt >= 3 ? 'disconnected' : ''}`}>
          <span className="reconnect-icon">{reconnectAttempt >= 3 ? '🔴' : '⚠️'}</span>
          <span>
            {status === 'connecting' 
              ? `Reconnecting to server${reconnectAttempt > 0 ? ` (attempt ${reconnectAttempt})` : ''}...`
              : reconnectAttempt >= 3 
                ? 'Unable to connect to backend'
                : 'Connection lost. Attempting to reconnect...'}
          </span>
          <span className="reconnect-hint">Data may be stale</span>
          <div className="reconnect-actions">
            <button 
              className="reconnect-btn"
              onClick={async () => {
                try {
                  await fetch((resolvedBackendHttp || 'http://127.0.0.1:8000') + '/debug/resync?exchange=binance', { method: 'POST' });
                  window.location.reload();
                } catch {
                  window.location.reload();
                }
              }}
            >
              🔄 Retry
            </button>
            <button 
              className="reconnect-btn"
              onClick={() => window.open('/about#troubleshooting', '_blank')}
            >
              ❓ Help
            </button>
          </div>
          {reconnectAttempt >= 3 && (
            <div className="reconnect-tips">
              💡 Tips: Check that backend is running on port 8000 • Try <code style={{ background: 'rgba(0,0,0,0.2)', padding: '1px 4px', borderRadius: 3 }}>python -m uvicorn app.main:app</code> in backend folder
            </div>
          )}
        </div>
      )}
      
      <div className="panel" style={{ marginTop: (isReconnecting || status === 'disconnected') ? 44 : 0 }}>
        <div className="toolbar">
          <div className="group" style={{ flexWrap: 'wrap' }}>
            <span className="badge">Exchange: Binance Perp</span>
            <span className="badge">Pairs: {sorted.length}</span>
            <span className="badge">
              {status==='connected'?'Live':status==='connecting'?'Connecting…':'Disconnected'} · {source==='ws'?'WS':'HTTP'}
            </span>
            <span className="badge" title="Stale symbol counts (ticker/kline)">
              Stale B(t/k): {staleCount.binanceTicker}/{staleCount.binanceKline} · Y(t/k): {staleCount.bybitTicker}/{staleCount.bybitKline}
            </span>
            <span className="badge" title="4h Cipher alert sentiment (BUY vs SELL counts)">
              4h Sentiment: {sentiment ? `${sentiment.bias} (${sentiment.buy}/${sentiment.sell})` : '—'}
            </span>
            <span className="badge" title="4h sentiment by exchange">
              B: {sentimentBinance ? `${sentimentBinance.bias} (${sentimentBinance.buy}/${sentimentBinance.sell})` : '—'} · Y: {sentimentBybit ? `${sentimentBybit.bias} (${sentimentBybit.buy}/${sentimentBybit.sell})` : '—'}
            </span>
          </div>
          <div className="group">
            <input className="input" placeholder="Search symbol... (press /)" value={query} onChange={e=>setQuery(e.target.value)} title="Press / to focus" />

            <div className="group" style={{ gap: 6 }}>
              <button
                className={"button " + (preset==='gainers5m'?'buttonActive':'')}
                onClick={()=>{ setPreset(preset==='gainers5m'?'none':'gainers5m'); setSortKey('change_5m'); setSortDir('desc'); }}
              >
                Gainers 5m
              </button>
              <button
                className={"button " + (preset==='losers5m'?'buttonActive':'')}
                onClick={()=>{ setPreset(preset==='losers5m'?'none':'losers5m'); setSortKey('change_5m'); setSortDir('asc'); }}
              >
                Losers 5m
              </button>
              <button
                className={"button " + (preset==='volatile5m'?'buttonActive':'')}
                onClick={()=>{ setPreset(preset==='volatile5m'?'none':'volatile5m'); setSortKey('change_5m'); setSortDir('desc'); }}
                title="Sorts by largest 5m moves (use Min |5m| % to threshold)"
              >
                Volatile 5m
              </button>
              <button
                className={"button " + (preset==='highOiDelta5m'?'buttonActive':'')}
                onClick={()=>{ setPreset(preset==='highOiDelta5m'?'none':'highOiDelta5m'); setSortKey('oi_change_5m'); setSortDir('desc'); }}
                title="Sorts by OI Δ 5m"
              >
                High OI Δ 5m
              </button>
              <button
                className={"button " + (preset==='breakout15m'?'buttonActive':'')}
                onClick={()=>{ setPreset(preset==='breakout15m'?'none':'breakout15m'); setSortKey('breakout_15m'); setSortDir('desc'); }}
                title="Sorts by breakout_15m"
              >
                Breakout 15m
              </button>
              <button
                className={"button " + (preset==='impulse'?'buttonActive':'')}
                onClick={()=>{ setPreset(preset==='impulse'?'none':'impulse'); setSortKey('impulse_score'); setSortDir('desc'); }}
                title="Scalping impulse score (move + vol activity)"
              >
                Impulse
              </button>
              <button
                className={"button " + (preset==='highSignal'?'buttonActive':'')}
                onClick={()=>{ setPreset(preset==='highSignal'?'none':'highSignal'); setSortKey('signal_score'); setSortDir('desc'); }}
              >
                High Signal
              </button>
              <button
                className={"button " + (preset==='cipherBuy'?'buttonActive':'')}
                onClick={()=>{ setPreset(preset==='cipherBuy'?'none':'cipherBuy'); }}
                title="Cipher B: WT cross up while oversold"
              >
                Cipher Buy
              </button>
              <button
                className={"button " + (preset==='cipherSell'?'buttonActive':'')}
                onClick={()=>{ setPreset(preset==='cipherSell'?'none':'cipherSell'); }}
                title="Cipher B: WT cross down while overbought"
              >
                Cipher Sell
              </button>
              <button
                className={"button " + (preset==='rBuy'?'buttonActive':'')}
                onClick={()=>{ setPreset(preset==='rBuy'?'none':'rBuy'); }}
                title="%R Trend Exhaustion: Bullish reversal (exited oversold)"
              >
                %R Buy
              </button>
              <button
                className={"button " + (preset==='rSell'?'buttonActive':'')}
                onClick={()=>{ setPreset(preset==='rSell'?'none':'rSell'); }}
                title="%R Trend Exhaustion: Bearish reversal (exited overbought)"
              >
                %R Sell
              </button>
              <button className="button" onClick={()=>{setPreset('none');}}>Reset</button>
            </div>

            <select className="select" value={sortKey} onChange={e=>setSortKey(e.target.value as SortKey)}>
              <option value="signal_score">Sort: Signal 🔥</option>
              <option value="impulse_score">Sort: Impulse</option>
              <option value="market_cap">Sort: Market Cap</option>
              <option value="change_5m">Sort: 5m %</option>
              <option value="change_15m">Sort: 15m %</option>
              <option value="momentum_score">Sort: Momentum</option>
              <option value="oi_change_5m">Sort: OI Chg 5m</option>
              <option value="oi_change_15m">Sort: OI Chg 15m</option>
              <option value="oi_change_1h">Sort: OI Chg 1h</option>
              <option value="oi_change_1d">Sort: OI Chg 1d</option>
              <option value="change_1d">Sort: % 1d</option>
              <option value="open_interest">Sort: OI</option>
              <option value="atr">Sort: ATR</option>
              <option value="vol_zscore_1m">Sort: Vol Z</option>
              <option value="last_price">Sort: Last</option>
              <option value="symbol">Sort: Symbol</option>
            </select>
            <button
              className="button"
              onClick={async ()=>{
                try{
                  await fetch((process.env.NEXT_PUBLIC_BACKEND_HTTP || 'http://127.0.0.1:8000') + '/debug/resync?exchange=binance', {method:'POST'});
                }catch{}
              }}
              title="Restart streams + backfill (Binance)"
            >
              Resync
            </button>
            <button className="button" onClick={()=>setSortDir(d=> d==='desc'?'asc':'desc')}>
              {sortDir==='desc' ? 'Desc' : 'Asc'}
            </button>
            <button className="button" onClick={()=>setOnlyFavs(v=>!v)}>
              {onlyFavs ? 'All' : 'Only Favs'}
            </button>
            <button className={"button " + (volDueOnly ? 'buttonActive' : '')} onClick={()=>setVolDueOnly(v=>!v)} title="Show only symbols that just triggered Volatility Due (15m or 4h)">
              Vol Due
            </button>
            <button className={"button " + (squeezeOnly ? 'buttonActive' : '')} onClick={()=>setSqueezeOnly(v=>!v)} title="Show only symbols currently in a squeeze (15m or 4h)">
              Squeeze
            </button>
            <button className={"button "+(showAlerts? 'buttonActive':'')} onClick={()=>setShowAlerts(v=>!v)} title="Toggle Alert Log">
              Alerts
            </button>
            <button className={"button "+(showColumns? 'buttonActive':'')} onClick={()=>setShowColumns(v=>!v)} title="Choose table columns">
              Columns
            </button>
            <button 
              className="button" 
              onClick={() => {
                // Export to CSV
                const headers = ['Symbol', 'Exchange', 'Price', '5m%', '15m%', '60m%', 'Signal', 'Impulse', 'OI', 'ATR', 'Market Cap'];
                const csvRows = [headers.join(',')];
                sorted.forEach(r => {
                  csvRows.push([
                    r.symbol,
                    r.exchange || 'binance',
                    r.last_price?.toFixed(4) || '',
                    ((r.change_5m || 0) * 100).toFixed(2) + '%',
                    ((r.change_15m || 0) * 100).toFixed(2) + '%',
                    ((r.change_60m || 0) * 100).toFixed(2) + '%',
                    r.signal_score?.toFixed(0) || '',
                    r.impulse_score?.toFixed(0) || '',
                    r.open_interest?.toFixed(0) || '',
                    r.atr?.toFixed(4) || '',
                    r.market_cap?.toFixed(0) || ''
                  ].join(','));
                });
                const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `crypto_screener_${new Date().toISOString().slice(0,10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              title="Export current view to CSV"
            >
              Export CSV
            </button>
            <button 
              className="button" 
              onClick={() => {
                const helpText = 
                  '⌨️ KEYBOARD SHORTCUTS\n\n' +
                  'ESC          Close modal/dialog\n' +
                  '/            Focus search box\n' +
                  '← →          Navigate symbols (in modal)\n' +
                  '?            Show this help';
                alert(helpText);
              }}
              title="Keyboard shortcuts (?)"
              style={{ padding: '10px', fontSize: 14 }}
            >
              ⌨️
            </button>
            <button 
              className={"button " + (viewMode !== 'auto' ? 'buttonActive' : '')}
              onClick={() => {
                // Cycle through: auto -> card -> table -> auto
                setViewMode(prev => prev === 'auto' ? 'card' : prev === 'card' ? 'table' : 'auto');
              }}
              title={`View mode: ${viewMode === 'auto' ? 'Auto (mobile=cards)' : viewMode === 'card' ? 'Cards' : 'Table'} - Click to cycle`}
              style={{ padding: '10px', fontSize: 14 }}
            >
              {viewMode === 'auto' ? '📱' : viewMode === 'card' ? '🃏' : '📋'}
            </button>
          </div>
        </div>

        {showColumns && (
          <div style={{ padding: 12 }}>
            <div className="card">
              <h3>Columns</h3>
              <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
                Tip: on mobile, keep only a few columns enabled to avoid horizontal scrolling.
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {Array.from(new Set(columnMeta.map(c=>c.group))).map((grp) => (
                  <div key={grp} style={{ minWidth: 220 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{grp}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {columnMeta.filter(c=>c.group===grp).map((c) => (
                        <label key={c.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={!!cols[c.key]}
                            onChange={(e) => setCols((prev) => ({ ...prev, [c.key]: e.target.checked }))}
                          />
                          <span className="muted" style={{ fontSize: 13 }}>{c.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={mobileMode} onChange={(e)=>setMobileMode(e.target.checked)} />
                  <span className="muted">Mobile mode</span>
                </label>
                <button className="button" onClick={() => setCols(mobileDefaultCols)}>
                  Mobile preset
                </button>
                <button className="button" onClick={() => setCols(desktopDefaultCols)}>
                  Desktop preset
                </button>
                <button className="button" onClick={() => setCols(Object.fromEntries(Object.keys(cols).map(k => [k, true])) as any)}>
                  Show all
                </button>
                <button className="button" onClick={() => setShowColumns(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Top movers grid - collapsible */}
        <div style={{padding:12}}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <button 
              className="button" 
              onClick={() => setTopMoversCollapsed(!topMoversCollapsed)}
              style={{ padding: '4px 10px', fontSize: 12 }}
            >
              {topMoversCollapsed ? '▶ Show' : '▼ Hide'} Top Movers
            </button>
            {topMoversCollapsed && <span className="muted" style={{ fontSize: 12 }}>Click to expand movers panel</span>}
          </div>
          {!topMoversCollapsed && (
          <div className="grid">
            <div className="card">
              <h3>Top Gainers 5m</h3>
              <div>
                {movers5mUp.map(m => (
                  <span key={idOf(m)} className="pill" onClick={()=>openDetails(m)}>
                    <span className="sym">{m.symbol}</span>
                    <span className="val chgUp">{fmtPct(m.change_5m)}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="card">
              <h3>Top Losers 5m</h3>
              <div>
                {movers5mDown.map(m => (
                    <span key={idOf(m)} className="pill" onClick={()=>openDetails(m)}>
                      <span className="sym">{m.symbol}</span>
                      <span className="val chgDown">{fmtPct(m.change_5m)}</span>
                    </span>
                ))}
              </div>
            </div>
            <div className="card">
              <h3>Top Gainers 15m</h3>
              <div>
                {movers15mUp.map(m => (
                  <span key={idOf(m)} className="pill" onClick={()=>openDetails(m)}>
                    <span className="sym">{m.symbol}</span>
                    <span className="val chgUp">{fmtPct(m.change_15m)}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="card">
              <h3>Top Losers 15m</h3>
              <div>
                {movers15mDown.map(m => (
                  <span key={idOf(m)} className="pill" onClick={()=>openDetails(m)}>
                    <span className="sym">{m.symbol}</span>
                    <span className="val chgDown">{fmtPct(m.change_15m)}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
          )}
        </div>

        {/* Pinned favorites */}
        {favs.length>0 && (
          <div style={{padding:12}}>
            <div className="card">
              <h3>Pinned Favorites</h3>
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Symbol</th>
                      <th>Last</th>
                      <th>5m %</th>
                      <th>15m %</th>
                      <th>ATR</th>
                      <th>Vol Z</th>
                    </tr>
                  </thead>
                  <tbody>
                    {favRows.map(r => (
                      <tr key={'fav-'+r.symbol}>
                        <td className="muted">
                          <span className={"star "+(favs.includes(idOf(r))?'active':'')} onClick={()=>toggleFav(idOf(r), favs, setFavs)}>★</span>
                        </td>
                        <td style={{fontWeight:600}}>{r.symbol}</td>
                        <td>{fmt(r.last_price)}</td>
                        <td className={pctClass(r.change_5m)}>{fmtPct(r.change_5m)}</td>
                        <td className={pctClass(r.change_15m)}>{fmtPct(r.change_15m)}</td>
                        <td>{fmt(r.atr)}</td>
                        <td>{fmt(r.vol_zscore_1m)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {sorted.length === 0 && (
          <div style={{ padding: 12 }} className="muted">
            No results for current selection. Try Reset or choose a different preset.
          </div>
        )}
        
        {/* Card View (mobile or manual toggle) */}
        {showCardView ? (
          <div style={{ padding: 10 }}>
            {sorted.map(r => (
              <MobileSymbolCard
                key={idOf(r)}
                metric={r}
                isFavorite={favs.includes(idOf(r))}
                hasPosition={openPositions.includes(idOf(r))}
                onToggleFavorite={() => toggleFav(idOf(r), favs, setFavs)}
                onViewDetails={() => openDetails(r)}
              />
            ))}
          </div>
        ) : (
          /* Desktop Table View */
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th className="sortable" onClick={()=>handleHeaderClick('symbol')}>
                    Symbol {sortKey==='symbol' && (sortDir==='desc'?'↓':'↑')}
                  </th>
                  {col('exchange') && <th className="hide-xs">Exchange</th>}
                  {col('signal') && (
                    <th className="sortable" onClick={()=>handleHeaderClick('signal_score')}>
                      Signal {sortKey==='signal_score' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('impulse') && (
                    <th className="sortable hide-sm" onClick={()=>handleHeaderClick('impulse_score')}>
                      Impulse {sortKey==='impulse_score' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('marketcap') && (
                    <th className="sortable hide-sm" onClick={()=>handleHeaderClick('market_cap')}>
                      Market Cap {sortKey==='market_cap' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  <th className="sortable" onClick={()=>handleHeaderClick('last_price')}>
                    Last {sortKey==='last_price' && (sortDir==='desc'?'↓':'↑')}
                  </th>
                  {col('chg1m') && (
                    <th className="sortable hide-sm" onClick={()=>handleHeaderClick('change_1m')}>
                      1m % {sortKey==='change_1m' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('chg5m') && (
                    <th className="sortable" onClick={()=>handleHeaderClick('change_5m')}>
                      5m % {sortKey==='change_5m' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('chg15m') && (
                    <th className="sortable" onClick={()=>handleHeaderClick('change_15m')}>
                      15m % {sortKey==='change_15m' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('chg60m') && (
                    <th className="sortable hide-md" onClick={()=>handleHeaderClick('change_60m')}>
                      60m % {sortKey==='change_60m' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('chg1d') && (
                    <th className="sortable hide-md" onClick={()=>handleHeaderClick('change_1d')}>
                      1d % {sortKey==='change_1d' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('momentum') && (
                    <th className="sortable hide-md" onClick={()=>handleHeaderClick('momentum_score')}>
                      Momentum {sortKey==='momentum_score' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('mom5m') && <th className="hide-md">Mom 5m</th>}
                  {col('mom15m') && <th className="hide-md">Mom 15m</th>}
                  {col('oi') && (
                    <th className="sortable hide-sm" onClick={()=>handleHeaderClick('open_interest')}>
                      OI {sortKey==='open_interest' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('oi5m') && (
                    <th className="sortable hide-sm" onClick={()=>handleHeaderClick('oi_change_5m')}>
                      OI Δ 5m {sortKey==='oi_change_5m' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('oi15m') && (
                    <th className="sortable hide-md" onClick={()=>handleHeaderClick('oi_change_15m')}>
                      OI Δ 15m {sortKey==='oi_change_15m' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('oi1h') && (
                    <th className="sortable hide-md" onClick={()=>handleHeaderClick('oi_change_1h')}>
                      OI Δ 1h {sortKey==='oi_change_1h' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('oi1d') && (
                    <th className="sortable hide-md" onClick={()=>handleHeaderClick('oi_change_1d')}>
                      OI Δ 1d {sortKey==='oi_change_1d' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('atr') && (
                    <th className="sortable hide-md" onClick={()=>handleHeaderClick('atr')}>
                      ATR {sortKey==='atr' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('volz') && (
                    <th className="sortable hide-md" onClick={()=>handleHeaderClick('vol_zscore_1m')}>
                      Vol Z {sortKey==='vol_zscore_1m' && (sortDir==='desc'?'↓':'↑')}
                    </th>
                  )}
                  {col('vol1m') && <th className="hide-md">Vol 1m</th>}
                  {col('rvol1m') && <th className="hide-md">RVOL 1m</th>}
                  {col('breakout15m') && <th className="hide-md">Breakout 15m</th>}
                  {col('vwap15m') && <th className="hide-md">VWAP 15m</th>}
                  {col('action') && <th className="hide-sm">Action</th>}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={idOf(r)} onClick={()=>openDetails(r)} style={{cursor:'pointer'}}>
                    <td className="muted">
                      <span className={"star "+(favs.includes(idOf(r))?'active':'')} onClick={(e)=>{e.stopPropagation(); toggleFav(idOf(r), favs, setFavs)}}>★</span>
                    </td>
                    <td style={{fontWeight:600}}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                        {r.symbol}
                        {openPositions.includes(idOf(r)) && (
                          <span 
                            className="badge" 
                            style={{
                              fontSize: 9,
                              background: '#3b82f6',
                              padding: '2px 5px',
                              fontWeight: 700,
                              color: '#fff',
                              borderRadius: 3,
                              flexShrink: 0
                            }}
                            title="You have an open position"
                          >
                            OPEN
                          </span>
                        )}
                      </span>
                    </td>
                    {col('exchange') && <td className="muted hide-xs">{r.exchange || 'binance'}</td>}
                    {col('signal') && (
                      <td className={signalClass(r.signal_strength)}>
                        {fmtSignal(r.signal_score, r.signal_strength)}
                        {r.cipher_buy && <span className="badge" style={{marginLeft:6,fontSize:12,background:'#2a9d8f',padding:'3px 6px',fontWeight:700,color:'#fff',boxShadow:'0 0 8px rgba(42,157,143,0.6)'}}>CB↑</span>}
                        {r.cipher_sell && <span className="badge" style={{marginLeft:6,fontSize:12,background:'#e76f51',padding:'3px 6px',fontWeight:700,color:'#fff',boxShadow:'0 0 8px rgba(231,111,81,0.6)'}}>CB↓</span>}
                        {r.percent_r_os_reversal && <span className="badge" style={{marginLeft:6,fontSize:12,background:'#06d6a0',padding:'3px 6px',fontWeight:700,color:'#000',boxShadow:'0 0 8px rgba(6,214,160,0.6)'}}>%R↑</span>}
                        {r.percent_r_ob_reversal && <span className="badge" style={{marginLeft:6,fontSize:12,background:'#ef476f',padding:'3px 6px',fontWeight:700,color:'#fff',boxShadow:'0 0 8px rgba(239,71,111,0.6)'}}>%R↓</span>}
                      </td>
                    )}
                    {col('impulse') && <td className={'hide-sm'}>{fmtImpulse(r.impulse_score, r.impulse_dir)}</td>}
                    {col('marketcap') && <td className={'hide-sm'}>{fmtMarketCap(r.market_cap)}</td>}
                    <td>{fmt(r.last_price)}</td>
                    {col('chg1m') && <td className={pctClass(r.change_1m) + ' hide-sm'}>{fmtPct(r.change_1m)}</td>}
                    {col('chg5m') && <td className={pctClass(r.change_5m)}>{fmtPct(r.change_5m)}</td>}
                    {col('chg15m') && <td className={pctClass(r.change_15m)}>{fmtPct(r.change_15m)}</td>}
                    {col('chg60m') && <td className={pctClass(r.change_60m) + ' hide-md'}>{fmtPct(r.change_60m)}</td>}
                    {col('chg1d') && <td className={pctClass(r.change_1d) + ' hide-md'}>{fmtPct(r.change_1d)}</td>}
                    {col('momentum') && <td className={momentumClass(r.momentum_score) + ' hide-md'}>{fmtMomentum(r.momentum_score)}</td>}
                    {col('mom5m') && <td className={pctClass(r.momentum_5m) + ' hide-md'}>{fmtPct(r.momentum_5m)}</td>}
                    {col('mom15m') && <td className={pctClass(r.momentum_15m) + ' hide-md'}>{fmtPct(r.momentum_15m)}</td>}
                    {col('oi') && <td className={'hide-sm'}>{fmtOI(r.open_interest)}</td>}
                    {col('oi5m') && <td className={oiClass(r.oi_change_5m) + ' hide-sm'}>{fmtOIPct(r.oi_change_5m)}</td>}
                    {col('oi15m') && <td className={oiClass(r.oi_change_15m) + ' hide-md'}>{fmtOIPct(r.oi_change_15m)}</td>}
                    {col('oi1h') && <td className={oiClass(r.oi_change_1h) + ' hide-md'}>{fmtOIPct(r.oi_change_1h)}</td>}
                    {col('oi1d') && <td className={oiClass(r.oi_change_1d) + ' hide-md'}>{fmtOIPct(r.oi_change_1d)}</td>}
                    {col('atr') && <td className={'hide-md'}>{fmt(r.atr)}</td>}
                    {col('volz') && <td className={'hide-md'}>{fmt(r.vol_zscore_1m)}</td>}
                    {col('vol1m') && <td className={'hide-md'}>{fmt(r.vol_1m)}</td>}
                    {col('rvol1m') && <td className={'hide-md'}>{fmt(r.rvol_1m)}</td>}
                    {col('breakout15m') && <td className={pctClass(r.breakout_15m) + ' hide-md'}>{fmtPct(r.breakout_15m)}</td>}
                    {col('vwap15m') && <td className={'hide-md'}>{fmt(r.vwap_15m)}</td>}
                    {col('action') && (
                      <td className="hide-sm">
                        <button 
                          className="button" 
                          onClick={(e) => handleQuickAdd(r, e)}
                          style={{ fontSize: 11, padding: '4px 8px' }}
                          title="Add to portfolio"
                        >
                          + Portfolio
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="footer">
          <div>WS: <code suppressHydrationWarning>{isClient ? (resolvedWsUrl || '—') : '—'}</code></div>
          <div className="muted">Last update: {lastUpdate? new Date(lastUpdate).toLocaleTimeString(): '—'}</div>
        </div>
      </div>

      {/* Rolling Alert Log (optional UI) */}
      {showAlerts && (
        <div className="panel" style={{position:'fixed', right: 12, bottom: 12, width: 420, maxWidth: '95vw', maxHeight: '45vh', overflowY:'auto', zIndex: 9999}}>
          <div className="toolbar" style={{justifyContent:'space-between'}}>
            <div className="group"><h3 style={{margin:0}}>Alerts</h3></div>
            <div className="group" style={{gap:8}}>
              <button className="button" onClick={()=>setAlertLog([])}>Clear</button>
              <button className="button" onClick={()=>setShowAlerts(false)}>Hide</button>
            </div>
          </div>
          <div style={{padding:12}}>
            {alertLog.length===0 && <div className="muted">No alerts yet.</div>}
            {alertLog.map((a, idx)=> (
              <div key={idx} className="card" style={{marginBottom:8, padding:8}}>
                <div className="muted" style={{fontSize:12}}>{new Date(a.ts).toLocaleTimeString()}</div>
                <pre style={{whiteSpace:'pre-wrap'}}>{a.text}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {modal.open && modal.row && (
        <DetailsModal
          row={liveModalData || modal.row}
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
          longShortRatio={modal.longShortRatio}
          liquidations={modal.liquidations}
          liquidationSummary={modal.liquidationSummary}
          liquidationLevels={modal.liquidationLevels}
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
          backendHttp={resolvedBackendHttp}
        />
      )}

      {/* Quick Add to Portfolio Modal */}
      {showQuickAdd && quickAddSymbol && (
        <div className="modal-overlay" onClick={() => setShowQuickAdd(false)}>
          <div className="modal-quick-add" onClick={(e) => e.stopPropagation()}>
            <h2>Add {quickAddSymbol.symbol} to Portfolio</h2>
            <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
              Entry Price: <strong>{fmt(quickAddSymbol.last_price)}</strong>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Side *</span>
                <select
                  className="input"
                  value={quickAddForm.side}
                  onChange={(e) => setQuickAddForm({ ...quickAddForm, side: e.target.value as 'LONG' | 'SHORT' })}
                >
                  <option value="LONG">LONG</option>
                  <option value="SHORT">SHORT</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Quantity *</span>
                <input
                  className="input"
                  type="number"
                  step="any"
                  placeholder="e.g., 0.1"
                  value={quickAddForm.quantity}
                  onChange={(e) => setQuickAddForm({ ...quickAddForm, quantity: e.target.value })}
                  autoFocus
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Stop Loss (optional)</span>
                <input
                  className="input"
                  type="number"
                  step="any"
                  placeholder="Optional"
                  value={quickAddForm.stop_loss}
                  onChange={(e) => setQuickAddForm({ ...quickAddForm, stop_loss: e.target.value })}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Take Profit (optional)</span>
                <input
                  className="input"
                  type="number"
                  step="any"
                  placeholder="Optional"
                  value={quickAddForm.take_profit}
                  onChange={(e) => setQuickAddForm({ ...quickAddForm, take_profit: e.target.value })}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Notes (optional)</span>
                <textarea
                  className="input"
                  placeholder="Optional notes"
                  value={quickAddForm.notes}
                  onChange={(e) => setQuickAddForm({ ...quickAddForm, notes: e.target.value })}
                  rows={2}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
              </label>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="button" onClick={submitQuickAdd} style={{ flex: 1 }}>
                  Add Position
                </button>
                <button className="button" onClick={() => setShowQuickAdd(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        }
        .modal-quick-add {
          background: var(--bg-secondary, #1a1a2e);
          border: 1px solid var(--border, #333);
          border-radius: 8px;
          padding: 24px;
          max-width: 400px;
          width: 90%;
          max-height: 90vh;
          overflow-y: auto;
        }
        .modal-quick-add h2 {
          margin: 0 0 16px 0;
          font-size: 18px;
        }
      `}</style>
    </div>
  );
}

function idOf(r: Metric){
  return `${(r.exchange || 'binance')}:${r.symbol}`;
}

function topMovers(rows: Metric[], key: 'change_5m' | 'change_15m', dir: 'up'|'down'){
  const items = rows.filter(r => r[key] !== null && r[key] !== undefined && !Number.isNaN(r[key] as number));
  items.sort((a,b)=>{
    const va = (a as any)[key] as number; const vb = (b as any)[key] as number;
    return dir==='up' ? vb - va : va - vb;
  });
  return items.slice(0,5);
}

function toggleFav(sym: string, favs: string[], setFavs: (f: string[])=>void){
  if (favs.includes(sym)) setFavs(favs.filter(s=>s!==sym)); else setFavs([...favs, sym]);
}

function pctClass(n?: number | null){
  if (n===undefined || n===null || Number.isNaN(n)) return 'muted';
  if (n>0) return 'chgUp';
  if (n<0) return 'chgDown';
  return 'muted';
}

function fmt(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs>=1000) return Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
  return Number(n).toFixed(6);
}

function Sparkline({data, color="#4cc9f0"}:{data:number[], color?: string}){
  const w=220, h=60, pad=6;
  if (!data || data.length<2) {
    return <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" />;
  }
  const min=Math.min(...data), max=Math.max(...data);
  const xs=(i:number)=> pad + (i*(w-2*pad))/(data.length-1);
  const ys=(v:number)=> pad + (h-2*pad) * (1 - (v-min)/(max-min || 1));
  const d = data.map((v,i)=>`${i?'L':'M'}${xs(i)},${ys(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{display:'block'}}>
      <path d={d} fill="none" stroke={color} strokeWidth={2}/>
    </svg>
  );
}

function toDeltaSeries(series: number[]) {
  if (!series || series.length < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    out.push(series[i] - series[i - 1]);
  }
  return out;
}

function deltaColor(series: number[]) {
  const d = toDeltaSeries(series);
  const last = d.length ? d[d.length - 1] : 0;
  if (last > 0) return '#3ee145';
  if (last < 0) return '#e13e3e';
  return '#f6c177';
}

// Liquidation Heatmap with Real-time WebSocket Updates
function LiquidationHeatmap({
  exchange,
  symbol,
  currentPrice: initialPrice,
  initialLevels,
  initialLiquidations,
  wsUrl,
}: {
  exchange: string;
  symbol: string;
  currentPrice: number;
  initialLevels: any[];
  initialLiquidations: any[];
  wsUrl: string;
}) {
  const [levels, setLevels] = useState(initialLevels);
  const [recentLiqs, setRecentLiqs] = useState(initialLiquidations);
  const [currentPrice, setCurrentPrice] = useState(initialPrice);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const wsRef = useRef<WebSocket | null>(null);

  // Update from props when they change
  useEffect(() => {
    if (initialLevels.length > 0) setLevels(initialLevels);
  }, [initialLevels]);

  useEffect(() => {
    if (initialLiquidations.length > 0) setRecentLiqs(initialLiquidations);
  }, [initialLiquidations]);

  useEffect(() => {
    if (initialPrice > 0) setCurrentPrice(initialPrice);
  }, [initialPrice]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (!wsUrl || !exchange || !symbol) return;

    // Convert HTTP URL to WebSocket URL
    const wsBase = wsUrl.replace(/^http/, 'ws').replace(/\/ws\/screener.*$/, '');
    const liqWsUrl = `${wsBase}/ws/liquidations/${exchange}/${symbol}`;
    
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let ws: WebSocket;

    const connect = () => {
      try {
        ws = new WebSocket(liqWsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsLive(true);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            
            if (msg.type === 'init') {
              if (msg.data.levels) setLevels(msg.data.levels);
              if (msg.data.liquidations) setRecentLiqs(msg.data.liquidations);
              if (msg.data.current_price) setCurrentPrice(msg.data.current_price);
            } else if (msg.type === 'liquidation') {
              setRecentLiqs(prev => [msg.data, ...prev.slice(0, 19)]);
              setLastUpdate(Date.now());
            } else if (msg.type === 'levels_update') {
              if (msg.data.levels) setLevels(msg.data.levels);
              if (msg.data.current_price) setCurrentPrice(msg.data.current_price);
              setLastUpdate(Date.now());
            } else if (msg.type === 'ping') {
              ws.send('ping');
            }
          } catch (e) {
            // Parse error
          }
        };

        ws.onclose = () => {
          setIsLive(false);
          reconnectTimeout = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch (e) {
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [wsUrl, exchange, symbol]);

  const maxIntensity = Math.max(...levels.map(l => l.intensity || 0), 0.001);

  return (
    <div style={{ marginTop: 16 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
        🔥 Liquidation Heatmap
        {isLive && (
          <span style={{ 
            fontSize: 10, 
            padding: '2px 6px', 
            background: 'rgba(42, 157, 143, 0.3)', 
            color: '#2a9d8f', 
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2a9d8f' }} />
            LIVE
          </span>
        )}
      </div>
      <div className="card" style={{ padding: 16, background: 'rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
            Price levels with concentrated liquidations (last 1h)
          </div>
          
          {levels.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#666' }}>
              No liquidation data yet. Data will appear as liquidations occur.
            </div>
          ) : (
            <>
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: 2,
                maxHeight: 300,
                overflowY: 'auto'
              }}>
                {levels.map((level, idx) => {
                  const normalizedIntensity = maxIntensity > 0 ? (level.intensity || 0) / maxIntensity : 0;
                  const isAbovePrice = level.price > currentPrice;
                  const isNearPrice = currentPrice > 0 && Math.abs(level.price - currentPrice) / currentPrice < 0.005;
                  
                  return (
                    <div 
                      key={idx}
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center',
                        gap: 8,
                        padding: '4px 8px',
                        background: isNearPrice ? 'rgba(74, 158, 255, 0.15)' : 'rgba(0,0,0,0.2)',
                        borderRadius: 4,
                        borderLeft: isNearPrice ? '3px solid #4a9eff' : '3px solid transparent'
                      }}
                    >
                      <div style={{ 
                        width: 80, 
                        fontSize: 11, 
                        fontWeight: 600,
                        color: isNearPrice ? '#4a9eff' : isAbovePrice ? '#e76f51' : '#2a9d8f'
                      }}>
                        ${fmt(level.price)}
                      </div>
                      
                      <div style={{ 
                        flex: 1, 
                        height: 20, 
                        display: 'flex',
                        borderRadius: 3,
                        overflow: 'hidden',
                        background: 'rgba(0,0,0,0.3)'
                      }}>
                        {level.long_value > 0 && (
                          <div style={{ 
                            width: `${(level.long_value / level.total_value) * 100 * normalizedIntensity}%`,
                            background: `rgba(42, 157, 143, ${0.3 + normalizedIntensity * 0.7})`,
                            minWidth: 4
                          }} />
                        )}
                        {level.short_value > 0 && (
                          <div style={{ 
                            width: `${(level.short_value / level.total_value) * 100 * normalizedIntensity}%`,
                            background: `rgba(231, 111, 81, ${0.3 + normalizedIntensity * 0.7})`,
                            minWidth: 4
                          }} />
                        )}
                      </div>
                      
                      <div style={{ 
                        width: 70, 
                        fontSize: 10, 
                        textAlign: 'right',
                        color: normalizedIntensity > 0.7 ? '#fff' : '#888',
                        fontWeight: normalizedIntensity > 0.7 ? 600 : 400
                      }}>
                        ${level.total_value >= 1000000 
                          ? (level.total_value / 1000000).toFixed(1) + 'M' 
                          : (level.total_value / 1000).toFixed(0) + 'K'}
                      </div>
                      
                      <div style={{ 
                        width: 30, 
                        fontSize: 10, 
                        textAlign: 'right',
                        color: '#666'
                      }}>
                        {level.total_count}x
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {recentLiqs.length > 0 && (
                <div style={{ 
                  marginTop: 8,
                  padding: '8px 12px',
                  background: 'rgba(0,0,0,0.2)',
                  borderRadius: 6,
                  maxHeight: 100,
                  overflowY: 'auto'
                }}>
                  <div style={{ fontSize: 10, color: '#888', marginBottom: 6 }}>Recent Liquidations</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {recentLiqs.slice(0, 5).map((liq, idx) => (
                      <div key={idx} style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between',
                        fontSize: 11,
                        opacity: 1 - (idx * 0.15)
                      }}>
                        <span style={{ 
                          color: liq.side === 'SELL' ? '#2a9d8f' : '#e76f51',
                          fontWeight: 600
                        }}>
                          {liq.side === 'SELL' ? '🟢 LONG' : '🔴 SHORT'}
                        </span>
                        <span style={{ color: '#888' }}>${fmt(liq.price)}</span>
                        <span style={{ fontWeight: 500 }}>
                          ${liq.value_usd >= 1000000 
                            ? (liq.value_usd / 1000000).toFixed(1) + 'M' 
                            : (liq.value_usd / 1000).toFixed(1) + 'K'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                paddingTop: 8,
                borderTop: '1px solid rgba(255,255,255,0.1)',
                fontSize: 10,
                color: '#888'
              }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 12, height: 12, background: '#2a9d8f', borderRadius: 2 }} />
                    <span>Long Liqs</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 12, height: 12, background: '#e76f51', borderRadius: 2 }} />
                    <span>Short Liqs</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 12, height: 12, background: '#4a9eff', borderRadius: 2 }} />
                  <span>Current Price</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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
  longShortRatio,
  liquidations,
  liquidationSummary,
  liquidationLevels,
  isFav,
  onToggleFav,
  onClose,
  onNavigate,
  onQuickAddToPortfolio,
  backendWs,
  backendHttp,
}: {
  row: Metric;
  closes: number[];
  oi: number[];
  loading: boolean;
  plan: TradePlan | null;
  bt30: BacktestResponse | null;
  bt90: BacktestResponse | null;
  news: NewsArticle[];
  newsLoading: boolean;
  fundingRate?: number | null;
  fundingRateAnnual?: number | null;
  nextFundingTime?: number | null;
  fundingLoading?: boolean;
  longShortRatio?: {
    long_ratio: number;
    short_ratio: number;
    long_short_ratio: number;
    long_account: number;
    short_account: number;
    timestamp: number;
  } | null;
  liquidations?: {
    symbol: string;
    side: string;
    price: number;
    qty: number;
    value_usd: number;
    timestamp: number;
  }[];
  liquidationSummary?: {
    recent_count: number;
    long_liq_count: number;
    short_liq_count: number;
    total_value_usd: number;
    long_liq_value: number;
    short_liq_value: number;
  } | null;
  liquidationLevels?: {
    price: number;
    long_value: number;
    short_value: number;
    total_value: number;
    long_count: number;
    short_count: number;
    total_count: number;
    intensity: number;
    bucket_size: number;
  }[];
  isFav: boolean;
  onToggleFav: () => void;
  onClose: () => void;
  onNavigate: (dir: -1 | 1) => void;
  onQuickAddToPortfolio?: () => void;
  backendWs: string;
  backendHttp: string;
}) {
  
  const [activeTab, setActiveTab] = useState<'overview' | 'plan' | 'indicators' | 'news'>('overview');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const toggleSection = (key: string) => setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  const exchange = row.exchange || 'binance';
  const symbol = row.symbol;

  const [footprintCandles, setFootprintCandles] = useState<any[]>([]);
  const [footprintStatus, setFootprintStatus] = useState<'idle'|'loading'|'connected'>('idle');
  const [orderflowWalls, setOrderflowWalls] = useState<{
    support: { price: number; volume: number; strength: number; distance_pct: number; touches: number }[];
    resistance: { price: number; volume: number; strength: number; distance_pct: number; touches: number }[];
  }>({ support: [], resistance: [] });
  
  // Order book walls (from resting limit orders)
  const [orderbookWalls, setOrderbookWalls] = useState<{
    support: { price: number; quantity: number; value_usd: number; strength: number; distance_pct: number; is_cluster?: boolean; cluster_count?: number; price_range?: number[] }[];
    resistance: { price: number; quantity: number; value_usd: number; strength: number; distance_pct: number; is_cluster?: boolean; cluster_count?: number; price_range?: number[] }[];
  }>({ support: [], resistance: [] });
  // Swing trading walls (further from price, clustered)
  const [swingWalls, setSwingWalls] = useState<{
    support: { price: number; quantity: number; value_usd: number; strength: number; distance_pct: number; is_cluster?: boolean; cluster_count?: number; price_range?: number[] }[];
    resistance: { price: number; quantity: number; value_usd: number; strength: number; distance_pct: number; is_cluster?: boolean; cluster_count?: number; price_range?: number[] }[];
  }>({ support: [], resistance: [] });
  const [orderbookStatus, setOrderbookStatus] = useState<'idle'|'loading'|'connected'>('idle');
  const [orderbookImbalance, setOrderbookImbalance] = useState<{
    bid_ratio: number;
    imbalance: string;
    mid_price: number | null;
    spread: number | null;
  }>({ bid_ratio: 0.5, imbalance: 'NEUTRAL', mid_price: null, spread: null });

  const tvUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(
    exchange.toUpperCase() === 'BYBIT' ? `BYBIT:${symbol}` : `BINANCE:${symbol}`
  )}`;

  // Order flow websocket
  useEffect(() => {
    setFootprintStatus('loading');
    setFootprintCandles([]);
    // Extract base WS URL (remove /ws/screener/* path if present)
    const baseWs = backendWs.replace(/\/ws\/screener.*$/, '');
    const wsUrl = `${baseWs}/ws/orderflow?exchange=${exchange}&symbol=${symbol}&tf=1m&step=0.5&lookback=30&emit_ms=300`;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => setFootprintStatus('connected');
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'snapshot') {
          setFootprintCandles(msg.candles || []);
          // Extract wall data from snapshot (trade-based walls)
          if (msg.walls) {
            setOrderflowWalls({
              support: msg.walls.support || [],
              resistance: msg.walls.resistance || []
            });
          }
        } else if (msg.type === 'delta') {
          setFootprintCandles(prev => {
            const c = msg.candle;
            const idx = prev.findIndex((x: any) => x.open_ts === c.open_ts);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = c;
              return next;
            }
            return [...prev, c];
          });
          // Update walls from delta
          if (msg.walls) {
            setOrderflowWalls({
              support: msg.walls.support || [],
              resistance: msg.walls.resistance || []
            });
          }
        }
      } catch {}
    };
    ws.onerror = () => setFootprintStatus('idle');
    ws.onclose = () => setFootprintStatus('idle');
    return () => {
      ws.close();
      setFootprintStatus('idle');
      setFootprintCandles([]);
    };
  }, [exchange, symbol, backendWs]);

  // Order book walls websocket (real-time resting limit orders)
  useEffect(() => {
    setOrderbookStatus('loading');
    const baseWs = backendWs.replace(/\/ws\/screener.*$/, '');
    const wsUrl = `${baseWs}/ws/orderbook/${exchange}/${symbol}`;
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => setOrderbookStatus('connected');
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'init' || msg.type === 'walls_update') {
          const data = msg.data || {};
          // Scalping walls (close to price)
          setOrderbookWalls({
            support: data.support || [],
            resistance: data.resistance || []
          });
          // Swing trading walls (further from price, clustered)
          setSwingWalls({
            support: data.swing_support || [],
            resistance: data.swing_resistance || []
          });
          setOrderbookImbalance({
            bid_ratio: data.bid_ratio || 0.5,
            imbalance: data.imbalance || 'NEUTRAL',
            mid_price: data.mid_price || null,
            spread: data.spread || null
          });
        }
      } catch {}
    };
    ws.onerror = () => setOrderbookStatus('idle');
    ws.onclose = () => setOrderbookStatus('idle');
    
    return () => {
      ws.close();
      setOrderbookStatus('idle');
      setOrderbookWalls({ support: [], resistance: [] });
    };
  }, [exchange, symbol, backendWs]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        onNavigate(-1);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        onNavigate(1);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, onNavigate]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
  };

  return (
    <div className="modalOverlay" onClick={onClose} style={{ padding: '20px', alignItems: 'center', overflow: 'auto' }}>
      <div className="panel modalSheet" onClick={(e) => e.stopPropagation()} style={{ 
        width: '100%', 
        maxWidth: '1200px',
        height: 'auto',
        maxHeight: '90vh',
        margin: '0 auto',
        borderRadius: '12px',
        overflowX: 'hidden',
        overflowY: 'auto',
        boxSizing: 'border-box'
      } as any}>
        <div className="toolbar" style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(12,19,30,0.98)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)', padding: '12px 12px', boxSizing: 'border-box', width: '100%', maxWidth: '100vw' }}>
          <div className="modalHandle" />
          <div className="group" style={{ gap: 12, alignItems: 'center', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={"star " + (isFav ? 'active' : '')} onClick={onToggleFav} title="Toggle favorite" style={{ fontSize: 18, cursor: 'pointer' }}>
                ★
              </span>
              <strong style={{ fontSize: 20, fontWeight: 700 }}>{symbol}</strong>
              <span className="badge" style={{ fontSize: 11 }}>{exchange}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="badge" style={{ fontSize: 13, fontWeight: 600 }}>
                ${fmt(row.last_price)}
              </div>
              <div className={`badge ${pctClass(row.change_5m)}`} style={{ fontSize: 12 }}>
                5m: {fmtPct(row.change_5m)}
              </div>
              <div className={`badge ${signalClass(row.signal_strength)}`} style={{ fontSize: 12 }}>
                {fmtSignal(row.signal_score, row.signal_strength)}
              </div>
            </div>
          </div>
          <div className="group" style={{ gap: 6 }}>
            <button className="button" onClick={() => onNavigate(-1)} title="Previous (←)" style={{ padding: '6px 12px' }}>
              ←
            </button>
            <button className="button" onClick={() => onNavigate(1)} title="Next (→)" style={{ padding: '6px 12px' }}>
              →
            </button>
            <button className="button" onClick={() => copy(symbol)} title="Copy symbol">
              Copy
            </button>
            <a className="button" href={tvUrl} target="_blank" rel="noreferrer" title="Open in TradingView">
              Chart
            </a>
            {onQuickAddToPortfolio && (
              <button className="button" onClick={onQuickAddToPortfolio} title="Add to portfolio">
                + Position
              </button>
            )}
            <button className="button" onClick={onClose} style={{ fontWeight: 600 }} title="Close (Esc)">
              ✕
            </button>
          </div>
        </div>
        
        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', padding: '0 8px', background: 'var(--bg-secondary)', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }} className="hide-scrollbar">
          <button 
            className="button"
            onClick={() => setActiveTab('overview')}
            style={{ 
              border: 'none',
              borderBottom: activeTab === 'overview' ? '2px solid var(--accent, #4a9eff)' : '2px solid transparent',
              borderRadius: 0,
              padding: '12px 14px',
              marginBottom: '-2px',
              fontWeight: activeTab === 'overview' ? 600 : 400,
              background: 'transparent',
              opacity: activeTab === 'overview' ? 1 : 0.6,
              whiteSpace: 'nowrap',
              fontSize: 13
            }}
          >
            Overview
          </button>
          <button 
            className="button"
            onClick={() => setActiveTab('plan')}
            style={{ 
              border: 'none',
              borderBottom: activeTab === 'plan' ? '2px solid var(--accent, #4a9eff)' : '2px solid transparent',
              borderRadius: 0,
              padding: '12px 14px',
              marginBottom: '-2px',
              fontWeight: activeTab === 'plan' ? 600 : 400,
              background: 'transparent',
              opacity: activeTab === 'plan' ? 1 : 0.6,
              whiteSpace: 'nowrap',
              fontSize: 13
            }}
          >
            Plan
          </button>
          <button 
            className="button"
            onClick={() => setActiveTab('indicators')}
            style={{ 
              border: 'none',
              borderBottom: activeTab === 'indicators' ? '2px solid var(--accent, #4a9eff)' : '2px solid transparent',
              borderRadius: 0,
              padding: '12px 14px',
              marginBottom: '-2px',
              fontWeight: activeTab === 'indicators' ? 600 : 400,
              background: 'transparent',
              opacity: activeTab === 'indicators' ? 1 : 0.6,
              whiteSpace: 'nowrap',
              fontSize: 13
            }}
          >
            📊
          </button>
          <button 
            className="button"
            onClick={() => setActiveTab('news')}
            style={{ 
              border: 'none',
              borderBottom: activeTab === 'news' ? '2px solid var(--accent, #4a9eff)' : '2px solid transparent',
              borderRadius: 0,
              padding: '12px 14px',
              marginBottom: '-2px',
              fontWeight: activeTab === 'news' ? 600 : 400,
              background: 'transparent',
              opacity: activeTab === 'news' ? 1 : 0.6,
              whiteSpace: 'nowrap',
              fontSize: 13
            }}
          >
            📰
          </button>
        </div>

        <div style={{ padding: 16 }}>
            {activeTab === 'overview' && (
              <div style={{ padding: 12, boxSizing: 'border-box', width: '100%', maxWidth: '100vw', overflowX: 'hidden' }}>
                {/* Key Metrics Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
                  <div className="card" style={{ padding: 12 }}>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Price Changes</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span>1m</span>
                        <span className={pctClass(row.change_1m)} style={{ fontWeight: 600 }}>{fmtPct(row.change_1m)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span>5m</span>
                        <span className={pctClass(row.change_5m)} style={{ fontWeight: 600 }}>{fmtPct(row.change_5m)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span>15m</span>
                        <span className={pctClass(row.change_15m)} style={{ fontWeight: 600 }}>{fmtPct(row.change_15m)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span>60m</span>
                        <span className={pctClass(row.change_60m)} style={{ fontWeight: 600 }}>{fmtPct(row.change_60m)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span>1d</span>
                        <span className={pctClass(row.change_1d)} style={{ fontWeight: 600 }}>{fmtPct(row.change_1d)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="card" style={{ padding: 12 }}>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Momentum</div>
                    <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }} className={momentumClass(row.momentum_score)}>
                      {fmtMomentum(row.momentum_score)}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
                      <div className="muted">5m: {fmtPct(row.momentum_5m)}</div>
                      <div className="muted">15m: {fmtPct(row.momentum_15m)}</div>
                    </div>
                  </div>

                  <div className="card" style={{ padding: 12 }}>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Volatility</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div>
                        <div className="muted" style={{ fontSize: 11 }}>ATR</div>
                        <div style={{ fontSize: 16, fontWeight: 600 }}>{fmt(row.atr)}</div>
                      </div>
                      <div>
                        <div className="muted" style={{ fontSize: 11 }}>Vol Z-Score</div>
                        <div style={{ fontSize: 16, fontWeight: 600 }}>{fmt(row.vol_zscore_1m)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="card" style={{ padding: 12 }}>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Open Interest</div>
                    <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{fmtOI(row.open_interest)}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
                      <div className={oiClass(row.oi_change_5m)}>5m: {fmtOIPct(row.oi_change_5m)}</div>
                      <div className={oiClass(row.oi_change_15m)}>15m: {fmtOIPct(row.oi_change_15m)}</div>
                      <div className={oiClass(row.oi_change_1h)}>1h: {fmtOIPct(row.oi_change_1h)}</div>
                      <div className={oiClass(row.oi_change_1d)}>1d: {fmtOIPct(row.oi_change_1d)}</div>
                    </div>
                  </div>
                </div>

                {/* Signals & Indicators Section */}
                {(row.cipher_buy || row.cipher_sell || row.percent_r_ob_reversal || row.percent_r_os_reversal || 
                  row.wt1 !== null || row.percent_r_fast !== null) && (
                  <div style={{ marginBottom: 16 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 8, fontWeight: 600 }}>📊 Active Signals & Indicators</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      
                      {/* Cipher B Card */}
                      {(row.wt1 !== null || row.cipher_buy || row.cipher_sell) && (
                        <div className="card" style={{ padding: 12, background: row.cipher_buy ? 'rgba(42, 157, 143, 0.1)' : row.cipher_sell ? 'rgba(231, 111, 81, 0.1)' : 'rgba(0,0,0,0.2)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>Cipher B (WaveTrend)</span>
                            {row.cipher_source_tf && (
                              <span className="badge" style={{ fontSize: 10, padding: '2px 6px' }}>{row.cipher_source_tf}</span>
                            )}
                            {row.cipher_buy && <span style={{ fontSize: 18 }}>🟢</span>}
                            {row.cipher_sell && <span style={{ fontSize: 18 }}>🔴</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 16, marginBottom: 6, fontSize: 13 }}>
                            {row.wt1 !== null && row.wt1 !== undefined && (
                              <div>
                                <span className="muted">WT1: </span>
                                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{row.wt1.toFixed(1)}</span>
                              </div>
                            )}
                            {row.wt2 !== null && row.wt2 !== undefined && (
                              <div>
                                <span className="muted">WT2: </span>
                                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{row.wt2.toFixed(1)}</span>
                              </div>
                            )}
                          </div>
                          {row.cipher_reason && (
                            <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic', lineHeight: 1.4 }}>
                              {row.cipher_reason}
                            </div>
                          )}
                        </div>
                      )}

                      {/* %R Trend Exhaustion Card */}
                      {(row.percent_r_fast !== null || row.percent_r_ob_reversal || row.percent_r_os_reversal) && (
                        <div className="card" style={{ padding: 12, background: row.percent_r_os_reversal ? 'rgba(6, 214, 160, 0.1)' : row.percent_r_ob_reversal ? 'rgba(239, 71, 111, 0.1)' : 'rgba(0,0,0,0.2)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>%R Trend Exhaustion</span>
                            {row.percent_r_source_tf && (
                              <span className="badge" style={{ fontSize: 10, padding: '2px 6px' }}>{row.percent_r_source_tf}</span>
                            )}
                            {row.percent_r_os_reversal && <span style={{ fontSize: 18 }}>🟢</span>}
                            {row.percent_r_ob_reversal && <span style={{ fontSize: 18 }}>🔴</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 16, marginBottom: 6, fontSize: 13 }}>
                            {row.percent_r_fast !== null && row.percent_r_fast !== undefined && (
                              <div>
                                <span className="muted">Fast: </span>
                                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{row.percent_r_fast.toFixed(1)}</span>
                              </div>
                            )}
                            {row.percent_r_slow !== null && row.percent_r_slow !== undefined && (
                              <div>
                                <span className="muted">Slow: </span>
                                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{row.percent_r_slow.toFixed(1)}</span>
                              </div>
                            )}
                          </div>
                          {row.percent_r_reason && (
                            <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic', lineHeight: 1.4 }}>
                              {row.percent_r_reason}
                            </div>
                          )}
                        </div>
                      )}

                    </div>
                  </div>
                )}

                {/* Price Charts */}
                <div style={{ marginTop: 8 }}>
                  <div 
                    className="collapsible-header" 
                    onClick={() => toggleSection('charts')}
                  >
                    <span className="collapsible-title">📈 Price & OI Charts</span>
                    <span className={`collapsible-toggle ${collapsedSections['charts'] ? '' : 'expanded'}`}>▼</span>
                  </div>
                  <div className={`collapsible-content ${collapsedSections['charts'] ? 'collapsed' : 'expanded'}`}>
                    <div className="chartsGrid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                      <style jsx>{`
                        @media (min-width: 640px) {
                          .chartsGrid {
                            grid-template-columns: 1fr 1fr !important;
                          }
                        }
                      `}</style>
                      <div className="card" style={{ padding: 12 }}>
                        <div className="muted" style={{ marginBottom: 8, fontSize: 12, fontWeight: 600 }}>
                          Last 60 x 1m closes {loading ? '(loading...)' : ''}
                        </div>
                        <Sparkline data={closes || []} />
                      </div>
                      <div className="card" style={{ padding: 12 }}>
                        <div className="muted" style={{ marginBottom: 8, fontSize: 12, fontWeight: 600 }}>
                          Open Interest Δ (last 60)
                        </div>
                        <Sparkline data={toDeltaSeries(oi || [])} color={deltaColor(oi || [])} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Funding Rate Section */}
                {fundingLoading ? (
                  <div style={{ marginTop: 16 }}>
                    <div className="muted" style={{ fontSize: 12 }}>Loading funding rate...</div>
                  </div>
                ) : fundingRate !== null && fundingRate !== undefined ? (
                  <div style={{ marginTop: 16 }}>
                    <div 
                      className="collapsible-header" 
                      onClick={() => toggleSection('funding')}
                    >
                      <span className="collapsible-title">💰 Funding Rate (Perpetual)</span>
                      <span className={`collapsible-toggle ${collapsedSections['funding'] ? '' : 'expanded'}`}>▼</span>
                    </div>
                    <div className={`collapsible-content ${collapsedSections['funding'] ? 'collapsed' : 'expanded'}`}>
                    <div className="card" style={{ padding: 16, background: 'rgba(0,0,0,0.2)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Current Rate (8h)</div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: fundingRate >= 0 ? '#e76f51' : '#2a9d8f' }}>
                            {fundingRate >= 0 ? '+' : ''}{(fundingRate * 100).toFixed(4)}%
                          </div>
                          <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                            {fundingRate >= 0 ? 'Longs pay shorts 💸' : 'Shorts pay longs 💰'}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Annualized (APR)</div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: fundingRateAnnual && fundingRateAnnual >= 0 ? '#e76f51' : '#2a9d8f' }}>
                            {fundingRateAnnual !== null && fundingRateAnnual !== undefined ? (
                              `${fundingRateAnnual >= 0 ? '+' : ''}${fundingRateAnnual.toFixed(2)}%`
                            ) : '—'}
                          </div>
                          <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                            3x daily funding
                          </div>
                        </div>
                        {nextFundingTime && (
                          <div>
                            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Next Funding</div>
                            <div style={{ fontSize: 16, fontWeight: 600 }}>
                              {new Date(nextFundingTime).toLocaleTimeString()}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#4a9eff', marginTop: 2 }}>
                              {(() => {
                                const now = Date.now();
                                const diff = nextFundingTime - now;
                                const hours = Math.floor(diff / (1000 * 60 * 60));
                                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                                return `⏱ ${hours}h ${minutes}m`;
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    </div>
                  </div>
                ) : null}

                {/* Long/Short Ratio Section */}
                {longShortRatio && (
                  <div style={{ marginTop: 16 }}>
                    <div 
                      className="collapsible-header" 
                      onClick={() => toggleSection('lsratio')}
                    >
                      <span className="collapsible-title">📊 Long/Short Ratio</span>
                      <span className={`collapsible-toggle ${collapsedSections['lsratio'] ? '' : 'expanded'}`}>▼</span>
                    </div>
                    <div className={`collapsible-content ${collapsedSections['lsratio'] ? 'collapsed' : 'expanded'}`}>
                    <div className="card" style={{ padding: 16, background: 'rgba(0,0,0,0.2)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* Visual Bar */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 4 }}>
                            <span>Longs ({(longShortRatio.long_ratio * 100).toFixed(1)}%)</span>
                            <span>Shorts ({(longShortRatio.short_ratio * 100).toFixed(1)}%)</span>
                          </div>
                          <div style={{ 
                            display: 'flex', 
                            height: 24, 
                            borderRadius: 4, 
                            overflow: 'hidden',
                            background: 'rgba(0,0,0,0.3)'
                          }}>
                            <div style={{ 
                              width: `${longShortRatio.long_ratio * 100}%`, 
                              background: 'linear-gradient(90deg, #2a9d8f, #40c9a2)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 11,
                              fontWeight: 600,
                              color: '#fff',
                              textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                            }}>
                              {longShortRatio.long_ratio >= 0.15 ? `${(longShortRatio.long_ratio * 100).toFixed(0)}%` : ''}
                            </div>
                            <div style={{ 
                              width: `${longShortRatio.short_ratio * 100}%`, 
                              background: 'linear-gradient(90deg, #e76f51, #f4845f)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 11,
                              fontWeight: 600,
                              color: '#fff',
                              textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                            }}>
                              {longShortRatio.short_ratio >= 0.15 ? `${(longShortRatio.short_ratio * 100).toFixed(0)}%` : ''}
                            </div>
                          </div>
                        </div>
                        
                        {/* Ratio Value */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>L/S Ratio</div>
                            <div style={{ 
                              fontSize: 28, 
                              fontWeight: 700, 
                              color: longShortRatio.long_short_ratio > 1 ? '#2a9d8f' : longShortRatio.long_short_ratio < 1 ? '#e76f51' : 'var(--text)'
                            }}>
                              {longShortRatio.long_short_ratio.toFixed(2)}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Sentiment</div>
                            <div style={{ 
                              fontSize: 14, 
                              fontWeight: 600,
                              color: longShortRatio.long_short_ratio > 1.2 ? '#2a9d8f' : 
                                     longShortRatio.long_short_ratio < 0.8 ? '#e76f51' : '#f4a261'
                            }}>
                              {longShortRatio.long_short_ratio > 1.5 ? '🐂 Very Bullish' :
                               longShortRatio.long_short_ratio > 1.2 ? '🐂 Bullish' :
                               longShortRatio.long_short_ratio > 0.8 ? '⚖️ Neutral' :
                               longShortRatio.long_short_ratio > 0.5 ? '🐻 Bearish' : '🐻 Very Bearish'}
                            </div>
                          </div>
                        </div>
                        
                        {/* Contrarian Warning */}
                        {(longShortRatio.long_short_ratio > 2 || longShortRatio.long_short_ratio < 0.5) && (
                          <div style={{ 
                            padding: '8px 12px', 
                            background: 'rgba(244, 162, 97, 0.15)', 
                            borderRadius: 6,
                            fontSize: 11,
                            color: '#f4a261',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6
                          }}>
                            <span>⚠️</span>
                            <span>
                              {longShortRatio.long_short_ratio > 2 
                                ? 'Extreme long bias - potential squeeze risk for longs'
                                : 'Extreme short bias - potential squeeze risk for shorts'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    </div>
                  </div>
                )}

                {/* Liquidations Section */}
                {(liquidationSummary && liquidationSummary.recent_count > 0) && (
                  <div style={{ marginTop: 16 }}>
                    <div 
                      className="collapsible-header" 
                      onClick={() => toggleSection('liquidations')}
                    >
                      <span className="collapsible-title">💥 Recent Liquidations ({liquidationSummary.recent_count})</span>
                      <span className={`collapsible-toggle ${collapsedSections['liquidations'] ? '' : 'expanded'}`}>▼</span>
                    </div>
                    <div className={`collapsible-content ${collapsedSections['liquidations'] ? 'collapsed' : 'expanded'}`}>
                    <div className="card" style={{ padding: 16, background: 'rgba(0,0,0,0.2)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* Summary Stats */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Total</div>
                            <div style={{ fontSize: 20, fontWeight: 700 }}>{liquidationSummary.recent_count}</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: '#2a9d8f', marginBottom: 4 }}>Long Liqs</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: '#2a9d8f' }}>{liquidationSummary.long_liq_count}</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: '#e76f51', marginBottom: 4 }}>Short Liqs</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: '#e76f51' }}>{liquidationSummary.short_liq_count}</div>
                          </div>
                        </div>
                        
                        {/* Value Bar */}
                        {liquidationSummary.total_value_usd > 0 && (
                          <div>
                            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                              Total Value: ${(liquidationSummary.total_value_usd / 1000).toFixed(1)}K
                            </div>
                            <div style={{ 
                              display: 'flex', 
                              height: 16, 
                              borderRadius: 4, 
                              overflow: 'hidden',
                              background: 'rgba(0,0,0,0.3)'
                            }}>
                              {liquidationSummary.long_liq_value > 0 && (
                                <div style={{ 
                                  width: `${(liquidationSummary.long_liq_value / liquidationSummary.total_value_usd) * 100}%`, 
                                  background: '#2a9d8f',
                                  minWidth: 2
                                }} />
                              )}
                              {liquidationSummary.short_liq_value > 0 && (
                                <div style={{ 
                                  width: `${(liquidationSummary.short_liq_value / liquidationSummary.total_value_usd) * 100}%`, 
                                  background: '#e76f51',
                                  minWidth: 2
                                }} />
                              )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888', marginTop: 4 }}>
                              <span style={{ color: '#2a9d8f' }}>${(liquidationSummary.long_liq_value / 1000).toFixed(1)}K longs</span>
                              <span style={{ color: '#e76f51' }}>${(liquidationSummary.short_liq_value / 1000).toFixed(1)}K shorts</span>
                            </div>
                          </div>
                        )}
                        
                        {/* Recent Liquidations List */}
                        {liquidations && liquidations.length > 0 && (
                          <div>
                            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Recent Events</div>
                            <div style={{ 
                              maxHeight: 150, 
                              overflowY: 'auto',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4
                            }}>
                              {liquidations.slice(0, 10).map((liq, idx) => (
                                <div 
                                  key={idx}
                                  style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    padding: '6px 8px',
                                    background: 'rgba(0,0,0,0.2)',
                                    borderRadius: 4,
                                    fontSize: 12
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ 
                                      width: 6, 
                                      height: 6, 
                                      borderRadius: '50%', 
                                      background: liq.side === 'SELL' ? '#2a9d8f' : '#e76f51'
                                    }} />
                                    <span style={{ color: liq.side === 'SELL' ? '#2a9d8f' : '#e76f51', fontWeight: 600 }}>
                                      {liq.side === 'SELL' ? 'LONG' : 'SHORT'}
                                    </span>
                                  </div>
                                  <span style={{ color: '#888' }}>${fmt(liq.price)}</span>
                                  <span style={{ fontWeight: 600 }}>${(liq.value_usd / 1000).toFixed(1)}K</span>
                                  <span style={{ color: '#666', fontSize: 10 }}>
                                    {new Date(liq.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    </div>
                  </div>
                )}

                {/* Liquidation Levels Heatmap */}
                <LiquidationHeatmap 
                  exchange={exchange}
                  symbol={symbol}
                  currentPrice={row.last_price}
                  initialLevels={liquidationLevels || []}
                  initialLiquidations={liquidations || []}
                  wsUrl={backendWs}
                />

              </div>
            )}

            {activeTab === 'plan' && (
              <div style={{ padding: 12, boxSizing: 'border-box', width: '100%', maxWidth: '100vw', overflowX: 'hidden' }}>
                {/* Trade Plan Section */}
                {plan ? (
                  <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600 }}>Trade Plan</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                      <div>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Side</div>
                        <div className={plan.side === 'LONG' ? 'chgUp' : 'chgDown'} style={{ fontSize: 18, fontWeight: 700 }}>
                          {String(plan.side)}
                        </div>
                      </div>
                      <div>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Entry</div>
                        <div style={{ fontSize: 16, fontWeight: 600 }}>{fmt(plan.entry_price)}</div>
                      </div>
                      <div>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Stop Loss</div>
                        <div className="chgDown" style={{ fontSize: 16, fontWeight: 600 }}>{fmt(plan.stop_loss)}</div>
                      </div>
                      <div>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Take Profit 1</div>
                        <div className="chgUp" style={{ fontSize: 16, fontWeight: 600 }}>{fmt(plan.tp1)}</div>
                      </div>
                      <div>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Take Profit 2</div>
                        <div className="chgUp" style={{ fontSize: 16, fontWeight: 600 }}>{fmt(plan.tp2)}</div>
                      </div>
                      <div>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Take Profit 3</div>
                        <div className="chgUp" style={{ fontSize: 16, fontWeight: 600 }}>{fmt(plan.tp3)}</div>
                      </div>
                      <div>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>ATR</div>
                        <div style={{ fontSize: 14 }}>{fmt(plan.atr)}</div>
                      </div>
                      <div>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>ATR Mult</div>
                        <div style={{ fontSize: 14 }}>{plan.atr_mult!=null ? String(plan.atr_mult) : '-'}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="card" style={{ padding: 16, marginBottom: 16, textAlign: 'center' }}>
                    <div className="muted">No trade plan available yet.</div>
                  </div>
                )}

                {/* Backtest Performance */}
                <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600 }}>Backtest Performance</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 8, fontWeight: 600 }}>30 Days</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span className="muted">Trades</span>
                          <span style={{ fontWeight: 600 }}>{bt30?.n_trades!=null ? String(bt30.n_trades) : '-'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span className="muted">Win Rate</span>
                          <span style={{ fontWeight: 600 }}>{bt30?.win_rate!=null ? (bt30.win_rate*100).toFixed(1)+'%' : '-'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span className="muted">Avg R</span>
                          <span style={{ fontWeight: 600 }}>{bt30?.avg_r!=null ? Number(bt30.avg_r).toFixed(2) : '-'}</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 8, fontWeight: 600 }}>90 Days</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span className="muted">Trades</span>
                          <span style={{ fontWeight: 600 }}>{bt90?.n_trades!=null ? String(bt90.n_trades) : '-'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span className="muted">Win Rate</span>
                          <span style={{ fontWeight: 600 }}>{bt90?.win_rate!=null ? (bt90.win_rate*100).toFixed(1)+'%' : '-'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span className="muted">Avg R</span>
                          <span style={{ fontWeight: 600 }}>{bt90?.avg_r!=null ? Number(bt90.avg_r).toFixed(2) : '-'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  {/* Order Book Walls (Real-time from resting limit orders) */}
                  <div style={{ marginBottom: 16 }}>
                    <div className="muted" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                      📊 Order Book Walls
                      {orderbookStatus === 'connected' && (
                        <span style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(74, 158, 255, 0.3)', color: '#4a9eff', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4a9eff', animation: 'pulse 2s infinite' }} />
                          LIVE
                        </span>
                      )}
                      {orderbookStatus === 'loading' && (
                        <span style={{ fontSize: 10, color: '#888' }}>connecting...</span>
                      )}
                    </div>
                    
                    {/* Order Book Imbalance Indicator */}
                    {orderbookStatus === 'connected' && (
                      <div style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: '#888' }}>Book Imbalance</span>
                          <span style={{ 
                            fontSize: 11, 
                            fontWeight: 600,
                            color: orderbookImbalance.imbalance === 'BID' ? '#2a9d8f' : 
                                   orderbookImbalance.imbalance === 'ASK' ? '#e76f51' : '#888'
                          }}>
                            {orderbookImbalance.imbalance === 'BID' ? '🟢 Bid Heavy' : 
                             orderbookImbalance.imbalance === 'ASK' ? '🔴 Ask Heavy' : '⚖️ Balanced'}
                          </span>
                        </div>
                        <div style={{ 
                          height: 8, 
                          borderRadius: 4, 
                          background: 'rgba(0,0,0,0.3)',
                          display: 'flex',
                          overflow: 'hidden'
                        }}>
                          <div style={{ 
                            width: `${orderbookImbalance.bid_ratio * 100}%`, 
                            background: 'linear-gradient(90deg, #2a9d8f, #40c9a2)',
                            transition: 'width 0.3s ease'
                          }} />
                          <div style={{ 
                            width: `${(1 - orderbookImbalance.bid_ratio) * 100}%`, 
                            background: 'linear-gradient(90deg, #e76f51, #f4845f)',
                            transition: 'width 0.3s ease'
                          }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#666', marginTop: 4 }}>
                          <span>Bids {(orderbookImbalance.bid_ratio * 100).toFixed(0)}%</span>
                          <span>Asks {((1 - orderbookImbalance.bid_ratio) * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    )}
                    
                    {/* Support/Resistance Walls from Order Book */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {/* Support Walls (Bid Side) */}
                      <div style={{ background: 'rgba(42, 157, 143, 0.1)', borderRadius: 6, padding: 10, borderLeft: '3px solid #2a9d8f' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#2a9d8f', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                          🛡️ Support Walls (Bids)
                        </div>
                        {orderbookStatus !== 'connected' ? (
                          <div style={{ fontSize: 10, color: '#666' }}>Connecting...</div>
                        ) : orderbookWalls.support.length === 0 ? (
                          <div style={{ fontSize: 10, color: '#666' }}>No large bids detected</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {orderbookWalls.support.slice(0, 4).map((wall, idx) => (
                              <div key={idx} style={{ 
                                display: 'flex', 
                                flexDirection: 'column',
                                padding: '6px 8px',
                                background: 'rgba(42, 157, 143, 0.1)',
                                borderRadius: 4
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontWeight: 600, color: '#2a9d8f', fontSize: 12 }}>${fmt(wall.price)}</span>
                                  <span style={{ 
                                    background: 'rgba(42, 157, 143, 0.3)', 
                                    padding: '2px 6px', 
                                    borderRadius: 4, 
                                    fontSize: 10,
                                    fontWeight: 600
                                  }}>
                                    {wall.strength.toFixed(1)}x
                                  </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888', marginTop: 2 }}>
                                  <span>${(wall.value_usd / 1000).toFixed(0)}K</span>
                                  <span>{wall.distance_pct}% away</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      {/* Resistance Walls (Ask Side) */}
                      <div style={{ background: 'rgba(231, 111, 81, 0.1)', borderRadius: 6, padding: 10, borderLeft: '3px solid #e76f51' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#e76f51', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                          🧱 Resistance Walls (Asks)
                        </div>
                        {orderbookStatus !== 'connected' ? (
                          <div style={{ fontSize: 10, color: '#666' }}>Connecting...</div>
                        ) : orderbookWalls.resistance.length === 0 ? (
                          <div style={{ fontSize: 10, color: '#666' }}>No large asks detected</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {orderbookWalls.resistance.slice(0, 4).map((wall, idx) => (
                              <div key={idx} style={{ 
                                display: 'flex', 
                                flexDirection: 'column',
                                padding: '6px 8px',
                                background: 'rgba(231, 111, 81, 0.1)',
                                borderRadius: 4
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontWeight: 600, color: '#e76f51', fontSize: 12 }}>${fmt(wall.price)}</span>
                                  <span style={{ 
                                    background: 'rgba(231, 111, 81, 0.3)', 
                                    padding: '2px 6px', 
                                    borderRadius: 4, 
                                    fontSize: 10,
                                    fontWeight: 600
                                  }}>
                                    {wall.strength.toFixed(1)}x
                                  </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888', marginTop: 2 }}>
                                  <span>${(wall.value_usd / 1000).toFixed(0)}K</span>
                                  <span>{wall.distance_pct}% away</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Swing Trading Zones (Aggregated walls further from price) */}
                    {orderbookStatus === 'connected' && (swingWalls.support.length > 0 || swingWalls.resistance.length > 0) && (
                      <div style={{ marginTop: 12 }}>
                        <div className="muted" style={{ marginBottom: 8, fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                          📈 Swing Trading Zones
                          <span style={{ fontSize: 10, color: '#666' }}>(within 10% of price)</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          {/* Swing Support Zones */}
                          <div style={{ background: 'rgba(42, 157, 143, 0.05)', borderRadius: 6, padding: 10, border: '1px dashed rgba(42, 157, 143, 0.3)' }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#2a9d8f', marginBottom: 6, opacity: 0.8 }}>
                              Support Zones
                            </div>
                            {swingWalls.support.length === 0 ? (
                              <div style={{ fontSize: 10, color: '#666' }}>No zones detected</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {swingWalls.support.slice(0, 5).map((wall, idx) => (
                                  <div key={idx} style={{ 
                                    display: 'flex', 
                                    flexDirection: 'column',
                                    padding: '6px 8px',
                                    background: 'rgba(42, 157, 143, 0.1)',
                                    borderRadius: 4,
                                    borderLeft: wall.is_cluster ? '2px solid #2a9d8f' : 'none'
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ fontWeight: 600, color: '#2a9d8f', fontSize: 11 }}>${fmt(wall.price)}</span>
                                        {wall.is_cluster && (
                                          <span style={{ 
                                            background: 'rgba(42, 157, 143, 0.2)', 
                                            padding: '1px 4px', 
                                            borderRadius: 3, 
                                            fontSize: 9,
                                            color: '#2a9d8f'
                                          }}>
                                            {wall.cluster_count} orders
                                          </span>
                                        )}
                                      </div>
                                      <span style={{ 
                                        background: 'rgba(42, 157, 143, 0.3)', 
                                        padding: '2px 5px', 
                                        borderRadius: 4, 
                                        fontSize: 9,
                                        fontWeight: 600
                                      }}>
                                        {wall.strength.toFixed(1)}x
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#888', marginTop: 2 }}>
                                      <span>${wall.value_usd >= 1000000 ? (wall.value_usd / 1000000).toFixed(1) + 'M' : (wall.value_usd / 1000).toFixed(0) + 'K'}</span>
                                      <span>{wall.distance_pct}% below</span>
                                    </div>
                                    {wall.price_range && wall.price_range[0] !== wall.price_range[1] && (
                                      <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>
                                        Range: ${fmt(wall.price_range[0])} - ${fmt(wall.price_range[1])}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          
                          {/* Swing Resistance Zones */}
                          <div style={{ background: 'rgba(231, 111, 81, 0.05)', borderRadius: 6, padding: 10, border: '1px dashed rgba(231, 111, 81, 0.3)' }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#e76f51', marginBottom: 6, opacity: 0.8 }}>
                              Resistance Zones
                            </div>
                            {swingWalls.resistance.length === 0 ? (
                              <div style={{ fontSize: 10, color: '#666' }}>No zones detected</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {swingWalls.resistance.slice(0, 5).map((wall, idx) => (
                                  <div key={idx} style={{ 
                                    display: 'flex', 
                                    flexDirection: 'column',
                                    padding: '6px 8px',
                                    background: 'rgba(231, 111, 81, 0.1)',
                                    borderRadius: 4,
                                    borderLeft: wall.is_cluster ? '2px solid #e76f51' : 'none'
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ fontWeight: 600, color: '#e76f51', fontSize: 11 }}>${fmt(wall.price)}</span>
                                        {wall.is_cluster && (
                                          <span style={{ 
                                            background: 'rgba(231, 111, 81, 0.2)', 
                                            padding: '1px 4px', 
                                            borderRadius: 3, 
                                            fontSize: 9,
                                            color: '#e76f51'
                                          }}>
                                            {wall.cluster_count} orders
                                          </span>
                                        )}
                                      </div>
                                      <span style={{ 
                                        background: 'rgba(231, 111, 81, 0.3)', 
                                        padding: '2px 5px', 
                                        borderRadius: 4, 
                                        fontSize: 9,
                                        fontWeight: 600
                                      }}>
                                        {wall.strength.toFixed(1)}x
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#888', marginTop: 2 }}>
                                      <span>${wall.value_usd >= 1000000 ? (wall.value_usd / 1000000).toFixed(1) + 'M' : (wall.value_usd / 1000).toFixed(0) + 'K'}</span>
                                      <span>{wall.distance_pct}% above</span>
                                    </div>
                                    {wall.price_range && wall.price_range[0] !== wall.price_range[1] && (
                                      <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>
                                        Range: ${fmt(wall.price_range[0])} - ${fmt(wall.price_range[1])}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Order Flow Footprint */}
                  <div className="muted" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                    Order Flow (Footprint) – 1m
                    {footprintStatus === 'connected' && (
                      <span style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(42, 157, 143, 0.3)', color: '#2a9d8f', borderRadius: 4 }}>LIVE</span>
                    )}
                  </div>
                  
                  {footprintStatus === 'loading' && <div className="muted">Loading...</div>}
                  {footprintStatus === 'idle' && <div className="muted">Disconnected</div>}
                  {footprintStatus === 'connected' && footprintCandles.length === 0 && <div className="muted">No data yet</div>}
                  {footprintStatus === 'connected' && footprintCandles.length > 0 && (
                    <>
                      {/* CVD Chart */}
                      <div className="card" style={{ padding: 10, marginBottom: 8 }}>
                        <div style={{ fontSize: 11, marginBottom: 4, color: '#aaa' }}>CVD (Cumulative Volume Delta)</div>
                        <div style={{ position: 'relative', height: 60, background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                          <svg width="100%" height="60" style={{ display: 'block' }}>
                            {footprintCandles.slice(-30).map((c: any, i: number, arr: any[]) => {
                              if (i === 0) return null;
                              const x1 = ((i - 1) / (arr.length - 1)) * 100;
                              const x2 = (i / (arr.length - 1)) * 100;
                              const minCvd = Math.min(...arr.map((x: any) => x.cvd || 0));
                              const maxCvd = Math.max(...arr.map((x: any) => x.cvd || 0));
                              const range = maxCvd - minCvd || 1;
                              const y1 = 50 - (((arr[i - 1].cvd || 0) - minCvd) / range) * 40;
                              const y2 = 50 - (((c.cvd || 0) - minCvd) / range) * 40;
                              const color = (c.cvd || 0) >= 0 ? '#3ee145' : '#e13e3e';
                              return (
                                <line
                                  key={i}
                                  x1={`${x1}%`}
                                  y1={y1}
                                  x2={`${x2}%`}
                                  y2={y2}
                                  stroke={color}
                                  strokeWidth="2"
                                />
                              );
                            })}
                          </svg>
                          <div style={{ position: 'absolute', top: 2, right: 4, fontSize: 10, color: '#aaa' }}>
                            {(footprintCandles[footprintCandles.length - 1]?.cvd || 0).toFixed(2)}
                          </div>
                        </div>
                      </div>

                      {/* Footprint Table with Imbalance Highlighting */}
                      <div className="card" style={{ padding: 10, maxHeight: 300, overflowY: 'auto' }}>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                              <th style={{ textAlign: 'left', padding: 4 }}>Time</th>
                              <th style={{ textAlign: 'right', padding: 4 }}>Bid Vol</th>
                              <th style={{ textAlign: 'right', padding: 4 }}>Ask Vol</th>
                              <th style={{ textAlign: 'right', padding: 4 }}>Delta</th>
                              <th style={{ textAlign: 'right', padding: 4 }}>CVD</th>
                              <th style={{ textAlign: 'right', padding: 4 }}>Levels</th>
                            </tr>
                          </thead>
                          <tbody>
                            {footprintCandles.slice(-8).reverse().map((c: any, i: number) => {
                              const bid = c.bid || 0;
                              const ask = c.ask || 0;
                              const delta = c.delta || 0;
                              const cvd = c.cvd || 0;
                              const deltaColor = delta >= 0 ? '#3ee145' : '#e13e3e';
                              const cvdColor = cvd >= 0 ? '#3ee145' : '#e13e3e';
                              
                              // Imbalance detection: ratio > 3:1
                              const ratio = ask > 0 && bid > 0 ? Math.max(ask / bid, bid / ask) : 0;
                              const isImbalance = ratio > 3;
                              const imbalanceColor = ask > bid ? 'rgba(62, 225, 69, 0.15)' : 'rgba(225, 62, 62, 0.15)';
                              
                              return (
                                <tr 
                                  key={c.open_ts || i} 
                                  style={{ 
                                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                                    background: isImbalance ? imbalanceColor : 'transparent'
                                  }}
                                >
                                  <td style={{ padding: 4 }}>
                                    {new Date(c.open_ts).toLocaleTimeString()}
                                    {isImbalance && <span style={{ marginLeft: 4 }}>🔥</span>}
                                  </td>
                                  <td style={{ textAlign: 'right', padding: 4, color: '#e13e3e' }}>{bid.toFixed(2)}</td>
                                  <td style={{ textAlign: 'right', padding: 4, color: '#3ee145' }}>{ask.toFixed(2)}</td>
                                  <td style={{ textAlign: 'right', padding: 4, color: deltaColor, fontWeight: 600 }}>
                                    {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
                                  </td>
                                  <td style={{ textAlign: 'right', padding: 4, color: cvdColor, fontSize: 11 }}>
                                    {cvd >= 0 ? '+' : ''}{cvd.toFixed(2)}
                                  </td>
                                  <td style={{ textAlign: 'right', padding: 4 }} className="muted">{(c.levels || []).length}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'indicators' && (
              <div style={{ padding: 12, boxSizing: 'border-box', width: '100%', maxWidth: '100vw', overflowX: 'hidden' }}>
                {/* Multi-Timeframe Indicators Table (Swing/Position Trading) */}
                <div style={{ overflowX: 'auto' }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 12, fontWeight: 600 }}>
                    📊 Higher Timeframe Indicators (Swing/Position)
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ textAlign: 'left', padding: '8px 4px', fontSize: 11, color: '#888' }}>Indicator</th>
                        <th style={{ textAlign: 'center', padding: '8px 4px', fontSize: 11, color: '#888' }}>1h<br/><span style={{ fontSize: 9, opacity: 0.7 }}>Intraday</span></th>
                        <th style={{ textAlign: 'center', padding: '8px 4px', fontSize: 11, color: '#888' }}>4h<br/><span style={{ fontSize: 9, opacity: 0.7 }}>Swing</span></th>
                        <th style={{ textAlign: 'center', padding: '8px 4px', fontSize: 11, color: '#888' }}>1d<br/><span style={{ fontSize: 9, opacity: 0.7 }}>Position</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* RSI Row */}
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '10px 4px', fontWeight: 600 }}>
                          RSI (14)
                          <div style={{ fontSize: 10, color: '#666', fontWeight: 400 }}>Relative Strength</div>
                        </td>
                        {[
                          { val: (row as any).rsi_1h, label: '1h', candles: 15 },
                          { val: (row as any).rsi_4h, label: '4h', candles: 15 },
                          { val: (row as any).rsi_1d, label: '1d', candles: 15 },
                        ].map((tf, i) => (
                          <td key={i} style={{ textAlign: 'center', padding: '10px 4px' }}>
                            {tf.val !== null && tf.val !== undefined ? (
                              <div style={{ 
                                fontWeight: 700, 
                                fontSize: 15,
                                color: tf.val >= 70 ? 'var(--overbought)' : tf.val <= 30 ? 'var(--oversold)' : 'var(--text)' 
                              }}>
                                {tf.val.toFixed(1)}
                                <div style={{ fontSize: 9, fontWeight: 400, marginTop: 2 }}>
                                  {tf.val >= 70 ? '🔴 OB' : tf.val <= 30 ? '🟢 OS' : '⚪'}
                                </div>
                              </div>
                            ) : (
                              <span 
                                style={{ color: '#555', fontSize: 11, cursor: 'help' }}
                                title={`Collecting ${tf.label} candles... Need ${tf.candles}+ for RSI calculation`}
                              >
                                <span className="skeleton-loader" style={{ display: 'inline-block', width: 24, height: 14 }} />
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                      
                      {/* MACD Histogram Row */}
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '10px 4px', fontWeight: 600 }}>
                          MACD Hist
                          <div style={{ fontSize: 10, color: '#666', fontWeight: 400 }}>Momentum</div>
                        </td>
                        {[
                          { val: (row as any).macd_histogram_1h, label: '1h', candles: 35 },
                          { val: (row as any).macd_histogram_4h, label: '4h', candles: 35 },
                          { val: (row as any).macd_histogram_1d, label: '1d', candles: 35 },
                        ].map((tf, i) => (
                          <td key={i} style={{ textAlign: 'center', padding: '10px 4px' }}>
                            {tf.val !== null && tf.val !== undefined ? (
                              <div style={{ 
                                fontWeight: 700, 
                                fontSize: 14,
                                color: tf.val >= 0 ? 'var(--up)' : 'var(--down)' 
                              }}>
                                {tf.val >= 0 ? '+' : ''}{tf.val.toFixed(3)}
                                <div style={{ fontSize: 9, fontWeight: 400, marginTop: 2 }}>
                                  {tf.val > 0 ? '🟢 Bull' : '🔴 Bear'}
                                </div>
                              </div>
                            ) : (
                              <span 
                                style={{ color: '#555', fontSize: 11, cursor: 'help' }}
                                title={`Collecting ${tf.label} candles... Need ${tf.candles}+ for MACD calculation`}
                              >
                                <span className="skeleton-loader" style={{ display: 'inline-block', width: 24, height: 14 }} />
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                      
                      {/* Stochastic RSI %K Row */}
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '10px 4px', fontWeight: 600 }}>
                          Stoch RSI %K
                          <div style={{ fontSize: 10, color: '#666', fontWeight: 400 }}>Overbought/Oversold</div>
                        </td>
                        {[
                          { val: (row as any).stoch_k_1h, label: '1h', candles: 35 },
                          { val: (row as any).stoch_k_4h, label: '4h', candles: 35 },
                          { val: (row as any).stoch_k_1d, label: '1d', candles: 35 },
                        ].map((tf, i) => (
                          <td key={i} style={{ textAlign: 'center', padding: '10px 4px' }}>
                            {tf.val !== null && tf.val !== undefined ? (
                              <div style={{ 
                                fontWeight: 700, 
                                fontSize: 15,
                                color: tf.val >= 80 ? 'var(--overbought)' : tf.val <= 20 ? 'var(--oversold)' : 'var(--text)' 
                              }}>
                                {tf.val.toFixed(1)}
                                <div style={{ fontSize: 9, fontWeight: 400, marginTop: 2 }}>
                                  {tf.val >= 80 ? '🔴 OB' : tf.val <= 20 ? '🟢 OS' : '⚪'}
                                </div>
                              </div>
                            ) : (
                              <span 
                                style={{ color: '#555', fontSize: 11, cursor: 'help' }}
                                title={`Collecting ${tf.label} candles... Need ${tf.candles}+ for Stoch RSI calculation`}
                              >
                                <span className="skeleton-loader" style={{ display: 'inline-block', width: 24, height: 14 }} />
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                
                {/* Detailed Cards for 15m (Scalping Reference) */}
                <div style={{ marginTop: 20 }}>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>📈 15m Detailed View (Scalping)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {/* RSI Mini Card */}
                    <div className="card" style={{ padding: 10, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>RSI</div>
                      {row.rsi_14 != null ? (
                        <>
                          <div style={{ fontSize: 20, fontWeight: 700, color: row.rsi_14 >= 70 ? 'var(--overbought)' : row.rsi_14 <= 30 ? 'var(--oversold)' : 'var(--text)' }}>
                            {row.rsi_14.toFixed(1)}
                          </div>
                          <div style={{ marginTop: 4, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${row.rsi_14}%`, height: '100%', background: row.rsi_14 >= 70 ? 'var(--overbought)' : row.rsi_14 <= 30 ? 'var(--oversold)' : 'var(--accent)' }} />
                          </div>
                        </>
                      ) : (
                        <span style={{ color: '#555', cursor: 'help' }} title="Collecting 15m candles... Need 15+ for RSI">
                          <span className="skeleton-loader" style={{ display: 'inline-block', width: 32, height: 20, marginTop: 4 }} />
                        </span>
                      )}
                    </div>
                    
                    {/* MACD Mini Card */}
                    <div className="card" style={{ padding: 10, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>MACD</div>
                      {row.macd != null ? (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 700, color: (row.macd || 0) >= 0 ? 'var(--up)' : 'var(--down)' }}>
                            {row.macd.toFixed(3)}
                          </div>
                          <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                            Sig: {row.macd_signal?.toFixed(3) ?? '—'}
                          </div>
                        </>
                      ) : (
                        <span style={{ color: '#555', cursor: 'help' }} title="Collecting 15m candles... Need 35+ for MACD">
                          <span className="skeleton-loader" style={{ display: 'inline-block', width: 32, height: 20, marginTop: 4 }} />
                        </span>
                      )}
                    </div>
                    
                    {/* Stoch RSI Mini Card */}
                    <div className="card" style={{ padding: 10, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>Stoch RSI</div>
                      {row.stoch_k != null ? (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>
                            <span style={{ color: row.stoch_k >= 80 ? 'var(--overbought)' : row.stoch_k <= 20 ? 'var(--oversold)' : 'var(--text)' }}>
                              {row.stoch_k.toFixed(1)}
                            </span>
                            <span style={{ color: '#666', margin: '0 2px' }}>/</span>
                            <span style={{ color: (row.stoch_d || 0) >= 80 ? 'var(--overbought)' : (row.stoch_d || 0) <= 20 ? 'var(--oversold)' : 'var(--text)' }}>
                              {row.stoch_d?.toFixed(1) ?? '—'}
                            </span>
                          </div>
                          <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>%K / %D</div>
                        </>
                      ) : (
                        <span style={{ color: '#555', cursor: 'help' }} title="Collecting 15m candles... Need 35+ for Stoch RSI">
                          <span className="skeleton-loader" style={{ display: 'inline-block', width: 32, height: 20, marginTop: 4 }} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="muted" style={{ fontSize: 11, marginTop: 16, padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                  ℹ️ <strong>Multi-Timeframe Analysis:</strong> 15m cards for scalping entries, higher timeframes (1h/4h/1d) for swing & position trading context. OB = Overbought, OS = Oversold. Higher timeframes provide stronger signals but slower confirmation.
                </div>
                
                {/* Advanced Metrics Section */}
                <div style={{ marginTop: 24 }}>
                  <h4 style={{ margin: '0 0 16px 0', fontSize: 14, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>📊 Advanced Metrics</h4>
                  
                  {/* Money Flow Index - Multi Timeframe */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Money Flow Index (MFI) - Cipher B Style</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {/* 1h MFI */}
                      <div style={{ background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 6, textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>1H</div>
                        {row.mfi_1h !== null && row.mfi_1h !== undefined ? (
                          <>
                            <div style={{ 
                              fontSize: 16, 
                              fontWeight: 700, 
                              color: row.mfi_1h > 20 ? '#10b981' : row.mfi_1h < -20 ? '#ef4444' : '#888' 
                            }}>
                              {row.mfi_1h > 0 ? '+' : ''}{row.mfi_1h.toFixed(1)}
                            </div>
                            <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>
                              {row.mfi_1h > 20 ? '🟢 Buying' : row.mfi_1h < -20 ? '🔴 Selling' : '⚪ Neutral'}
                            </div>
                          </>
                        ) : (
                          <div className="muted" style={{ fontSize: 11 }}>-</div>
                        )}
                      </div>
                      
                      {/* 15m MFI */}
                      <div style={{ background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 6, textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>15M</div>
                        {row.mfi_15m !== null && row.mfi_15m !== undefined ? (
                          <>
                            <div style={{ 
                              fontSize: 16, 
                              fontWeight: 700, 
                              color: row.mfi_15m > 20 ? '#10b981' : row.mfi_15m < -20 ? '#ef4444' : '#888' 
                            }}>
                              {row.mfi_15m > 0 ? '+' : ''}{row.mfi_15m.toFixed(1)}
                            </div>
                            <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>
                              {row.mfi_15m > 20 ? '🟢 Buying' : row.mfi_15m < -20 ? '🔴 Selling' : '⚪ Neutral'}
                            </div>
                          </>
                        ) : (
                          <div className="muted" style={{ fontSize: 11 }}>Need data</div>
                        )}
                      </div>
                      
                      {/* 4h MFI */}
                      <div style={{ background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 6, textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>4H</div>
                        {row.mfi_4h !== null && row.mfi_4h !== undefined ? (
                          <>
                            <div style={{ 
                              fontSize: 16, 
                              fontWeight: 700, 
                              color: row.mfi_4h > 20 ? '#10b981' : row.mfi_4h < -20 ? '#ef4444' : '#888' 
                            }}>
                              {row.mfi_4h > 0 ? '+' : ''}{row.mfi_4h.toFixed(1)}
                            </div>
                            <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>
                              {row.mfi_4h > 20 ? '🟢 Buying' : row.mfi_4h < -20 ? '🔴 Selling' : '⚪ Neutral'}
                            </div>
                          </>
                        ) : (
                          <div className="muted" style={{ fontSize: 11 }}>Need data</div>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: '#555', marginTop: 6, textAlign: 'center' }}>
                      MFI shows buying/selling pressure based on where price closes within the candle range
                    </div>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                    
                    {/* MTF Confluence */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>MTF Confluence <span style={{ color: '#555' }}>(1m/15m/4h)</span></div>
                      {row.mtf_summary ? (
                        <>
                          <div style={{ 
                            fontSize: 14, 
                            fontWeight: 700, 
                            color: (row.mtf_bull_count || 0) > (row.mtf_bear_count || 0) ? '#10b981' : (row.mtf_bear_count || 0) > (row.mtf_bull_count || 0) ? '#ef4444' : '#888'
                          }}>
                            {row.mtf_summary}
                          </div>
                          <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
                            {(row.mtf_bull_count || 0) >= 4 ? '✅ Strong bullish' : (row.mtf_bear_count || 0) >= 4 ? '⚠️ Strong bearish' : 'Mixed signals'}
                          </div>
                        </>
                      ) : (
                        <div className="muted">Calculating...</div>
                      )}
                    </div>
                    
                    {/* Volatility Percentile */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Volatility Percentile <span style={{ color: '#555' }}>(1m ATR)</span></div>
                      {row.volatility_percentile !== null && row.volatility_percentile !== undefined ? (
                        <>
                          <div style={{ 
                            fontSize: 18, 
                            fontWeight: 700, 
                            color: row.volatility_percentile > 80 ? '#f59e0b' : row.volatility_percentile < 20 ? '#3b82f6' : '#888'
                          }}>
                            {row.volatility_percentile.toFixed(0)}%
                          </div>
                          <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
                            {row.volatility_percentile > 80 ? '🔥 High vol' : row.volatility_percentile < 20 ? '💤 Low vol' : '📊 Normal'}
                          </div>
                        </>
                      ) : (
                        <div className="muted">Need data...</div>
                      )}
                    </div>

                    {/* Volatility Due (Squeeze) */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                        Volatility Due <span style={{ color: '#555' }}>(Squeeze)</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                          <span>15m</span>
                          <span style={{ fontWeight: 700, color: row.vol_due_15m ? '#10b981' : '#666' }}>
                            {row.vol_due_15m ? 'ON' : '—'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                          <span>4h</span>
                          <span style={{ fontWeight: 700, color: row.vol_due_4h ? '#10b981' : '#666' }}>
                            {row.vol_due_4h ? 'ON' : '—'}
                          </span>
                        </div>

                        {(row.vol_due_15m || row.vol_due_4h) && (
                          <div style={{ fontSize: 10, color: '#888', marginTop: 2, lineHeight: 1.35 }}>
                            {row.vol_due_source_tf ? `Triggered: ${row.vol_due_source_tf}` : null}
                            {row.vol_due_reason ? (
                              <div style={{ marginTop: 4, fontStyle: 'italic' }}>{row.vol_due_reason}</div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Time Since Signal */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Signal Age</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                          <span>Cipher B:</span>
                          <span style={{ 
                            fontWeight: 600, 
                            color: row.cipher_signal_age_ms && row.cipher_signal_age_ms < 300000 ? '#10b981' : '#888'
                          }}>
                            {row.cipher_signal_age_ms ? (
                              row.cipher_signal_age_ms < 60000 ? `${Math.floor(row.cipher_signal_age_ms / 1000)}s` :
                              row.cipher_signal_age_ms < 3600000 ? `${Math.floor(row.cipher_signal_age_ms / 60000)}m` :
                              `${Math.floor(row.cipher_signal_age_ms / 3600000)}h`
                            ) : '-'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                          <span>%R:</span>
                          <span style={{ 
                            fontWeight: 600, 
                            color: row.percent_r_signal_age_ms && row.percent_r_signal_age_ms < 300000 ? '#10b981' : '#888'
                          }}>
                            {row.percent_r_signal_age_ms ? (
                              row.percent_r_signal_age_ms < 60000 ? `${Math.floor(row.percent_r_signal_age_ms / 1000)}s` :
                              row.percent_r_signal_age_ms < 3600000 ? `${Math.floor(row.percent_r_signal_age_ms / 60000)}m` :
                              `${Math.floor(row.percent_r_signal_age_ms / 3600000)}h`
                            ) : '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                  </div>
                  
                  {/* Sector Tags */}
                  {row.sector_tags && row.sector_tags.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Sector Tags</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {row.sector_tags.map((tag: string, i: number) => (
                          <span 
                            key={i}
                            style={{ 
                              padding: '3px 8px', 
                              background: tag.includes('Top 10') ? 'rgba(16, 185, 129, 0.2)' : tag.includes('Top 20') ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.1)', 
                              borderRadius: 4, 
                              fontSize: 10, 
                              fontWeight: 600,
                              color: tag.includes('Top') ? '#fff' : '#aaa'
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                </div>
              </div>
            )}

            {activeTab === 'news' && (
              <div style={{ padding: 12, boxSizing: 'border-box', width: '100%', maxWidth: '100vw', overflowX: 'hidden' }}>
                {newsLoading && (
                  <div className="card" style={{ padding: 32, textAlign: 'center' }}>
                    <div className="muted">Loading news articles...</div>
                  </div>
                )}
                {!newsLoading && (!news || news.length === 0) && (
                  <div className="card" style={{ padding: 32, textAlign: 'center' }}>
                    <div className="muted">No news articles found</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                      Unable to fetch news at this time. Please try again later.
                    </div>
                  </div>
                )}
                {news && news.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {news.map((article) => (
                      <div key={article.id} className="card" style={{ padding: 16, cursor: 'pointer' }} 
                           onClick={() => window.open(article.url, '_blank')}>
                        <div style={{ display: 'flex', gap: 12 }}>
                          {article.image_url && (
                            <div style={{ width: 80, height: 80, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: 'var(--border)' }}>
                              <img 
                                src={article.image_url} 
                                alt="" 
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => e.currentTarget.style.display = 'none'}
                              />
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <h4 style={{ margin: '0 0 6px 0', fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>
                              {article.title}
                            </h4>
                            <div className="muted" style={{ fontSize: 11, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span style={{ fontWeight: 600 }}>{article.source}</span>
                              <span>•</span>
                              <span>{new Date(article.published * 1000).toLocaleDateString()} {new Date(article.published * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            </div>
                            <p style={{ fontSize: 13, margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {article.body}
                            </p>
                            {article.tags && article.tags.length > 0 && (
                              <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {article.tags.slice(0, 4).map((tag, i) => (
                                  <span key={i} className="badge" style={{ fontSize: 10, padding: '2px 6px' }}>
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 10 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        {label}
      </div>
      <div className={className} style={{ fontSize: 14, fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

function fmtPct(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  const v = n*100;
  const sign = v>0?'+':'';
  return sign + v.toFixed(2) + '%';
}

function fmtMomentum(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(1);
}

function fmtOI(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  // Format large numbers with K, M, B suffixes
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}

function fmtOIPct(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  const v = n * 100;
  const sign = v > 0 ? '+' : '';
  return sign + v.toFixed(2) + '%';
}

function fmtMarketCap(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function momentumClass(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return 'muted';
  if (n > 50) return 'momentumStrong';
  if (n > 20) return 'chgUp';
  if (n < -50) return 'momentumWeak';
  if (n < -20) return 'chgDown';
  return 'muted';
}

function oiClass(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return 'muted';
  // OI increasing (positive) is typically bullish, decreasing is bearish
  if (n > 0.02) return 'chgUp';  // > 2% increase
  if (n < -0.02) return 'chgDown'; // > 2% decrease
  return 'muted';
}

function signalClass(strength?: string | null) {
  if (!strength) return 'muted';
  switch(strength) {
    case 'strong_bull': return 'signalStrongBull';
    case 'bull': return 'signalBull';
    case 'bear': return 'signalBear';
    case 'strong_bear': return 'signalStrongBear';
    default: return 'muted';
  }
}

function fmtImpulse(score?: number | null, dir?: number | null){
  if (score === undefined || score === null || Number.isNaN(score)) return '-';
  const arrow = dir === 1 ? '↑' : dir === -1 ? '↓' : '';
  return `${arrow}${score.toFixed(0)}`;
}

function fmtSignal(score?: number | null, strength?: string | null) {
  if (score === undefined || score === null || Number.isNaN(score)) return '-';
  
  let emoji = '';
  switch(strength) {
    case 'strong_bull':
      emoji = '🔥🔥🔥';
      break;
    case 'bull':
      emoji = '🔥🔥';
      break;
    case 'bear':
      emoji = '❄️❄️';
      break;
    case 'strong_bear':
      emoji = '❄️❄️❄️';
      break;
    default:
      emoji = '➖';
  }
  
  const sign = score > 0 ? '+' : '';
  return `${emoji} ${sign}${score.toFixed(0)}`;
}

// Utility Components for UX Fixes

function SkeletonLoader({ width = '100%', height = 20 }: { width?: string | number; height?: number }) {
  return (
    <div 
      className="skeleton-loader"
      style={{ 
        width,
        height,
      }}
    />
  );
}

function Toast({ message, type = 'success', onClose }: { 
  message: string; 
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`toast toast-${type}`}>
      {message}
    </div>
  );
}
