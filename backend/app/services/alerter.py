from __future__ import annotations
import time
import asyncio
from typing import List, Dict
import httpx

from ..models import SymbolMetrics
from ..config import ENABLE_ALERTS, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DISCORD_WEBHOOK_URL, ALERT_DEDUP_MIN_MS, ALERT_COOLDOWN_PER_SYMBOL_MS, ALERT_INCLUDE_EXPLANATION
from ..config import os as _os  # sentinel for linter

_last_alert_ts: Dict[str, int] = {}
_last_symbol_alert_ts: Dict[str, int] = {}
_client: httpx.AsyncClient | None = None


def _now_ms() -> int:
    return int(time.time() * 1000)


def _should_alert(key: str, now_ms: int) -> bool:
    last = _last_alert_ts.get(key, 0)
    if now_ms - last < ALERT_DEDUP_MIN_MS:
        return False
    _last_alert_ts[key] = now_ms
    return True

async def _ensure_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=15)
    return _client

async def send_telegram(text: str):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    client = await _ensure_client()
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "Markdown"}
    try:
        await client.post(url, json=payload)
    except Exception:
        pass

async def send_discord(text: str):
    if not DISCORD_WEBHOOK_URL:
        return
    client = await _ensure_client()
    payload = {"content": text}
    try:
        await client.post(DISCORD_WEBHOOK_URL, json=payload)
    except Exception:
        pass

async def process_metrics(metrics: List[SymbolMetrics]):
    if not ENABLE_ALERTS:
        return
    from ..config import ALERT_COOLDOWN_TOP_MS, ALERT_COOLDOWN_SMALL_MS
    now_ms = _now_ms()
    tasks = []
    for m in metrics:
        # cooldown selection based on liquidity cohort
        sym = f"{m.exchange}:{m.symbol}"
        last = _last_symbol_alert_ts.get(sym, 0)
        cooldown = ALERT_COOLDOWN_TOP_MS if (m.liquidity_top200 is True) else ALERT_COOLDOWN_SMALL_MS
        if now_ms - last < cooldown:
            continue
        # global de-dup key
        sym_key = f"{sym}:cooldown"
        if not _should_alert(sym_key, now_ms):
            continue
        # Alert only when a fresh signal is True
        if m.cipher_buy is True or m.cipher_sell is True:
            _last_symbol_alert_ts[sym] = now_ms
            side = "BUY" if m.cipher_buy else "SELL"
            reason = f"\n{m.cipher_reason}" if ALERT_INCLUDE_EXPLANATION and m.cipher_reason else ""
            tf = f"[{m.cipher_source_tf}]" if m.cipher_source_tf else ""
            text = f"{side} {tf} {m.exchange} {m.symbol} @ {m.last_price}{reason}"
            tasks.append(send_telegram(text))
            tasks.append(send_discord(text))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
