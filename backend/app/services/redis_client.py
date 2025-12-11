from __future__ import annotations
from typing import Optional
from redis.asyncio import Redis
from ..config import REDIS_URL, ENABLE_REDIS

_redis: Optional[Redis] = None

async def get_redis() -> Optional[Redis]:
    global _redis
    if not ENABLE_REDIS:
        return None
    if _redis is None:
        _redis = Redis.from_url(REDIS_URL, decode_responses=True)
    return _redis

async def publish_json(channel: str, payload: str) -> None:
    r = await get_redis()
    if r:
        await r.publish(channel, payload)
