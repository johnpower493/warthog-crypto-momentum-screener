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
  const [preset, setPreset] = useState<'none' | 'gainers5m' | 'losers5m' | 'highSignal'>('gainers5m');
  const [minSignal, setMinSignal] = useState<number | ''>('');
  const [minAbs5m, setMinAbs5m] = useState<number | ''>('');

  useEffect(() => {
    const defaultUrl = 'ws://localhost:8000/ws/screener/bybit';
    const base = process.env.NEXT_PUBLIC_BACKEND_WS || defaultUrl.replace('/ws/screener','/ws/screener');
    const url = base.replace('/ws/screener','/ws/screener/bybit');
    const ws = new WebSocket(url);
    setStatus('connecting');
    ws.onopen = () => setStatus('connected');
    ws.onerror = () => setStatus('disconnected');
    ws.onclose = () => setStatus('disconnected');
    ws.onmessage = (ev) => {
      try {
        const s: Snapshot = JSON.parse(ev.data);
        if ((s as any).type === 'ping') return;
        setRows(s.metrics);
      } catch {}
    };
    return () => ws.close();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    let base = rows;

    if (q) base = base.filter((r) => r.symbol.includes(q));

    if (minSignal !== '') base = base.filter((r) => (r.signal_score ?? -Infinity) >= (minSignal as number));
    if (minAbs5m !== '') base = base.filter((r) => Math.abs(r.change_5m ?? 0) >= (minAbs5m as number) / 100);

    if (preset === 'gainers5m') base = base.filter((r) => (r.change_5m ?? -Infinity) > 0);
    if (preset === 'losers5m') base = base.filter((r) => (r.change_5m ?? Infinity) < 0);
    if (preset === 'highSignal') base = base.filter((r) => (r.signal_score ?? -Infinity) >= 70);

    return base;
  }, [rows, query, preset, minSignal, minAbs5m]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => (b.change_5m ?? -Infinity) - (a.change_5m ?? -Infinity));
  }, [filtered]);

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
              <button className={"button " + (preset==='highSignal'?'buttonActive':'')} onClick={()=>setPreset(preset==='highSignal'?'none':'highSignal')}>High Signal</button>
              <button className="button" onClick={()=>{setPreset('gainers5m'); setMinSignal(''); setMinAbs5m('');}}>Reset</button>
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

            <span className="badge">{status==='connected'?'Live':'Disconnected'}</span>
          </div>
        </div>
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
