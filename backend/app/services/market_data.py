"""
Market data services for Long/Short Ratio and Liquidations.
Fetches data from Binance and Bybit public APIs.
"""
from __future__ import annotations
import asyncio
import time
import logging
from typing import Optional, Dict, Any, List, Tuple
import aiohttp

logger = logging.getLogger(__name__)

# Cache for market data (to avoid hitting rate limits)
_ls_ratio_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}  # key -> (timestamp, data)
_liquidations_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_CACHE_TTL_SEC = 60.0  # 1 minute cache


async def fetch_long_short_ratio(exchange: str, symbol: str) -> Optional[Dict[str, Any]]:
    """
    Fetch Long/Short ratio data for a symbol.
    
    Returns:
        {
            "symbol": "BTCUSDT",
            "long_ratio": 0.52,      # Percentage of accounts long (0-1)
            "short_ratio": 0.48,     # Percentage of accounts short (0-1)
            "long_short_ratio": 1.08, # long_ratio / short_ratio
            "long_account": 52.0,    # % accounts long
            "short_account": 48.0,   # % accounts short
            "timestamp": 1234567890000
        }
    """
    cache_key = f"{exchange}:{symbol}:ls"
    now = time.time()
    
    # Check cache
    if cache_key in _ls_ratio_cache:
        cached_ts, cached_data = _ls_ratio_cache[cache_key]
        if now - cached_ts < _CACHE_TTL_SEC:
            return cached_data
    
    try:
        if exchange == "binance":
            return await _fetch_binance_ls_ratio(symbol, cache_key)
        elif exchange == "bybit":
            return await _fetch_bybit_ls_ratio(symbol, cache_key)
        else:
            return None
    except Exception as e:
        logger.warning(f"Failed to fetch L/S ratio for {exchange}:{symbol}: {e}")
        return None


async def _fetch_binance_ls_ratio(symbol: str, cache_key: str) -> Optional[Dict[str, Any]]:
    """Fetch from Binance Futures API - Top Trader Long/Short Ratio (Accounts)"""
    # Binance provides multiple L/S ratio endpoints:
    # 1. /futures/data/globalLongShortAccountRatio - All traders
    # 2. /futures/data/topLongShortAccountRatio - Top traders
    # 3. /futures/data/topLongShortPositionRatio - Top traders by position
    
    url = "https://fapi.binance.com/futures/data/globalLongShortAccountRatio"
    params = {
        "symbol": symbol,
        "period": "5m",  # 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d
        "limit": 1
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
            
            if not data or len(data) == 0:
                return None
            
            latest = data[0]
            # Binance returns longAccount/shortAccount as decimal ratios (e.g., "0.5234" for 52.34%)
            # We store as 0-1 ratio for consistency with Bybit
            long_ratio = float(latest.get("longAccount", 0))  # Already 0-1 range
            short_ratio = float(latest.get("shortAccount", 0))  # Already 0-1 range
            ls_ratio = float(latest.get("longShortRatio", 1))
            
            result = {
                "symbol": symbol,
                "long_ratio": long_ratio,
                "short_ratio": short_ratio,
                "long_short_ratio": ls_ratio,
                "long_account": long_ratio * 100,  # Convert to percentage for display
                "short_account": short_ratio * 100,  # Convert to percentage for display
                "timestamp": int(latest.get("timestamp", 0)),
                "period": "5m",
                "source": "binance_global"
            }
            
            # Cache result
            _ls_ratio_cache[cache_key] = (time.time(), result)
            return result


async def _fetch_bybit_ls_ratio(symbol: str, cache_key: str) -> Optional[Dict[str, Any]]:
    """Fetch from Bybit API - Long/Short Ratio"""
    # Bybit provides L/S ratio via /v5/market/account-ratio
    url = "https://api.bybit.com/v5/market/account-ratio"
    params = {
        "category": "linear",
        "symbol": symbol,
        "period": "5min",  # 5min, 15min, 30min, 1h, 4h, 1d
        "limit": 1
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
            
            if data.get("retCode") != 0:
                return None
            
            lst = data.get("result", {}).get("list", [])
            if not lst:
                return None
            
            latest = lst[0]
            buy_ratio = float(latest.get("buyRatio", 0))
            sell_ratio = float(latest.get("sellRatio", 0))
            
            # Convert to same format as Binance
            ls_ratio = buy_ratio / sell_ratio if sell_ratio > 0 else 1.0
            
            result = {
                "symbol": symbol,
                "long_ratio": buy_ratio,
                "short_ratio": sell_ratio,
                "long_short_ratio": ls_ratio,
                "long_account": buy_ratio * 100,
                "short_account": sell_ratio * 100,
                "timestamp": int(latest.get("timestamp", 0)),
                "period": "5min",
                "source": "bybit"
            }
            
            # Cache result
            _ls_ratio_cache[cache_key] = (time.time(), result)
            return result


async def fetch_liquidations(exchange: str, symbol: str, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Fetch recent liquidations for a symbol.
    
    Returns list of:
        {
            "symbol": "BTCUSDT",
            "side": "BUY" or "SELL",  # BUY = short liquidated, SELL = long liquidated
            "price": 50000.0,
            "qty": 0.5,
            "value_usd": 25000.0,
            "timestamp": 1234567890000
        }
    """
    cache_key = f"{exchange}:{symbol}:liq"
    now = time.time()
    
    # Check cache (shorter TTL for liquidations - 30s)
    if cache_key in _liquidations_cache:
        cached_ts, cached_data = _liquidations_cache[cache_key]
        if now - cached_ts < 30.0:
            return cached_data
    
    try:
        if exchange == "binance":
            return await _fetch_binance_liquidations(symbol, limit, cache_key)
        elif exchange == "bybit":
            return await _fetch_bybit_liquidations(symbol, limit, cache_key)
        else:
            return []
    except Exception as e:
        logger.warning(f"Failed to fetch liquidations for {exchange}:{symbol}: {e}")
        return []


async def _fetch_binance_liquidations(symbol: str, limit: int, cache_key: str) -> List[Dict[str, Any]]:
    """Fetch from Binance Futures API - Force Orders (Liquidations)"""
    url = "https://fapi.binance.com/fapi/v1/forceOrders"
    params = {
        "symbol": symbol,
        "limit": min(limit, 100)  # Max 100
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status != 200:
                return []
            data = await resp.json()
            
            if not data:
                return []
            
            results = []
            for liq in data:
                price = float(liq.get("price", 0))
                qty = float(liq.get("origQty", 0))
                side = liq.get("side", "")
                
                results.append({
                    "symbol": symbol,
                    "side": side,
                    "price": price,
                    "qty": qty,
                    "value_usd": price * qty,
                    "timestamp": int(liq.get("time", 0)),
                    "source": "binance"
                })
            
            # Sort by timestamp desc
            results.sort(key=lambda x: x["timestamp"], reverse=True)
            
            # Cache result
            _liquidations_cache[cache_key] = (time.time(), results)
            return results


async def _fetch_bybit_liquidations(symbol: str, limit: int, cache_key: str) -> List[Dict[str, Any]]:
    """Fetch from Bybit WebSocket store - Recent liquidations
    
    Bybit doesn't have a REST API for liquidations, so we use the WebSocket stream
    which collects liquidations in memory. The stream must be running for data to be available.
    """
    try:
        from ..exchanges.bybit_liquidations_ws import get_recent_liquidations
        return get_recent_liquidations(symbol, limit=limit)
    except ImportError:
        logger.warning("Bybit liquidations WebSocket module not available")
        return []
    except Exception as e:
        logger.warning(f"Failed to get Bybit liquidations from WS store: {e}")
        return []


async def fetch_market_data_combined(exchange: str, symbol: str) -> Dict[str, Any]:
    """
    Fetch both L/S ratio and liquidations in parallel.
    Used by the /symbol/details endpoint.
    """
    ls_task = fetch_long_short_ratio(exchange, symbol)
    liq_task = fetch_liquidations(exchange, symbol, limit=20)
    
    ls_data, liq_data = await asyncio.gather(ls_task, liq_task)
    
    # Calculate liquidation summary
    liq_summary = {
        "recent_count": len(liq_data),
        "long_liq_count": sum(1 for l in liq_data if l.get("side") == "SELL"),  # SELL = long liquidated
        "short_liq_count": sum(1 for l in liq_data if l.get("side") == "BUY"),  # BUY = short liquidated
        "total_value_usd": sum(l.get("value_usd", 0) for l in liq_data),
        "long_liq_value": sum(l.get("value_usd", 0) for l in liq_data if l.get("side") == "SELL"),
        "short_liq_value": sum(l.get("value_usd", 0) for l in liq_data if l.get("side") == "BUY"),
    }
    
    return {
        "long_short_ratio": ls_data,
        "liquidations": liq_data[:10],  # Return top 10 most recent
        "liquidation_summary": liq_summary
    }
