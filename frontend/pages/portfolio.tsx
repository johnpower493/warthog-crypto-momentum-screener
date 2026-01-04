import { useEffect, useState } from 'react';

type Position = {
  id: number;
  exchange: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entry_price: number;
  quantity: number;
  entry_time: number;
  stop_loss?: number | null;
  take_profit?: number | null;
  notes?: string | null;
  // Real-time calculated fields
  current_price?: number;
  pnl?: number;
  pnl_pct?: number;
  value?: number;
  cost_basis?: number;
};

type Trade = {
  id: number;
  position_id: number;
  exchange: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entry_price: number;
  exit_price: number;
  quantity: number;
  entry_time: number;
  exit_time: number;
  pnl: number;
  pnl_pct: number;
  notes?: string | null;
};

type Stats = {
  open_positions: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
  avg_pnl_pct: number;
  best_trade: number;
  worst_trade: number;
};

export default function PortfolioPage() {
  const [backendHttp, setBackendHttp] = useState<string>('');
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [view, setView] = useState<'positions' | 'history' | 'stats'>('positions');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  // Add position modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPosition, setNewPosition] = useState({
    exchange: 'binance',
    symbol: '',
    side: 'LONG' as 'LONG' | 'SHORT',
    entry_price: '',
    quantity: '',
    stop_loss: '',
    take_profit: '',
    notes: '',
  });

  // Edit position modal
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [editForm, setEditForm] = useState({
    stop_loss: '',
    take_profit: '',
    notes: '',
  });

  // Close position modal
  const [closingPosition, setClosingPosition] = useState<Position | null>(null);
  const [closeForm, setCloseForm] = useState({
    exit_price: '',
    notes: '',
  });

  useEffect(() => {
    const resolved = process.env.NEXT_PUBLIC_BACKEND_HTTP || 
      (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8000` : 'http://127.0.0.1:8000');
    setBackendHttp(resolved);
  }, []);

  const loadData = async () => {
    if (!backendHttp) return;
    setStatus('loading');
    try {
      const [posResp, histResp, statsResp] = await Promise.all([
        fetch(`${backendHttp}/portfolio/positions`),
        fetch(`${backendHttp}/portfolio/history?limit=50`),
        fetch(`${backendHttp}/portfolio/stats`),
      ]);

      if (posResp.ok) {
        const data = await posResp.json();
        setPositions(data.positions || []);
      }
      if (histResp.ok) {
        const data = await histResp.json();
        setTrades(data.trades || []);
      }
      if (statsResp.ok) {
        const data = await statsResp.json();
        setStats(data);
      }
      setStatus('idle');
    } catch (e) {
      setStatus('error');
      console.error('Error loading portfolio data:', e);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // Update every 5s
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendHttp]);

  const handleAddPosition = async () => {
    if (!newPosition.symbol || !newPosition.entry_price || !newPosition.quantity) {
      alert('Please fill in required fields: Symbol, Entry Price, Quantity');
      return;
    }

    try {
      const resp = await fetch(`${backendHttp}/portfolio/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: newPosition.exchange,
          symbol: newPosition.symbol.toUpperCase(),
          side: newPosition.side,
          entry_price: parseFloat(newPosition.entry_price),
          quantity: parseFloat(newPosition.quantity),
          stop_loss: newPosition.stop_loss ? parseFloat(newPosition.stop_loss) : null,
          take_profit: newPosition.take_profit ? parseFloat(newPosition.take_profit) : null,
          notes: newPosition.notes || null,
        }),
      });

      if (resp.ok) {
        setShowAddModal(false);
        setNewPosition({
          exchange: 'binance',
          symbol: '',
          side: 'LONG',
          entry_price: '',
          quantity: '',
          stop_loss: '',
          take_profit: '',
          notes: '',
        });
        loadData();
      } else {
        alert('Failed to add position');
      }
    } catch (e) {
      console.error('Error adding position:', e);
      alert('Error adding position');
    }
  };

  const handleUpdatePosition = async () => {
    if (!editingPosition) return;

    try {
      const resp = await fetch(`${backendHttp}/portfolio/positions/${editingPosition.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stop_loss: editForm.stop_loss ? parseFloat(editForm.stop_loss) : null,
          take_profit: editForm.take_profit ? parseFloat(editForm.take_profit) : null,
          notes: editForm.notes || null,
        }),
      });

      if (resp.ok) {
        setEditingPosition(null);
        loadData();
      } else {
        alert('Failed to update position');
      }
    } catch (e) {
      console.error('Error updating position:', e);
      alert('Error updating position');
    }
  };

  const handleClosePosition = async () => {
    if (!closingPosition || !closeForm.exit_price) {
      alert('Please enter exit price');
      return;
    }

    try {
      const resp = await fetch(`${backendHttp}/portfolio/positions/${closingPosition.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exit_price: parseFloat(closeForm.exit_price),
          notes: closeForm.notes || null,
        }),
      });

      if (resp.ok) {
        setClosingPosition(null);
        setCloseForm({ exit_price: '', notes: '' });
        loadData();
      } else {
        alert('Failed to close position');
      }
    } catch (e) {
      console.error('Error closing position:', e);
      alert('Error closing position');
    }
  };

  const handleDeletePosition = async (id: number) => {
    if (!confirm('Are you sure you want to delete this position?')) return;

    try {
      const resp = await fetch(`${backendHttp}/portfolio/positions/${id}`, {
        method: 'DELETE',
      });

      if (resp.ok) {
        loadData();
      } else {
        alert('Failed to delete position');
      }
    } catch (e) {
      console.error('Error deleting position:', e);
      alert('Error deleting position');
    }
  };

  const openEditModal = (pos: Position) => {
    setEditingPosition(pos);
    setEditForm({
      stop_loss: pos.stop_loss?.toString() || '',
      take_profit: pos.take_profit?.toString() || '',
      notes: pos.notes || '',
    });
  };

  const openCloseModal = (pos: Position) => {
    setClosingPosition(pos);
    setCloseForm({
      exit_price: pos.current_price?.toString() || pos.entry_price.toString(),
      notes: '',
    });
  };

  const totalPnL = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);
  const totalValue = positions.reduce((sum, p) => sum + (p.value || 0), 0);

  return (
    <div className="container">
      <div className="panel">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <div className="group">
            <span className="badge">Portfolio</span>
            {stats && <span className="badge">Open: {stats.open_positions}</span>}
            <span className={`badge ${totalPnL >= 0 ? 'chgUp' : 'chgDown'}`}>
              PnL: {fmtPnL(totalPnL)}
            </span>
            {status === 'loading' && <span className="badge">Loading…</span>}
          </div>
          <div className="group">
            <button
              className={`button ${view === 'positions' ? 'buttonActive' : ''}`}
              onClick={() => setView('positions')}
            >
              Positions
            </button>
            <button
              className={`button ${view === 'history' ? 'buttonActive' : ''}`}
              onClick={() => setView('history')}
            >
              History
            </button>
            <button
              className={`button ${view === 'stats' ? 'buttonActive' : ''}`}
              onClick={() => setView('stats')}
            >
              Stats
            </button>
            <button className="button" onClick={() => setShowAddModal(true)}>
              + Add Position
            </button>
            <a className="button" href="/">
              Home
            </a>
          </div>
        </div>

        {view === 'positions' && (
          <div style={{ padding: 12 }}>
            {positions.length === 0 && (
              <div className="muted">No open positions. Click "+ Add Position" to start tracking.</div>
            )}
            {positions.length > 0 && (
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Entry</th>
                      <th>Current</th>
                      <th>Qty</th>
                      <th>Value</th>
                      <th>PnL</th>
                      <th>PnL %</th>
                      <th>SL/TP</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600 }}>
                          {p.symbol}
                          <div className="muted" style={{ fontSize: 11 }}>{p.exchange}</div>
                        </td>
                        <td className={p.side === 'LONG' ? 'chgUp' : 'chgDown'}>{p.side}</td>
                        <td>{fmt(p.entry_price)}</td>
                        <td>{fmt(p.current_price)}</td>
                        <td>{p.quantity}</td>
                        <td>{fmt(p.value)}</td>
                        <td className={pnlClass(p.pnl)}>{fmtPnL(p.pnl)}</td>
                        <td className={pnlClass(p.pnl)}>{fmtPct(p.pnl_pct)}</td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {p.stop_loss ? `SL: ${fmt(p.stop_loss)}` : '-'}
                          <br />
                          {p.take_profit ? `TP: ${fmt(p.take_profit)}` : '-'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <button className="button" onClick={() => openEditModal(p)} style={{ fontSize: 11, padding: '4px 8px' }}>
                              Edit
                            </button>
                            <button className="button" onClick={() => openCloseModal(p)} style={{ fontSize: 11, padding: '4px 8px' }}>
                              Close
                            </button>
                            <button className="button" onClick={() => handleDeletePosition(p.id)} style={{ fontSize: 11, padding: '4px 8px' }}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {view === 'history' && (
          <div style={{ padding: 12 }}>
            {trades.length === 0 && (
              <div className="muted">No trade history yet.</div>
            )}
            {trades.length > 0 && (
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Entry</th>
                      <th>Exit</th>
                      <th>Qty</th>
                      <th>PnL</th>
                      <th>PnL %</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t) => (
                      <tr key={t.id}>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {new Date(t.exit_time).toLocaleDateString()}
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {t.symbol}
                          <div className="muted" style={{ fontSize: 11 }}>{t.exchange}</div>
                        </td>
                        <td className={t.side === 'LONG' ? 'chgUp' : 'chgDown'}>{t.side}</td>
                        <td>{fmt(t.entry_price)}</td>
                        <td>{fmt(t.exit_price)}</td>
                        <td>{t.quantity}</td>
                        <td className={pnlClass(t.pnl)}>{fmtPnL(t.pnl)}</td>
                        <td className={pnlClass(t.pnl)}>{fmtPct(t.pnl_pct)}</td>
                        <td className="muted" style={{ fontSize: 11, maxWidth: 200 }}>
                          {t.notes || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {view === 'stats' && stats && (
          <div style={{ padding: 12 }}>
            <div className="grid">
              <div className="card">
                <h3>Overview</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>Open Positions: <strong>{stats.open_positions}</strong></div>
                  <div>Total Trades: <strong>{stats.total_trades}</strong></div>
                  <div className={pnlClass(stats.total_pnl)}>
                    Total PnL: <strong>{fmtPnL(stats.total_pnl)}</strong>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3>Performance</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>Win Rate: <strong>{stats.win_rate.toFixed(1)}%</strong></div>
                  <div>Winning Trades: <strong className="chgUp">{stats.winning_trades}</strong></div>
                  <div>Losing Trades: <strong className="chgDown">{stats.losing_trades}</strong></div>
                </div>
              </div>

              <div className="card">
                <h3>Averages</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className={pnlClass(stats.avg_pnl)}>
                    Avg PnL: <strong>{fmtPnL(stats.avg_pnl)}</strong>
                  </div>
                  <div className={pnlClass(stats.avg_pnl)}>
                    Avg PnL %: <strong>{fmtPct(stats.avg_pnl_pct)}</strong>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3>Extremes</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="chgUp">
                    Best Trade: <strong>{fmtPnL(stats.best_trade)}</strong>
                  </div>
                  <div className="chgDown">
                    Worst Trade: <strong>{fmtPnL(stats.worst_trade)}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Position Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Position</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label>
                Exchange
                <select
                  className="input"
                  value={newPosition.exchange}
                  onChange={(e) => setNewPosition({ ...newPosition, exchange: e.target.value })}
                >
                  <option value="binance">Binance</option>
                  <option value="bybit">Bybit</option>
                </select>
              </label>

              <label>
                Symbol *
                <input
                  className="input"
                  placeholder="e.g., BTCUSDT"
                  value={newPosition.symbol}
                  onChange={(e) => setNewPosition({ ...newPosition, symbol: e.target.value.toUpperCase() })}
                />
              </label>

              <label>
                Side
                <select
                  className="input"
                  value={newPosition.side}
                  onChange={(e) => setNewPosition({ ...newPosition, side: e.target.value as 'LONG' | 'SHORT' })}
                >
                  <option value="LONG">LONG</option>
                  <option value="SHORT">SHORT</option>
                </select>
              </label>

              <label>
                Entry Price *
                <input
                  className="input"
                  type="number"
                  step="any"
                  placeholder="e.g., 95000"
                  value={newPosition.entry_price}
                  onChange={(e) => setNewPosition({ ...newPosition, entry_price: e.target.value })}
                />
              </label>

              <label>
                Quantity *
                <input
                  className="input"
                  type="number"
                  step="any"
                  placeholder="e.g., 0.1"
                  value={newPosition.quantity}
                  onChange={(e) => setNewPosition({ ...newPosition, quantity: e.target.value })}
                />
              </label>

              <label>
                Stop Loss
                <input
                  className="input"
                  type="number"
                  step="any"
                  placeholder="Optional"
                  value={newPosition.stop_loss}
                  onChange={(e) => setNewPosition({ ...newPosition, stop_loss: e.target.value })}
                />
              </label>

              <label>
                Take Profit
                <input
                  className="input"
                  type="number"
                  step="any"
                  placeholder="Optional"
                  value={newPosition.take_profit}
                  onChange={(e) => setNewPosition({ ...newPosition, take_profit: e.target.value })}
                />
              </label>

              <label>
                Notes
                <textarea
                  className="input"
                  placeholder="Optional notes"
                  value={newPosition.notes}
                  onChange={(e) => setNewPosition({ ...newPosition, notes: e.target.value })}
                  rows={3}
                />
              </label>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="button" onClick={handleAddPosition}>Add</button>
                <button className="button" onClick={() => setShowAddModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Position Modal */}
      {editingPosition && (
        <div className="modal-overlay" onClick={() => setEditingPosition(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Position: {editingPosition.symbol}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label>
                Stop Loss
                <input
                  className="input"
                  type="number"
                  step="any"
                  placeholder="Optional"
                  value={editForm.stop_loss}
                  onChange={(e) => setEditForm({ ...editForm, stop_loss: e.target.value })}
                />
              </label>

              <label>
                Take Profit
                <input
                  className="input"
                  type="number"
                  step="any"
                  placeholder="Optional"
                  value={editForm.take_profit}
                  onChange={(e) => setEditForm({ ...editForm, take_profit: e.target.value })}
                />
              </label>

              <label>
                Notes
                <textarea
                  className="input"
                  placeholder="Optional notes"
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  rows={3}
                />
              </label>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="button" onClick={handleUpdatePosition}>Update</button>
                <button className="button" onClick={() => setEditingPosition(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Close Position Modal */}
      {closingPosition && (
        <div className="modal-overlay" onClick={() => setClosingPosition(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Close Position: {closingPosition.symbol}</h2>
            <div className="muted" style={{ marginBottom: 12 }}>
              Entry: {fmt(closingPosition.entry_price)} | Current: {fmt(closingPosition.current_price)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label>
                Exit Price *
                <input
                  className="input"
                  type="number"
                  step="any"
                  placeholder="Exit price"
                  value={closeForm.exit_price}
                  onChange={(e) => setCloseForm({ ...closeForm, exit_price: e.target.value })}
                />
              </label>

              <label>
                Notes
                <textarea
                  className="input"
                  placeholder="Optional closing notes"
                  value={closeForm.notes}
                  onChange={(e) => setCloseForm({ ...closeForm, notes: e.target.value })}
                  rows={3}
                />
              </label>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="button" onClick={handleClosePosition}>Close Position</button>
                <button className="button" onClick={() => setClosingPosition(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .modal {
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 24px;
          max-width: 500px;
          width: 90%;
          max-height: 90vh;
          overflow-y: auto;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 13px;
          font-weight: 500;
        }
        textarea {
          resize: vertical;
          font-family: inherit;
        }
      `}</style>
    </div>
  );
}

function fmt(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1000) return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return Number(n).toFixed(6);
}

function fmtPnL(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}`;
}

function fmtPct(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function pnlClass(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return 'muted';
  if (n > 0) return 'chgUp';
  if (n < 0) return 'chgDown';
  return 'muted';
}
