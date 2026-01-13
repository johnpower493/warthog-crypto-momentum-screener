import { useEffect, useState } from 'react';

function SkeletonLoader({ width = '100%', height = 20 }: { width?: string | number; height?: number }) {
  return (
    <div 
      className="skeleton-loader"
      style={{ width, height }}
    />
  );
}

function SkeletonCard() {
  return (
    <div className="card card-static">
      <SkeletonLoader width="60%" height={14} />
      <div style={{ marginTop: 8 }}>
        <SkeletonLoader width="40%" height={28} />
      </div>
    </div>
  );
}

function SkeletonTable({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="tableWrap">
      <table className="table">
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}><SkeletonLoader width="70%" height={14} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIdx) => (
            <tr key={rowIdx}>
              {Array.from({ length: cols }).map((_, colIdx) => (
                <td key={colIdx}><SkeletonLoader width={colIdx === 0 ? '50%' : '80%'} height={16} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
  const [minTrades, setMinTrades] = useState<number>(5);
  const [limit, setLimit] = useState<number>(25);

  const [sortBreakdownBy, setSortBreakdownBy] = useState<'n'|'win_rate'|'avg_r'>('n');
  const [sortSymbolsBy, setSortSymbolsBy] = useState<'avg_r'|'win_rate'|'n'>('avg_r');

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
      const url = new URL(base + '/meta/analysis/report');
      url.searchParams.set('window_days', String(windowDays));
      url.searchParams.set('exchange', exchange);
      url.searchParams.set('top200_only', top200Only ? 'true' : 'false');

      // Map UI filters to report params
      url.searchParams.set('breakdown_min_trades', String(Math.max(1, minTrades)));
      url.searchParams.set('breakdown_limit', String(Math.max(1, limit)));
      url.searchParams.set('bucket_min_trades', String(Math.max(1, minTrades)));
      url.searchParams.set('bucket_limit', String(Math.max(1, limit)));
      url.searchParams.set('symbol_min_trades', String(Math.max(1, minTrades)));
      url.searchParams.set('symbol_limit', String(Math.max(1, limit)));

      const resp = await fetch(url.toString());
      const data = resp.ok ? await resp.json() : null;

      setSummary(data?.summary || null);
      setStatusInfo(data?.status || null);
      setBreakdown(data?.breakdown?.rows || []);
      setBestBuckets(data?.best_buckets?.rows || []);
      setWorst(data?.worst_symbols?.rows || []);
      setBest(data?.best_symbols?.rows || []);
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
  }, [backendHttp, windowDays, exchange, top200Only, minTrades, limit]);

  const sortedBreakdown = [...breakdown].sort((a, b) => {
    if (sortBreakdownBy === 'n') return (b.n || 0) - (a.n || 0);
    if (sortBreakdownBy === 'win_rate') return (b.win_rate || 0) - (a.win_rate || 0);
    return (b.avg_r || 0) - (a.avg_r || 0);
  });

  const sortedBestBuckets = [...bestBuckets].sort((a, b) => {
    // best buckets should default to avg_r desc
    if (sortBreakdownBy === 'n') return (b.n || 0) - (a.n || 0);
    if (sortBreakdownBy === 'win_rate') return (b.win_rate || 0) - (a.win_rate || 0);
    return (b.avg_r || 0) - (a.avg_r || 0);
  });

  const sortSymbols = (rows: WorstRow[]) => {
    const out = [...rows];
    out.sort((a, b) => {
      if (sortSymbolsBy === 'n') return (b.n || 0) - (a.n || 0);
      if (sortSymbolsBy === 'win_rate') return (b.win_rate || 0) - (a.win_rate || 0);
      return (b.avg_r || 0) - (a.avg_r || 0);
    });
    return out;
  };
  const sortedBest = sortSymbols(best);
  const sortedWorst = sortSymbols(worst);

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
            <span className="badge">Rows: {statusInfo?.total_rows ?? '—'} (resolved {statusInfo?.resolved_rows ?? '—'}, NONE {statusInfo?.none_rows ?? '—'})</span>
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
            <label style={{display:'inline-flex', alignItems:'center', gap:8}}>
              <span className="muted">Min trades</span>
              <input
                className="input"
                style={{width: 90}}
                type="number"
                min={1}
                step={1}
                value={minTrades}
                onChange={(e)=>setMinTrades(Math.max(1, parseInt(e.target.value || '1', 10)))}
              />
            </label>
            <label style={{display:'inline-flex', alignItems:'center', gap:8}}>
              <span className="muted">Limit</span>
              <input
                className="input"
                style={{width: 90}}
                type="number"
                min={5}
                step={5}
                value={limit}
                onChange={(e)=>setLimit(Math.max(5, parseInt(e.target.value || '25', 10)))}
              />
            </label>
            <button className="button" onClick={recompute}>Recompute</button>
            <button className="button" onClick={load}>Refresh</button>
            <a className="button" href="/">Home</a>
          </div>
        </div>

        <div style={{padding:12}}>
          <div className="grid" style={{gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))'}}>
            {status === 'loading' && !summary ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>

        <div style={{padding:12}}>
          <div className="toolbar" style={{justifyContent:'space-between', padding:'0 0 8px 0'}}>
            <h3 style={{margin:0}}>Breakdown (Grade × TF × Side)</h3>
            <div className="group">
              <span className="muted">Sort:</span>
              <select className="select" value={sortBreakdownBy} onChange={(e)=>setSortBreakdownBy(e.target.value as any)}>
                <option value="n">Trades</option>
                <option value="win_rate">Win %</option>
                <option value="avg_r">Avg R</option>
              </select>
            </div>
          </div>
          {status === 'loading' && breakdown.length === 0 ? (
            <SkeletonTable rows={5} cols={6} />
          ) : (
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
                  {sortedBreakdown.map((r, i) => (
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
          )}
        </div>

        <div style={{padding:12}}>
          <h3 style={{marginTop:0}}>Best buckets (Grade × TF × Side)</h3>
          {status === 'loading' && bestBuckets.length === 0 ? (
            <SkeletonTable rows={5} cols={6} />
          ) : (
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
                  {sortedBestBuckets.map((r, i) => (
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
          )}
        </div>

        <div style={{padding:12}}>
          <div className="toolbar" style={{justifyContent:'space-between', padding:'0 0 8px 0'}}>
            <h3 style={{margin:0}}>Best symbols</h3>
            <div className="group">
              <span className="muted">Sort:</span>
              <select className="select" value={sortSymbolsBy} onChange={(e)=>setSortSymbolsBy(e.target.value as any)}>
                <option value="avg_r">Avg R</option>
                <option value="win_rate">Win %</option>
                <option value="n">Trades</option>
              </select>
            </div>
          </div>
          {status === 'loading' && best.length === 0 ? (
            <SkeletonTable rows={5} cols={5} />
          ) : (
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
                  {sortedBest.map((r, i) => (
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
          )}
        </div>

        <div style={{padding:12}}>
          <h3 style={{marginTop:0}}>Worst symbols</h3>
          {status === 'loading' && worst.length === 0 ? (
            <SkeletonTable rows={5} cols={5} />
          ) : (
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
                  {sortedWorst.map((r, i) => (
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
          )}
        </div>

      </div>
    </div>
  );
}
