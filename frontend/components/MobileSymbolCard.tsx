/**
 * Mobile-Optimized Symbol Card Component
 * 
 * Replace table layout on mobile devices with card-based layout
 * for better readability and touch interactions.
 * 
 * Updated to match the Metric type from index.tsx
 */

import React from 'react';

interface Metric {
  symbol: string;
  exchange: string;
  last_price: number;
  change_1m?: number | null;
  change_5m?: number | null;
  change_15m?: number | null;
  change_60m?: number | null;
  signal_score?: number | null;
  signal_strength?: string | null;
  impulse_score?: number | null;
  impulse_dir?: number | null;
  cipher_buy?: boolean | null;
  cipher_sell?: boolean | null;
  percent_r_os_reversal?: boolean | null;
  percent_r_ob_reversal?: boolean | null;
  vol_zscore_1m?: number | null;
  rvol_1m?: number | null;
  oi_change_5m?: number | null;
  open_interest?: number | null;
  market_cap?: number | null;
  momentum_score?: number | null;
  sector_tags?: string[] | null;
  ts: number;
}

interface MobileSymbolCardProps {
  metric: Metric;
  isFavorite?: boolean;
  hasPosition?: boolean;
  onToggleFavorite?: () => void;
  onViewDetails?: () => void;
}

export default function MobileSymbolCard({
  metric,
  isFavorite = false,
  hasPosition = false,
  onToggleFavorite,
  onViewDetails,
}: MobileSymbolCardProps) {
  const {
    symbol,
    exchange = 'binance',
    last_price,
    signal_score,
    signal_strength,
    impulse_score,
    impulse_dir,
    change_1m,
    change_5m,
    change_15m,
    change_60m,
    cipher_buy,
    cipher_sell,
    percent_r_os_reversal,
    percent_r_ob_reversal,
    vol_zscore_1m,
    rvol_1m,
    oi_change_5m,
    market_cap,
    sector_tags,
  } = metric;

  // Helper to format percentage
  const fmtPct = (n: number | null | undefined) => {
    if (n == null) return '--';
    const v = n * 100;
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}%`;
  };

  // Helper to format price
  const fmtPrice = (p: number | null | undefined) => {
    if (p == null) return '--';
    if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (p >= 1) return p.toFixed(2);
    if (p >= 0.01) return p.toFixed(4);
    return p.toFixed(6);
  };

  // Helper to format market cap
  const fmtMC = (mc: number | null | undefined) => {
    if (mc == null) return '--';
    if (mc >= 1e9) return `$${(mc / 1e9).toFixed(1)}B`;
    if (mc >= 1e6) return `$${(mc / 1e6).toFixed(0)}M`;
    return `$${(mc / 1e3).toFixed(0)}K`;
  };

  // Signal strength color based on signal_strength field
  const getSignalColor = (strength: string | null | undefined, score: number | null | undefined) => {
    if (strength === 'strong_bull') return '#10b981';
    if (strength === 'bull') return '#16a34a';
    if (strength === 'bear') return '#ef4444';
    if (strength === 'strong_bear') return '#dc2626';
    if (score != null) {
      if (score >= 70) return '#10b981';
      if (score >= 40) return '#f59e0b';
    }
    return '#6b7280';
  };

  // Change color
  const getChangeColor = (c: number | null | undefined) => {
    if (c == null) return '#6b7280';
    return c >= 0 ? '#10b981' : '#ef4444';
  };

  // Format impulse with direction arrow
  const fmtImpulse = (score: number | null | undefined, dir: number | null | undefined) => {
    if (score == null) return '--';
    const arrow = dir === 1 ? '↑' : dir === -1 ? '↓' : '';
    return `${arrow}${Math.round(score)}`;
  };

  return (
    <div
      onClick={onViewDetails}
      style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.2)',
        position: 'relative',
        cursor: 'pointer',
      }}
    >
      {/* Header Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
            {symbol}
          </h3>
          <span style={{ fontSize: 10, color: '#666', textTransform: 'uppercase' }}>
            {exchange}
          </span>
          {hasPosition && (
            <span style={{ fontSize: 9, background: '#3b82f6', padding: '2px 6px', borderRadius: 3, fontWeight: 700, color: '#fff' }}>
              OPEN
            </span>
          )}
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(); }}
          style={{ background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', padding: 2, color: isFavorite ? '#fbbf24' : '#666' }}
        >
          {isFavorite ? '★' : '☆'}
        </button>
      </div>

      {/* Price & Signal Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>
          ${fmtPrice(last_price)}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: getSignalColor(signal_strength, signal_score) }}>
            {signal_score != null ? Math.round(signal_score) : '--'}
          </div>
          <div style={{ fontSize: 9, color: '#666' }}>Signal</div>
        </div>
      </div>

      {/* Signal Badges */}
      {(cipher_buy || cipher_sell || percent_r_os_reversal || percent_r_ob_reversal) && (
        <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
          {cipher_buy && (
            <span style={{ fontSize: 10, background: '#2a9d8f', padding: '3px 7px', borderRadius: 4, fontWeight: 600, color: '#fff', boxShadow: '0 0 6px rgba(42,157,143,0.5)' }}>
              CB↑
            </span>
          )}
          {cipher_sell && (
            <span style={{ fontSize: 10, background: '#e76f51', padding: '3px 7px', borderRadius: 4, fontWeight: 600, color: '#fff', boxShadow: '0 0 6px rgba(231,111,81,0.5)' }}>
              CB↓
            </span>
          )}
          {percent_r_os_reversal && (
            <span style={{ fontSize: 10, background: '#06d6a0', padding: '3px 7px', borderRadius: 4, fontWeight: 600, color: '#000', boxShadow: '0 0 6px rgba(6,214,160,0.5)' }}>
              %R↑
            </span>
          )}
          {percent_r_ob_reversal && (
            <span style={{ fontSize: 10, background: '#ef476f', padding: '3px 7px', borderRadius: 4, fontWeight: 600, color: '#fff', boxShadow: '0 0 6px rgba(239,71,111,0.5)' }}>
              %R↓
            </span>
          )}
        </div>
      )}

      {/* Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 10 }}>
        <MetricBox label="5m" value={fmtPct(change_5m)} color={getChangeColor(change_5m)} />
        <MetricBox label="15m" value={fmtPct(change_15m)} color={getChangeColor(change_15m)} />
        <MetricBox label="60m" value={fmtPct(change_60m)} color={getChangeColor(change_60m)} />
        <MetricBox label="Impulse" value={fmtImpulse(impulse_score, impulse_dir)} color="#888" />
      </div>

      {/* Additional Info Row */}
      <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#888', flexWrap: 'wrap' }}>
        {market_cap != null && (
          <span>💰 <strong style={{ color: '#aaa' }}>{fmtMC(market_cap)}</strong></span>
        )}
        {oi_change_5m != null && (
          <span>OI: <strong style={{ color: getChangeColor(oi_change_5m) }}>{fmtPct(oi_change_5m)}</strong></span>
        )}
        {vol_zscore_1m != null && (
          <span>Vol Z: <strong style={{ color: '#aaa' }}>{vol_zscore_1m.toFixed(1)}</strong></span>
        )}
        {sector_tags && sector_tags.length > 0 && (
          <span style={{ color: '#8b5cf6' }}>{sector_tags[0]}</span>
        )}
      </div>
    </div>
  );
}

// Metric Box Component - Compact version for mobile
function MetricBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '6px 4px', borderRadius: 5, textAlign: 'center' }}>
      <div style={{ fontSize: 8, color: '#666', marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
