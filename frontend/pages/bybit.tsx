import { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/globals.css';

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

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => (b.change_5m ?? -Infinity) - (a.change_5m ?? -Infinity));
  }, [rows]);

  return (
    <div className="container">
      <div className="panel">
        <div className="toolbar">
          <div className="group">
            <span className="badge">Exchange: Bybit Perp</span>
            <span className="badge">Pairs: {sorted.length}</span>
          </div>
          <div className="badge">{status==='connected'?'Live':'Disconnected'}</div>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Signal</th>
                <th>Last</th>
                <th>1m %</th>
                <th>5m %</th>
                <th>15m %</th>
                <th>60m %</th>
                <th>Momentum</th>
                <th>OI</th>
                <th>OI Δ 5m</th>
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
                <tr key={r.symbol}>
                  <td style={{fontWeight:600}}>{r.symbol}</td>
                  <td className={signalClass(r.signal_strength)}>{fmtSignal(r.signal_score, r.signal_strength)}</td>
                  <td>{fmt(r.last_price)}</td>
                  <td className={pctClass(r.change_1m)}>{fmtPct(r.change_1m)}</td>
                  <td className={pctClass(r.change_5m)}>{fmtPct(r.change_5m)}</td>
                  <td className={pctClass(r.change_15m)}>{fmtPct(r.change_15m)}</td>
                  <td className={pctClass(r.change_60m)}>{fmtPct(r.change_60m)}</td>
                  <td className={momentumClass(r.momentum_score)}>{fmtMomentum(r.momentum_score)}</td>
                  <td>{fmtOI(r.open_interest)}</td>
                  <td className={oiClass(r.oi_change_5m)}>{fmtOIPct(r.oi_change_5m)}</td>
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
