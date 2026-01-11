import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';

interface SignalAlert {
  id: number;
  ts: number;
  exchange: string;
  symbol: string;
  signal: 'BUY' | 'SELL' | string;
  source_tf?: string | null;
  reason?: string | null;
  price?: number | null;
  grade?: string;
}

interface Stats {
  total: number;
  buys: number;
  sells: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  binance: number;
  bybit: number;
}

export default function AlertsHistoryPage() {
  const [alerts, setAlerts] = useState<SignalAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendHttp, setBackendHttp] = useState<string>('');
  
  // Filters
  const [symbolFilter, setSymbolFilter] = useState('');
  const [sideFilter, setSideFilter] = useState<'all' | 'BUY' | 'SELL'>('all');
  const [gradeFilter, setGradeFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [exchangeFilter, setExchangeFilter] = useState<'all' | 'binance' | 'bybit'>('all');
  const [tfFilter, setTfFilter] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<'1h' | '4h' | '24h' | '7d' | 'all'>('24h');
  const [limit, setLimit] = useState(500);

  useEffect(() => {
    try {
      const resolved = process.env.NEXT_PUBLIC_BACKEND_HTTP || `${window.location.protocol}//${window.location.hostname}:8000`;
      setBackendHttp(resolved);
    } catch {}
  }, []);

  useEffect(() => {
    if (!backendHttp) return;
    
    const fetchAlerts = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        if (exchangeFilter !== 'all') params.set('exchange', exchangeFilter);
        if (sideFilter !== 'all') params.set('signal', sideFilter);
        if (gradeFilter !== 'all') params.set('min_grade', gradeFilter);
        if (tfFilter !== 'all') params.set('source_tf', tfFilter);
        
        const resp = await fetch(`${backendHttp}/alerts/history?${params.toString()}`);
        
        if (resp.ok) {
          const data = await resp.json();
          setAlerts(Array.isArray(data) ? data : data.alerts || []);
        }
      } catch (e) {
        console.error('Failed to fetch alerts:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [backendHttp, exchangeFilter, sideFilter, gradeFilter, tfFilter, limit]);

  // Apply client-side filters (symbol search, time range)
  const filteredAlerts = useMemo(() => {
    let filtered = alerts;
    
    // Symbol filter
    if (symbolFilter) {
      filtered = filtered.filter(a => 
        a.symbol.toLowerCase().includes(symbolFilter.toLowerCase())
      );
    }
    
    // Time range filter
    if (timeRange !== 'all') {
      const now = Date.now();
      const ranges: Record<string, number> = {
        '1h': 60 * 60 * 1000,
        '4h': 4 * 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
      };
      const cutoff = now - ranges[timeRange];
      filtered = filtered.filter(a => a.ts >= cutoff);
    }
    
    return filtered;
  }, [alerts, symbolFilter, timeRange]);

  // Calculate stats from filtered alerts
  const stats: Stats = useMemo(() => {
    return {
      total: filteredAlerts.length,
      buys: filteredAlerts.filter(a => a.signal === 'BUY').length,
      sells: filteredAlerts.filter(a => a.signal === 'SELL').length,
      gradeA: filteredAlerts.filter(a => a.grade === 'A').length,
      gradeB: filteredAlerts.filter(a => a.grade === 'B').length,
      gradeC: filteredAlerts.filter(a => a.grade === 'C').length,
      binance: filteredAlerts.filter(a => a.exchange === 'binance').length,
      bybit: filteredAlerts.filter(a => a.exchange === 'bybit').length,
    };
  }, [filteredAlerts]);

  // Get unique timeframes from alerts
  const uniqueTfs = useMemo(() => {
    const tfs = new Set(alerts.map(a => a.source_tf).filter(Boolean));
    return Array.from(tfs).sort();
  }, [alerts]);

  const fmtTime = (ts: number) => {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };
  
  const fmtFullTime = (ts: number) => new Date(ts).toLocaleString();
  
  const fmtPrice = (n?: number | null) => {
    if (n === undefined || n === null || Number.isNaN(n)) return '-';
    const abs = Math.abs(n);
    if (abs >= 1000) return '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (abs >= 1) return '$' + Number(n).toFixed(2);
    return '$' + Number(n).toPrecision(4);
  };

  const gradeColor = (g?: string) => {
    if (g === 'A') return '#10b981';
    if (g === 'B') return '#f59e0b';
    if (g === 'C') return '#ef4444';
    return '#6b7280';
  };

  return (
    <>
      <Head>
        <title>Signal History | Crypto Screener</title>
      </Head>
      <div className="container">
        <div className="panel">
          {/* Header */}
          <div className="toolbar" style={{ borderBottom: '1px solid var(--border)', gap: 16 }}>
            <Link href="/" className="button">← Back</Link>
            <h2 style={{ margin: 0, flex: 1 }}>📊 Signal History</h2>
            <span className="muted" style={{ fontSize: 13 }}>
              Auto-refresh: 30s
            </span>
          </div>
          
          {/* Stats Bar */}
          <div style={{ 
            display: 'flex', 
            gap: 16, 
            padding: '12px 16px', 
            background: 'var(--bg-secondary)', 
            borderBottom: '1px solid var(--border)',
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', gap: 24, flex: 1, flexWrap: 'wrap' }}>
              <div>
                <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Total</span>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{stats.total}</div>
              </div>
              <div>
                <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Buys</span>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#10b981' }}>{stats.buys}</div>
              </div>
              <div>
                <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Sells</span>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444' }}>{stats.sells}</div>
              </div>
              <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 16 }}>
                <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Grade A</span>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#10b981' }}>{stats.gradeA}</div>
              </div>
              <div>
                <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Grade B</span>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b' }}>{stats.gradeB}</div>
              </div>
              <div>
                <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Grade C</span>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444' }}>{stats.gradeC}</div>
              </div>
              <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 16 }}>
                <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Binance</span>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{stats.binance}</div>
              </div>
              <div>
                <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Bybit</span>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{stats.bybit}</div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div style={{ 
            display: 'flex', 
            gap: 12, 
            padding: 16, 
            background: 'var(--bg)', 
            flexWrap: 'wrap', 
            alignItems: 'center',
            borderBottom: '1px solid var(--border)'
          }}>
            <input
              className="input"
              placeholder="🔍 Search symbol..."
              value={symbolFilter}
              onChange={e => setSymbolFilter(e.target.value)}
              style={{ width: 160 }}
            />
            
            <select 
              className="input" 
              value={exchangeFilter} 
              onChange={e => setExchangeFilter(e.target.value as any)}
              style={{ width: 120 }}
            >
              <option value="all">All Exchanges</option>
              <option value="binance">Binance</option>
              <option value="bybit">Bybit</option>
            </select>
            
            <select 
              className="input" 
              value={sideFilter} 
              onChange={e => setSideFilter(e.target.value as any)}
              style={{ width: 110 }}
            >
              <option value="all">All Sides</option>
              <option value="BUY">BUY Only</option>
              <option value="SELL">SELL Only</option>
            </select>
            
            <select 
              className="input" 
              value={gradeFilter} 
              onChange={e => setGradeFilter(e.target.value as any)}
              style={{ width: 110 }}
            >
              <option value="all">All Grades</option>
              <option value="A">Grade A+</option>
              <option value="B">Grade B+</option>
              <option value="C">Grade C+</option>
            </select>
            
            <select 
              className="input" 
              value={tfFilter} 
              onChange={e => setTfFilter(e.target.value)}
              style={{ width: 120 }}
            >
              <option value="all">All Timeframes</option>
              {uniqueTfs.map(tf => (
                <option key={tf} value={tf!}>{tf}</option>
              ))}
            </select>
            
            <select 
              className="input" 
              value={timeRange} 
              onChange={e => setTimeRange(e.target.value as any)}
              style={{ width: 110 }}
            >
              <option value="1h">Last 1h</option>
              <option value="4h">Last 4h</option>
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7d</option>
              <option value="all">All Time</option>
            </select>
            
            <select 
              className="input" 
              value={limit} 
              onChange={e => setLimit(Number(e.target.value))}
              style={{ width: 100 }}
            >
              <option value={100}>100 rows</option>
              <option value={250}>250 rows</option>
              <option value={500}>500 rows</option>
              <option value={1000}>1000 rows</option>
            </select>
            
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 13 }}>
              Showing {filteredAlerts.length} signals
            </span>
          </div>

          {loading && alerts.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center' }}>Loading signals...</div>
          ) : filteredAlerts.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>
              {alerts.length === 0 
                ? 'No signals yet. Signals appear here when trading signals are triggered by the screener.'
                : 'No signals match your filters.'}
            </div>
          ) : (
            <div style={{ maxHeight: 'calc(100vh - 340px)', overflow: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>Time</th>
                    <th style={{ width: 80 }}>Exchange</th>
                    <th style={{ width: 120 }}>Symbol</th>
                    <th style={{ width: 70 }}>Signal</th>
                    <th style={{ width: 60 }}>Grade</th>
                    <th style={{ width: 60 }}>TF</th>
                    <th style={{ width: 100 }}>Price</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAlerts.map((a, i) => (
                    <tr key={a.id || i}>
                      <td 
                        className="muted" 
                        style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                        title={fmtFullTime(a.ts)}
                      >
                        {fmtTime(a.ts)}
                      </td>
                      <td>
                        <span style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: a.exchange === 'binance' ? '#f3ba2f22' : '#f7931a22',
                          color: a.exchange === 'binance' ? '#f3ba2f' : '#f7931a',
                        }}>
                          {a.exchange}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{a.symbol}</td>
                      <td>
                        <span className="badge" style={{
                          background: a.signal === 'BUY' ? '#10b981' : '#ef4444',
                          color: '#fff',
                          padding: '4px 10px',
                          fontWeight: 600
                        }}>
                          {a.signal}
                        </span>
                      </td>
                      <td>
                        {a.grade && (
                          <span style={{
                            display: 'inline-block',
                            width: 28,
                            height: 28,
                            lineHeight: '28px',
                            textAlign: 'center',
                            borderRadius: '50%',
                            fontWeight: 700,
                            fontSize: 13,
                            background: gradeColor(a.grade) + '22',
                            color: gradeColor(a.grade),
                          }}>
                            {a.grade}
                          </span>
                        )}
                      </td>
                      <td className="muted">{a.source_tf || '-'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{fmtPrice(a.price)}</td>
                      <td style={{ maxWidth: 400 }}>
                        <div className="muted" style={{ 
                          fontSize: 12, 
                          whiteSpace: 'pre-wrap', 
                          lineHeight: 1.4,
                          maxHeight: 60,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {a.reason || '-'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
