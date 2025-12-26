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

  // Scalping impulse
  impulse_score?: number | null;
  impulse_dir?: number | null;
  // Combined signal
  signal_score?: number | null;
  signal_strength?: string | null;
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

type SortKey =
  | 'change_1m'
  | 'change_5m'
  | 'change_15m'
  | 'change_60m'
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
  const binState = useRef<Map<string, Metric>>(new Map());
  const httpState = useRef<Map<string, Metric>>(new Map());
  const [modal, setModal] = useState<{
    open: boolean;
    row?: Metric;
    closes?: number[];
    loading?: boolean;
    plan?: TradePlan | null;
    bt30?: any;
    bt90?: any;
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
  const [favs, setFavs] = useState<string[]>(() => {
    try{ return JSON.parse(localStorage.getItem('favs')||'[]'); }catch{return []}
  });
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

  useEffect(() => {
    // persist favorites
    localStorage.setItem('favs', JSON.stringify(favs));
  }, [favs]);

  useEffect(() => {
    const override = new URL(location.href).searchParams.get('ws') || undefined;
    const envUrl = process.env.NEXT_PUBLIC_BACKEND_WS;
    const defaultWs = (typeof window !== 'undefined')
      ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:8000/ws/screener`
      : 'ws://localhost:8000/ws/screener';
    const url = override || envUrl || defaultWs;

    const backendHttp =
    process.env.NEXT_PUBLIC_BACKEND_HTTP ||
    (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8000` : 'http://127.0.0.1:8000');

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
                if (m && (m.cipher_buy === true || m.cipher_sell === true)) {
                  const side = m.cipher_buy ? 'BUY' : 'SELL';
                  const tf = m.cipher_source_tf ? `[${m.cipher_source_tf}]` : '';
                  const reason = m.cipher_reason ? `\n${m.cipher_reason}` : '';
                  newAlerts.push({ ts: Date.now(), text: `${side} ${tf} ${(m.exchange||'binance')} ${m.symbol} @ ${m.last_price}${reason}`});
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
    const backendBase = process.env.NEXT_PUBLIC_BACKEND_HTTP || 'http://127.0.0.1:8000';

    // Show modal immediately with row data; load history + plan + backtests async
    setModal({ open: true, row: r, closes: [], loading: true, plan: null, bt30: null, bt90: null });

    try {
      const [histResp, planResp, bt30Resp, bt90Resp] = await Promise.all([
        fetch(`${backendBase}/debug/history?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(r.symbol)}&limit=60`),
        fetch(`${backendBase}/meta/trade_plan?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(r.symbol)}`),
        fetch(`${backendBase}/meta/backtest?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(r.symbol)}&window_days=30`),
        fetch(`${backendBase}/meta/backtest?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(r.symbol)}&window_days=90`),
      ]);
      const j = histResp.ok ? await histResp.json() : { closes: [] };
      const p = planResp.ok ? await planResp.json() : { plan: null };
      const b30 = bt30Resp.ok ? await bt30Resp.json() : null;
      const b90 = bt90Resp.ok ? await bt90Resp.json() : null;
      setModal((m) => ({
        ...m,
        open: true,
        row: r,
        closes: j.closes || [],
        plan: p.plan || null,
        bt30: b30 && b30.result ? ({ window_days: 30, ...b30 } as any) : null,
        bt90: b90 && b90.result ? ({ window_days: 90, ...b90 } as any) : null,
        loading: false,
      }));
    } catch (e) {
      setModal((m) => ({ ...m, open: true, row: r, closes: [], loading: false }));
    }
  };

  return (
    <div className="container">
      <div className="panel">
        <div className="toolbar">
          <div className="group">
            <span className="badge">Exchange: Binance Perp</span>
            <span className="badge">Pairs: {sorted.length}</span>
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
              <button className="button" onClick={()=>{setPreset('none');}}>Reset</button>
            </div>

            <select className="select" value={sortKey} onChange={e=>setSortKey(e.target.value as SortKey)}>
              <option value="signal_score">Sort: Signal 🔥</option>
              <option value="impulse_score">Sort: Impulse</option>
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
          </div>
        </div>

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
                <th className="hide-xs">Exchange</th>
                <th className="sortable" onClick={()=>handleHeaderClick('signal_score')}>
                  Signal {sortKey==='signal_score' && (sortDir==='desc'?'↓':'↑')}
                </th>
                <th className="sortable hide-sm" onClick={()=>handleHeaderClick('impulse_score')}>
                  Impulse {sortKey==='impulse_score' && (sortDir==='desc'?'↓':'↑')}
                </th>
                <th className="sortable" onClick={()=>handleHeaderClick('last_price')}>
                  Last {sortKey==='last_price' && (sortDir==='desc'?'↓':'↑')}
                </th>
                <th className="sortable hide-sm" onClick={()=>handleHeaderClick('change_1m')}>
                  1m % {sortKey==='change_1m' && (sortDir==='desc'?'↓':'↑')}
                </th>
                <th className="sortable" onClick={()=>handleHeaderClick('change_5m')}>
                  5m % {sortKey==='change_5m' && (sortDir==='desc'?'↓':'↑')}
                </th>
                <th className="sortable" onClick={()=>handleHeaderClick('change_15m')}>
                  15m % {sortKey==='change_15m' && (sortDir==='desc'?'↓':'↑')}
                </th>
                <th className="sortable hide-md" onClick={()=>handleHeaderClick('change_60m')}>
                  60m % {sortKey==='change_60m' && (sortDir==='desc'?'↓':'↑')}
                </th>
                <th className="sortable hide-md" onClick={()=>handleHeaderClick('momentum_score')}>
                  Momentum {sortKey==='momentum_score' && (sortDir==='desc'?'↓':'↑')}
                </th>
                <th className="hide-md">Mom 5m</th>
                <th className="hide-md">Mom 15m</th>
                <th className="sortable hide-sm" onClick={()=>handleHeaderClick('open_interest')}>
                  OI {sortKey==='open_interest' && (sortDir==='desc'?'↓':'↑')}
                </th>
                <th className="sortable hide-sm" onClick={()=>handleHeaderClick('oi_change_5m')}>
                  OI Δ 5m {sortKey==='oi_change_5m' && (sortDir==='desc'?'↓':'↑')}
                </th>
                <th className="hide-md">OI Δ 15m</th>
                <th className="hide-md">OI Δ 1h</th>
                <th className="sortable hide-md" onClick={()=>handleHeaderClick('atr')}>
                  ATR {sortKey==='atr' && (sortDir==='desc'?'↓':'↑')}
                </th>
                <th className="sortable hide-md" onClick={()=>handleHeaderClick('vol_zscore_1m')}>
                  Vol Z {sortKey==='vol_zscore_1m' && (sortDir==='desc'?'↓':'↑')}
                </th>
                <th className="hide-md">Vol 1m</th>
                <th className="hide-md">RVOL 1m</th>
                <th className="hide-md">Breakout 15m</th>
                <th className="hide-md">VWAP 15m</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={idOf(r)} onClick={()=>openDetails(r)} style={{cursor:'pointer'}}>
                  <td className="muted">
                    <span className={"star "+(favs.includes(idOf(r))?'active':'')} onClick={(e)=>{e.stopPropagation(); toggleFav(idOf(r), favs, setFavs)}}>★</span>
                  </td>
                  <td style={{fontWeight:600}}>{r.symbol}</td>
                  <td className="muted hide-xs">{r.exchange || 'binance'}</td>
                  <td className={signalClass(r.signal_strength)}>{fmtSignal(r.signal_score, r.signal_strength)}</td>
                  <td className={'hide-sm'}>{fmtImpulse(r.impulse_score, r.impulse_dir)}</td>
                  <td>{fmt(r.last_price)}</td>
                  <td className={pctClass(r.change_1m) + ' hide-sm'}>{fmtPct(r.change_1m)}</td>
                  <td className={pctClass(r.change_5m)}>{fmtPct(r.change_5m)}</td>
                  <td className={pctClass(r.change_15m)}>{fmtPct(r.change_15m)}</td>
                  <td className={pctClass(r.change_60m) + ' hide-md'}>{fmtPct(r.change_60m)}</td>
                  <td className={momentumClass(r.momentum_score) + ' hide-md'}>{fmtMomentum(r.momentum_score)}</td>
                  <td className={pctClass(r.momentum_5m) + ' hide-md'}>{fmtPct(r.momentum_5m)}</td>
                  <td className={pctClass(r.momentum_15m) + ' hide-md'}>{fmtPct(r.momentum_15m)}</td>
                  <td className={'hide-sm'}>{fmtOI(r.open_interest)}</td>
                  <td className={oiClass(r.oi_change_5m) + ' hide-sm'}>{fmtOIPct(r.oi_change_5m)}</td>
                  <td className={oiClass(r.oi_change_15m) + ' hide-md'}>{fmtOIPct(r.oi_change_15m)}</td>
                  <td className={oiClass(r.oi_change_1h) + ' hide-md'}>{fmtOIPct(r.oi_change_1h)}</td>
                  <td className={'hide-md'}>{fmt(r.atr)}</td>
                  <td className={'hide-md'}>{fmt(r.vol_zscore_1m)}</td>
                  <td className={'hide-md'}>{fmt(r.vol_1m)}</td>
                  <td className={'hide-md'}>{fmt(r.rvol_1m)}</td>
                  <td className={pctClass(r.breakout_15m) + ' hide-md'}>{fmtPct(r.breakout_15m)}</td>
                  <td className={'hide-md'}>{fmt(r.vwap_15m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="footer">
          <div>WS: <code>{process.env.NEXT_PUBLIC_BACKEND_WS || (typeof window !== 'undefined' ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:8000/ws/screener` : 'ws://localhost:8000/ws/screener')}</code></div>
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
          loading={!!modal.loading}
          plan={modal.plan || null}
          bt30={modal.bt30 || null}
          bt90={modal.bt90 || null}
          isFav={favs.includes(idOf(modal.row))}
          onToggleFav={() => toggleFav(idOf(modal.row!), favs, setFavs)}
          onClose={() => setModal({ open: false })}
          onNavigate={(dir) => {
            const i = sorted.findIndex((x) => idOf(x) === idOf(modal.row!));
            if (i < 0) return;
            const next = sorted[(i + dir + sorted.length) % sorted.length];
            openDetails(next);
          }}
        />
      )}
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

function Sparkline({data}:{data:number[]}){
  const w=200, h=60, pad=6;
  if (!data || data.length<2) return <svg width={w} height={h}></svg>;
  const min=Math.min(...data), max=Math.max(...data);
  const xs=(i:number)=> pad + (i*(w-2*pad))/(data.length-1);
  const ys=(v:number)=> pad + (h-2*pad) * (1 - (v-min)/(max-min || 1));
  const d = data.map((v,i)=>`${i?'L':'M'}${xs(i)},${ys(v)}`).join(' ');
  return (
    <svg width={w} height={h}>
      <path d={d} fill="none" stroke="#4cc9f0" strokeWidth={2}/>
    </svg>
  );
}

function DetailsModal({
  row,
  closes,
  loading,
  plan,
  bt30,
  bt90,
  isFav,
  onToggleFav,
  onClose,
  onNavigate,
}: {
  row: Metric;
  closes: number[];
  loading: boolean;
  plan: TradePlan | null;
  bt30: any;
  bt90: any;
  isFav: boolean;
  onToggleFav: () => void;
  onClose: () => void;
  onNavigate: (dir: -1 | 1) => void;
}) {
  const exchange = row.exchange || 'binance';
  const symbol = row.symbol;

  const tvUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(
    exchange.toUpperCase() === 'BYBIT' ? `BYBIT:${symbol}` : `BINANCE:${symbol}`
  )}`;

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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div className="panel" style={{ width: 720, maxWidth: '95vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="toolbar">
          <div className="group" style={{ gap: 10, alignItems: 'center' }}>
            <span className="badge">{exchange}</span>
            <strong style={{ fontSize: 16 }}>{symbol}</strong>
            <span className={"star " + (isFav ? 'active' : '')} onClick={onToggleFav} title="Toggle favorite">
              ★
            </span>
            <span className="badge">Signal: {fmtSignal(row.signal_score, row.signal_strength)}</span>
          </div>
          <div className="group">
            <button className="button" onClick={() => onNavigate(-1)} title="Previous (↑)">
              Prev
            </button>
            <button className="button" onClick={() => onNavigate(1)} title="Next (↓)">
              Next
            </button>
            <button className="button" onClick={() => copy(symbol)} title="Copy symbol">
              Copy
            </button>
            <a className="button" href={tvUrl} target="_blank" rel="noreferrer" title="Open in TradingView">
              TradingView
            </a>
            <button className="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '260px 1fr', gap: 12 }}>
          <div>
            <div className="badge" style={{ display: 'inline-block', marginBottom: 8 }}>
              Last: {fmt(row.last_price)}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Stat label="1m" value={fmtPct(row.change_1m)} className={pctClass(row.change_1m)} />
              <Stat label="5m" value={fmtPct(row.change_5m)} className={pctClass(row.change_5m)} />
              <Stat label="15m" value={fmtPct(row.change_15m)} className={pctClass(row.change_15m)} />
              <Stat label="60m" value={fmtPct(row.change_60m)} className={pctClass(row.change_60m)} />
              <Stat label="ATR" value={fmt(row.atr)} className="muted" />
              <Stat label="Vol Z" value={fmt(row.vol_zscore_1m)} className="muted" />
              <Stat label="Momentum" value={fmtMomentum(row.momentum_score)} className={momentumClass(row.momentum_score)} />
              <Stat label="OI" value={fmtOI(row.open_interest)} className="muted" />
              <Stat label="OI Δ 5m" value={fmtOIPct(row.oi_change_5m)} className={oiClass(row.oi_change_5m)} />
              <Stat label="OI Δ 15m" value={fmtOIPct(row.oi_change_15m)} className={oiClass(row.oi_change_15m)} />
            </div>

            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Tip: use ↑ / ↓ to navigate, Esc to close.
            </div>
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 6 }}>
              Last 60 x 1m closes {loading ? '(loading...)' : ''}
            </div>
            <Sparkline data={closes || []} />

            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ marginBottom: 6 }}>Trade Plan</div>
              {!plan && <div className="muted">No plan yet.</div>}
              {plan && (
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <Stat label="Side" value={String(plan.side)} className="muted" />
                    <Stat label="Entry" value={fmt(plan.entry_price)} className="muted" />
                    <Stat label="Stop" value={fmt(plan.stop_loss)} className="chgDown" />
                    <Stat label="TP1" value={fmt(plan.tp1)} className="chgUp" />
                    <Stat label="TP2" value={fmt(plan.tp2)} className="chgUp" />
                    <Stat label="TP3" value={fmt(plan.tp3)} className="chgUp" />
                    <Stat label="ATR" value={fmt(plan.atr)} className="muted" />
                    <Stat label="ATR Mult" value={plan.atr_mult!=null ? String(plan.atr_mult) : '-'} className="muted" />
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ marginBottom: 6 }}>Recent Performance</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Stat label="30d Trades" value={bt30?.n_trades!=null ? String(bt30.n_trades) : '-'} className="muted" />
                <Stat label="30d Win%" value={bt30?.win_rate!=null ? (bt30.win_rate*100).toFixed(1)+'%' : '-'} className="muted" />
                <Stat label="30d Avg R" value={bt30?.avg_r!=null ? Number(bt30.avg_r).toFixed(2) : '-'} className="muted" />
                <Stat label="90d Trades" value={bt90?.n_trades!=null ? String(bt90.n_trades) : '-'} className="muted" />
                <Stat label="90d Win%" value={bt90?.win_rate!=null ? (bt90.win_rate*100).toFixed(1)+'%' : '-'} className="muted" />
                <Stat label="90d Avg R" value={bt90?.avg_r!=null ? Number(bt90.avg_r).toFixed(2) : '-'} className="muted" />
              </div>
            </div>
          </div>
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
