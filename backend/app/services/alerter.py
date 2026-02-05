from __future__ import annotations
import time
import asyncio
from typing import List, Dict
import httpx

from ..models import SymbolMetrics
from ..config import ENABLE_ALERTS, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DISCORD_WEBHOOK_URL, ALERT_DEDUP_MIN_MS, ALERT_COOLDOWN_PER_SYMBOL_MS, ALERT_INCLUDE_EXPLANATION, ALERT_MIN_GRADE, ALERT_VOL_DUE
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
    # grade threshold map
    grade_rank = {'A': 3, 'B': 2, 'C': 1}
    min_rank = grade_rank.get(ALERT_MIN_GRADE, 3)

    for m in metrics:
        sym = f"{m.exchange}:{m.symbol}"

        is_cipher = (m.cipher_buy is True or m.cipher_sell is True)
        is_wrte = (m.percent_r_ob_reversal is True or m.percent_r_os_reversal is True)
        is_swing = (getattr(m, 'swing_long_buy', None) is True)
        is_vol_due = ALERT_VOL_DUE and (getattr(m, 'vol_due_15m', None) is True or getattr(m, 'vol_due_4h', None) is True)

        if not (is_cipher or is_wrte or is_swing or is_vol_due):
            continue

        # Cipher/%R/Swing alerts are typically filtered by grade; volatility-due is allowed even if grade is absent.
        if is_cipher or is_wrte or is_swing:
            g = (m.model_dump().get('setup_grade') if hasattr(m, 'model_dump') else None)  # type: ignore
            if g is None:
                g = getattr(m, 'setup_grade', None)
            g = (str(g).upper() if g else None)
            if g is None:
                # if grade not present, be conservative: do not notify cipher/%R
                is_cipher = False
                is_wrte = False
            elif grade_rank.get(g, 0) < min_rank:
                is_cipher = False
                is_wrte = False

        if not (is_cipher or is_wrte or is_swing or is_vol_due):
            continue

        # cooldown selection based on liquidity cohort (shared across alert types)
        last = _last_symbol_alert_ts.get(sym, 0)
        cooldown = ALERT_COOLDOWN_TOP_MS if (m.liquidity_top200 is True) else ALERT_COOLDOWN_SMALL_MS
        if now_ms - last < cooldown:
            continue

        # Per-symbol, per-type de-dup keys (prevents different alert types blocking each other)
        
        # Cipher B signals
        if is_cipher:
            sym_key = f"{sym}:cipher"
            if _should_alert(sym_key, now_ms):
                _last_symbol_alert_ts[sym] = now_ms
                side = "BUY" if m.cipher_buy else "SELL"
                reason = f"\n{m.cipher_reason}" if ALERT_INCLUDE_EXPLANATION and m.cipher_reason else ""
                tf = f"[{m.cipher_source_tf}]" if m.cipher_source_tf else ""
                text = f"{side} {tf} {m.exchange} {m.symbol} @ {m.last_price}{reason}"
                tasks.append(send_telegram(text))
                tasks.append(send_discord(text))

        # %R Trend Exhaustion signals (reversals are most actionable)
        if is_wrte:
            sym_key = f"{sym}:wrte"
            if _should_alert(sym_key, now_ms):
                _last_symbol_alert_ts[sym] = now_ms
                side = "BUY" if m.percent_r_os_reversal else "SELL"
                reason = f"\n{m.percent_r_reason}" if ALERT_INCLUDE_EXPLANATION and m.percent_r_reason else ""
                text = f"{side} [%RTE] {m.exchange} {m.symbol} @ {m.last_price}{reason}"
                tasks.append(send_telegram(text))
                tasks.append(send_discord(text))

        # Swing long alerts
        if is_swing:
            sym_key = f"{sym}:swing_long"
            if _should_alert(sym_key, now_ms):
                _last_symbol_alert_ts[sym] = now_ms
                reason_txt = getattr(m, 'swing_long_reason', None)
                tf = getattr(m, 'swing_long_source_tf', None) or '4h'
                reason = f"\n{reason_txt}" if ALERT_INCLUDE_EXPLANATION and reason_txt else ""
                text = f"BUY [SWING {tf}] {m.exchange} {m.symbol} @ {m.last_price}{reason}"
                tasks.append(send_telegram(text))
                tasks.append(send_discord(text))

        # Volatility Due (Squeeze) alerts
        if is_vol_due:
            sym_key = f"{sym}:vol_due"
            if _should_alert(sym_key, now_ms):
                _last_symbol_alert_ts[sym] = now_ms
                tf = getattr(m, 'vol_due_source_tf', None)
                tf_txt = f"[{tf}]" if tf else ""
                reason_txt = getattr(m, 'vol_due_reason', None)
                reason = f"\n{reason_txt}" if ALERT_INCLUDE_EXPLANATION and reason_txt else ""
                text = f"VOLATILITY DUE {tf_txt} {m.exchange} {m.symbol} @ {m.last_price}{reason}"
                tasks.append(send_telegram(text))
                tasks.append(send_discord(text))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
