"""
Portfolio tracking service for managing open positions and calculating PnL.
"""
import sqlite3
import logging
from typing import List, Optional, Dict
from datetime import datetime

logger = logging.getLogger(__name__)

class Position:
    """Represents an open trading position."""
    def __init__(
        self,
        id: int,
        exchange: str,
        symbol: str,
        side: str,  # 'LONG' or 'SHORT'
        entry_price: float,
        quantity: float,
        entry_time: int,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
        notes: Optional[str] = None,
    ):
        self.id = id
        self.exchange = exchange
        self.symbol = symbol
        self.side = side
        self.entry_price = entry_price
        self.quantity = quantity
        self.entry_time = entry_time
        self.stop_loss = stop_loss
        self.take_profit = take_profit
        self.notes = notes
    
    def calculate_pnl(self, current_price: float) -> Dict:
        """Calculate PnL for this position."""
        if self.side == 'LONG':
            pnl = (current_price - self.entry_price) * self.quantity
            pnl_pct = ((current_price / self.entry_price) - 1) * 100
        else:  # SHORT
            pnl = (self.entry_price - current_price) * self.quantity
            pnl_pct = ((self.entry_price / current_price) - 1) * 100
        
        return {
            'pnl': pnl,
            'pnl_pct': pnl_pct,
            'current_price': current_price,
            'value': current_price * self.quantity,
            'cost_basis': self.entry_price * self.quantity,
        }
    
    def to_dict(self) -> Dict:
        """Convert position to dictionary."""
        return {
            'id': self.id,
            'exchange': self.exchange,
            'symbol': self.symbol,
            'side': self.side,
            'entry_price': self.entry_price,
            'quantity': self.quantity,
            'entry_time': self.entry_time,
            'stop_loss': self.stop_loss,
            'take_profit': self.take_profit,
            'notes': self.notes,
        }


class PortfolioManager:
    """Manages portfolio positions with SQLite persistence."""
    
    def __init__(self, db_path: str = "portfolio.sqlite3"):
        self.db_path = db_path
        self._init_db()
    
    def _init_db(self):
        """Initialize portfolio database tables."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS positions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    exchange TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    side TEXT NOT NULL,
                    entry_price REAL NOT NULL,
                    quantity REAL NOT NULL,
                    entry_time INTEGER NOT NULL,
                    stop_loss REAL,
                    take_profit REAL,
                    notes TEXT,
                    status TEXT DEFAULT 'OPEN',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS closed_positions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    position_id INTEGER NOT NULL,
                    exchange TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    side TEXT NOT NULL,
                    entry_price REAL NOT NULL,
                    exit_price REAL NOT NULL,
                    quantity REAL NOT NULL,
                    entry_time INTEGER NOT NULL,
                    exit_time INTEGER NOT NULL,
                    pnl REAL NOT NULL,
                    pnl_pct REAL NOT NULL,
                    notes TEXT,
                    created_at INTEGER NOT NULL
                )
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_positions_status 
                ON positions(status)
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_positions_symbol 
                ON positions(exchange, symbol)
            """)
            
            conn.commit()
            logger.info("Portfolio database initialized")
        except Exception as e:
            logger.error(f"Error initializing portfolio DB: {e}")
        finally:
            conn.close()
    
    def add_position(
        self,
        exchange: str,
        symbol: str,
        side: str,
        entry_price: float,
        quantity: float,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
        notes: Optional[str] = None,
    ) -> Optional[int]:
        """Add a new position to the portfolio."""
        conn = sqlite3.connect(self.db_path)
        try:
            now = int(datetime.now().timestamp() * 1000)
            cursor = conn.execute("""
                INSERT INTO positions 
                (exchange, symbol, side, entry_price, quantity, entry_time, 
                 stop_loss, take_profit, notes, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
            """, (exchange, symbol, side.upper(), entry_price, quantity, now,
                  stop_loss, take_profit, notes, now, now))
            conn.commit()
            position_id = cursor.lastrowid
            logger.info(f"Added position {position_id}: {side} {quantity} {symbol} @ {entry_price}")
            return position_id
        except Exception as e:
            logger.error(f"Error adding position: {e}")
            return None
        finally:
            conn.close()
    
    def get_open_positions(self) -> List[Position]:
        """Get all open positions."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute("""
                SELECT id, exchange, symbol, side, entry_price, quantity, 
                       entry_time, stop_loss, take_profit, notes
                FROM positions
                WHERE status = 'OPEN'
                ORDER BY entry_time DESC
            """)
            positions = []
            for row in cursor.fetchall():
                positions.append(Position(*row))
            return positions
        except Exception as e:
            logger.error(f"Error getting open positions: {e}")
            return []
        finally:
            conn.close()
    
    def get_position(self, position_id: int) -> Optional[Position]:
        """Get a specific position by ID."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute("""
                SELECT id, exchange, symbol, side, entry_price, quantity, 
                       entry_time, stop_loss, take_profit, notes
                FROM positions
                WHERE id = ? AND status = 'OPEN'
            """, (position_id,))
            row = cursor.fetchone()
            if row:
                return Position(*row)
            return None
        except Exception as e:
            logger.error(f"Error getting position {position_id}: {e}")
            return None
        finally:
            conn.close()
    
    def update_position(
        self,
        position_id: int,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
        notes: Optional[str] = None,
    ) -> bool:
        """Update an existing position."""
        conn = sqlite3.connect(self.db_path)
        try:
            now = int(datetime.now().timestamp() * 1000)
            conn.execute("""
                UPDATE positions
                SET stop_loss = ?, take_profit = ?, notes = ?, updated_at = ?
                WHERE id = ? AND status = 'OPEN'
            """, (stop_loss, take_profit, notes, now, position_id))
            conn.commit()
            logger.info(f"Updated position {position_id}")
            return True
        except Exception as e:
            logger.error(f"Error updating position {position_id}: {e}")
            return False
        finally:
            conn.close()
    
    def close_position(
        self,
        position_id: int,
        exit_price: float,
        notes: Optional[str] = None,
    ) -> bool:
        """Close a position and record the trade."""
        conn = sqlite3.connect(self.db_path)
        try:
            # Get the position
            cursor = conn.execute("""
                SELECT exchange, symbol, side, entry_price, quantity, entry_time, notes
                FROM positions
                WHERE id = ? AND status = 'OPEN'
            """, (position_id,))
            row = cursor.fetchone()
            if not row:
                logger.warning(f"Position {position_id} not found or already closed")
                return False
            
            exchange, symbol, side, entry_price, quantity, entry_time, pos_notes = row
            
            # Calculate PnL
            if side == 'LONG':
                pnl = (exit_price - entry_price) * quantity
                pnl_pct = ((exit_price / entry_price) - 1) * 100
            else:  # SHORT
                pnl = (entry_price - exit_price) * quantity
                pnl_pct = ((entry_price / exit_price) - 1) * 100
            
            now = int(datetime.now().timestamp() * 1000)
            combined_notes = f"{pos_notes or ''}\n{notes or ''}".strip()
            
            # Insert into closed_positions
            conn.execute("""
                INSERT INTO closed_positions
                (position_id, exchange, symbol, side, entry_price, exit_price, 
                 quantity, entry_time, exit_time, pnl, pnl_pct, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (position_id, exchange, symbol, side, entry_price, exit_price,
                  quantity, entry_time, now, pnl, pnl_pct, combined_notes, now))
            
            # Update position status
            conn.execute("""
                UPDATE positions
                SET status = 'CLOSED', updated_at = ?
                WHERE id = ?
            """, (now, position_id))
            
            conn.commit()
            logger.info(f"Closed position {position_id}: {side} {symbol} PnL: {pnl:.2f} ({pnl_pct:.2f}%)")
            return True
        except Exception as e:
            logger.error(f"Error closing position {position_id}: {e}")
            return False
        finally:
            conn.close()
    
    def delete_position(self, position_id: int) -> bool:
        """Delete a position (only if open)."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("""
                DELETE FROM positions
                WHERE id = ? AND status = 'OPEN'
            """, (position_id,))
            conn.commit()
            logger.info(f"Deleted position {position_id}")
            return True
        except Exception as e:
            logger.error(f"Error deleting position {position_id}: {e}")
            return False
        finally:
            conn.close()
    
    def get_closed_positions(self, limit: int = 100) -> List[Dict]:
        """Get closed positions (trade history)."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute("""
                SELECT id, position_id, exchange, symbol, side, 
                       entry_price, exit_price, quantity, entry_time, exit_time,
                       pnl, pnl_pct, notes
                FROM closed_positions
                ORDER BY exit_time DESC
                LIMIT ?
            """, (limit,))
            
            results = []
            for row in cursor.fetchall():
                results.append({
                    'id': row[0],
                    'position_id': row[1],
                    'exchange': row[2],
                    'symbol': row[3],
                    'side': row[4],
                    'entry_price': row[5],
                    'exit_price': row[6],
                    'quantity': row[7],
                    'entry_time': row[8],
                    'exit_time': row[9],
                    'pnl': row[10],
                    'pnl_pct': row[11],
                    'notes': row[12],
                })
            return results
        except Exception as e:
            logger.error(f"Error getting closed positions: {e}")
            return []
        finally:
            conn.close()
    
    def get_portfolio_stats(self) -> Dict:
        """Get portfolio statistics."""
        conn = sqlite3.connect(self.db_path)
        try:
            # Count open positions
            cursor = conn.execute("SELECT COUNT(*) FROM positions WHERE status = 'OPEN'")
            open_count = cursor.fetchone()[0]
            
            # Get closed positions stats
            cursor = conn.execute("""
                SELECT 
                    COUNT(*) as total_trades,
                    SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
                    SUM(pnl) as total_pnl,
                    AVG(pnl) as avg_pnl,
                    AVG(pnl_pct) as avg_pnl_pct,
                    MAX(pnl) as best_trade,
                    MIN(pnl) as worst_trade
                FROM closed_positions
            """)
            row = cursor.fetchone()
            
            total_trades = row[0] or 0
            winning_trades = row[1] or 0
            win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
            
            return {
                'open_positions': open_count,
                'total_trades': total_trades,
                'winning_trades': winning_trades,
                'losing_trades': total_trades - winning_trades,
                'win_rate': win_rate,
                'total_pnl': row[2] or 0,
                'avg_pnl': row[3] or 0,
                'avg_pnl_pct': row[4] or 0,
                'best_trade': row[5] or 0,
                'worst_trade': row[6] or 0,
            }
        except Exception as e:
            logger.error(f"Error getting portfolio stats: {e}")
            return {}
        finally:
            conn.close()


# Global instance
_manager: Optional[PortfolioManager] = None

def get_portfolio_manager() -> PortfolioManager:
    """Get or create the global portfolio manager."""
    global _manager
    if _manager is None:
        _manager = PortfolioManager()
    return _manager
