"""
Binance Order Book WebSocket Stream with Wall Detection

Subscribes to the order book depth stream to detect support/resistance walls
from resting limit orders in real-time.

Binance Futures WebSocket: wss://fstream.binance.com/stream
Stream: <symbol>@depth@100ms (fast updates) or <symbol>@depth20@100ms (top 20 levels)

Wall Detection Logic:
- Scans bid side for large clustered buy orders (support walls)
- Scans ask side for large clustered sell orders (resistance walls)
- A "wall" is a price level with significantly more volume than surrounding levels
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import AsyncIterator, Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, field

import websockets

from ..config import BINANCE_FUTURES_WS, WS_PING_INTERVAL

log = logging.getLogger(__name__)


@dataclass
class OrderBookLevel:
    """Single price level in the order book."""
    price: float
    quantity: float
    value_usd: float  # price * quantity
    

@dataclass
class OrderBookWall:
    """Detected wall (large resting order) in the order book."""
    price: float
    quantity: float
    value_usd: float
    side: str  # 'support' (bid) or 'resistance' (ask)
    strength: float  # How much larger than average (multiplier)
    distance_pct: float  # Distance from current price as percentage
    

@dataclass
class OrderBookState:
    """Current state of the order book for a symbol."""
    symbol: str
    bids: Dict[float, float] = field(default_factory=dict)  # price -> qty
    asks: Dict[float, float] = field(default_factory=dict)  # price -> qty
    last_update_id: int = 0
    last_update_ts: int = 0
    
    def update_from_snapshot(self, bids: List[List[str]], asks: List[List[str]], update_id: int):
        """Initialize from a depth snapshot."""
        self.bids.clear()
        self.asks.clear()
        for b in bids:
            price, qty = float(b[0]), float(b[1])
            if qty > 0:
                self.bids[price] = qty
        for a in asks:
            price, qty = float(a[0]), float(a[1])
            if qty > 0:
                self.asks[price] = qty
        self.last_update_id = update_id
        self.last_update_ts = int(time.time() * 1000)
    
    def update_from_delta(self, bids: List[List[str]], asks: List[List[str]], update_id: int):
        """Apply incremental updates."""
        for b in bids:
            price, qty = float(b[0]), float(b[1])
            if qty == 0:
                self.bids.pop(price, None)
            else:
                self.bids[price] = qty
        for a in asks:
            price, qty = float(a[0]), float(a[1])
            if qty == 0:
                self.asks.pop(price, None)
            else:
                self.asks[price] = qty
        self.last_update_id = update_id
        self.last_update_ts = int(time.time() * 1000)
    
    def get_best_bid(self) -> Optional[float]:
        """Get highest bid price."""
        return max(self.bids.keys()) if self.bids else None
    
    def get_best_ask(self) -> Optional[float]:
        """Get lowest ask price."""
        return min(self.asks.keys()) if self.asks else None
    
    def get_mid_price(self) -> Optional[float]:
        """Get mid price between best bid and ask."""
        best_bid = self.get_best_bid()
        best_ask = self.get_best_ask()
        if best_bid and best_ask:
            return (best_bid + best_ask) / 2
        return best_bid or best_ask
    
    def detect_walls(
        self, 
        min_strength: float = 2.0,
        max_levels: int = 50,
        max_distance_pct: float = 3.0,
        cluster_pct: float = 0.0
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Detect support and resistance walls from the order book.
        
        Args:
            min_strength: Minimum multiplier above average to be considered a wall
            max_levels: Maximum number of price levels to analyze on each side
            max_distance_pct: Maximum distance from mid price to consider
            cluster_pct: Percentage range to cluster nearby walls (0 = no clustering)
            
        Returns:
            Dict with 'support' and 'resistance' lists of wall data
        """
        mid_price = self.get_mid_price()
        if not mid_price or mid_price <= 0:
            return {"support": [], "resistance": []}
        
        support_walls = []
        resistance_walls = []
        
        # Analyze bids (support)
        if self.bids:
            sorted_bids = sorted(self.bids.items(), key=lambda x: x[0], reverse=True)[:max_levels]
            bid_values = [(price, qty, price * qty) for price, qty in sorted_bids]
            
            if bid_values:
                avg_value = sum(v[2] for v in bid_values) / len(bid_values)
                
                for price, qty, value in bid_values:
                    distance_pct = abs(mid_price - price) / mid_price * 100
                    if distance_pct > max_distance_pct:
                        continue
                    
                    strength = value / avg_value if avg_value > 0 else 0
                    if strength >= min_strength:
                        support_walls.append({
                            "price": price,
                            "quantity": qty,
                            "value_usd": value,
                            "side": "support",
                            "strength": round(strength, 2),
                            "distance_pct": round(distance_pct, 2)
                        })
        
        # Analyze asks (resistance)
        if self.asks:
            sorted_asks = sorted(self.asks.items(), key=lambda x: x[0])[:max_levels]
            ask_values = [(price, qty, price * qty) for price, qty in sorted_asks]
            
            if ask_values:
                avg_value = sum(v[2] for v in ask_values) / len(ask_values)
                
                for price, qty, value in ask_values:
                    distance_pct = abs(price - mid_price) / mid_price * 100
                    if distance_pct > max_distance_pct:
                        continue
                    
                    strength = value / avg_value if avg_value > 0 else 0
                    if strength >= min_strength:
                        resistance_walls.append({
                            "price": price,
                            "quantity": qty,
                            "value_usd": value,
                            "side": "resistance",
                            "strength": round(strength, 2),
                            "distance_pct": round(distance_pct, 2)
                        })
        
        # Cluster nearby walls if requested
        if cluster_pct > 0:
            support_walls = self._cluster_walls(support_walls, mid_price, cluster_pct)
            resistance_walls = self._cluster_walls(resistance_walls, mid_price, cluster_pct)
        
        # Sort by strength (strongest first) and limit
        support_walls.sort(key=lambda x: x["strength"], reverse=True)
        resistance_walls.sort(key=lambda x: x["strength"], reverse=True)
        
        return {
            "support": support_walls[:10],
            "resistance": resistance_walls[:10]
        }
    
    def _cluster_walls(
        self, 
        walls: List[Dict[str, Any]], 
        mid_price: float,
        cluster_pct: float
    ) -> List[Dict[str, Any]]:
        """Cluster nearby walls together into aggregated zones.
        
        Combines walls that are within cluster_pct of each other.
        """
        if not walls or cluster_pct <= 0:
            return walls
        
        # Sort by price
        sorted_walls = sorted(walls, key=lambda x: x["price"])
        clustered = []
        
        i = 0
        while i < len(sorted_walls):
            # Start a new cluster
            cluster_walls = [sorted_walls[i]]
            cluster_start_price = sorted_walls[i]["price"]
            
            # Add nearby walls to cluster
            j = i + 1
            while j < len(sorted_walls):
                price_diff_pct = abs(sorted_walls[j]["price"] - cluster_start_price) / cluster_start_price * 100
                if price_diff_pct <= cluster_pct:
                    cluster_walls.append(sorted_walls[j])
                    j += 1
                else:
                    break
            
            # Aggregate cluster
            if len(cluster_walls) == 1:
                clustered.append(cluster_walls[0])
            else:
                # Combine into single aggregated wall
                total_value = sum(w["value_usd"] for w in cluster_walls)
                total_qty = sum(w["quantity"] for w in cluster_walls)
                # Use value-weighted average price
                weighted_price = sum(w["price"] * w["value_usd"] for w in cluster_walls) / total_value
                avg_strength = sum(w["strength"] for w in cluster_walls) / len(cluster_walls)
                distance_pct = abs(weighted_price - mid_price) / mid_price * 100
                
                clustered.append({
                    "price": round(weighted_price, 2),
                    "quantity": total_qty,
                    "value_usd": total_value,
                    "side": cluster_walls[0]["side"],
                    "strength": round(avg_strength * len(cluster_walls), 2),  # Boost strength for clusters
                    "distance_pct": round(distance_pct, 2),
                    "is_cluster": True,
                    "cluster_count": len(cluster_walls),
                    "price_range": [min(w["price"] for w in cluster_walls), max(w["price"] for w in cluster_walls)]
                })
            
            i = j
        
        return clustered
    
    def detect_swing_walls(
        self,
        min_strength: float = 1.5,
        max_distance_pct: float = 10.0,
        cluster_pct: float = 0.3
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Detect walls for swing trading - looks further from current price.
        
        Uses clustering to aggregate nearby walls into zones.
        
        Args:
            min_strength: Minimum strength multiplier (lower = more sensitive)
            max_distance_pct: How far from price to look (default 10%)
            cluster_pct: Cluster walls within this % of each other
            
        Returns:
            Dict with 'support' and 'resistance' zones for swing trading
        """
        return self.detect_walls(
            min_strength=min_strength,
            max_levels=200,  # Analyze more levels
            max_distance_pct=max_distance_pct,
            cluster_pct=cluster_pct
        )
    
    def get_depth_summary(self, levels: int = 10) -> Dict[str, Any]:
        """Get a summary of order book depth."""
        mid_price = self.get_mid_price()
        
        # Top bids
        sorted_bids = sorted(self.bids.items(), key=lambda x: x[0], reverse=True)[:levels]
        top_bids = [{"price": p, "qty": q, "value": p * q} for p, q in sorted_bids]
        total_bid_value = sum(b["value"] for b in top_bids)
        
        # Top asks
        sorted_asks = sorted(self.asks.items(), key=lambda x: x[0])[:levels]
        top_asks = [{"price": p, "qty": q, "value": p * q} for p, q in sorted_asks]
        total_ask_value = sum(a["value"] for a in top_asks)
        
        # Imbalance ratio
        total = total_bid_value + total_ask_value
        bid_ratio = total_bid_value / total if total > 0 else 0.5
        
        return {
            "mid_price": mid_price,
            "best_bid": self.get_best_bid(),
            "best_ask": self.get_best_ask(),
            "spread": (self.get_best_ask() - self.get_best_bid()) if self.get_best_bid() and self.get_best_ask() else 0,
            "top_bids": top_bids,
            "top_asks": top_asks,
            "total_bid_value": total_bid_value,
            "total_ask_value": total_ask_value,
            "bid_ratio": round(bid_ratio, 3),
            "imbalance": "BID" if bid_ratio > 0.55 else "ASK" if bid_ratio < 0.45 else "NEUTRAL"
        }


# In-memory store for order book states
_orderbook_states: Dict[str, OrderBookState] = {}


def get_orderbook_state(symbol: str) -> Optional[OrderBookState]:
    """Get the current order book state for a symbol."""
    return _orderbook_states.get(symbol)


def get_orderbook_walls(symbol: str, min_strength: float = 2.0) -> Dict[str, List[Dict[str, Any]]]:
    """Get detected walls for a symbol from the order book."""
    state = _orderbook_states.get(symbol)
    if not state:
        return {"support": [], "resistance": []}
    return state.detect_walls(min_strength=min_strength)


async def stream_orderbook(symbol: str, depth_levels: int = 20) -> AsyncIterator[dict]:
    """Stream order book updates for a Binance symbol.
    
    Yields normalized updates with wall detection.
    
    Args:
        symbol: Trading pair (e.g., "BTCUSDT")
        depth_levels: Number of levels to subscribe to (5, 10, or 20)
    """
    # Use partial depth stream for efficiency
    stream = f"{symbol.lower()}@depth{depth_levels}@100ms"
    url = f"{BINANCE_FUTURES_WS}?streams={stream}"
    
    # Initialize state
    if symbol not in _orderbook_states:
        _orderbook_states[symbol] = OrderBookState(symbol=symbol)
    state = _orderbook_states[symbol]
    
    backoff = 1.0
    attempt = 0
    
    while True:
        try:
            attempt += 1
            log.info(f"Binance orderbook WS connect {symbol} (attempt {attempt})")
            
            async with websockets.connect(
                url,
                ping_interval=WS_PING_INTERVAL,
                ping_timeout=60,
                close_timeout=10,
                max_queue=4096,
            ) as ws:
                backoff = 1.0
                log.info(f"Binance orderbook connected: {symbol}")
                
                async for message in ws:
                    try:
                        data = json.loads(message)
                        
                        # Handle combined stream format
                        payload = data.get("data") if isinstance(data, dict) and "data" in data else data
                        if not payload:
                            continue
                        
                        # Partial depth snapshot format
                        bids = payload.get("b") or payload.get("bids", [])
                        asks = payload.get("a") or payload.get("asks", [])
                        update_id = payload.get("u") or payload.get("lastUpdateId", 0)
                        
                        if not bids and not asks:
                            continue
                        
                        # Update state (partial depth gives us snapshots, not deltas)
                        state.update_from_snapshot(bids, asks, update_id)
                        
                        # Detect walls
                        walls = state.detect_walls(min_strength=1.5)
                        
                        # Get depth summary
                        depth = state.get_depth_summary(levels=10)
                        
                        yield {
                            "type": "orderbook",
                            "exchange": "binance",
                            "symbol": symbol,
                            "ts": int(time.time() * 1000),
                            "mid_price": depth["mid_price"],
                            "best_bid": depth["best_bid"],
                            "best_ask": depth["best_ask"],
                            "spread": depth["spread"],
                            "bid_ratio": depth["bid_ratio"],
                            "imbalance": depth["imbalance"],
                            "total_bid_value": depth["total_bid_value"],
                            "total_ask_value": depth["total_ask_value"],
                            "walls": walls,
                        }
                        
                    except json.JSONDecodeError:
                        continue
                    except Exception as e:
                        log.debug(f"Binance orderbook parse error: {e}")
                        continue
                        
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning(f"Binance orderbook WS error {symbol}: {type(e).__name__}: {e} (reconnect {backoff:.1f}s)")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 20)


async def run_orderbook_collector(symbol: str) -> None:
    """Run order book collector for a single symbol.
    
    Keeps the order book state updated in memory.
    """
    log.info(f"Starting Binance orderbook collector for {symbol}")
    
    try:
        async for update in stream_orderbook(symbol):
            # State is already updated in stream_orderbook
            # Log significant wall changes if needed
            walls = update.get("walls", {})
            support = walls.get("support", [])
            resistance = walls.get("resistance", [])
            
            if support or resistance:
                strongest_support = support[0] if support else None
                strongest_resistance = resistance[0] if resistance else None
                
                # Log large walls (strength > 3x)
                if strongest_support and strongest_support["strength"] > 3:
                    log.debug(f"Strong support wall {symbol}: ${strongest_support['price']:,.2f} ({strongest_support['strength']:.1f}x)")
                if strongest_resistance and strongest_resistance["strength"] > 3:
                    log.debug(f"Strong resistance wall {symbol}: ${strongest_resistance['price']:,.2f} ({strongest_resistance['strength']:.1f}x)")
                    
    except asyncio.CancelledError:
        log.info(f"Binance orderbook collector cancelled: {symbol}")
        raise
    except Exception as e:
        log.error(f"Binance orderbook collector error {symbol}: {e}")
        raise
