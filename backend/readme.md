# Backend

## Alerting (Telegram/Discord)

This backend can emit Cipher B buy/sell alerts to Telegram and/or Discord, with human-readable explanations indicating which timeframe triggered (15m or 4h) and the WaveTrend values.

### What gets alerted
- Signals are generated using multi-timeframe Cipher B logic:
  - EITHER: a fresh cross on 15m or 4h closed candles can trigger a BUY/SELL
  - Thresholds are configurable via env (defaults relaxed to increase frequency)
- Each alert includes:
  - Exchange, symbol, last price
  - Side (BUY/SELL) and the timeframe that triggered (15m/4h)
  - Optional explanation (WT1/WT2 values and threshold reference)

### Enable alerting
Set these environment variables before starting the backend:

- ENABLE_ALERTS=true
- TELEGRAM_BOT_TOKEN=your_bot_token
- TELEGRAM_CHAT_ID=your_chat_id
- DISCORD_WEBHOOK_URL=your_discord_webhook_url (optional)
- ALERT_DEDUP_MIN_MS=60000            # avoid duplicate alerts within 60s (default)
- ALERT_COOLDOWN_PER_SYMBOL_MS=300000 # 5-min per-symbol cooldown (default)
- ALERT_INCLUDE_EXPLANATION=true      # include the detailed reason in the alert

### Configure Cipher B thresholds
- CIPHERB_OS_LEVEL (default -40)
- CIPHERB_OB_LEVEL (default 40)

These can be overridden via environment variables to tune signal frequency.

### Telegram setup steps
1. Create a bot with BotFather
   - In Telegram search for "BotFather"
   - /start, then /newbot and follow prompts to get a bot token (e.g., 123456789:AA...)
2. Get your chat ID
   - Start a chat with your bot (send any message)
   - Option A: Use @userinfobot to get your user ID (numeric)
   - Option B: curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates" and read the `chat.id`
   - Use that ID as TELEGRAM_CHAT_ID (groups require adding the bot and using group chat ID)
3. Set environment variables
   - ENABLE_ALERTS=true
   - TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
4. Restart the backend

### Discord setup (optional)
1. In Discord, Channel Settings -> Integrations -> Webhooks -> New Webhook
2. Copy the webhook URL and set DISCORD_WEBHOOK_URL
3. Restart the backend

### How it works (internals)
- File: backend/app/services/alerter.py
  - process_metrics() scans emitted SymbolMetrics on each snapshot and sends alerts if cipher_buy or cipher_sell is True
  - Dedup and cooldown logic prevent repeated alerts
  - Uses Telegram Bot API and Discord webhook
- File: backend/app/services/aggregator.py
  - _emit_snapshot() builds a snapshot, triggers alerts (process_metrics), then publishes to subscribers/redis
- Model fields for explainability (backend/app/models.py -> SymbolMetrics)
  - cipher_source_tf: '15m' | '4h' timeframe that triggered
  - cipher_reason: human-readable explanation string

### Notes
- Signals are computed on higher timeframes using closed candles only. If alerts don't fire immediately after restart, ensure HTF backfill completed and thresholds are set appropriately.
- You can relax thresholds via env to increase frequency: CIPHERB_OS_LEVEL, CIPHERB_OB_LEVEL.
- If you need per-user preferences (side/TF/symbols), we can add a simple settings store and filter alerts per subscriber.
