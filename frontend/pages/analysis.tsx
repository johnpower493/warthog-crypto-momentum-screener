import { useEffect, useState } from 'react';

type Summary = {
  window_days: number;
  exchange: string;
  top200_only: boolean;
  n_trades: number;
  win_rate: number;
  avg_r: number;
  avg_mae_r: number;
  avg_mfe_r: number;
  avg_bars_to_resolve: number;
};

type BreakdownRow = {
  setup_grade: string;
  source_tf: string;
  signal: string;
  n: number;
  win_rate: number;
  avg_r: number;
};

type WorstRow = {
  exchange: string;
  symbol: string;
  n: number;
  avg_r: number;
  win_rate: number;
};

export default function AnalysisPage() {
  const [backendHttp, setBackendHttp] = useState<string>(process.env.NEXT_PUBLIC_BACKEND_HTTP || '');

  const [windowDays, setWindowDays] = useState<number>(30);
  const [exchange, setExchange] = useState<'all'|'binance'|'bybit'>('all');
  const [top200Only, setTop200Only] = useState<boolean>(true);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [statusInfo, setStatusInfo] = useState<any>(null);
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([]);
  const [worst, setWorst] = useState<WorstRow[]>([]);
  const [best, setBest] = useState<WorstRow[]>([]);
  const [bestBuckets, setBestBuckets] = useState<BreakdownRow[]>([]);
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
      const base = backendHttp || 'http://127.0.0.1:8000';
      const qs = `window_days=${windowDays}&exchange=${exchange}&top200_only=${top200Only ? 'true':'false'}`;
      const [sResp, stResp, bResp, bbResp, wResp, bestResp] = await Promise.all([
        fetch(`${base}/meta/analysis/summary?${qs}`),
        fetch(`${base}/meta/analysis/status?${qs}`),
        fetch(`${base}/meta/analysis/breakdown?${qs}`),
        fetch(`${base}/meta/analysis/best_buckets?${qs}`),
        fetch(`${base}/meta/analysis/worst_symbols?${qs}`),
        fetch(`${base}/meta/analysis/best_symbols?${qs}`),
      ]);
      const s = sResp.ok ? await sResp.json() : null;
      const st = stResp.ok ? await stResp.json() : null;
      const b = bResp.ok ? await bResp.json() : null;
      const bb = bbResp.ok ? await bbResp.json() : null;
      const w = wResp.ok ? await wResp.json() : null;
      const best = bestResp.ok ? await bestResp.json() : null;
      setSummary(s);
      setStatusInfo(st);
      setBreakdown(b?.rows || []);
      setBestBuckets(bb?.rows || []);
      setWorst(w?.rows || []);
      setBest(best?.rows || []);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  };

  const recompute = async () => {
    setStatus('loading');
    try {
      const base = backendHttp || 'http://127.0.0.1:8000';
      const url = new URL(base + '/meta/analysis/run');
      url.searchParams.set('window_days', String(windowDays));
      url.searchParams.set('exchange', exchange);
      url.searchParams.set('top200_only', top200Only ? 'true' : 'false');
      const resp = await fetch(url.toString(), { method: 'POST' });
      if (!resp.ok) throw new Error('bad response');
      await load();
    } catch {
      setStatus('error');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendHttp, windowDays, exchange, top200Only]);

  return (
    <div className="container">
      <div className="panel">
        <div className="toolbar" style={{justifyContent:'space-between'}}>
          <div className="group">
            <span className="badge">Analysis</span>
            <span className="badge">{windowDays}d</span>
            <span className="badge">{top200Only ? 'Top200' : 'All'}</span>
            <span className="badge">{exchange}</span>
            <span className="badge">Last recompute: {statusInfo?.last_run_ts ? new Date(statusInfo.last_run_ts).toLocaleString() : '—'}</span>
            <span className="badge">NONE rate: {statusInfo ? (statusInfo.none_rate*100).toFixed(1)+'%' : '—'}</span>
            {status === 'loading' && <span className="badge">Loading…</span>}
            {status === 'error' && <span className="badge">Error</span>}
          </div>
          <div className="group" style={{flexWrap:'wrap'}}>
            <select className="select" value={windowDays} onChange={(e)=>setWindowDays(parseInt(e.target.value,10))}>
              <option value={30}>30d</option>
              <option value={90}>90d</option>
            </select>
            <select className="select" value={exchange} onChange={(e)=>setExchange(e.target.value as any)}>
              <option value="all">All</option>
              <option value="binance">Binance</option>
              <option value="bybit">Bybit</option>
            </select>
            <label style={{display:'inline-flex', alignItems:'center', gap:8}}>
              <input type="checkbox" checked={top200Only} onChange={(e)=>setTop200Only(e.target.checked)} />
              <span className="muted">Top 200 only</span>
            </label>
            <button className="button" onClick={recompute}>Recompute</button>
            <button className="button" onClick={load}>Refresh</button>
            <a className="button" href="/">Home</a>
          </div>
        </div>

        <div style={{padding:12}}>
          <div className="grid" style={{gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))'}}>
            <div className="card">
              <div className="muted">Trades (resolved)</div>
              <div style={{fontSize:24, fontWeight:800}}>{summary?.n_trades ?? '—'}</div>
            </div>
            <div className="card">
              <div className="muted">Win rate</div>
              <div style={{fontSize:24, fontWeight:800}}>{summary ? (summary.win_rate*100).toFixed(1)+'%' : '—'}</div>
            </div>
            <div className="card">
              <div className="muted">Avg R</div>
              <div style={{fontSize:24, fontWeight:800}}>{summary ? Number(summary.avg_r).toFixed(2) : '—'}</div>
            </div>
            <div className="card">
              <div className="muted">Avg MAE (R)</div>
              <div style={{fontSize:24, fontWeight:800}}>{summary ? Number(summary.avg_mae_r).toFixed(2) : '—'}</div>
            </div>
            <div className="card">
              <div className="muted">Avg MFE (R)</div>
              <div style={{fontSize:24, fontWeight:800}}>{summary ? Number(summary.avg_mfe_r).toFixed(2) : '—'}</div>
            </div>
            <div className="card">
              <div className="muted">Avg bars to resolve</div>
              <div style={{fontSize:24, fontWeight:800}}>{summary ? Number(summary.avg_bars_to_resolve).toFixed(1) : '—'}</div>
              <div className="muted" style={{fontSize:12}}>15m bars (max horizon 96)</div>
            </div>
          </div>
        </div>

        <div style={{padding:12}}>
          <h3 style={{marginTop:0}}>Breakdown (Grade × TF × Side)</h3>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Grade</th>
                  <th>TF</th>
                  <th>Side</th>
                  <th>Trades</th>
                  <th>Win %</th>
                  <th>Avg R</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((r, i) => (
                  <tr key={i}>
                    <td style={{fontWeight:800}}>{r.setup_grade}</td>
                    <td className="muted">{r.source_tf}</td>
                    <td className={r.signal==='BUY'?'chgUp':'chgDown'} style={{fontWeight:800}}>{r.signal}</td>
                    <td>{r.n}</td>
                    <td>{(r.win_rate*100).toFixed(1)}%</td>
                    <td>{Number(r.avg_r).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{padding:12}}>
          <h3 style={{marginTop:0}}>Best buckets (Grade × TF × Side)</h3>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Grade</th>
                  <th>TF</th>
                  <th>Side</th>
                  <th>Trades</th>
                  <th>Win %</th>
                  <th>Avg R</th>
                </tr>
              </thead>
              <tbody>
                {bestBuckets.map((r, i) => (
                  <tr key={i}>
                    <td style={{fontWeight:800}}>{r.setup_grade}</td>
                    <td className="muted">{r.source_tf}</td>
                    <td className={r.signal==='BUY'?'chgUp':'chgDown'} style={{fontWeight:800}}>{r.signal}</td>
                    <td>{r.n}</td>
                    <td>{(r.win_rate*100).toFixed(1)}%</td>
                    <td>{Number(r.avg_r).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{padding:12}}>
          <h3 style={{marginTop:0}}>Best symbols (by Avg R)</h3>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Exchange</th>
                  <th>Symbol</th>
                  <th>Trades</th>
                  <th>Win %</th>
                  <th>Avg R</th>
                </tr>
              </thead>
              <tbody>
                {best.map((r, i) => (
                  <tr key={i}>
                    <td className="muted">{r.exchange}</td>
                    <td style={{fontWeight:800}}>{r.symbol}</td>
                    <td>{r.n}</td>
                    <td>{(r.win_rate*100).toFixed(1)}%</td>
                    <td className={r.avg_r<0?'chgDown':'chgUp'} style={{fontWeight:800}}>{Number(r.avg_r).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{padding:12}}>
          <h3 style={{marginTop:0}}>Worst symbols (by Avg R)</h3>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Exchange</th>
                  <th>Symbol</th>
                  <th>Trades</th>
                  <th>Win %</th>
                  <th>Avg R</th>
                </tr>
              </thead>
              <tbody>
                {worst.map((r, i) => (
                  <tr key={i}>
                    <td className="muted">{r.exchange}</td>
                    <td style={{fontWeight:800}}>{r.symbol}</td>
                    <td>{r.n}</td>
                    <td>{(r.win_rate*100).toFixed(1)}%</td>
                    <td className={r.avg_r<0?'chgDown':'chgUp'} style={{fontWeight:800}}>{Number(r.avg_r).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
