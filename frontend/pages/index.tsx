import { useEffect, useMemo, useRef, useState } from 'react';

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
  | 'market_cap'
  | 'atr'
  | 'vol_zscore_1m'
  | 'last_price'
  | 'symbol'
  | 'momentum_score'
  | 'oi_change_5m'
  | 'open_interest'
  | 'signal_score'
  | 'impulse_score'
  | 'breakout_15m'
  | 'vwap_15m';

export default function Home() {
  const [rows, setRows] = useState<Metric[]>([]);
  const [showAlerts, setShowAlerts] = useState<boolean>(false);
  const [alertLog, setAlertLog] = useState<{ts:number; text:string}[]>([]);

  // Avoid SSR/CSR hydration mismatches by resolving host-based URLs client-side
  const [resolvedBackendHttp, setResolvedBackendHttp] = useState<string>(process.env.NEXT_PUBLIC_BACKEND_HTTP || '');
  const [resolvedWsUrl, setResolvedWsUrl] = useState<string>(process.env.NEXT_PUBLIC_BACKEND_WS || '');
  const [isClient, setIsClient] = useState(false);
  const binState = useRef<Map<string, Metric>>(new Map());
  const httpState = useRef<Map<string, Metric>>(new Map());
  const [modal, setModal] = useState<{
    open: boolean;
    row?: Metric;
    closes?: number[];
    oi?: number[];
    loading?: boolean;
    plan?: TradePlan | null;
    bt30?: any;
    bt90?: any;
    news?: NewsArticle[];
    newsLoading?: boolean;
    fundingRate?: number | null;
    fundingRateAnnual?: number | null;
    nextFundingTime?: number | null;
    fundingLoading?: boolean;
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

    { key: 'momentum', label: 'Momentum', group: 'Momentum', mobileDefault: false },
    { key: 'mom5m', label: 'Mom 5m', group: 'Momentum', mobileDefault: false },
    { key: 'mom15m', label: 'Mom 15m', group: 'Momentum', mobileDefault: false },

    { key: 'oi', label: 'Open Interest', group: 'Open Interest', mobileDefault: false },
    { key: 'oi5m', label: 'OI Δ 5m', group: 'Open Interest', mobileDefault: false },
    { key: 'oi15m', label: 'OI Δ 15m', group: 'Open Interest', mobileDefault: false },
    { key: 'oi1h', label: 'OI Δ 1h', group: 'Open Interest', mobileDefault: false },

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
    oi: true,
    oi5m: true,
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

  useEffect(() => {
    // Resolve URLs + hydrate persisted state from localStorage (client-only)
    setIsClient(true);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // persist favorites
    try { localStorage.setItem('favs', JSON.stringify(favs)); } catch {}
  }, [favs]);

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
          setRows(Array.from(map.values()));
          setLastUpdate(Date.now());
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

      // sentiment (4h) - best effort
      try {
        const [allResp, bResp, yResp] = await Promise.all([
          fetch(backendHttp + '/meta/sentiment'),
          fetch(backendHttp + '/meta/sentiment?exchange=binance'),
          fetch(backendHttp + '/meta/sentiment?exchange=bybit'),
        ]);
        if (allResp.ok) setSentiment(await allResp.json());
        if (bResp.ok) setSentimentBinance(await bResp.json());
        if (yResp.ok) setSentimentBybit(await yResp.json());
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

          ws.onmessage = (ev) => {
            try {
              const snap: Snapshot | { type: string } = JSON.parse(ev.data);
              if ((snap as any).type === 'ping') return;
              const s = snap as Snapshot;
              setRows(s.metrics);
              setLastUpdate(Date.now());
              // Append any fresh cipher signals to alert log
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
          failCount += 1;
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

    return base;
  }, [rows, query, onlyFavs, favs, preset]);

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

  // Top movers (based on full universe, not filtered)
  const movers5mUp = useMemo(() => topMovers(rows, 'change_5m', 'up'), [rows]);
  const movers5mDown = useMemo(() => topMovers(rows, 'change_5m', 'down'), [rows]);
  const movers15mUp = useMemo(() => topMovers(rows, 'change_15m', 'up'), [rows]);
  const movers15mDown = useMemo(() => topMovers(rows, 'change_15m', 'down'), [rows]);

  const favRows = useMemo(() => rows.filter(r => favs.includes(idOf(r))), [rows, favs]);

  const openDetails = async (r: Metric) => {
    const exchange = r.exchange || 'binance';
    const backendBase =
      process.env.NEXT_PUBLIC_BACKEND_HTTP ||
      (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8000` : 'http://127.0.0.1:8000');

    // Show modal immediately with row data; load history + plan + backtests + news async
    setModal({ open: true, row: r, closes: [], oi: [], loading: true, plan: null, bt30: null, bt90: null, news: [], newsLoading: true, fundingRate: null, fundingRateAnnual: null, nextFundingTime: null, fundingLoading: true });

    try {
      const [histResp, oiResp, planResp, bt30Resp, bt90Resp, newsResp, fundingResp] = await Promise.all([
        fetch(`${backendBase}/debug/history?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(r.symbol)}&limit=60`),
        fetch(`${backendBase}/debug/oi_history?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(r.symbol)}&limit=60`),
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
      setModal((m) => ({
        ...m,
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
      }));
    } catch (e) {
      setModal((m) => ({ ...m, open: true, row: r, closes: [], oi: [], news: [], newsLoading: false, loading: false }));
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
      <div className="panel">
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
            <input className="input" placeholder="Search symbol (e.g. BTC)" value={query} onChange={e=>setQuery(e.target.value)} />

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
            <button className={"button "+(showAlerts? 'buttonActive':'')} onClick={()=>setShowAlerts(v=>!v)} title="Toggle Alert Log">
              Alerts
            </button>
            <a className="button" href="/alerts" title="View persisted alerts history">
              History
            </a>
            <a className="button" href="/feed" title="High quality signals feed">
              Feed
            </a>
            <a className="button" href="/analysis" title="Strategy analysis dashboard">
              Analysis
            </a>
            <a className="button" href="/portfolio" title="Track your positions & PnL">
              Portfolio
            </a>
            <a className="button" href="/about" title="Help & documentation">
              About
            </a>
            <button className={"button "+(showColumns? 'buttonActive':'')} onClick={()=>setShowColumns(v=>!v)} title="Choose table columns">
              Columns
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

        {/* Top movers grid */}
        <div style={{padding:12}}>
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
                {col('oi15m') && <th className="hide-md">OI Δ 15m</th>}
                {col('oi1h') && <th className="hide-md">OI Δ 1h</th>}
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
                  <td style={{fontWeight:600}}>{r.symbol}</td>
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
                  {col('momentum') && <td className={momentumClass(r.momentum_score) + ' hide-md'}>{fmtMomentum(r.momentum_score)}</td>}
                  {col('mom5m') && <td className={pctClass(r.momentum_5m) + ' hide-md'}>{fmtPct(r.momentum_5m)}</td>}
                  {col('mom15m') && <td className={pctClass(r.momentum_15m) + ' hide-md'}>{fmtPct(r.momentum_15m)}</td>}
                  {col('oi') && <td className={'hide-sm'}>{fmtOI(r.open_interest)}</td>}
                  {col('oi5m') && <td className={oiClass(r.oi_change_5m) + ' hide-sm'}>{fmtOIPct(r.oi_change_5m)}</td>}
                  {col('oi15m') && <td className={oiClass(r.oi_change_15m) + ' hide-md'}>{fmtOIPct(r.oi_change_15m)}</td>}
                  {col('oi1h') && <td className={oiClass(r.oi_change_1h) + ' hide-md'}>{fmtOIPct(r.oi_change_1h)}</td>}
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
          row={modal.row}
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
  fundingRate?: number | null;
  fundingRateAnnual?: number | null;
  nextFundingTime?: number | null;
  fundingLoading?: boolean;
  isFav: boolean;
  onToggleFav: () => void;
  onClose: () => void;
  onNavigate: (dir: -1 | 1) => void;
  onQuickAddToPortfolio?: () => void;
  backendWs: string;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'plan' | 'indicators' | 'news'>('overview');
  const exchange = row.exchange || 'binance';
  const symbol = row.symbol;

  const [footprintCandles, setFootprintCandles] = useState<any[]>([]);
  const [footprintStatus, setFootprintStatus] = useState<'idle'|'loading'|'connected'>('idle');

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
    <div className="modalOverlay" onClick={onClose}>
      <div className="panel modalSheet" onClick={(e) => e.stopPropagation()}>
        <div className="toolbar" style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(12,19,30,0.98)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}>
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
            <button className="button" onClick={onClose} style={{ fontWeight: 600 }}>
              ✕
            </button>
          </div>
        </div>
        
        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', padding: '0 12px', background: 'var(--bg-secondary)' }}>
          <button 
            className={`button ${activeTab === 'overview' ? '' : ''}`}
            onClick={() => setActiveTab('overview')}
            style={{ 
              border: 'none',
              borderBottom: activeTab === 'overview' ? '2px solid var(--accent, #4a9eff)' : '2px solid transparent',
              borderRadius: 0,
              padding: '12px 20px',
              marginBottom: '-2px',
              fontWeight: activeTab === 'overview' ? 600 : 400,
              background: 'transparent',
              opacity: activeTab === 'overview' ? 1 : 0.6
            }}
          >
            Overview
          </button>
          <button 
            className={`button ${activeTab === 'plan' ? '' : ''}`}
            onClick={() => setActiveTab('plan')}
            style={{ 
              border: 'none',
              borderBottom: activeTab === 'plan' ? '2px solid var(--accent, #4a9eff)' : '2px solid transparent',
              borderRadius: 0,
              padding: '12px 20px',
              marginBottom: '-2px',
              fontWeight: activeTab === 'plan' ? 600 : 400,
              background: 'transparent',
              opacity: activeTab === 'plan' ? 1 : 0.6
            }}
          >
            Trade Plan
          </button>
          <button 
            className={`button ${activeTab === 'indicators' ? '' : ''}`}
            onClick={() => setActiveTab('indicators')}
            style={{ 
              border: 'none',
              borderBottom: activeTab === 'indicators' ? '2px solid var(--accent, #4a9eff)' : '2px solid transparent',
              borderRadius: 0,
              padding: '12px 20px',
              marginBottom: '-2px',
              fontWeight: activeTab === 'indicators' ? 600 : 400,
              background: 'transparent',
              opacity: activeTab === 'indicators' ? 1 : 0.6
            }}
          >
            📊 Indicators
          </button>
          <button 
            className={`button ${activeTab === 'news' ? '' : ''}`}
            onClick={() => setActiveTab('news')}
            style={{ 
              border: 'none',
              borderBottom: activeTab === 'news' ? '2px solid var(--accent, #4a9eff)' : '2px solid transparent',
              borderRadius: 0,
              padding: '12px 20px',
              marginBottom: '-2px',
              fontWeight: activeTab === 'news' ? 600 : 400,
              background: 'transparent',
              opacity: activeTab === 'news' ? 1 : 0.6
            }}
          >
            📰 News
          </button>
        </div>

        <div style={{ padding: 16 }}>
            {activeTab === 'overview' && (
              <div>
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
                    </div>
                  </div>
                </div>

                {/* Signals & Indicators Section */}
                {(row.cipher_buy || row.cipher_sell || row.percent_r_ob_reversal || row.percent_r_os_reversal || 
                  row.wt1 !== null || row.percent_r_fast !== null) && (
                  <div style={{ marginBottom: 16 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 8, fontWeight: 600 }}>📊 Active Signals & Indicators</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                      
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
                <div className="chartsGrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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

                {/* Funding Rate Section */}
                {fundingLoading ? (
                  <div style={{ marginTop: 16 }}>
                    <div className="muted" style={{ fontSize: 12 }}>Loading funding rate...</div>
                  </div>
                ) : fundingRate !== null && fundingRate !== undefined ? (
                  <div style={{ marginTop: 16 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 8, fontWeight: 600 }}>💰 Funding Rate (Perpetual)</div>
                    <div className="card" style={{ padding: 16, background: 'rgba(0,0,0,0.2)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
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
                ) : null}
              </div>
            )}

            {activeTab === 'plan' && (
              <div>
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
                  <div className="muted" style={{ marginBottom: 6 }}>Order Flow (Footprint) – 1m</div>
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
              <div style={{ padding: 16 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 12, fontWeight: 600 }}>
                  📊 Technical Indicators (15m Timeframe)
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                  
                  {/* RSI Card */}
                  <div className="card" style={{ padding: 12 }}>
                    <div style={{ marginBottom: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>RSI (14)</span>
                      <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>Relative Strength Index</span>
                    </div>
                    {row.rsi_14 !== null && row.rsi_14 !== undefined ? (
                      <>
                        <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 8, color: row.rsi_14 >= 70 ? '#e76f51' : row.rsi_14 <= 30 ? '#2a9d8f' : 'var(--text)' }}>
                          {row.rsi_14.toFixed(1)}
                        </div>
                        <div style={{ fontSize: 11, color: '#888' }}>
                          {row.rsi_14 >= 70 ? '🔴 Overbought (>70)' : row.rsi_14 <= 30 ? '🟢 Oversold (<30)' : '⚪ Neutral (30-70)'}
                        </div>
                        <div style={{ marginTop: 8, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ width: `${row.rsi_14}%`, height: '100%', background: row.rsi_14 >= 70 ? '#e76f51' : row.rsi_14 <= 30 ? '#2a9d8f' : '#4a9eff', transition: 'width 0.3s' }} />
                        </div>
                      </>
                    ) : (
                      <div className="muted" style={{ fontSize: 12 }}>Not enough data (need 15+ candles)</div>
                    )}
                  </div>

                  {/* MACD Card */}
                  <div className="card" style={{ padding: 12 }}>
                    <div style={{ marginBottom: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>MACD (12,26,9)</span>
                      <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>Moving Avg Convergence</span>
                    </div>
                    {row.macd !== null && row.macd !== undefined ? (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                          <div>
                            <span className="muted">MACD: </span>
                            <span style={{ fontWeight: 600, color: (row.macd || 0) >= 0 ? '#3ee145' : '#e13e3e' }}>
                              {row.macd.toFixed(2)}
                            </span>
                          </div>
                          <div>
                            <span className="muted">Signal: </span>
                            <span style={{ fontWeight: 600 }}>
                              {row.macd_signal?.toFixed(2) || 'N/A'}
                            </span>
                          </div>
                          <div>
                            <span className="muted">Histogram: </span>
                            <span style={{ fontWeight: 600, color: (row.macd_histogram || 0) >= 0 ? '#3ee145' : '#e13e3e' }}>
                              {row.macd_histogram?.toFixed(2) || 'N/A'}
                            </span>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>
                          {(row.macd_histogram || 0) > 0 ? '🟢 Bullish momentum' : '🔴 Bearish momentum'}
                        </div>
                      </>
                    ) : (
                      <div className="muted" style={{ fontSize: 12 }}>Not enough data (need 35+ candles)</div>
                    )}
                  </div>

                  {/* Stochastic RSI Card */}
                  <div className="card" style={{ padding: 12 }}>
                    <div style={{ marginBottom: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>Stochastic RSI</span>
                      <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>%K / %D</span>
                    </div>
                    {row.stoch_k !== null && row.stoch_k !== undefined ? (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, marginBottom: 8 }}>
                          <div>
                            <span className="muted">%K: </span>
                            <span style={{ fontWeight: 600, color: row.stoch_k >= 80 ? '#e76f51' : row.stoch_k <= 20 ? '#2a9d8f' : 'var(--text)' }}>
                              {row.stoch_k.toFixed(1)}
                            </span>
                          </div>
                          <div>
                            <span className="muted">%D: </span>
                            <span style={{ fontWeight: 600, color: (row.stoch_d || 0) >= 80 ? '#e76f51' : (row.stoch_d || 0) <= 20 ? '#2a9d8f' : 'var(--text)' }}>
                              {row.stoch_d?.toFixed(1) || 'N/A'}
                            </span>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: '#888' }}>
                          {row.stoch_k >= 80 ? '🔴 Overbought (>80)' : row.stoch_k <= 20 ? '🟢 Oversold (<20)' : '⚪ Neutral (20-80)'}
                        </div>
                      </>
                    ) : (
                      <div className="muted" style={{ fontSize: 12 }}>Not enough data (need 35+ candles)</div>
                    )}
                  </div>

                </div>

                <div className="muted" style={{ fontSize: 11, marginTop: 16, padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                  ℹ️ All indicators are calculated on 15m closed candles for more stable signals. Indicators may show "Not enough data" until sufficient 15m candles have been collected (~6 hours for full indicator set).
                </div>
              </div>
            )}

            {activeTab === 'news' && (
              <div>
                {newsLoading && (
                  <div className="card" style={{ padding: 32, textAlign: 'center' }}>
                    <div className="muted">Loading news articles...</div>
                  </div>
                )}
                {!newsLoading && (!news || news.length === 0) && (
                  <div className="card" style={{ padding: 32, textAlign: 'center' }}>
                    <div className="muted">No news articles found for {row.symbol}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                      Showing general crypto market news instead
                    </div>
                  </div>
                )}
                {news && news.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {news.map((article) => (
                      <div key={article.id} className="card" style={{ padding: 16, transition: 'all 0.2s', cursor: 'pointer' }} 
                           onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                           onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
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
