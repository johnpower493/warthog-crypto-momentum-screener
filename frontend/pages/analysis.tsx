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

type SymbolPerf = {
  symbol: string;
  exchange: string;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_r: number;
  total_r: number;
  avg_mae_r: number;
  avg_mfe_r: number;
  avg_bars: number;
  expectancy: number;
};

type RecentAlert = {
  id: number;
  ts: number;
  exchange: string;
  symbol: string;
  signal: string;
  source_tf: string;
  reason: string;
  price: number;
  grade: string;
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
  const [symbolPerf, setSymbolPerf] = useState<{ best: SymbolPerf[]; worst: SymbolPerf[] }>({ best: [], worst: [] });
  const [recentAlerts, setRecentAlerts] = useState<RecentAlert[]>([]);
  const [status, setStatus] = useState<'idle'|'loading'|'error'>('idle');
  const [recomputeStatus, setRecomputeStatus] = useState<'idle'|'running'|'done'|'error'>('idle');
  const [recomputeResult, setRecomputeResult] = useState<{ n: number; elapsed_sec: number } | null>(null);
  
  // Filtered win rate controls
  const [filterGrade, setFilterGrade] = useState<string>('');
  const [filterTf, setFilterTf] = useState<string>('');
  const [filterSide, setFilterSide] = useState<string>('');
  const [filterSymbol, setFilterSymbol] = useState<string>('');
  const [filteredStats, setFilteredStats] = useState<{
    filters: { grade: string; source_tf: string; signal: string; symbol: string };
    stats: { n_trades: number; wins: number; losses: number; win_rate: number; avg_r: number; total_r: number; expectancy: number; tp1_count: number; tp2_count: number; tp3_count: number };
    grade_breakdown: { grade: string; n: number; win_rate: number; avg_r: number }[];
    available_symbols: { symbol: string; exchange: string; n: number }[];
  } | null>(null);

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

      // Build filtered winrate URL
      const filteredUrl = new URL(base + '/meta/analysis/filtered_winrate');
      filteredUrl.searchParams.set('window_days', String(windowDays));
      filteredUrl.searchParams.set('exchange', exchange);
      filteredUrl.searchParams.set('top200_only', top200Only ? 'true' : 'false');
      if (filterGrade) filteredUrl.searchParams.set('grade', filterGrade);
      if (filterTf) filteredUrl.searchParams.set('source_tf', filterTf);
      if (filterSide) filteredUrl.searchParams.set('signal', filterSide);
      if (filterSymbol) filteredUrl.searchParams.set('symbol', filterSymbol);

      // Fetch main report, symbol performance, recent A-grade alerts, and filtered stats in parallel
      const [reportResp, symbolsResp, alertsResp, filteredResp] = await Promise.all([
        fetch(url.toString()),
        fetch(`${base}/meta/analysis/symbols?window_days=${windowDays}&min_trades=${minTrades}`),
        fetch(`${base}/meta/alerts?min_grade=A&limit=20&since_minutes=1440`),
        fetch(filteredUrl.toString()),
      ]);

      const data = reportResp.ok ? await reportResp.json() : null;
      const symbolsData = symbolsResp.ok ? await symbolsResp.json() : null;
      const alertsData = alertsResp.ok ? await alertsResp.json() : null;
      const filteredData = filteredResp.ok ? await filteredResp.json() : null;

      setSummary(data?.summary || null);
      setStatusInfo(data?.status || null);
      setBreakdown(data?.breakdown?.rows || []);
      setBestBuckets(data?.best_buckets?.rows || []);
      setWorst(data?.worst_symbols?.rows || []);
      setBest(data?.best_symbols?.rows || []);
      setSymbolPerf({
        best: symbolsData?.best_performers || [],
        worst: symbolsData?.worst_performers || [],
      });
      setRecentAlerts(alertsData?.alerts || []);
      setFilteredStats(filteredData || null);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  };

  const recompute = async () => {
    setRecomputeStatus('running');
    setRecomputeResult(null);
    try {
      const base = backendHttp || 'http://127.0.0.1:8000';
      const url = new URL(base + '/meta/analysis/run');
      url.searchParams.set('window_days', String(windowDays));
      url.searchParams.set('exchange', exchange);
      url.searchParams.set('top200_only', top200Only ? 'true' : 'false');
      const resp = await fetch(url.toString(), { method: 'POST' });
      if (!resp.ok) throw new Error('bad response');
      const result = await resp.json();
      setRecomputeResult({ n: result.n || 0, elapsed_sec: result.elapsed_sec || 0 });
      setRecomputeStatus('done');
      // Auto-clear success message after 5 seconds
      setTimeout(() => setRecomputeStatus('idle'), 5000);
      await load();
    } catch {
      setRecomputeStatus('error');
      setTimeout(() => setRecomputeStatus('idle'), 5000);
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
            <button 
              className="button" 
              onClick={recompute}
              disabled={recomputeStatus === 'running'}
              style={{ 
                minWidth: 120,
                background: recomputeStatus === 'running' ? 'var(--status-reconnecting)' : 
                           recomputeStatus === 'done' ? 'var(--up)' : 
                           recomputeStatus === 'error' ? 'var(--down)' : undefined,
                color: recomputeStatus !== 'idle' ? '#000' : undefined,
              }}
            >
              {recomputeStatus === 'running' ? '⏳ Running...' : 
               recomputeStatus === 'done' ? `✓ Done (${recomputeResult?.n || 0} alerts)` :
               recomputeStatus === 'error' ? '✗ Failed' :
               '🔄 Recompute'}
            </button>
            <button className="button" onClick={load} disabled={status === 'loading'}>
              {status === 'loading' ? '...' : 'Refresh'}
            </button>
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

        {/* Recommended Setups - Recent A-Grade Signals */}
        <div style={{padding:12}}>
          <div style={{marginBottom:12, padding:16, background:'linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(6,95,70,0.1) 100%)', borderRadius:8, border:'1px solid rgba(16,185,129,0.3)'}}>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
              <div>
                <h3 style={{margin:0, color:'var(--up)'}}>🎯 Recommended Setups (A-Grade)</h3>
                <p className="muted" style={{margin:'4px 0 0 0', fontSize:12}}>
                  High-confidence signals with MTF alignment • Last 24 hours
                </p>
              </div>
              <div className="badge" style={{background:'var(--up)', color:'#000', fontWeight:700}}>
                {recentAlerts.length} signals
              </div>
            </div>
            
            {recentAlerts.length > 0 ? (
              <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:12}}>
                {recentAlerts.slice(0, 8).map((alert, i) => {
                  const symbolWinRate = symbolPerf.best.find(s => s.symbol === alert.symbol)?.win_rate;
                  const isGoodSymbol = symbolWinRate && symbolWinRate > 0.5;
                  return (
                    <div key={i} className="card" style={{padding:12, borderLeft: `3px solid ${alert.signal === 'BUY' ? 'var(--up)' : 'var(--down)'}`}}>
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                        <div>
                          <span style={{fontWeight:700, fontSize:16}}>{alert.symbol}</span>
                          <span className="muted" style={{marginLeft:8, fontSize:12}}>{alert.exchange}</span>
                        </div>
                        <span className={`badge ${alert.signal === 'BUY' ? 'chgUp' : 'chgDown'}`} style={{fontWeight:700}}>
                          {alert.signal}
                        </span>
                      </div>
                      <div style={{marginTop:8, fontSize:13}}>
                        <span className="muted">Price:</span> ${alert.price?.toFixed(4) || '—'}
                        <span className="muted" style={{marginLeft:12}}>TF:</span> {alert.source_tf || '15m'}
                      </div>
                      <div style={{marginTop:4, fontSize:11, color:'var(--muted)'}}>
                        {new Date(alert.ts).toLocaleString()}
                      </div>
                      {isGoodSymbol && (
                        <div style={{marginTop:6, fontSize:11, color:'var(--up)'}}>
                          ✓ Good historical performance ({(symbolWinRate! * 100).toFixed(0)}% win rate)
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="muted" style={{textAlign:'center', padding:20}}>
                No A-grade signals in the last 24 hours. A-grade signals require high score AND MTF alignment (1h/4h).
              </div>
            )}
          </div>
        </div>

        {/* Grading Model Info */}
        <div style={{padding:'0 12px 12px 12px'}}>
          <div style={{padding:12, background:'rgba(74,158,255,0.1)', borderRadius:8, border:'1px solid rgba(74,158,255,0.2)', fontSize:12}}>
            <strong style={{color:'var(--accent)'}}>📊 Enhanced Grading Model (v3)</strong>
            <div className="muted" style={{marginTop:4}}>
              Signals are now graded with: OI alignment • RVOL • Momentum • RSI extremes • Funding rate • Volatility • MTF confluence (1h/4h) • Bollinger Bands • VWAP • ATR risk • Symbol performance.
              <strong> A-grade requires score ≥6 AND 1h/4h alignment.</strong>
            </div>
          </div>
        </div>

        {/* Filtered Win Rate Calculator */}
        <div style={{padding:12}}>
          <div style={{padding:16, background:'var(--panel)', borderRadius:8, border:'1px solid var(--border)'}}>
            <h3 style={{margin:'0 0 12px 0', fontSize:14}}>🎯 Win Rate Calculator</h3>
            <p className="muted" style={{margin:'0 0 12px 0', fontSize:12}}>
              Filter by grade, timeframe, and side to see specific win rates
            </p>
            
            <div style={{display:'flex', gap:12, flexWrap:'wrap', marginBottom:16}}>
              <div>
                <label className="muted" style={{fontSize:11, display:'block', marginBottom:4}}>Grade</label>
                <select 
                  value={filterGrade} 
                  onChange={e => { setFilterGrade(e.target.value); }}
                  style={{padding:'6px 12px', borderRadius:4, background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)'}}
                >
                  <option value="">All Grades</option>
                  <option value="A">A Grade</option>
                  <option value="B">B Grade</option>
                  <option value="C">C Grade</option>
                </select>
              </div>
              
              <div>
                <label className="muted" style={{fontSize:11, display:'block', marginBottom:4}}>Timeframe</label>
                <select 
                  value={filterTf} 
                  onChange={e => { setFilterTf(e.target.value); }}
                  style={{padding:'6px 12px', borderRadius:4, background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)'}}
                >
                  <option value="">All TFs</option>
                  <option value="15m">15m</option>
                  <option value="1h">1h</option>
                  <option value="4h">4h</option>
                </select>
              </div>
              
              <div>
                <label className="muted" style={{fontSize:11, display:'block', marginBottom:4}}>Side</label>
                <select 
                  value={filterSide} 
                  onChange={e => { setFilterSide(e.target.value); }}
                  style={{padding:'6px 12px', borderRadius:4, background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)'}}
                >
                  <option value="">Both</option>
                  <option value="BUY">BUY Only</option>
                  <option value="SELL">SELL Only</option>
                </select>
              </div>
              
              <div>
                <label className="muted" style={{fontSize:11, display:'block', marginBottom:4}}>Exchange</label>
                <select 
                  value={exchange} 
                  onChange={e => { setExchange(e.target.value as 'all' | 'binance' | 'bybit'); }}
                  style={{padding:'6px 12px', borderRadius:4, background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)'}}
                >
                  <option value="all">All Exchanges</option>
                  <option value="binance">Binance</option>
                  <option value="bybit">Bybit</option>
                </select>
              </div>
              
              <div>
                <label className="muted" style={{fontSize:11, display:'block', marginBottom:4}}>Symbol</label>
                <select 
                  value={filterSymbol} 
                  onChange={e => { setFilterSymbol(e.target.value); }}
                  style={{padding:'6px 12px', borderRadius:4, background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)', minWidth:140}}
                >
                  <option value="">All Symbols</option>
                  {filteredStats?.available_symbols?.map((s, i) => (
                    <option key={i} value={s.symbol}>
                      {s.symbol} ({s.n})
                    </option>
                  ))}
                </select>
              </div>
              
              <div style={{display:'flex', alignItems:'flex-end'}}>
                <button className="button" onClick={load} style={{padding:'6px 16px'}}>
                  Calculate
                </button>
              </div>
              
              {(filterGrade || filterTf || filterSide || filterSymbol) && (
                <div style={{display:'flex', alignItems:'flex-end'}}>
                  <button 
                    className="button" 
                    onClick={() => { setFilterGrade(''); setFilterTf(''); setFilterSide(''); setFilterSymbol(''); }}
                    style={{padding:'6px 12px', background:'transparent', border:'1px solid var(--border)'}}
                  >
                    ✕ Clear
                  </button>
                </div>
              )}
            </div>
            
            {/* Filtered Results */}
            {filteredStats && (
              <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))', gap:12}}>
                <div className="card" style={{padding:12, textAlign:'center'}}>
                  <div className="muted" style={{fontSize:10, marginBottom:4}}>Win Rate</div>
                  <div style={{
                    fontSize:28, 
                    fontWeight:700, 
                    color: filteredStats.stats.win_rate >= 0.55 ? 'var(--up)' : 
                           filteredStats.stats.win_rate >= 0.45 ? 'var(--text)' : 'var(--down)'
                  }}>
                    {(filteredStats.stats.win_rate * 100).toFixed(1)}%
                  </div>
                  <div style={{fontSize:10, color:'#666'}}>{filteredStats.stats.wins}W / {filteredStats.stats.losses}L</div>
                </div>
                
                <div className="card" style={{padding:12, textAlign:'center'}}>
                  <div className="muted" style={{fontSize:10, marginBottom:4}}>Trades</div>
                  <div style={{fontSize:28, fontWeight:700}}>{filteredStats.stats.n_trades}</div>
                  <div style={{fontSize:10, color:'#666'}}>
                    {filteredStats.filters.grade !== 'all' ? filteredStats.filters.grade : 'All'} • 
                    {filteredStats.filters.source_tf !== 'all' ? ` ${filteredStats.filters.source_tf}` : ' All TF'} • 
                    {filteredStats.filters.signal !== 'all' ? ` ${filteredStats.filters.signal}` : ' Both'}
                    {filteredStats.filters.symbol !== 'all' ? ` • ${filteredStats.filters.symbol}` : ''}
                  </div>
                </div>
                
                <div className="card" style={{padding:12, textAlign:'center'}}>
                  <div className="muted" style={{fontSize:10, marginBottom:4}}>Avg R</div>
                  <div style={{
                    fontSize:28, 
                    fontWeight:700,
                    color: filteredStats.stats.avg_r > 0 ? 'var(--up)' : filteredStats.stats.avg_r < 0 ? 'var(--down)' : 'var(--text)'
                  }}>
                    {filteredStats.stats.avg_r > 0 ? '+' : ''}{filteredStats.stats.avg_r.toFixed(2)}R
                  </div>
                  <div style={{fontSize:10, color:'#666'}}>Total: {filteredStats.stats.total_r > 0 ? '+' : ''}{filteredStats.stats.total_r.toFixed(1)}R</div>
                </div>
                
                <div className="card" style={{padding:12, textAlign:'center'}}>
                  <div className="muted" style={{fontSize:10, marginBottom:4}}>Expectancy</div>
                  <div style={{
                    fontSize:28, 
                    fontWeight:700,
                    color: filteredStats.stats.expectancy > 0 ? 'var(--up)' : filteredStats.stats.expectancy < 0 ? 'var(--down)' : 'var(--text)'
                  }}>
                    {filteredStats.stats.expectancy > 0 ? '+' : ''}{filteredStats.stats.expectancy.toFixed(2)}
                  </div>
                  <div style={{fontSize:10, color:'#666'}}>Per trade edge</div>
                </div>
                
                <div className="card" style={{padding:12, textAlign:'center'}}>
                  <div className="muted" style={{fontSize:10, marginBottom:4}}>TP Distribution</div>
                  <div style={{fontSize:14, fontWeight:600}}>
                    <span style={{color:'#22c55e'}}>TP1:{filteredStats.stats.tp1_count}</span>
                    <span style={{color:'#3b82f6', marginLeft:6}}>TP2:{filteredStats.stats.tp2_count}</span>
                    <span style={{color:'#a855f7', marginLeft:6}}>TP3:{filteredStats.stats.tp3_count}</span>
                  </div>
                  <div style={{fontSize:10, color:'#666', marginTop:4}}>Take profit hits</div>
                </div>
              </div>
            )}
            
            {/* Grade Breakdown (when no grade filter) */}
            {filteredStats && !filterGrade && filteredStats.grade_breakdown.length > 0 && (
              <div style={{marginTop:16}}>
                <div className="muted" style={{fontSize:11, marginBottom:8}}>Win Rate by Grade:</div>
                <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                  {filteredStats.grade_breakdown.map((g, i) => (
                    <div 
                      key={i} 
                      className="card" 
                      style={{
                        padding:'8px 16px', 
                        display:'flex', 
                        alignItems:'center', 
                        gap:8,
                        cursor:'pointer',
                        border: filterGrade === g.grade ? '1px solid var(--accent)' : undefined
                      }}
                      onClick={() => setFilterGrade(g.grade === '—' ? '' : g.grade)}
                    >
                      <span style={{
                        fontWeight:700, 
                        fontSize:16,
                        color: g.grade === 'A' ? 'var(--up)' : g.grade === 'B' ? 'var(--status-reconnecting)' : 'var(--down)'
                      }}>
                        {g.grade}
                      </span>
                      <span style={{fontSize:12}}>
                        <span style={{color: g.win_rate >= 0.5 ? 'var(--up)' : 'var(--down)'}}>
                          {(g.win_rate * 100).toFixed(1)}%
                        </span>
                        <span className="muted" style={{marginLeft:4}}>({g.n})</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
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
