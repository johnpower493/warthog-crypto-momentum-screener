"""
Funding rate fetcher for perpetual futures.
Fetches current funding rates and next funding times from exchanges.
"""

import asyncio
import logging
from typing import Dict, Optional, Tuple
from datetime import datetime
import aiohttp

log = logging.getLogger(__name__)


class FundingRateCache:
    """Cache for funding rates to avoid excessive API calls."""
    
    def __init__(self, cache_duration_seconds: int = 300):
        self._cache: Dict[str, Tuple[float, datetime, Optional[int]]] = {}
        self._cache_duration = cache_duration_seconds
    
    def get(self, exchange: str, symbol: str) -> Optional[Tuple[float, Optional[int]]]:
        """Get cached funding rate and next funding time.
        
        Returns: (funding_rate, next_funding_time_ms) or None if not cached or expired.
        """
        key = f"{exchange}:{symbol}"
        if key not in self._cache:
            return None
        
        rate, cached_at, next_time = self._cache[key]
        age_seconds = (datetime.utcnow() - cached_at).total_seconds()
        
        if age_seconds > self._cache_duration:
            return None
        
        return (rate, next_time)
    
    def set(self, exchange: str, symbol: str, rate: float, next_funding_time_ms: Optional[int] = None):
        """Cache a funding rate."""
        key = f"{exchange}:{symbol}"
        self._cache[key] = (rate, datetime.utcnow(), next_funding_time_ms)


# Global cache instance
_funding_cache = FundingRateCache()


async def fetch_binance_funding_rate(symbol: str) -> Optional[Tuple[float, Optional[int]]]:
    """Fetch funding rate from Binance.
    
    Returns: (funding_rate, next_funding_time_ms) or None on error.
    """
    try:
        # Check cache first
        cached = _funding_cache.get('binance', symbol)
        if cached:
            return cached
        
        url = f"https://fapi.binance.com/fapi/v1/premiumIndex?symbol={symbol}"
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status != 200:
                    log.warning(f"Binance funding rate API returned {resp.status} for {symbol}")
                    return None
                
                data = await resp.json()
                
                # Extract funding rate and next funding time
                funding_rate = float(data.get('lastFundingRate', 0))
                next_funding_time = int(data.get('nextFundingTime', 0))
                
                # Cache the result
                _funding_cache.set('binance', symbol, funding_rate, next_funding_time)
                
                return (funding_rate, next_funding_time)
    
    except Exception as e:
        log.warning(f"Failed to fetch Binance funding rate for {symbol}: {e}")
        return None


async def fetch_bybit_funding_rate(symbol: str) -> Optional[Tuple[float, Optional[int]]]:
    """Fetch funding rate from Bybit.
    
    Returns: (funding_rate, next_funding_time_ms) or None on error.
    """
    try:
        # Check cache first
        cached = _funding_cache.get('bybit', symbol)
        if cached:
            return cached
        
        url = f"https://api.bybit.com/v5/market/tickers?category=linear&symbol={symbol}"
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status != 200:
                    log.warning(f"Bybit funding rate API returned {resp.status} for {symbol}")
                    return None
                
                data = await resp.json()
                
                if data.get('retCode') != 0:
                    log.warning(f"Bybit API error for {symbol}: {data.get('retMsg')}")
                    return None
                
                result = data.get('result', {})
                items = result.get('list', [])
                
                if not items:
                    log.warning(f"No funding rate data for {symbol} from Bybit")
                    return None
                
                item = items[0]
                funding_rate = float(item.get('fundingRate', 0))
                next_funding_time = int(item.get('nextFundingTime', 0))
                
                # Cache the result
                _funding_cache.set('bybit', symbol, funding_rate, next_funding_time)
                
                return (funding_rate, next_funding_time)
    
    except Exception as e:
        log.warning(f"Failed to fetch Bybit funding rate for {symbol}: {e}")
        return None


async def fetch_funding_rate(exchange: str, symbol: str) -> Optional[Tuple[float, Optional[int]]]:
    """Fetch funding rate for any exchange.
    
    Returns: (funding_rate, next_funding_time_ms) or None on error.
    """
    if exchange == 'binance':
        return await fetch_binance_funding_rate(symbol)
    elif exchange == 'bybit':
        return await fetch_bybit_funding_rate(symbol)
    else:
        log.warning(f"Funding rate not supported for exchange: {exchange}")
        return None


async def fetch_multiple_funding_rates(symbols: list[tuple[str, str]]) -> Dict[str, Tuple[float, Optional[int]]]:
    """Fetch funding rates for multiple symbols concurrently.
    
    Args:
        symbols: List of (exchange, symbol) tuples
    
    Returns:
        Dict mapping "exchange:symbol" to (funding_rate, next_funding_time_ms)
    """
    tasks = []
    keys = []
    
    for exchange, symbol in symbols:
        tasks.append(fetch_funding_rate(exchange, symbol))
        keys.append(f"{exchange}:{symbol}")
    
    results = await asyncio.gather(*tasks)
    
    return {
        key: result
        for key, result in zip(keys, results)
        if result is not None
    }
