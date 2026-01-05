"""
News service using CryptoCompare API for crypto-specific news.
Free tier: No API key required for basic usage, but recommended for higher limits.
Get your free API key at: https://min-api.cryptocompare.com/
"""
import asyncio
import logging
import time
from typing import List, Dict, Optional
import aiohttp
import os

logger = logging.getLogger(__name__)

# Get API key from environment (optional for free tier)
CRYPTOCOMPARE_API_KEY = os.getenv("CRYPTOCOMPARE_API_KEY", "")

class NewsProvider:
    """Fetches crypto news from CryptoCompare with caching."""
    
    def __init__(self, cache_ttl: int = 900):  # 15 minutes cache
        self._cache: Dict[str, Dict] = {}  # symbol -> {articles, timestamp}
        self._cache_ttl = cache_ttl
        self._session: Optional[aiohttp.ClientSession] = None
    
    async def get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session
    
    async def close(self):
        """Close aiohttp session."""
        if self._session and not self._session.closed:
            await self._session.close()
    
    def _normalize_symbol(self, symbol: str) -> str:
        """Normalize symbol for news lookup (e.g., BTCUSDT -> BTC)."""
        symbol = symbol.upper().replace("USDT", "").replace("PERP", "").replace("USD", "")
        # Special cases
        if symbol == "WBTC":
            return "BTC"
        return symbol
    
    def _is_cache_valid(self, symbol: str) -> bool:
        """Check if cached news is still valid."""
        if symbol not in self._cache:
            return False
        age = time.time() - self._cache[symbol]["timestamp"]
        return age < self._cache_ttl
    
    async def get_news(self, symbol: str, limit: int = 20) -> List[Dict]:
        """
        Get latest news for a crypto symbol.
        
        Args:
            symbol: Trading symbol (e.g., BTCUSDT, ETHUSDT)
            limit: Maximum number of articles to return
        
        Returns:
            List of news articles with title, body, url, source, etc.
        """
        normalized = self._normalize_symbol(symbol)
        
        # Check cache
        if self._is_cache_valid(normalized):
            logger.debug(f"Returning cached news for {normalized}")
            return self._cache[normalized]["articles"][:limit]
        
        try:
            session = await self.get_session()
            
            # CryptoCompare news API endpoint
            url = "https://min-api.cryptocompare.com/data/v2/news/"
            params = {
                "lang": "EN",
                "sortOrder": "latest",
            }
            
            # Add API key if available
            if CRYPTOCOMPARE_API_KEY:
                params["api_key"] = CRYPTOCOMPARE_API_KEY
            
            # For symbol-specific news, we'll fetch general crypto news
            # and filter by tags/categories in the response
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                logger.info(f"CryptoCompare news API response status: {resp.status}")
                if resp.status == 200:
                    data = await resp.json()
                    logger.info(f"CryptoCompare response: Type={data.get('Type')}, Message={data.get('Message')}")
                    
                    # CryptoCompare returns Type: 100 for success
                    if data.get("Type") == 100 or data.get("Data"):
                        all_articles = data.get("Data", [])
                        
                        # Filter articles relevant to the symbol
                        filtered_articles = []
                        for article in all_articles:
                            tags = article.get("tags", "").lower()
                            categories = article.get("categories", "").lower()
                            title = article.get("title", "").lower()
                            body = article.get("body", "").lower()
                            
                            # Check if symbol appears in tags, categories, title, or body
                            if (normalized.lower() in tags or 
                                normalized.lower() in categories or
                                normalized.lower() in title or
                                normalized.lower() in body):
                                filtered_articles.append(self._format_article(article))
                        
                        # If we don't have enough symbol-specific news, include general crypto news
                        if len(filtered_articles) < 5:
                            for article in all_articles[:limit]:
                                formatted = self._format_article(article)
                                if formatted not in filtered_articles:
                                    filtered_articles.append(formatted)
                                if len(filtered_articles) >= limit:
                                    break
                        
                        # Cache the results
                        self._cache[normalized] = {
                            "articles": filtered_articles,
                            "timestamp": time.time()
                        }
                        
                        logger.info(f"Fetched {len(filtered_articles)} news articles for {normalized}")
                        return filtered_articles[:limit]
                    else:
                        logger.warning(f"CryptoCompare API unexpected response: Type={data.get('Type')}, Message={data.get('Message')}")
                elif resp.status == 429:
                    logger.warning("CryptoCompare rate limit hit")
                else:
                    logger.warning(f"CryptoCompare API returned status {resp.status}")
        except Exception as e:
            logger.error(f"Error fetching news for {symbol}: {e}")
        
        return []
    
    def _format_article(self, article: Dict) -> Dict:
        """Format a CryptoCompare article for frontend consumption."""
        return {
            "id": str(article.get("id", "")),  # Ensure ID is a string
            "title": article.get("title", ""),
            "body": article.get("body", "")[:500],  # Truncate to 500 chars
            "url": article.get("url", ""),
            "source": article.get("source", "Unknown"),
            "published": article.get("published_on", 0),
            "image_url": article.get("imageurl", ""),
            "tags": article.get("tags", "").split("|") if article.get("tags") else [],
            "categories": article.get("categories", "").split("|") if article.get("categories") else [],
            "upvotes": article.get("upvotes", 0),
            "downvotes": article.get("downvotes", 0),
        }
    
    def clear_cache(self, symbol: Optional[str] = None):
        """Clear cache for a specific symbol or all symbols."""
        if symbol:
            normalized = self._normalize_symbol(symbol)
            if normalized in self._cache:
                del self._cache[normalized]
        else:
            self._cache.clear()


# Global instance
_provider: Optional[NewsProvider] = None

def get_news_provider() -> NewsProvider:
    """Get or create the global news provider."""
    global _provider
    if _provider is None:
        _provider = NewsProvider()
    return _provider

async def cleanup():
    """Cleanup resources."""
    global _provider
    if _provider:
        await _provider.close()
        _provider = None
