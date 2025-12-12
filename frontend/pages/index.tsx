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

type SortKey = 'change_5m' | 'change_15m' | 'atr' | 'vol_zscore_1m' | 'last_price' | 'symbol' | 'momentum_score' | 'oi_change_5m' | 'open_interest' | 'signal_score';

export default function Home() {
  const [rows, setRows] = useState<Metric[]>([]);
  const binState = useRef<Map<string, Metric>>(new Map());
  const httpState = useRef<Map<string, Metric>>(new Map());
  const [modal, setModal] = useState<{open: boolean; symbol?: string; exchange?: string; closes?: number[]}>({open:false});
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('signal_score');
  const [sortDir, setSortDir] = useState<'desc'|'asc'>('desc');
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
    const base = onlyFavs ? rows.filter(r => favs.includes(idOf(r))) : rows;
    return q ? base.filter(r => r.symbol.includes(q)) : base;
  }, [rows, query, onlyFavs, favs]);

  const sorted = useMemo(() => {
    const val = (r: Metric) => {
      const v = (r as any)[sortKey];
      if (v === null || v === undefined || Number.isNaN(v)) return sortDir==='desc'? -Infinity : Infinity;
      return v;
    };
    const arr = [...filtered].sort((a,b)=>{
      const va = val(a); const vb = val(b);
      if (va === vb) return a.symbol.localeCompare(b.symbol);
      return sortDir==='desc' ? (vb as number) - (va as number) : (va as number) - (vb as number);
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  // Top movers (based on full universe, not filtered)
  const movers5mUp = useMemo(() => topMovers(rows, 'change_5m', 'up'), [rows]);
  const movers5mDown = useMemo(() => topMovers(rows, 'change_5m', 'down'), [rows]);
  const movers15mUp = useMemo(() => topMovers(rows, 'change_15m', 'up'), [rows]);
  const movers15mDown = useMemo(() => topMovers(rows, 'change_15m', 'down'), [rows]);

  const favRows = useMemo(() => rows.filter(r => favs.includes(idOf(r))), [rows, favs]);

  const openDetails = async (r: Metric) => {
    const exchange = r.exchange || 'binance';
    const backendBase = (process.env.NEXT_PUBLIC_BACKEND_HTTP || 'http://127.0.0.1:8000');
    try{
      const resp = await fetch(`${backendBase}/debug/history?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(r.symbol)}&limit=60`);
      const j = await resp.json();
      setModal({open:true, symbol:r.symbol, exchange, closes:j.closes||[]});
    }catch(e){
      setModal({open:true, symbol:r.symbol, exchange, closes:[]});
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
                <th>Symbol</th>
                <th>Exchange</th>
                <th>Signal</th>
                <th>Last</th>
                <th>1m %</th>
                <th>5m %</th>
                <th>15m %</th>
                <th>60m %</th>
                <th>Momentum</th>
                <th>Mom 5m</th>
                <th>Mom 15m</th>
                <th>OI</th>
                <th>OI Δ 5m</th>
                <th>OI Δ 15m</th>
                <th>OI Δ 1h</th>
                <th>ATR</th>
                <th>Vol Z</th>
                <th>Vol 1m</th>
                <th>RVOL 1m</th>
                <th>Breakout 15m</th>
                <th>VWAP 15m</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={idOf(r)} onClick={()=>openDetails(r)} style={{cursor:'pointer'}}>
                  <td className="muted">
                    <span className={"star "+(favs.includes(idOf(r))?'active':'')} onClick={(e)=>{e.stopPropagation(); toggleFav(idOf(r), favs, setFavs)}}>★</span>
                  </td>
                  <td style={{fontWeight:600}}>{r.symbol}</td>
                  <td className="muted">{r.exchange || 'binance'}</td>
                  <td className={signalClass(r.signal_strength)}>{fmtSignal(r.signal_score, r.signal_strength)}</td>
                  <td>{fmt(r.last_price)}</td>
                  <td className={pctClass(r.change_1m)}>{fmtPct(r.change_1m)}</td>
                  <td className={pctClass(r.change_5m)}>{fmtPct(r.change_5m)}</td>
                  <td className={pctClass(r.change_15m)}>{fmtPct(r.change_15m)}</td>
                  <td className={pctClass(r.change_60m)}>{fmtPct(r.change_60m)}</td>
                  <td className={momentumClass(r.momentum_score)}>{fmtMomentum(r.momentum_score)}</td>
                  <td className={pctClass(r.momentum_5m)}>{fmtPct(r.momentum_5m)}</td>
                  <td className={pctClass(r.momentum_15m)}>{fmtPct(r.momentum_15m)}</td>
                  <td>{fmtOI(r.open_interest)}</td>
                  <td className={oiClass(r.oi_change_5m)}>{fmtOIPct(r.oi_change_5m)}</td>
                  <td className={oiClass(r.oi_change_15m)}>{fmtOIPct(r.oi_change_15m)}</td>
                  <td className={oiClass(r.oi_change_1h)}>{fmtOIPct(r.oi_change_1h)}</td>
                  <td>{fmt(r.atr)}</td>
                  <td>{fmt(r.vol_zscore_1m)}</td>
                  <td>{fmt(r.vol_1m)}</td>
                  <td>{fmt(r.rvol_1m)}</td>
                  <td className={pctClass(r.breakout_15m)}>{fmtPct(r.breakout_15m)}</td>
                  <td>{fmt(r.vwap_15m)}</td>
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
      {modal.open && <DetailsModal symbol={modal.symbol!} exchange={modal.exchange!} closes={modal.closes||[]} onClose={()=>setModal({open:false})} />}
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

function DetailsModal({symbol, exchange, closes, onClose}:{symbol:string; exchange:string; closes:number[]; onClose:()=>void}){
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999}} onClick={onClose}>
      <div className="panel" style={{width:520}} onClick={(e)=>e.stopPropagation()}>
        <div className="toolbar">
          <div className="group"><span className="badge">{exchange}</span><strong style={{marginLeft:8}}>{symbol}</strong></div>
          <button className="button" onClick={onClose}>Close</button>
        </div>
        <div style={{padding:12}}>
          <Sparkline data={closes||[]} />
        </div>
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
