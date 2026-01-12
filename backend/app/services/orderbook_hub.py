"""
Order Book Hub - Unified manager for order book WebSocket connections

Manages order book WebSocket connections for multiple symbols across exchanges.
Provides real-time wall detection from resting limit orders.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Any, Optional, Set

log = logging.getLogger(__name__)


class OrderBookHub:
    """Manages order book WebSocket connections and wall detection.
    
    Unlike the orderflow (trade-based) system, this connects to actual
    order book depth streams to see resting limit orders.
    """
    
    def __init__(self):
        self._active_symbols: Dict[str, Set[str]] = {
            "binance": set(),
            "bybit": set()
        }
        self._tasks: Dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()
    
    async def start_orderbook(self, exchange: str, symbol: str) -> bool:
        """Start order book streaming for a symbol.
        
        Returns True if started successfully or already running.
        """
        async with self._lock:
            exchange = exchange.lower()
            if exchange not in self._active_symbols:
                log.warning(f"Unknown exchange: {exchange}")
                return False
            
            task_key = f"{exchange}:{symbol}"
            
            # Already running
            if symbol in self._active_symbols[exchange]:
                task = self._tasks.get(task_key)
                if task and not task.done():
                    return True
            
            # Start new collector
            try:
                if exchange == "binance":
                    from ..exchanges.binance_orderbook_ws import run_orderbook_collector
                elif exchange == "bybit":
                    from ..exchanges.bybit_orderbook_ws import run_orderbook_collector
                else:
                    return False
                
                task = asyncio.create_task(run_orderbook_collector(symbol))
                self._tasks[task_key] = task
                self._active_symbols[exchange].add(symbol)
                
                log.info(f"Started orderbook collector: {task_key}")
                return True
                
            except Exception as e:
                log.error(f"Failed to start orderbook collector {task_key}: {e}")
                return False
    
    async def stop_orderbook(self, exchange: str, symbol: str) -> None:
        """Stop order book streaming for a symbol."""
        async with self._lock:
            exchange = exchange.lower()
            task_key = f"{exchange}:{symbol}"
            
            task = self._tasks.pop(task_key, None)
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            
            if exchange in self._active_symbols:
                self._active_symbols[exchange].discard(symbol)
            
            log.info(f"Stopped orderbook collector: {task_key}")
    
    async def stop_all(self) -> None:
        """Stop all order book collectors."""
        async with self._lock:
            for task_key, task in list(self._tasks.items()):
                if task and not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
            
            self._tasks.clear()
            for exchange in self._active_symbols:
                self._active_symbols[exchange].clear()
            
            log.info("Stopped all orderbook collectors")
    
    def get_walls(self, exchange: str, symbol: str, min_strength: float = 1.5, max_distance_pct: float = 3.0) -> Dict[str, List[Dict[str, Any]]]:
        """Get detected walls for a symbol (scalping - close to price).
        
        Returns dict with 'support' and 'resistance' lists.
        """
        exchange = exchange.lower()
        
        try:
            if exchange == "binance":
                from ..exchanges.binance_orderbook_ws import get_orderbook_state
            elif exchange == "bybit":
                from ..exchanges.bybit_orderbook_ws import get_orderbook_state
            else:
                return {"support": [], "resistance": []}
            
            state = get_orderbook_state(symbol)
            if not state:
                return {"support": [], "resistance": []}
            
            return state.detect_walls(min_strength=min_strength, max_distance_pct=max_distance_pct)
            
        except Exception as e:
            log.debug(f"Failed to get orderbook walls {exchange}:{symbol}: {e}")
            return {"support": [], "resistance": []}
    
    def get_swing_walls(self, exchange: str, symbol: str, min_strength: float = 1.5, max_distance_pct: float = 10.0, cluster_pct: float = 0.3) -> Dict[str, List[Dict[str, Any]]]:
        """Get detected walls for swing trading - looks further from current price.
        
        Uses clustering to aggregate nearby walls into zones.
        
        Args:
            exchange: Exchange name
            symbol: Trading pair
            min_strength: Minimum strength multiplier
            max_distance_pct: How far from price to look (default 10%)
            cluster_pct: Cluster walls within this % of each other
            
        Returns:
            Dict with 'support' and 'resistance' zones for swing trading
        """
        exchange = exchange.lower()
        
        try:
            if exchange == "binance":
                from ..exchanges.binance_orderbook_ws import get_orderbook_state
            elif exchange == "bybit":
                from ..exchanges.bybit_orderbook_ws import get_orderbook_state
            else:
                return {"support": [], "resistance": []}
            
            state = get_orderbook_state(symbol)
            if not state:
                return {"support": [], "resistance": []}
            
            return state.detect_swing_walls(
                min_strength=min_strength,
                max_distance_pct=max_distance_pct,
                cluster_pct=cluster_pct
            )
            
        except Exception as e:
            log.debug(f"Failed to get swing walls {exchange}:{symbol}: {e}")
            return {"support": [], "resistance": []}
    
    def get_orderbook_state(self, exchange: str, symbol: str) -> Optional[Dict[str, Any]]:
        """Get the current order book state for a symbol.
        
        Returns depth summary with walls.
        """
        exchange = exchange.lower()
        
        try:
            if exchange == "binance":
                from ..exchanges.binance_orderbook_ws import get_orderbook_state
            elif exchange == "bybit":
                from ..exchanges.bybit_orderbook_ws import get_orderbook_state
            else:
                return None
            
            state = get_orderbook_state(symbol)
            if not state:
                return None
            
            depth = state.get_depth_summary(levels=10)
            walls = state.detect_walls(min_strength=1.5)
            
            return {
                "exchange": exchange,
                "symbol": symbol,
                "mid_price": depth["mid_price"],
                "best_bid": depth["best_bid"],
                "best_ask": depth["best_ask"],
                "spread": depth["spread"],
                "bid_ratio": depth["bid_ratio"],
                "imbalance": depth["imbalance"],
                "total_bid_value": depth["total_bid_value"],
                "total_ask_value": depth["total_ask_value"],
                "walls": walls,
                "last_update_ts": state.last_update_ts
            }
            
        except Exception as e:
            log.debug(f"Failed to get orderbook state {exchange}:{symbol}: {e}")
            return None
    
    def is_active(self, exchange: str, symbol: str) -> bool:
        """Check if order book streaming is active for a symbol."""
        exchange = exchange.lower()
        if exchange not in self._active_symbols:
            return False
        return symbol in self._active_symbols[exchange]
    
    def get_active_count(self) -> Dict[str, int]:
        """Get count of active order book streams per exchange."""
        return {
            exchange: len(symbols) 
            for exchange, symbols in self._active_symbols.items()
        }


# Global singleton instance
_orderbook_hub: Optional[OrderBookHub] = None


def get_orderbook_hub() -> OrderBookHub:
    """Get the global OrderBookHub instance."""
    global _orderbook_hub
    if _orderbook_hub is None:
        _orderbook_hub = OrderBookHub()
    return _orderbook_hub
