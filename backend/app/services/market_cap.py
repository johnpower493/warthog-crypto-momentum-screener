"""
Market cap fetcher using CoinGecko API (free tier).
Provides market cap data for crypto symbols with SQLite persistence.
"""
import asyncio
import logging
import time
from typing import Dict, Optional
import aiohttp

logger = logging.getLogger(__name__)

# Default update interval: 1 hour (3600 seconds)
DEFAULT_UPDATE_INTERVAL = 3600

class MarketCapProvider:
    """Fetches and caches market cap data from CoinGecko with SQLite persistence."""
    
    def __init__(self, update_interval: int = DEFAULT_UPDATE_INTERVAL):
        self._cache: Dict[str, float] = {}
        self._symbol_to_coingecko_id: Dict[str, str] = {}
        self._last_update: float = 0
        self._update_interval = update_interval  # Configurable interval (default 1 hour)
        self._session: Optional[aiohttp.ClientSession] = None
        self._db_initialized = False
        
    async def get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session
        
    async def close(self):
        """Close aiohttp session."""
        if self._session and not self._session.closed:
            await self._session.close()
    
    def _init_db(self):
        """Initialize SQLite table for market cap cache."""
        if self._db_initialized:
            return
        try:
            from .ohlc_store import init_db, get_conn, _DB_LOCK
            init_db()
            conn = get_conn()
            with _DB_LOCK:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS market_cap_cache (
                        symbol TEXT PRIMARY KEY,
                        market_cap REAL NOT NULL,
                        last_updated INTEGER NOT NULL
                    )
                """)
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_market_cap_updated 
                    ON market_cap_cache(last_updated)
                """)
                conn.commit()
            self._db_initialized = True
            logger.info("Market cap cache table initialized")
        except Exception as e:
            logger.error(f"Error initializing market cap DB: {e}")
    
    def _load_from_db(self):
        """Load market cap data from SQLite cache."""
        try:
            from .ohlc_store import get_conn, _DB_LOCK
            self._init_db()
            conn = get_conn()
            with _DB_LOCK:
                cursor = conn.execute("""
                    SELECT symbol, market_cap, last_updated 
                    FROM market_cap_cache
                """)
                rows = cursor.fetchall()
            
            if rows:
                self._cache.clear()
                oldest_update = None
                for symbol, market_cap, last_updated in rows:
                    self._cache[symbol.upper()] = float(market_cap)
                    if oldest_update is None or last_updated < oldest_update:
                        oldest_update = last_updated
                
                if oldest_update:
                    self._last_update = oldest_update
                
                logger.info(f"Loaded {len(rows)} market cap entries from DB cache")
                return True
            return False
        except Exception as e:
            logger.error(f"Error loading market cap from DB: {e}")
            return False
    
    def _save_to_db(self):
        """Save current market cap cache to SQLite."""
        try:
            from .ohlc_store import get_conn, _DB_LOCK
            self._init_db()
            conn = get_conn()
            current_time = int(time.time())
            
            with _DB_LOCK:
                # Clear old data and insert new
                conn.execute("DELETE FROM market_cap_cache")
                conn.executemany(
                    "INSERT INTO market_cap_cache (symbol, market_cap, last_updated) VALUES (?, ?, ?)",
                    [(symbol, market_cap, current_time) for symbol, market_cap in self._cache.items()]
                )
                conn.commit()
            
            logger.info(f"Saved {len(self._cache)} market cap entries to DB cache")
        except Exception as e:
            logger.error(f"Error saving market cap to DB: {e}")
    
    def _normalize_symbol(self, symbol: str) -> str:
        """Normalize symbol for lookup (e.g., BTCUSDT -> BTC)."""
        symbol = symbol.upper().replace("USDT", "").replace("PERP", "").replace("USD", "")
        # Special cases
        if symbol == "WBTC":
            return "BTC"
        return symbol
    
    async def _fetch_coingecko_ids(self):
        """Fetch mapping of symbols to CoinGecko IDs."""
        try:
            session = await self.get_session()
            url = "https://api.coingecko.com/api/v3/coins/list"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    # Build a mapping from symbol to id
                    mapping = {}
                    for coin in data:
                        symbol = coin.get("symbol", "").upper()
                        coin_id = coin.get("id", "")
                        # Prefer shorter IDs for common symbols (bitcoin over wrapped-bitcoin)
                        if symbol not in mapping or len(coin_id) < len(mapping[symbol]):
                            mapping[symbol] = coin_id
                    self._symbol_to_coingecko_id = mapping
                    logger.info(f"Fetched {len(mapping)} CoinGecko symbol mappings")
        except Exception as e:
            logger.error(f"Error fetching CoinGecko IDs: {e}")
    
    async def _fetch_market_caps(self):
        """Fetch market cap data from CoinGecko for top coins."""
        try:
            session = await self.get_session()
            # Fetch top 250 coins by market cap (free tier allows this)
            url = "https://api.coingecko.com/api/v3/coins/markets"
            params = {
                "vs_currency": "usd",
                "order": "market_cap_desc",
                "per_page": "250",
                "page": "1",
                "sparkline": "false"
            }
            
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    new_cache = {}
                    for coin in data:
                        symbol = coin.get("symbol", "").upper()
                        market_cap = coin.get("market_cap")
                        if symbol and market_cap is not None:
                            new_cache[symbol] = float(market_cap)
                    
                    self._cache = new_cache
                    self._last_update = time.time()
                    logger.info(f"Updated market cap cache with {len(new_cache)} symbols from CoinGecko")
                    
                    # Save to database
                    self._save_to_db()
                elif resp.status == 429:
                    logger.warning("CoinGecko rate limit hit, using cached data")
                else:
                    logger.warning(f"CoinGecko API returned status {resp.status}")
        except Exception as e:
            logger.error(f"Error fetching market caps: {e}")
    
    async def ensure_initialized(self):
        """Ensure the provider is initialized with symbol mappings and cache."""
        # Initialize DB
        self._init_db()
        
        # Try to load from database first
        loaded_from_db = self._load_from_db()
        
        # Fetch CoinGecko ID mappings if not already loaded
        if not self._symbol_to_coingecko_id:
            await self._fetch_coingecko_ids()
        
        # If DB is empty or stale, fetch fresh data
        if not loaded_from_db:
            logger.info("No cached market cap data found, fetching from CoinGecko...")
            await self._fetch_market_caps()
        else:
            logger.info(f"Using cached market cap data (age: {int(time.time() - self._last_update)}s)")
    
    async def update_if_needed(self):
        """Update market cap cache if stale."""
        current_time = time.time()
        age = current_time - self._last_update
        if age >= self._update_interval:
            logger.info(f"Market cap cache is stale (age: {int(age)}s), updating from CoinGecko...")
            await self._fetch_market_caps()
        else:
            logger.debug(f"Market cap cache is fresh (age: {int(age)}s, interval: {self._update_interval}s)")
    
    def get_market_cap(self, symbol: str) -> Optional[float]:
        """Get market cap for a symbol (e.g., BTCUSDT -> BTC market cap)."""
        normalized = self._normalize_symbol(symbol)
        return self._cache.get(normalized)

# Global instance
_provider: Optional[MarketCapProvider] = None

def get_provider() -> MarketCapProvider:
    """Get or create the global market cap provider."""
    global _provider
    if _provider is None:
        try:
            from ..config import MARKET_CAP_UPDATE_INTERVAL_SEC
            interval = MARKET_CAP_UPDATE_INTERVAL_SEC
        except (ImportError, AttributeError):
            interval = DEFAULT_UPDATE_INTERVAL
        _provider = MarketCapProvider(update_interval=interval)
        logger.info(f"Created market cap provider with update interval: {interval}s ({interval//3600}h)")
    return _provider

async def initialize():
    """Initialize the market cap provider."""
    provider = get_provider()
    await provider.ensure_initialized()
    await provider.update_if_needed()

async def cleanup():
    """Cleanup resources."""
    global _provider
    if _provider:
        await _provider.close()
        _provider = None
