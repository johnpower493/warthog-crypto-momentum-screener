import { useEffect, useMemo, useState } from 'react';

type AlertRow = {
  id: number;
  ts: number;
  exchange: string;
  symbol: string;
  signal: 'BUY' | 'SELL' | string;
  source_tf?: string | null;
  price?: number | null;
  reason?: string | null;
};

export default function AlertsPage() {
  const [backendHttp, setBackendHttp] = useState<string>(process.env.NEXT_PUBLIC_BACKEND_HTTP || '');
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    try {
      const resolved = process.env.NEXT_PUBLIC_BACKEND_HTTP || `${window.location.protocol}//${window.location.hostname}:8000`;
      setBackendHttp(resolved);
    } catch {}
  }, []);

  const [rows, setRows] = useState<AlertRow[]>([]);
  const [status, setStatus] = useState<'idle'|'loading'|'error'>('idle');

  const [exchange, setExchange] = useState<'all'|'binance'|'bybit'>('all');
  const [side, setSide] = useState<'all'|'BUY'|'SELL'>('all');
  const [query, setQuery] = useState('');

  const load = async () => {
    setStatus('loading');
    try {
      const url = new URL((backendHttp || 'http://127.0.0.1:8000') + '/meta/alerts');
      url.searchParams.set('limit', '500');
      if (exchange !== 'all') url.searchParams.set('exchange', exchange);
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
  }, [exchange]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    let base = rows;
    if (side !== 'all') base = base.filter(r => r.signal === side);
    if (q) base = base.filter(r => r.symbol?.toUpperCase().includes(q));
    return base;
  }, [rows, side, query]);

  return (
    <div className="container">
      <div className="panel">
        <div className="toolbar">
          <div className="group">
            <span className="badge">Alerts History</span>
            <span className="badge">Rows: {filtered.length}</span>
            {status === 'loading' && <span className="badge">Loading…</span>}
            {status === 'error' && <span className="badge">Error</span>}
          </div>
          <div className="group">
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
            <input className="input" placeholder="Search symbol (e.g. BTC)" value={query} onChange={(e)=>setQuery(e.target.value)} />
            <button className="button" onClick={load}>Refresh</button>
            <a className="button" href="/">Home</a>
          </div>
        </div>

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Exchange</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>TF</th>
                <th>Price</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{new Date(r.ts).toLocaleString()}</td>
                  <td className="muted">{r.exchange}</td>
                  <td style={{fontWeight:600}}>{r.symbol}</td>
                  <td className={r.signal === 'BUY' ? 'chgUp' : r.signal === 'SELL' ? 'chgDown' : 'muted'}>{r.signal}</td>
                  <td className="muted">{r.source_tf || '-'}</td>
                  <td>{fmt(r.price)}</td>
                  <td style={{maxWidth: 680}}>
                    <div className="muted" style={{whiteSpace:'pre-wrap'}}>{r.reason || '-'}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function fmt(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs>=1000) return Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
  return Number(n).toFixed(6);
}
