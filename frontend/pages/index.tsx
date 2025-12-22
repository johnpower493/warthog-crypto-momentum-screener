import { useEffect, useMemo, useRef, useState } from 'react';

type Metric = {
  symbol: string;
  exchange: string;
  last_price: number;
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

type SortKey = 'change_1m' | 'change_5m' | 'change_15m' | 'change_60m' | 'atr' | 'vol_zscore_1m' | 'last_price' | 'symbol' | 'momentum_score' | 'oi_change_5m' | 'open_interest' | 'signal_score';

export default function Home() {
  const [rows, setRows] = useState<Metric[]>([]);
  const binState = useRef<Map<string, Metric>>(new Map());
  const httpState = useRef<Map<string, Metric>>(new Map());
  const [modal, setModal] = useState<{
    open: boolean;
    row?: Metric;
    closes?: number[];
    loading?: boolean;
  }>({ open: false });
  const [query, setQuery] = useState('');

  // Quick filters / presets
  const [preset, setPreset] = useState<'none' | 'gainers5m' | 'losers5m' | 'highSignal'>('none');
  const [minSignal, setMinSignal] = useState<number | ''>('');
  const [minAbs5m, setMinAbs5m] = useState<number | ''>('');

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

  useEffect(() => {
    // persist favorites
    localStorage.setItem('favs', JSON.stringify(favs));
  }, [favs]);

  useEffect(() => {
    const override = new URL(location.href).searchParams.get('ws') || undefined;
    const envUrl = process.env.NEXT_PUBLIC_BACKEND_WS;
    const url = override || envUrl || 'ws://localhost:8000/ws/screener';

    function startHttpPolling() {
      try { if (pollTimer.current) window.clearInterval(pollTimer.current); } catch {}
      setSource('http');
      setStatus('connected');
      const poll = async () => {
        try {
          // default to combined snapshot if ws path endswith /all, else binance snapshot
          const endAll = url.endsWith('/all');
          const endpoint = endAll ? '/debug/snapshot/all' : '/debug/snapshot';
          const backendBase = (process.env.NEXT_PUBLIC_BACKEND_HTTP || 'http://127.0.0.1:8000');
          const resp = await fetch(backendBase + endpoint);
          if (!resp.ok) return;
          const s: Snapshot = await resp.json();
          const map = httpState.current; map.clear();
          for (const m of (s.metrics || [])) {
            map.set(`${(m.exchange||'binance')}:${m.symbol}`, m);
          }
          setRows(Array.from(map.values()));
          setLastUpdate(Date.now());
        } catch (e) {
          console.error('HTTP poll error', e);
        }
      };
      poll();
      pollTimer.current = window.setInterval(poll, 5000);
    }

    // If url starts with ws:// and fails, fallback to HTTP polling
    if (url.startsWith('ws')) {
      console.log('Connecting WS to', url);
      const ws = new WebSocket(url);
      setStatus('connecting');
      wsRef.current = ws;
      ws.onopen = () => { console.log('WS open', url); setStatus('connected'); setSource('ws'); };
      ws.onerror = (e) => { console.error('WS error', e); setStatus('disconnected'); startHttpPolling(); };
      ws.onclose = () => { console.warn('WS closed'); setStatus('disconnected'); if (source !== 'http') startHttpPolling(); };
      ws.onmessage = (ev) => {
        try {
          const snap: Snapshot | {type: string} = JSON.parse(ev.data);
          if ((snap as any).type === 'ping') return;
          const s = snap as Snapshot;
          setRows(s.metrics);
          setLastUpdate(Date.now());
        } catch (err) { console.error('WS parse error', err); }
      };
      return () => {
        try { ws.close(); } catch {}
        wsRef.current = null;
        setStatus('disconnected');
        if (pollTimer.current) { window.clearInterval(pollTimer.current); pollTimer.current = null; }
      };
    } else {
      // Non-WS url provided -> treat as HTTP base
      startHttpPolling();
      return () => { if (pollTimer.current) { window.clearInterval(pollTimer.current); pollTimer.current = null; } };
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    let base = onlyFavs ? rows.filter((r) => favs.includes(idOf(r))) : rows;

    if (q) base = base.filter((r) => r.symbol.includes(q));

    if (minSignal !== '') {
      base = base.filter((r) => (r.signal_score ?? -Infinity) >= (minSignal as number));
    }
    if (minAbs5m !== '') {
      base = base.filter((r) => Math.abs(r.change_5m ?? 0) >= (minAbs5m as number) / 100);
    }

    // Presets
    if (preset === 'gainers5m') base = base.filter((r) => (r.change_5m ?? -Infinity) > 0);
    if (preset === 'losers5m') base = base.filter((r) => (r.change_5m ?? Infinity) < 0);
    if (preset === 'highSignal') base = base.filter((r) => (r.signal_score ?? -Infinity) >= 70);

    return base;
  }, [rows, query, onlyFavs, favs, preset, minSignal, minAbs5m]);

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
      const na = (va === null || va === undefined || Number.isNaN(va))
        ? (sortDir === 'desc' ? -Infinity : Infinity)
        : (va as number);
      const nb = (vb === null || vb === undefined || Number.isNaN(vb))
        ? (sortDir === 'desc' ? -Infinity : Infinity)
        : (vb as number);

      if (na === nb) {
        // Stable tie-breaker: always alphabetical symbol (case-insensitive, numeric-aware)
        return cmpString(a.symbol ?? '', b.symbol ?? '');
      }
      return sortDir === 'desc' ? nb - na : na - nb;
    };

    return [...filtered].sort(cmp);
  }, [filtered, sortKey, sortDir]);

  // Top movers (based on full universe, not filtered)
  const movers5mUp = useMemo(() => topMovers(rows, 'change_5m', 'up'), [rows]);
  const movers5mDown = useMemo(() => topMovers(rows, 'change_5m', 'down'), [rows]);
  const movers15mUp = useMemo(() => topMovers(rows, 'change_15m', 'up'), [rows]);
  const movers15mDown = useMemo(() => topMovers(rows, 'change_15m', 'down'), [rows]);

  const favRows = useMemo(() => rows.filter(r => favs.includes(idOf(r))), [rows, favs]);

  const openDetails = async (r: Metric) => {
    const exchange = r.exchange || 'binance';
    const backendBase = process.env.NEXT_PUBLIC_BACKEND_HTTP || 'http://127.0.0.1:8000';

    // Show modal immediately with row data; load history async
    setModal({ open: true, row: r, closes: [], loading: true });

    try {
      const resp = await fetch(
        `${backendBase}/debug/history?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(r.symbol)}&limit=60`
      );
      const j = await resp.json();
      setModal((m) => ({ ...m, open: true, row: r, closes: j.closes || [], loading: false }));
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
              <button className={"button " + (preset==='gainers5m'?'buttonActive':'')} onClick={()=>setPreset(preset==='gainers5m'?'none':'gainers5m')}>Gainers 5m</button>
              <button className={"button " + (preset==='losers5m'?'buttonActive':'')} onClick={()=>setPreset(preset==='losers5m'?'none':'losers5m')}>Losers 5m</button>
              <button className={"button " + (preset==='highSignal'?'buttonActive':'')} onClick={()=>setPreset(preset==='highSignal'?'none':'highSignal')}>High Signal</button>
              <button className="button" onClick={()=>{setPreset('none'); setMinSignal(''); setMinAbs5m('');}}>Reset</button>
            </div>

            <input
              className="input"
              style={{ minWidth: 120 }}
              inputMode="numeric"
              placeholder="Min Signal"
              value={minSignal}
              onChange={(e)=>{
                const v = e.target.value.trim();
                setMinSignal(v===''? '' : Number(v));
              }}
            />
            <input
              className="input"
              style={{ minWidth: 140 }}
              inputMode="numeric"
              placeholder="Min |5m| %"
              value={minAbs5m}
              onChange={(e)=>{
                const v = e.target.value.trim();
                setMinAbs5m(v===''? '' : Number(v));
              }}
            />

            <select className="select" value={sortKey} onChange={e=>setSortKey(e.target.value as SortKey)}>
              <option value="signal_score">Sort: Signal 🔥</option>
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
            <span className="badge">{status==='connected'?'Live':'Disconnected'} · {source==='ws'?'WS':'HTTP'}</span>
            <button className="button" onClick={()=>setSortDir(d=> d==='desc'?'asc':'desc')}>
              {sortDir==='desc' ? 'Desc' : 'Asc'}
            </button>
            <button className="button" onClick={()=>setOnlyFavs(v=>!v)}>
              {onlyFavs ? 'All' : 'Only Favs'}
            </button>
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
          <div>WS: <code>{process.env.NEXT_PUBLIC_BACKEND_WS || 'ws://localhost:8000/ws/screener'}</code></div>
          <div className="muted">Last update: {lastUpdate? new Date(lastUpdate).toLocaleTimeString(): '—'}</div>
        </div>
      </div>
      {modal.open && modal.row && (
        <DetailsModal
          row={modal.row}
          closes={modal.closes || []}
          loading={!!modal.loading}
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
  isFav,
  onToggleFav,
  onClose,
  onNavigate,
}: {
  row: Metric;
  closes: number[];
  loading: boolean;
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
