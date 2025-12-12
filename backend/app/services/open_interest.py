from __future__ import annotations
import asyncio
import logging
from typing import Dict, List, Optional
import httpx

logger = logging.getLogger(__name__)

class OpenInterestFetcher:
    """Fetches Open Interest data from exchanges"""
    
    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None
        self._oi_cache: Dict[str, Dict[str, float]] = {}  # {exchange: {symbol: oi}}
        
    async def start(self):
        """Initialize the HTTP client"""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=10)
    
    async def stop(self):
        """Close the HTTP client"""
        if self._client:
            await self._client.aclose()
            self._client = None
    
    async def fetch_binance_oi(self, symbols: List[str]) -> Dict[str, float]:
        """
        Fetch open interest for Binance perpetual futures
        Endpoint: GET /fapi/v1/openInterest
        """
        if not self._client:
            await self.start()
        
        result = {}
        base_url = "https://fapi.binance.com"
        
        # Binance allows fetching OI per symbol
        for symbol in symbols:
            try:
                resp = await self._client.get(f"{base_url}/fapi/v1/openInterest", params={"symbol": symbol})
                if resp.status_code == 200:
                    data = resp.json()
                    # openInterest is in contracts, openInterestValue is in USD
                    oi = float(data.get("openInterest", 0))
                    result[symbol] = oi
                await asyncio.sleep(0.05)  # Rate limit protection
            except Exception as e:
                logger.debug(f"Error fetching Binance OI for {symbol}: {e}")
                continue
        
        self._oi_cache["binance"] = result
        return result
    
    async def fetch_bybit_oi(self, symbols: List[str]) -> Dict[str, float]:
        """
        Fetch open interest for Bybit linear perpetuals
        Endpoint: GET /v5/market/open-interest
        """
        if not self._client:
            await self.start()
        
        result = {}
        base_url = "https://api.bybit.com"
        
        # Bybit allows fetching OI per symbol
        for symbol in symbols:
            try:
                resp = await self._client.get(
                    f"{base_url}/v5/market/open-interest",
                    params={"category": "linear", "symbol": symbol, "intervalTime": "5min"}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("retCode") == 0:
                        items = data.get("result", {}).get("list", [])
                        if items:
                            # Get the most recent OI value
                            oi = float(items[0].get("openInterest", 0))
                            result[symbol] = oi
                await asyncio.sleep(0.05)  # Rate limit protection
            except Exception as e:
                logger.debug(f"Error fetching Bybit OI for {symbol}: {e}")
                continue
        
        self._oi_cache["bybit"] = result
        return result
    
    def get_oi(self, exchange: str, symbol: str) -> Optional[float]:
        """Get cached OI value for a symbol"""
        return self._oi_cache.get(exchange, {}).get(symbol)
    
    async def periodic_fetch(self, exchange: str, symbols: List[str], interval: int = 60):
        """
        Periodically fetch OI data for given symbols
        interval: seconds between fetches (default 60s)
        """
        while True:
            try:
                if exchange == "binance":
                    await self.fetch_binance_oi(symbols)
                elif exchange == "bybit":
                    await self.fetch_bybit_oi(symbols)
                logger.info(f"Fetched OI for {len(symbols)} {exchange} symbols")
            except Exception as e:
                logger.error(f"Error in periodic OI fetch for {exchange}: {e}")
            
            await asyncio.sleep(interval)
