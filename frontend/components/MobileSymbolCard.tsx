/**
 * Mobile-Optimized Symbol Card Component
 * 
 * Replace table layout on mobile devices with card-based layout
 * for better readability and touch interactions.
 */

import React from 'react';

interface Metric {
  symbol: string;
  exchange?: string;
  last_price?: number;
  signal?: number;
  impulse?: number;
  chg1m?: number;
  chg5m?: number;
  chg15m?: number;
  chg60m?: number;
  momentum?: number;
  volz?: number;
  rvol1m?: number;
  cipher_buy?: boolean;
  cipher_sell?: boolean;
  percent_r_os_reversal?: boolean;
  percent_r_ob_reversal?: boolean;
  oi?: number;
  oi_chg_5m?: number;
  market_cap?: number;
  grade?: string;
  liquidity_cohort?: string;
}

interface MobileSymbolCardProps {
  metric: Metric;
  isFavorite?: boolean;
  hasPosition?: boolean;
  onToggleFavorite?: () => void;
  onViewDetails?: () => void;
  onQuickLong?: () => void;
  onQuickShort?: () => void;
}

export default function MobileSymbolCard({
  metric,
  isFavorite = false,
  hasPosition = false,
  onToggleFavorite,
  onViewDetails,
  onQuickLong,
  onQuickShort,
}: MobileSymbolCardProps) {
  const {
    symbol,
    exchange = 'binance',
    last_price,
    signal,
    impulse,
    chg1m,
    chg5m,
    chg15m,
    chg60m,
    cipher_buy,
    cipher_sell,
    percent_r_os_reversal,
    percent_r_ob_reversal,
    volz,
    rvol1m,
    oi_chg_5m,
    market_cap,
    grade,
    liquidity_cohort,
  } = metric;

  // Helper to format percentage
  const fmtPct = (n: number | null | undefined) => {
    if (n == null) return '--';
    const sign = n >= 0 ? '+' : '';
    return `${sign}${(n * 100).toFixed(2)}%`;
  };

  // Helper to format price
  const fmtPrice = (p: number | null | undefined) => {
    if (p == null) return '--';
    if (p >= 1000) return p.toFixed(0);
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

  // Signal strength color
  const getSignalColor = (s: number | null | undefined) => {
    if (s == null) return '#6b7280';
    if (s >= 80) return '#10b981';
    if (s >= 60) return '#3b82f6';
    if (s >= 40) return '#f59e0b';
    return '#ef4444';
  };

  // Change color
  const getChangeColor = (c: number | null | undefined) => {
    if (c == null) return '#6b7280';
    return c >= 0 ? '#10b981' : '#ef4444';
  };

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.2)',
        position: 'relative',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            {symbol}
          </h3>
          <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>
            {exchange}
          </span>
          {hasPosition && (
            <span
              style={{
                fontSize: 9,
                background: '#3b82f6',
                padding: '2px 6px',
                borderRadius: 3,
                fontWeight: 700,
                color: '#fff',
              }}
            >
              OPEN
            </span>
          )}
        </div>

        <button
          onClick={onToggleFavorite}
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: 20,
            cursor: 'pointer',
            padding: 4,
          }}
        >
          {isFavorite ? '⭐' : '☆'}
        </button>
      </div>

      {/* Price & Signal Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>
            ${fmtPrice(last_price)}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: getSignalColor(signal),
            }}
          >
            {signal != null ? Math.round(signal) : '--'}
          </div>
          <div style={{ fontSize: 10, color: '#888' }}>Signal</div>
        </div>
      </div>

      {/* Signal Badges */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {cipher_buy && (
          <span
            style={{
              fontSize: 11,
              background: '#2a9d8f',
              padding: '4px 8px',
              borderRadius: 4,
              fontWeight: 600,
              color: '#fff',
            }}
          >
            CB↑
          </span>
        )}
        {cipher_sell && (
          <span
            style={{
              fontSize: 11,
              background: '#e76f51',
              padding: '4px 8px',
              borderRadius: 4,
              fontWeight: 600,
              color: '#fff',
            }}
          >
            CB↓
          </span>
        )}
        {percent_r_os_reversal && (
          <span
            style={{
              fontSize: 11,
              background: '#06d6a0',
              padding: '4px 8px',
              borderRadius: 4,
              fontWeight: 600,
              color: '#000',
            }}
          >
            %R↑
          </span>
        )}
        {percent_r_ob_reversal && (
          <span
            style={{
              fontSize: 11,
              background: '#ef476f',
              padding: '4px 8px',
              borderRadius: 4,
              fontWeight: 600,
              color: '#fff',
            }}
          >
            %R↓
          </span>
        )}
        {grade && (
          <span
            style={{
              fontSize: 11,
              background: grade === 'A' ? '#10b981' : grade === 'B' ? '#3b82f6' : '#6b7280',
              padding: '4px 8px',
              borderRadius: 4,
              fontWeight: 600,
              color: '#fff',
            }}
          >
            Grade {grade}
          </span>
        )}
        {liquidity_cohort && (
          <span
            style={{
              fontSize: 11,
              background: liquidity_cohort === 'top200' ? '#8b5cf6' : '#6b7280',
              padding: '4px 8px',
              borderRadius: 4,
              fontWeight: 600,
              color: '#fff',
            }}
          >
            {liquidity_cohort === 'top200' ? '🔥 Top 200' : 'Small Cap'}
          </span>
        )}
      </div>

      {/* Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <MetricBox
          label="1m"
          value={fmtPct(chg1m)}
          color={getChangeColor(chg1m)}
        />
        <MetricBox
          label="5m"
          value={fmtPct(chg5m)}
          color={getChangeColor(chg5m)}
        />
        <MetricBox
          label="15m"
          value={fmtPct(chg15m)}
          color={getChangeColor(chg15m)}
        />
        <MetricBox
          label="Impulse"
          value={impulse != null ? Math.round(impulse) : '--'}
          color="#888"
        />
        <MetricBox
          label="Vol Z"
          value={volz != null ? volz.toFixed(1) : '--'}
          color="#888"
        />
        <MetricBox
          label="RVol"
          value={rvol1m != null ? rvol1m.toFixed(1) + 'x' : '--'}
          color="#888"
        />
      </div>

      {/* Additional Info Row */}
      {(market_cap != null || oi_chg_5m != null) && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            fontSize: 11,
            color: '#888',
            marginBottom: 12,
          }}
        >
          {market_cap != null && (
            <span>
              💰 MCap: <strong style={{ color: '#fff' }}>{fmtMC(market_cap)}</strong>
            </span>
          )}
          {oi_chg_5m != null && (
            <span>
              📊 OI 5m: <strong style={{ color: getChangeColor(oi_chg_5m) }}>{fmtPct(oi_chg_5m)}</strong>
            </span>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onQuickLong}
          style={{
            flex: 1,
            background: '#10b981',
            color: '#fff',
            border: 'none',
            padding: '12px',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(16, 185, 129, 0.3)',
          }}
        >
          🟢 LONG
        </button>
        <button
          onClick={onQuickShort}
          style={{
            flex: 1,
            background: '#ef4444',
            color: '#fff',
            border: 'none',
            padding: '12px',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(239, 68, 68, 0.3)',
          }}
        >
          🔴 SHORT
        </button>
        <button
          onClick={onViewDetails}
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            color: '#fff',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            padding: '12px 16px',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          📊
        </button>
      </div>
    </div>
  );
}

// Metric Box Component
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
    <div
      style={{
        background: 'rgba(255, 255, 255, 0.05)',
        padding: '8px',
        borderRadius: 6,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 9, color: '#888', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color }}>
        {value}
      </div>
    </div>
  );
}
