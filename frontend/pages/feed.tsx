import { useEffect, useMemo, useState } from 'react';

type AlertRow = {
  id: number;
  ts: number;
  created_ts: number;
  exchange: string;
  symbol: string;
  signal: 'BUY' | 'SELL' | string;
  source_tf?: string | null;
  price?: number | null;
  reason?: string | null;
  setup_score?: number | null;
  setup_grade?: string | null;
  avoid_reasons?: string[] | null;
};

const gradeRank: Record<string, number> = { A: 3, B: 2, C: 1 };

export default function FeedPage() {
  const [backendHttp, setBackendHttp] = useState<string>(process.env.NEXT_PUBLIC_BACKEND_HTTP || '');

  const [exchange, setExchange] = useState<'all'|'binance'|'bybit'>('all');
  const [side, setSide] = useState<'all'|'BUY'|'SELL'>('all');
  const [tf, setTf] = useState<'all'|'15m'|'4h'>('all');
  const [minGrade, setMinGrade] = useState<'B'|'A'|'C'>('B');
  const [sinceMinutes, setSinceMinutes] = useState<number>(60);
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [status, setStatus] = useState<'idle'|'loading'|'error'>('idle');

  useEffect(() => {
    try {
      const resolved = process.env.NEXT_PUBLIC_BACKEND_HTTP || `${window.location.protocol}//${window.location.hostname}:8000`;
      setBackendHttp(resolved);
    } catch {}
  }, []);

  const load = async () => {
    setStatus('loading');
    try {
      const url = new URL((backendHttp || 'http://127.0.0.1:8000') + '/meta/alerts');
      url.searchParams.set('limit', '500');
      url.searchParams.set('since_minutes', String(sinceMinutes));
      url.searchParams.set('min_grade', minGrade);
      if (exchange !== 'all') url.searchParams.set('exchange', exchange);
      if (side !== 'all') url.searchParams.set('signal', side);
      if (tf !== 'all') url.searchParams.set('source_tf', tf);
      const resp = await fetch(url.toString());
      if (!resp.ok) throw new Error('bad response');
      const j = await resp.json();
      setRows(j.alerts || []);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  };

  useEffect(() => {
    load();
    const t = window.setInterval(load, 10_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendHttp, exchange, side, tf, minGrade, sinceMinutes]);

  const display = useMemo(() => {
    // Already filtered server-side, but keep stable sort by created_ts
    return [...rows].sort((a,b) => (b.created_ts || 0) - (a.created_ts || 0));
  }, [rows]);

  return (
    <div className="container">
      <div className="panel">
        <div className="toolbar" style={{justifyContent:'space-between'}}>
          <div className="group">
            <span className="badge">Signal Feed</span>
            <span className="badge">Window: {sinceMinutes}m</span>
            <span className="badge">Grade: {minGrade}+</span>
            <span className="badge">Rows: {display.length}</span>
            {status === 'loading' && <span className="badge">Loading…</span>}
            {status === 'error' && <span className="badge">Error</span>}
          </div>
          <div className="group" style={{flexWrap:'wrap'}}>
            <select className="select" value={exchange} onChange={(e)=>setExchange(e.target.value as any)}>
              <option value="all">All exchanges</option>
              <option value="binance">Binance</option>
              <option value="bybit">Bybit</option>
            </select>
            <select className="select" value={side} onChange={(e)=>setSide(e.target.value as any)}>
              <option value="all">All sides</option>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
            <select className="select" value={tf} onChange={(e)=>setTf(e.target.value as any)}>
              <option value="all">All TF</option>
              <option value="15m">15m</option>
              <option value="4h">4h</option>
            </select>
            <select className="select" value={minGrade} onChange={(e)=>setMinGrade(e.target.value as any)}>
              <option value="A">A only</option>
              <option value="B">A+B</option>
              <option value="C">All</option>
            </select>
            <select className="select" value={sinceMinutes} onChange={(e)=>setSinceMinutes(parseInt(e.target.value,10))}>
              <option value={30}>30m</option>
              <option value={60}>60m</option>
              <option value={120}>120m</option>
              <option value={240}>240m</option>
            </select>
            <button className="button" onClick={load}>Refresh</button>
            <a className="button" href="/">Home</a>
          </div>
        </div>

        <div style={{padding:12}}>
          {display.length === 0 && <div className="muted">No signals in the selected window/filters.</div>}
          {display.map((a) => (
            <div key={a.id} className="card" style={{marginBottom:10}}>
              <div style={{display:'flex', justifyContent:'space-between', gap:10, flexWrap:'wrap'}}>
                <div style={{display:'flex', gap:10, flexWrap:'wrap', alignItems:'center'}}>
                  <span className={a.signal === 'BUY' ? 'chgUp' : 'chgDown'} style={{fontWeight:800}}>{a.signal}</span>
                  <span className="badge">{a.exchange}</span>
                  <span style={{fontWeight:800}}>{a.symbol}</span>
                  <span className="badge">{a.source_tf || '-'}</span>
                  <span className="badge">Grade {a.setup_grade || '-'}</span>
                  <span className="muted">score {fmt(a.setup_score)}</span>
                  <span className="muted">@ {fmt(a.price)}</span>
                </div>
                <div className="muted" style={{fontSize:12}}>
                  {fmtAge(a.created_ts)}
                </div>
              </div>

              {a.avoid_reasons && a.avoid_reasons.length > 0 && (
                <div style={{marginTop:8, display:'flex', gap:6, flexWrap:'wrap'}}>
                  {a.avoid_reasons.map((x, i)=> (
                    <span key={i} className="badge" title="Avoid reason">{x}</span>
                  ))}
                </div>
              )}

              {a.reason && (
                <div className="muted" style={{marginTop:8, whiteSpace:'pre-wrap'}}>
                  {a.reason}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function fmt(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs>=1000) return Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
  return Number(n).toFixed(4);
}

function fmtAge(ts?: number | null) {
  if (!ts) return '—';
  const d = Date.now() - ts;
  const m = Math.floor(d/60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  return `${h}h ${m%60}m ago`;
}
