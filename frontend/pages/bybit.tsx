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
  open_interest?: number | null;
  oi_change_5m?: number | null;
  oi_change_15m?: number | null;
  oi_change_1h?: number | null;
  momentum_5m?: number | null;
  momentum_15m?: number | null;
  momentum_score?: number | null;
  impulse_score?: number | null;
  impulse_dir?: number | null;
  signal_score?: number | null;
  signal_strength?: string | null;
  ts: number;
};

type Snapshot = {
  exchange: string;
  ts: number;
  metrics: Metric[];
};

export default function BybitPage() {
  const [rows, setRows] = useState<Metric[]>([]);
  const [status, setStatus] = useState<'disconnected'|'connecting'|'connected'>('connecting');

  const [query, setQuery] = useState('');
  const [preset, setPreset] = useState<
    | 'none'
    | 'gainers5m'
    | 'losers5m'
    | 'highSignal'
    | 'volatile5m'
    | 'highOiDelta5m'
    | 'breakout15m'
    | 'impulse'
  >('gainers5m');
  // (Removed) manual numeric threshold inputs.

  const [staleCount, setStaleCount] = useState<{ticker:number; kline:number}>({ticker:0, kline:0});

  useEffect(() => {
    const backendHttp = process.env.NEXT_PUBLIC_BACKEND_HTTP || 'http://127.0.0.1:8000';

    let cancelled = false;
    let attempt = 0;
    let ws: WebSocket | null = null;

    function sleep(ms: number) {
      return new Promise((r) => setTimeout(r, ms));
    }

    async function pollStatusOnce() {
      try {
        const resp = await fetch(backendHttp + '/debug/status');
        if (!resp.ok) return;
        const j = await resp.json();
        const y = j.bybit?.stale || {};
        setStaleCount({ ticker: y.ticker_count || 0, kline: y.kline_count || 0 });
      } catch {}
    }

    const statusTimer = window.setInterval(pollStatusOnce, 5000);
    pollStatusOnce();

    async function connectLoop() {
      const defaultUrl = 'ws://localhost:8000/ws/screener/bybit';
      const base = process.env.NEXT_PUBLIC_BACKEND_WS || defaultUrl;
      let url: string;
      if (base.includes('/ws/screener/bybit')) {
        url = base;
      } else if (base.includes('/ws/screener')) {
        url = base.replace('/ws/screener', '/ws/screener/bybit');
      } else {
        url = (base.endsWith('/') ? base.slice(0, -1) : base) + '/ws/screener/bybit';
      }

      while (!cancelled) {
        setStatus('connecting');
        try {
          ws = new WebSocket(url);

          await new Promise<void>((resolve, reject) => {
            if (!ws) return reject(new Error('ws null'));
            ws.onopen = () => resolve();
            ws.onerror = () => reject(new Error('ws error'));
          });

          attempt = 0;
          setStatus('connected');

          ws.onmessage = (ev) => {
            try {
              const s: Snapshot = JSON.parse(ev.data);
              if ((s as any).type === 'ping') return;
              setRows(s.metrics);
            } catch {}
          };

          await new Promise<void>((resolve) => {
            if (!ws) return resolve();
            ws.onclose = () => resolve();
            ws.onerror = () => resolve();
          });

          setStatus('disconnected');
        } catch {
          setStatus('disconnected');
        }

        attempt += 1;
        const baseDelay = Math.min(10_000, 500 * Math.pow(2, Math.min(attempt, 5)));
        const jitter = Math.floor(Math.random() * 250);
        await sleep(baseDelay + jitter);
      }
    }

    connectLoop();

    return () => {
      cancelled = true;
      try { if (ws) ws.close(); } catch {}
      window.clearInterval(statusTimer);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    let base = rows;

    if (q) base = base.filter((r) => r.symbol.includes(q));

    if (preset === 'gainers5m') base = base.filter((r) => (r.change_5m ?? -Infinity) > 0);
    if (preset === 'losers5m') base = base.filter((r) => (r.change_5m ?? Infinity) < 0);
    if (preset === 'highSignal') base = base.filter((r) => (r.signal_score ?? -Infinity) >= 70);
    // Impulse preset: sort-first (do not hard-filter).
    if (preset === 'volatile5m') base = base.filter((r) => Math.abs(r.change_5m ?? 0) > 0);
    if (preset === 'highOiDelta5m') base = base.filter((r) => Math.abs(r.oi_change_5m ?? 0) > 0);
    if (preset === 'breakout15m') base = base.filter((r) => (r.breakout_15m ?? 0) > 0);

    return base;
  }, [rows, query, preset]);

  const sorted = useMemo(() => {
    const arr = [...filtered];

    // Preset-driven ordering
    if (preset === 'losers5m') {
      return arr.sort((a, b) => (a.change_5m ?? Infinity) - (b.change_5m ?? Infinity));
    }
    if (preset === 'volatile5m') {
      return arr.sort((a, b) => Math.abs(b.change_5m ?? 0) - Math.abs(a.change_5m ?? 0));
    }
    if (preset === 'highOiDelta5m') {
      return arr.sort((a, b) => Math.abs(b.oi_change_5m ?? 0) - Math.abs(a.oi_change_5m ?? 0));
    }
    if (preset === 'breakout15m') {
      return arr.sort((a, b) => (b.breakout_15m ?? -Infinity) - (a.breakout_15m ?? -Infinity));
    }
    if (preset === 'impulse') {
      return arr.sort((a, b) => (b.impulse_score ?? -Infinity) - (a.impulse_score ?? -Infinity));
    }

    // Default: gainers 5m
    return arr.sort((a, b) => (b.change_5m ?? -Infinity) - (a.change_5m ?? -Infinity));
  }, [filtered, preset]);

  return (
    <div className="container">
      <div className="panel">
        <div className="toolbar">
          <div className="group">
            <span className="badge">Exchange: Bybit Perp</span>
            <span className="badge">Pairs: {sorted.length}</span>
          </div>
          <div className="group">
            <input className="input" placeholder="Search symbol (e.g. BTC)" value={query} onChange={e=>setQuery(e.target.value)} />

            <div className="group" style={{ gap: 6 }}>
              <button className={"button " + (preset==='gainers5m'?'buttonActive':'')} onClick={()=>setPreset(preset==='gainers5m'?'none':'gainers5m')}>Gainers 5m</button>
              <button className={"button " + (preset==='losers5m'?'buttonActive':'')} onClick={()=>setPreset(preset==='losers5m'?'none':'losers5m')}>Losers 5m</button>
              <button className={"button " + (preset==='volatile5m'?'buttonActive':'')} onClick={()=>setPreset(preset==='volatile5m'?'none':'volatile5m')}>Volatile 5m</button>
              <button className={"button " + (preset==='highOiDelta5m'?'buttonActive':'')} onClick={()=>setPreset(preset==='highOiDelta5m'?'none':'highOiDelta5m')}>High OI Δ 5m</button>
              <button className={"button " + (preset==='breakout15m'?'buttonActive':'')} onClick={()=>setPreset(preset==='breakout15m'?'none':'breakout15m')}>Breakout 15m</button>
              <button className={"button " + (preset==='impulse'?'buttonActive':'')} onClick={()=>setPreset(preset==='impulse'?'none':'impulse')}>Impulse</button>
              <button className={"button " + (preset==='highSignal'?'buttonActive':'')} onClick={()=>setPreset(preset==='highSignal'?'none':'highSignal')}>High Signal</button>
              <button className="button" onClick={()=>{setPreset('gainers5m');}}>Reset</button>
            </div>

            <span className="badge">{status==='connected'?'Live':status==='connecting'?'Connecting…':'Disconnected'}</span>
            <span className="badge" title="Stale symbol counts (ticker/kline)">Stale (t/k): {staleCount.ticker}/{staleCount.kline}</span>
            <button
              className="button"
              onClick={async ()=>{
                try{
                  await fetch((process.env.NEXT_PUBLIC_BACKEND_HTTP || 'http://127.0.0.1:8000') + '/debug/resync?exchange=bybit', {method:'POST'});
                }catch{}
              }}
              title="Restart streams + backfill (Bybit)"
            >
              Resync
            </button>
          </div>
        </div>
        {sorted.length === 0 && (
          <div style={{ padding: 12 }} className="muted">
            No results for current selection. Try Reset or choose a different preset.
          </div>
        )}
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Signal</th>
                <th>Last</th>
                <th className="hide-sm">1m %</th>
                <th>5m %</th>
                <th>15m %</th>
                <th className="hide-md">60m %</th>
                <th className="hide-md">Momentum</th>
                <th className="hide-sm">OI</th>
                <th className="hide-sm">OI Δ 5m</th>
                <th className="hide-md">OI Δ 1h</th>
                <th className="hide-md">ATR</th>
                <th className="hide-md">Vol Z</th>
                <th className="hide-md">Vol 1m</th>
                <th className="hide-md">RVOL 1m</th>
                <th className="hide-md">Breakout 15m</th>
                <th className="hide-md">VWAP 15m</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.symbol}>
                  <td style={{fontWeight:600}}>{r.symbol}</td>
                  <td className={signalClass(r.signal_strength)}>{fmtSignal(r.signal_score, r.signal_strength)}</td>
                  <td>{fmt(r.last_price)}</td>
                  <td className={pctClass(r.change_1m) + ' hide-sm'}>{fmtPct(r.change_1m)}</td>
                  <td className={pctClass(r.change_5m)}>{fmtPct(r.change_5m)}</td>
                  <td className={pctClass(r.change_15m)}>{fmtPct(r.change_15m)}</td>
                  <td className={pctClass(r.change_60m) + ' hide-md'}>{fmtPct(r.change_60m)}</td>
                  <td className={momentumClass(r.momentum_score) + ' hide-md'}>{fmtMomentum(r.momentum_score)}</td>
                  <td className={'hide-sm'}>{fmtOI(r.open_interest)}</td>
                  <td className={oiClass(r.oi_change_5m) + ' hide-sm'}>{fmtOIPct(r.oi_change_5m)}</td>
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
      </div>
    </div>
  );
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
  if (n > 0.02) return 'chgUp';
  if (n < -0.02) return 'chgDown';
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
