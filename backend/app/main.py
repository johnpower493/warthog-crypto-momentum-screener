from __future__ import annotations
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .services.stream_manager import StreamManager
from .models import ScreenerSnapshot

import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
app = FastAPI(title="Crypto Screener Backend", version="0.1.0")

# Allow local dev frontends
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

stream_mgr = StreamManager()

# On-demand orderflow (trades -> footprint) streams for the DetailsModal
from .services.orderflow_hub import OrderFlowHub
orderflow_mgr = OrderFlowHub()

@app.on_event("startup")
async def on_startup():
    await stream_mgr.start()

    # Initialize market cap provider
    try:
        from .services.market_cap import initialize
        import logging as log
        log.info("Initializing market cap provider...")
        await initialize()
        log.info("Market cap provider initialized successfully")
        # Schedule periodic updates
        asyncio.create_task(_market_cap_update_loop())
    except Exception as e:
        import traceback
        logging.getLogger(__name__).error(f"Failed to initialize market cap provider: {e}")
        logging.getLogger(__name__).error(traceback.format_exc())

    # Optional scheduled analysis recompute
    try:
        from .config import ANALYSIS_AUTORUN
        if ANALYSIS_AUTORUN:
            from .services.analysis_scheduler import analysis_autorun_loop
            asyncio.create_task(analysis_autorun_loop())
    except Exception:
        pass

async def _market_cap_update_loop():
    """Periodically update market cap cache."""
    from .services.market_cap import get_provider
    while True:
        await asyncio.sleep(300)  # 5 minutes
        try:
            provider = get_provider()
            await provider.update_if_needed()
        except Exception as e:
            logging.getLogger(__name__).error(f"Market cap update failed: {e}")

@app.get("/health")
async def health():
    # Backward-compatible basic liveness endpoint
    return {"status": "ok"}

@app.get("/healthz")
async def healthz():
    # Standard liveness probe
    return {"status": "ok"}

@app.get("/readyz")
async def readyz():
    """Readiness probe.

    For local-only use we keep this lightweight and fast:
    - confirms the stream manager has started
    - confirms we have at least one running stream task

    (We avoid making external network calls here to keep the probe reliable.)
    """
    tasks = {
        "binance_kline": bool(stream_mgr._task and not stream_mgr._task.done()),
        "binance_ticker": bool(stream_mgr._task_bin_ticker and not stream_mgr._task_bin_ticker.done()),
        "bybit_kline": bool(stream_mgr._task_bybit and not stream_mgr._task_bybit.done()),
        "bybit_ticker": bool(stream_mgr._task_bybit_ticker and not stream_mgr._task_bybit_ticker.done()),
    }
    any_running = any(tasks.values())
    return {"ready": any_running, "tasks": tasks}

@app.get("/debug/status")
async def debug_status(include_lists: bool | None = None):
    import time
    now_ms = int(time.time() * 1000)
    
    try:
        bin_syms = await stream_mgr.binance.symbols()
    except Exception:
        bin_syms = []
    try:
        byb_syms = await stream_mgr.bybit.symbols()  # type: ignore[attr-defined]
    except Exception:
        byb_syms = []
    
    # Check task health
    def check_task(task, name):
        if task is None:
            return {"status": "not_started", "error": None}
        # Important: CancelledError is a BaseException in modern asyncio, so we must
        # handle it explicitly to avoid 500s in debug endpoints during restarts.
        if task.cancelled():
            return {"status": "cancelled", "error": None}
        if task.done():
            exc = None
            try:
                exc = task.exception()
            except asyncio.CancelledError:
                return {"status": "cancelled", "error": None}
            except BaseException as e:
                # Any other BaseException should be represented as an error string
                return {"status": "dead", "error": str(e)}
            return {"status": "dead", "error": str(exc) if exc else "completed"}
        return {"status": "running", "error": None}
    
    bin_last_ingest = getattr(stream_mgr.agg, 'last_ingest_ts', 0)
    bin_last_kline_ingest = getattr(stream_mgr.agg, 'last_kline_ingest_ts', bin_last_ingest)
    bin_last_ticker_ingest = getattr(stream_mgr.agg, 'last_ticker_ingest_ts', bin_last_ingest)
    bin_last_emit = getattr(stream_mgr.agg, 'last_emit_ts', 0)
    bybit_last_ingest = getattr(stream_mgr.agg_bybit, 'last_ingest_ts', 0) if hasattr(stream_mgr, 'agg_bybit') else 0
    bybit_last_kline_ingest = getattr(stream_mgr.agg_bybit, 'last_kline_ingest_ts', bybit_last_ingest) if hasattr(stream_mgr, 'agg_bybit') else 0
    bybit_last_ticker_ingest = getattr(stream_mgr.agg_bybit, 'last_ticker_ingest_ts', bybit_last_ingest) if hasattr(stream_mgr, 'agg_bybit') else 0
    bybit_last_emit = getattr(stream_mgr.agg_bybit, 'last_emit_ts', 0) if hasattr(stream_mgr, 'agg_bybit') else 0
    
    from .config import STALE_TICKER_MS, STALE_KLINE_MS, DEBUG_STATUS_INCLUDE_LISTS_DEFAULT
    inc = DEBUG_STATUS_INCLUDE_LISTS_DEFAULT if include_lists is None else bool(include_lists)

    bin_stale = stream_mgr.agg.stale_symbols(
        now_ms,
        ticker_stale_ms=STALE_TICKER_MS,
        kline_stale_ms=STALE_KLINE_MS,
        include_lists=inc,
    )
    byb_stale = (
        stream_mgr.agg_bybit.stale_symbols(
            now_ms,
            ticker_stale_ms=STALE_TICKER_MS,
            kline_stale_ms=STALE_KLINE_MS,
            include_lists=inc,
        )
        if hasattr(stream_mgr, 'agg_bybit')
        else {"ticker":[],"kline":[],"ticker_count":0,"kline_count":0, "include_lists": inc, "ticker_stale_ms": STALE_TICKER_MS, "kline_stale_ms": STALE_KLINE_MS}
    )

    return {
        "binance": {
            "symbols": len(bin_syms),
            "state": getattr(stream_mgr.agg, 'state_count', lambda: 0)(),
            "last_emit_ts": bin_last_emit,
            "last_ingest_ts": bin_last_ingest,
            "last_kline_ingest_ts": bin_last_kline_ingest,
            "last_ticker_ingest_ts": bin_last_ticker_ingest,
            "last_ingest_age_s": (now_ms - bin_last_ingest) / 1000 if bin_last_ingest else None,
            "last_kline_ingest_age_s": (now_ms - bin_last_kline_ingest) / 1000 if bin_last_kline_ingest else None,
            "last_ticker_ingest_age_s": (now_ms - bin_last_ticker_ingest) / 1000 if bin_last_ticker_ingest else None,
            "tasks": {
                "kline": check_task(stream_mgr._task, "binance_kline"),
                "ticker": check_task(stream_mgr._task_bin_ticker, "binance_ticker"),
            },
            "stale": bin_stale,
        },
        "bybit": {
            "symbols": len(byb_syms),
            "state": getattr(stream_mgr.agg_bybit, 'state_count', lambda: 0)() if hasattr(stream_mgr, 'agg_bybit') else 0,
            "last_emit_ts": bybit_last_emit,
            "last_ingest_ts": bybit_last_ingest,
            "last_kline_ingest_ts": bybit_last_kline_ingest,
            "last_ticker_ingest_ts": bybit_last_ticker_ingest,
            "last_ingest_age_s": (now_ms - bybit_last_ingest) / 1000 if bybit_last_ingest else None,
            "last_kline_ingest_age_s": (now_ms - bybit_last_kline_ingest) / 1000 if bybit_last_kline_ingest else None,
            "last_ticker_ingest_age_s": (now_ms - bybit_last_ticker_ingest) / 1000 if bybit_last_ticker_ingest else None,
            "tasks": {
                "kline": check_task(stream_mgr._task_bybit, "bybit_kline"),
                "ticker": check_task(stream_mgr._task_bybit_ticker, "bybit_ticker"),
            },
            "stale": byb_stale,
        }
    }

@app.get("/debug/bybit/symbols")
async def debug_bybit_symbols():
    try:
        syms = await stream_mgr.bybit.symbols()  # type: ignore[attr-defined]
    except Exception:
        syms = []
    return {"count": len(syms), "symbols": syms}

@app.get("/debug/symbols")
async def debug_symbols():
    syms = await stream_mgr.binance.symbols()
    return {"count": len(syms), "symbols": syms}

@app.get("/debug/snapshot")
async def debug_snapshot():
    try:
        snap = stream_mgr.agg.build_snapshot()  # type: ignore[attr-defined]
        return snap.model_dump()
    except Exception:
        return {"exchange": "binance", "ts": 0, "metrics": []}

@app.get("/debug/snapshot/bybit")
async def debug_snapshot_bybit():
    try:
        snap = stream_mgr.agg_bybit.build_snapshot()  # type: ignore[attr-defined]
        return snap.model_dump()
    except Exception:
        return {"exchange": "bybit", "ts": 0, "metrics": []}

@app.get("/debug/oi")
async def debug_oi():
    """Debug endpoint to check Open Interest data"""
    try:
        snap = stream_mgr.agg.build_snapshot()  # type: ignore[attr-defined]
        oi_metrics = []
        for m in snap.metrics:
            if m.open_interest is not None and m.open_interest > 0:
                oi_metrics.append({
                    "symbol": m.symbol,
                    "oi": m.open_interest,
                    "oi_5m": m.oi_change_5m,
                    "oi_15m": m.oi_change_15m,
                    "oi_1h": m.oi_change_1h,
                    "oi_1d": getattr(m, 'oi_change_1d', None),
                })
        return {
            "exchange": "binance",
            "total_symbols": len(snap.metrics),
            "symbols_with_oi": len(oi_metrics),
            "oi_data": oi_metrics[:10]  # Show first 10
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/debug/marketcap")
async def debug_marketcap():
    """Debug endpoint to check Market Cap data"""
    try:
        from .services.market_cap import get_provider
        provider = get_provider()
        snap = stream_mgr.agg.build_snapshot()  # type: ignore[attr-defined]
        mc_metrics = []
        for m in snap.metrics:
            mc = provider.get_market_cap(m.symbol)
            if mc is not None and mc > 0:
                mc_metrics.append({
                    "symbol": m.symbol,
                    "market_cap": mc,
                })
        return {
            "exchange": "binance",
            "total_symbols": len(snap.metrics),
            "symbols_with_mc": len(mc_metrics),
            "cache_size": len(provider._cache),
            "cache_sample": list(provider._cache.items())[:10],
            "mc_data": mc_metrics[:10]  # Show first 10
        }
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

# ========================================
# Portfolio Endpoints
# ========================================

@app.get("/portfolio/positions")
async def get_positions():
    """Get all open positions with real-time PnL."""
    try:
        from .services.portfolio import get_portfolio_manager
        manager = get_portfolio_manager()
        positions = manager.get_open_positions()
        
        # Get current prices from BOTH Binance and Bybit screeners
        price_map = {}
        
        # Add Binance prices
        try:
            snap_binance = stream_mgr.agg.build_snapshot()  # type: ignore[attr-defined]
            for m in snap_binance.metrics:
                price_map[f"{m.exchange}:{m.symbol}"] = m.last_price
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed to get Binance prices for portfolio: {e}")
        
        # Add Bybit prices
        try:
            snap_bybit = stream_mgr.agg_bybit.build_snapshot()  # type: ignore[attr-defined]
            for m in snap_bybit.metrics:
                price_map[f"{m.exchange}:{m.symbol}"] = m.last_price
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed to get Bybit prices for portfolio: {e}")
        
        result = []
        for pos in positions:
            pos_dict = pos.to_dict()
            key = f"{pos.exchange}:{pos.symbol}"
            current_price = price_map.get(key, pos.entry_price)
            pnl_data = pos.calculate_pnl(current_price)
            pos_dict.update(pnl_data)
            result.append(pos_dict)
        
        return {"positions": result}
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.post("/portfolio/positions")
async def add_position(body: dict):
    """Add a new position to the portfolio."""
    try:
        from .services.portfolio import get_portfolio_manager
        manager = get_portfolio_manager()
        
        position_id = manager.add_position(
            exchange=body.get("exchange", "binance"),
            symbol=body["symbol"],
            side=body["side"],
            entry_price=body["entry_price"],
            quantity=body["quantity"],
            stop_loss=body.get("stop_loss"),
            take_profit=body.get("take_profit"),
            notes=body.get("notes"),
        )
        
        if position_id:
            return {"success": True, "position_id": position_id}
        else:
            return {"success": False, "error": "Failed to add position"}
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.put("/portfolio/positions/{position_id}")
async def update_position(position_id: int, body: dict):
    """Update an existing position."""
    try:
        from .services.portfolio import get_portfolio_manager
        manager = get_portfolio_manager()
        
        success = manager.update_position(
            position_id=position_id,
            stop_loss=body.get('stop_loss'),
            take_profit=body.get('take_profit'),
            notes=body.get('notes'),
        )
        
        return {"success": success}
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.post("/portfolio/positions/{position_id}/close")
async def close_position(position_id: int, body: dict):
    """Close a position."""
    try:
        from .services.portfolio import get_portfolio_manager
        manager = get_portfolio_manager()
        
        success = manager.close_position(
            position_id=position_id,
            exit_price=body.get('exit_price'),
            notes=body.get('notes'),
        )
        
        return {"success": success}
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.delete("/portfolio/positions/{position_id}")
async def delete_position(position_id: int):
    """Delete a position (only if open)."""
    try:
        from .services.portfolio import get_portfolio_manager
        manager = get_portfolio_manager()
        
        success = manager.delete_position(position_id)
        
        return {"success": success}
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.get("/portfolio/history")
async def get_trade_history(limit: int = 100):
    """Get closed positions (trade history)."""
    try:
        from .services.portfolio import get_portfolio_manager
        manager = get_portfolio_manager()
        
        trades = manager.get_closed_positions(limit=limit)
        
        return {"trades": trades}
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

# ==================== Market Data (L/S Ratio, Liquidations) ====================

@app.get("/market_data/long_short_ratio/{exchange}/{symbol}")
async def get_long_short_ratio(exchange: str, symbol: str):
    """Get Long/Short ratio for a symbol.
    
    Returns the ratio of accounts/positions that are long vs short.
    Higher ratio = more longs, Lower ratio = more shorts.
    """
    try:
        from .services.market_data import fetch_long_short_ratio
        data = await fetch_long_short_ratio(exchange, symbol)
        if data is None:
            return {"error": "Failed to fetch L/S ratio", "exchange": exchange, "symbol": symbol}
        return data
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}


@app.get("/market_data/liquidations/{exchange}/{symbol}")
async def get_liquidations(exchange: str, symbol: str, limit: int = 20):
    """Get recent liquidations for a symbol.
    
    Returns list of recent forced liquidations with size and direction.
    """
    try:
        from .services.market_data import fetch_liquidations
        data = await fetch_liquidations(exchange, symbol, limit=limit)
        
        # Calculate summary
        long_liq = [l for l in data if l.get("side") == "SELL"]  # SELL = long liquidated
        short_liq = [l for l in data if l.get("side") == "BUY"]  # BUY = short liquidated
        
        return {
            "exchange": exchange,
            "symbol": symbol,
            "liquidations": data,
            "summary": {
                "total_count": len(data),
                "long_liq_count": len(long_liq),
                "short_liq_count": len(short_liq),
                "total_value_usd": sum(l.get("value_usd", 0) for l in data),
                "long_liq_value": sum(l.get("value_usd", 0) for l in long_liq),
                "short_liq_value": sum(l.get("value_usd", 0) for l in short_liq),
            }
        }
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}


@app.get("/market_data/liquidation_levels/{exchange}/{symbol}")
async def get_liquidation_levels(
    exchange: str, 
    symbol: str, 
    current_price: float = 0,
    range_pct: float = 5.0
):
    """Get liquidation levels heatmap data for a symbol.
    
    Returns aggregated liquidation data at price levels for visualization.
    Each level shows total long/short liquidation value at that price bucket.
    
    Args:
        exchange: "binance" or "bybit"
        symbol: Trading pair (e.g., "BTCUSDT")
        current_price: Current price to filter levels around (0 = no filter)
        range_pct: Percentage range around current price to include (default 5%)
    
    Returns:
        List of price levels with liquidation data and intensity for heatmap coloring.
    """
    try:
        levels = []
        
        if exchange.lower() == "binance":
            from .exchanges.binance_liquidations_ws import get_liquidation_levels as get_binance_levels
            levels = get_binance_levels(symbol, current_price=current_price, range_pct=range_pct)
        elif exchange.lower() == "bybit":
            # Try Bybit first, then fall back to Binance data
            from .exchanges.bybit_liquidations_ws import get_liquidation_levels as get_bybit_levels
            levels = get_bybit_levels(symbol, current_price=current_price, range_pct=range_pct)
            
            # If no Bybit data, use Binance data for the same symbol
            if not levels:
                from .exchanges.binance_liquidations_ws import get_liquidation_levels as get_binance_levels
                levels = get_binance_levels(symbol, current_price=current_price, range_pct=range_pct)
        else:
            return {"error": f"Unknown exchange: {exchange}"}
        
        # Calculate totals
        total_long_value = sum(l.get("long_value", 0) for l in levels)
        total_short_value = sum(l.get("short_value", 0) for l in levels)
        
        return {
            "exchange": exchange,
            "symbol": symbol,
            "current_price": current_price,
            "range_pct": range_pct,
            "levels": levels,
            "summary": {
                "level_count": len(levels),
                "total_long_value": total_long_value,
                "total_short_value": total_short_value,
                "total_value": total_long_value + total_short_value,
                "bias": "long" if total_long_value > total_short_value else "short" if total_short_value > total_long_value else "neutral"
            }
        }
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}


# ==================== Funding Rate ====================

@app.get("/funding_rate/{exchange}/{symbol}")
async def get_funding_rate(exchange: str, symbol: str):
    """Get funding rate for a specific symbol."""
    try:
        from .services.funding_rate import fetch_funding_rate
        
        result = await fetch_funding_rate(exchange, symbol)
        
        if result is None:
            return {"error": "Failed to fetch funding rate"}
        
        funding_rate, next_funding_time = result
        
        # Calculate annualized rate (funding happens every 8 hours = 3x per day)
        funding_rate_annual = funding_rate * 3 * 365 * 100  # Convert to percentage
        
        return {
            "exchange": exchange,
            "symbol": symbol,
            "funding_rate": funding_rate,
            "funding_rate_annual": funding_rate_annual,
            "next_funding_time": next_funding_time,
        }
    
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}


@app.get("/portfolio/stats")
async def get_portfolio_stats():
    """Get portfolio performance statistics."""
    try:
        from .services.portfolio import get_portfolio_manager
        manager = get_portfolio_manager()
        
        stats = manager.get_portfolio_stats()
        
        return stats
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

# ========================================
# News Endpoints
# ========================================

@app.get("/news/{exchange}/{symbol}")
async def get_news(exchange: str, symbol: str, limit: int = 20):
    """Get latest news for a crypto symbol from CryptoCompare."""
    try:
        from .services.news import get_news_provider
        provider = get_news_provider()
        
        articles = await provider.get_news(symbol, limit=limit)
        
        return {
            "exchange": exchange,
            "symbol": symbol,
            "articles": articles,
            "count": len(articles)
        }
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.get("/debug/snapshot/all")
async def debug_snapshot_all():
    try:
        snap_b = stream_mgr.agg.build_snapshot()  # type: ignore[attr-defined]
    except Exception:
        snap_b = None
    try:
        snap_y = stream_mgr.agg_bybit.build_snapshot()  # type: ignore[attr-defined]
    except Exception:
        snap_y = None
    metrics = []
    ts = 0
    if snap_b:
        metrics.extend(snap_b.metrics)
        ts = max(ts, snap_b.ts)
    if snap_y:
        metrics.extend(snap_y.metrics)
        ts = max(ts, snap_y.ts)
    from .models import ScreenerSnapshot
    return ScreenerSnapshot(exchange="all", ts=ts, metrics=metrics).model_dump()

@app.post("/debug/resync")
async def debug_resync(exchange: str = "all", backfill_limit: int = 200):
    """Manually resync streams/backfill without restarting the process.

    Intended for local-only deployments (ngrok/cloudflare tunnel).
    """
    import logging
    log = logging.getLogger(__name__)

    results = {"exchange": exchange, "backfill_limit": backfill_limit, "actions": []}

    async def do_binance():
        await stream_mgr._restart_binance()
        await stream_mgr._restart_binance_ticker()
        results["actions"].append("binance_restart")
        try:
            await stream_mgr._backfill_binance(limit=backfill_limit)
            results["actions"].append("binance_backfill")
        except Exception as e:
            log.warning(f"Resync: Binance backfill failed: {e}")
            results["actions"].append("binance_backfill_failed")
        try:
            await stream_mgr.agg.heartbeat_emit()
            results["actions"].append("binance_emit")
        except Exception:
            pass

    async def do_bybit():
        await stream_mgr._restart_bybit()
        await stream_mgr._restart_bybit_ticker()
        results["actions"].append("bybit_restart")
        try:
            await stream_mgr._backfill_bybit(limit=backfill_limit)
            results["actions"].append("bybit_backfill")
        except Exception as e:
            log.warning(f"Resync: Bybit backfill failed: {e}")
            results["actions"].append("bybit_backfill_failed")
        try:
            await stream_mgr.agg_bybit.heartbeat_emit()
            results["actions"].append("bybit_emit")
        except Exception:
            pass

    try:
        if exchange in {"all", "binance"}:
            await do_binance()
        if exchange in {"all", "bybit"}:
            await do_bybit()
        results["ok"] = True
    except Exception as e:
        # Ensure this endpoint never throws 500s; surface the error instead.
        results["ok"] = False
        results["error"] = str(e)

    return results


@app.get("/debug/history")
async def debug_history(exchange: str, symbol: str, limit: int = 60):
    if exchange == 'binance':
        data = stream_mgr.agg.get_history(symbol, limit)  # type: ignore[attr-defined]
    elif exchange == 'bybit':
        data = stream_mgr.agg_bybit.get_history(symbol, limit)  # type: ignore[attr-defined]
    else:
        data = []
    return {"exchange": exchange, "symbol": symbol, "limit": limit, "closes": data}


@app.get("/debug/oi_history")
async def debug_oi_history(exchange: str, symbol: str, limit: int = 60):
    if exchange == 'binance':
        data = stream_mgr.agg.get_oi_history(symbol, limit)  # type: ignore[attr-defined]
    elif exchange == 'bybit':
        data = stream_mgr.agg_bybit.get_oi_history(symbol, limit)  # type: ignore[attr-defined]
    else:
        data = []
    return {"exchange": exchange, "symbol": symbol, "limit": limit, "oi": data}


@app.get("/meta/alerts")
async def meta_alerts(
    exchange: str | None = None,
    limit: int = 500,
    since_minutes: int = 60,
    signal: str | None = None,
    source_tf: str | None = None,
    min_grade: str = 'B',
):
    import time
    from .services.alert_store import get_recent_alerts
    since_ts = int(time.time() * 1000) - int(since_minutes * 60 * 1000)
    return {
        "exchange": exchange or "all",
        "limit": limit,
        "since_minutes": since_minutes,
        "min_grade": min_grade,
        "alerts": get_recent_alerts(
            exchange=exchange,
            limit=limit,
            since_ts=since_ts,
            signal=signal,
            source_tf=source_tf,
            min_grade=min_grade,
        ),
    }


@app.get("/alerts/history")
async def alerts_history(
    exchange: str | None = None,
    limit: int = 200,
    signal: str | None = None,
    source_tf: str | None = None,
    min_grade: str | None = None,
):
    """Get persisted signal alerts history for the Alerts/History page.
    
    This is the historical alerts from the screener's signal detection system,
    NOT custom price alerts set by users.
    """
    from .services.alert_store import get_recent_alerts
    
    alerts = get_recent_alerts(
        exchange=exchange,
        limit=limit,
        since_ts=None,  # No time filter - get all historical alerts
        signal=signal,
        source_tf=source_tf,
        min_grade=min_grade,
    )
    
    # Transform to match frontend expected format
    return [
        {
            "id": a["id"],
            "ts": a["created_ts"] or a["ts"],
            "exchange": a["exchange"],
            "symbol": a["symbol"],
            "signal": a["signal"],
            "source_tf": a.get("source_tf"),
            "reason": a.get("reason"),
            "price": a.get("price"),
            "grade": a.get("setup_grade"),
        }
        for a in alerts
    ]


@app.get("/meta/trade_plan")
async def meta_trade_plan(exchange: str, symbol: str):
    from .services.alert_store import get_latest_trade_plan
    plan = get_latest_trade_plan(exchange, symbol)
    return {"exchange": exchange, "symbol": symbol, "plan": plan}


@app.get("/symbol/details")
async def symbol_details(exchange: str, symbol: str):
    """Combined endpoint for symbol details modal - reduces API calls.
    
    Returns: history, oi_history, trade_plan, backtest (30d & 90d), news, funding_rate,
             long_short_ratio, liquidations
    """
    import json
    from .services.alert_store import get_latest_trade_plan
    from .services.ohlc_store import init_db, _DB_LOCK, _CONN
    from .services.backtester import STRATEGY_VERSION
    from .services.news import get_news_provider
    from .services.funding_rate import fetch_funding_rate
    from .services.market_data import fetch_market_data_combined
    
    result = {
        "exchange": exchange,
        "symbol": symbol,
        "closes": [],
        "oi": [],
        "plan": None,
        "bt30": None,
        "bt90": None,
        "news": [],
        "funding": None,
        "long_short_ratio": None,
        "liquidations": [],
        "liquidation_summary": None,
        "liquidation_levels": [],
    }
    
    # Get history data
    try:
        if exchange == 'binance':
            result["closes"] = stream_mgr.agg.get_history(symbol, 60)
            result["oi"] = stream_mgr.agg.get_oi_history(symbol, 60)
        elif exchange == 'bybit':
            result["closes"] = stream_mgr.agg_bybit.get_history(symbol, 60)
            result["oi"] = stream_mgr.agg_bybit.get_oi_history(symbol, 60)
    except Exception:
        pass
    
    # Get trade plan
    try:
        result["plan"] = get_latest_trade_plan(exchange, symbol)
    except Exception:
        pass
    
    # Get backtest results (30d and 90d)
    try:
        init_db()
        with _DB_LOCK:
            for window_days in [30, 90]:
                cur = _CONN.execute(
                    """
                    SELECT ts, n_trades, win_rate, avg_r, avg_mae_r, avg_mfe_r, avg_bars_to_resolve, results_json
                    FROM backtest_results
                    WHERE exchange=? AND symbol=? AND window_days=? AND strategy_version=?
                    """,
                    (exchange, symbol, window_days, STRATEGY_VERSION),
                )
                row = cur.fetchone()
                if row:
                    bt_data = {
                        "window_days": window_days,
                        "ts": row[0],
                        "n_trades": row[1],
                        "win_rate": row[2],
                        "avg_r": row[3],
                        "avg_mae_r": row[4],
                        "avg_mfe_r": row[5],
                        "avg_bars_to_resolve": row[6],
                        "result": json.loads(row[7]) if row[7] else None,
                    }
                    if window_days == 30:
                        result["bt30"] = bt_data
                    else:
                        result["bt90"] = bt_data
    except Exception:
        pass
    
    # Fetch news, funding rate, and market data (L/S ratio + liquidations) concurrently
    try:
        news_task = asyncio.create_task(_fetch_news_safe(symbol))
        funding_task = asyncio.create_task(_fetch_funding_safe(exchange, symbol))
        market_data_task = asyncio.create_task(_fetch_market_data_safe(exchange, symbol))
        
        news_result, funding_result, market_data_result = await asyncio.gather(
            news_task, funding_task, market_data_task
        )
        result["news"] = news_result
        result["funding"] = funding_result
        if market_data_result:
            result["long_short_ratio"] = market_data_result.get("long_short_ratio")
            result["liquidations"] = market_data_result.get("liquidations", [])
            result["liquidation_summary"] = market_data_result.get("liquidation_summary")
            result["liquidation_levels"] = market_data_result.get("liquidation_levels", [])
    except Exception:
        pass
    
    return result


async def _fetch_market_data_safe(exchange: str, symbol: str):
    """Fetch market data (L/S ratio + liquidations) with error handling."""
    try:
        from .services.market_data import fetch_market_data_combined
        return await fetch_market_data_combined(exchange, symbol)
    except Exception:
        return None


async def _fetch_news_safe(symbol: str):
    """Fetch news with error handling."""
    try:
        from .services.news import get_news_provider
        provider = get_news_provider()
        return await provider.get_news(symbol, limit=20)
    except Exception:
        return []


async def _fetch_funding_safe(exchange: str, symbol: str):
    """Fetch funding rate with error handling."""
    try:
        from .services.funding_rate import fetch_funding_rate
        result = await fetch_funding_rate(exchange, symbol)
        if result:
            funding_rate, next_funding_time = result
            return {
                "funding_rate": funding_rate,
                "funding_rate_annual": funding_rate * 3 * 365 * 100,
                "next_funding_time": next_funding_time,
            }
    except Exception:
        pass
    return None


@app.post("/meta/backtest/run")
async def meta_backtest_run(exchange: str, symbol: str, window_days: int = 30):
    """Run backtest for a symbol and persist results."""
    from .services.backtester import backtest_symbol
    from .services.backtester import _insert_backtest_row  # type: ignore
    res = backtest_symbol(exchange, symbol, window_days)
    _insert_backtest_row(
        exchange=exchange,
        symbol=symbol,
        source_tf=None,
        window_days=window_days,
        n_trades=int(res.get('n_trades', 0)),
        win_rate=res.get('win_rate'),
        avg_r=res.get('avg_r'),
        avg_mae_r=res.get('avg_mae_r'),
        avg_mfe_r=res.get('avg_mfe_r'),
        avg_bars_to_resolve=res.get('avg_bars_to_resolve'),
        results_json=res,
    )
    return {"exchange": exchange, "symbol": symbol, "window_days": window_days, "result": res}


@app.get("/meta/backtest")
async def meta_backtest(exchange: str, symbol: str, window_days: int = 30):
    from .services.ohlc_store import init_db
    from .services.ohlc_store import _DB_LOCK, _CONN  # type: ignore
    from .services.backtester import STRATEGY_VERSION
    init_db()
    with _DB_LOCK:
        cur = _CONN.execute(
            """
            SELECT ts, n_trades, win_rate, avg_r, avg_mae_r, avg_mfe_r, avg_bars_to_resolve, results_json
            FROM backtest_results
            WHERE exchange=? AND symbol=? AND window_days=? AND strategy_version=?
            """,
            (exchange, symbol, window_days, STRATEGY_VERSION),
        )
        row = cur.fetchone()
    if not row:
        return {"exchange": exchange, "symbol": symbol, "window_days": window_days, "strategy_version": STRATEGY_VERSION, "result": None}
    import json
    return {
        "exchange": exchange,
        "symbol": symbol,
        "window_days": window_days,
        "strategy_version": STRATEGY_VERSION,
        "ts": row[0],
        "n_trades": row[1],
        "win_rate": row[2],
        "avg_r": row[3],
        "avg_mae_r": row[4],
        "avg_mfe_r": row[5],
        "avg_bars_to_resolve": row[6],
        "result": json.loads(row[7]) if row[7] else None,
    }


@app.get("/meta/sentiment")
async def meta_sentiment(exchange: str | None = None, window_minutes: int = 240):
    """Aggregate BUY/SELL counts over a rolling window (default 4h) from the persisted alerts table."""
    import time
    from .services.ohlc_store import init_db
    from .services.ohlc_store import _DB_LOCK, _CONN  # type: ignore
    init_db()
    since_ts = int(time.time() * 1000) - int(window_minutes * 60 * 1000)

    params = [since_ts]
    where = "WHERE created_ts >= ?"
    if exchange:
        where += " AND exchange = ?"
        params.append(exchange)

    with _DB_LOCK:
        cur = _CONN.execute(
            f"""
            SELECT signal, COUNT(*)
            FROM alerts
            {where}
            GROUP BY signal
            """,
            tuple(params),
        )
        rows = cur.fetchall()

    counts = {"BUY": 0, "SELL": 0}
    for sig, c in rows:
        if sig in counts:
            counts[sig] = int(c)

    total = counts["BUY"] + counts["SELL"]
    # score in [-1, +1]
    score = ((counts["BUY"] - counts["SELL"]) / total) if total else 0.0
    bias = "bullish" if score > 0.1 else "bearish" if score < -0.1 else "neutral"

    return {
        "exchange": exchange or "all",
        "window_minutes": window_minutes,
        "since_ts": since_ts,
        "buy": counts["BUY"],
        "sell": counts["SELL"],
        "total": total,
        "score": score,
        "bias": bias,
    }


@app.get("/meta/sentiment/all")
async def meta_sentiment_all(window_minutes: int = 240):
    """Combined sentiment endpoint - returns all, binance, and bybit sentiment in one call.
    
    Reduces 3 API calls to 1 for the main dashboard.
    """
    import time
    from .services.ohlc_store import init_db
    from .services.ohlc_store import _DB_LOCK, _CONN  # type: ignore
    init_db()
    since_ts = int(time.time() * 1000) - int(window_minutes * 60 * 1000)

    def calc_sentiment(buy: int, sell: int):
        total = buy + sell
        score = ((buy - sell) / total) if total else 0.0
        bias = "bullish" if score > 0.1 else "bearish" if score < -0.1 else "neutral"
        return {"buy": buy, "sell": sell, "total": total, "score": score, "bias": bias}

    with _DB_LOCK:
        # Single query to get counts by exchange and signal
        cur = _CONN.execute(
            """
            SELECT exchange, signal, COUNT(*)
            FROM alerts
            WHERE created_ts >= ?
            GROUP BY exchange, signal
            """,
            (since_ts,),
        )
        rows = cur.fetchall()

    # Aggregate counts
    all_buy, all_sell = 0, 0
    binance_buy, binance_sell = 0, 0
    bybit_buy, bybit_sell = 0, 0

    for exchange, signal, count in rows:
        if signal == "BUY":
            all_buy += count
            if exchange == "binance":
                binance_buy = count
            elif exchange == "bybit":
                bybit_buy = count
        elif signal == "SELL":
            all_sell += count
            if exchange == "binance":
                binance_sell = count
            elif exchange == "bybit":
                bybit_sell = count

    return {
        "window_minutes": window_minutes,
        "since_ts": since_ts,
        "all": calc_sentiment(all_buy, all_sell),
        "binance": calc_sentiment(binance_buy, binance_sell),
        "bybit": calc_sentiment(bybit_buy, bybit_sell),
    }


@app.post('/meta/analysis/run')
async def meta_analysis_run(window_days: int = 30, exchange: str = 'all', top200_only: bool = True):
    """Run analysis backtest and update grader with symbol win rates.
    
    This can be triggered manually from the Analysis page to recompute all backtests
    and update the signal grading model with latest symbol performance data.
    """
    from .services.analysis_backtester import run_analysis_backtest, update_grader_symbol_rates
    import time
    
    start = time.time()
    result = run_analysis_backtest(window_days=window_days, exchange=exchange, top200_only=top200_only)
    
    # Also update grader with symbol win rates
    update_grader_symbol_rates(window_days=30)
    
    elapsed = time.time() - start
    result['elapsed_sec'] = round(elapsed, 2)
    result['grader_updated'] = True
    
    return result


@app.get('/meta/analysis/filtered_winrate')
async def meta_analysis_filtered_winrate(
    window_days: int = 30,
    exchange: str = 'all',
    top200_only: bool = True,
    grade: str | None = None,  # 'A', 'B', 'C', or None for all
    source_tf: str | None = None,  # '15m', '1h', '4h', or None for all
    signal: str | None = None,  # 'BUY', 'SELL', or None for all
    symbol: str | None = None,  # Specific symbol or None for all
):
    """Get filtered win rate stats for specific grade/timeframe/side/symbol combinations.
    
    This allows users to see win rates for specific signal configurations,
    e.g., "A-grade BUY signals on 15m timeframe for BTCUSDT".
    """
    from .services.ohlc_store import init_db
    from .services.ohlc_store import _DB_LOCK, _CONN  # type: ignore
    from .services.backtester import STRATEGY_VERSION
    init_db()

    params = [window_days, STRATEGY_VERSION]
    where = ["window_days=?", "strategy_version=?", "resolved != 'NONE'"]
    
    if exchange != 'all':
        where.append('exchange=?')
        params.append(exchange)
    if top200_only:
        where.append('liquidity_top200 = 1')
    if grade:
        where.append('setup_grade=?')
        params.append(grade)
    if source_tf:
        where.append('source_tf=?')
        params.append(source_tf)
    if signal:
        where.append('signal=?')
        params.append(signal)
    if symbol:
        where.append('symbol=?')
        params.append(symbol)

    where_sql = ' AND '.join(where)
    
    with _DB_LOCK:
        row = _CONN.execute(
            f"""
            SELECT
              COUNT(*) as n,
              SUM(CASE WHEN resolved LIKE 'TP%' THEN 1 ELSE 0 END) as wins,
              SUM(CASE WHEN resolved = 'SL' THEN 1 ELSE 0 END) as losses,
              AVG(CASE WHEN resolved LIKE 'TP%' THEN 1.0 ELSE 0.0 END) as win_rate,
              AVG(r_multiple) as avg_r,
              SUM(r_multiple) as total_r,
              AVG(mae_r) as avg_mae_r,
              AVG(mfe_r) as avg_mfe_r,
              AVG(bars_to_resolve) as avg_bars,
              SUM(CASE WHEN resolved = 'TP1' THEN 1 ELSE 0 END) as tp1_count,
              SUM(CASE WHEN resolved = 'TP2' THEN 1 ELSE 0 END) as tp2_count,
              SUM(CASE WHEN resolved = 'TP3' THEN 1 ELSE 0 END) as tp3_count
            FROM backtest_trades
            WHERE {where_sql}
            """,
            tuple(params),
        ).fetchone()
        
        # Also get breakdown by grade if no grade filter
        grade_breakdown = []
        if not grade:
            grades_rows = _CONN.execute(
                f"""
                SELECT setup_grade,
                       COUNT(*) as n,
                       AVG(CASE WHEN resolved LIKE 'TP%' THEN 1.0 ELSE 0.0 END) as win_rate,
                       AVG(r_multiple) as avg_r
                FROM backtest_trades
                WHERE {where_sql}
                GROUP BY setup_grade
                ORDER BY setup_grade
                """,
                tuple(params),
            ).fetchall()
            for gr in grades_rows:
                grade_breakdown.append({
                    'grade': gr[0] or '—',
                    'n': int(gr[1] or 0),
                    'win_rate': round(float(gr[2] or 0), 3),
                    'avg_r': round(float(gr[3] or 0), 3),
                })

    n = int(row[0] or 0)
    wins = int(row[1] or 0)
    losses = int(row[2] or 0)
    win_rate = float(row[3] or 0)
    avg_r = float(row[4] or 0)
    
    # Calculate expectancy
    if n > 0:
        avg_win = float(row[7] or 0)  # avg_mfe_r as proxy for avg win
        avg_loss = abs(float(row[6] or 0))  # avg_mae_r as proxy for avg loss
        expectancy = (win_rate * avg_win) - ((1 - win_rate) * avg_loss) if avg_loss > 0 else 0
    else:
        expectancy = 0

    # Get list of symbols with trades for the dropdown
    symbol_list = []
    with _DB_LOCK:
        sym_rows = _CONN.execute(
            f"""
            SELECT DISTINCT symbol, exchange, COUNT(*) as n
            FROM backtest_trades
            WHERE window_days=? AND strategy_version=? AND resolved != 'NONE'
            {' AND exchange=?' if exchange != 'all' else ''}
            {' AND liquidity_top200 = 1' if top200_only else ''}
            GROUP BY symbol, exchange
            HAVING COUNT(*) >= 3
            ORDER BY COUNT(*) DESC
            LIMIT 100
            """,
            tuple([window_days, STRATEGY_VERSION] + ([exchange] if exchange != 'all' else [])),
        ).fetchall()
        for sr in sym_rows:
            symbol_list.append({'symbol': sr[0], 'exchange': sr[1], 'n': sr[2]})

    return {
        'filters': {
            'window_days': window_days,
            'exchange': exchange,
            'top200_only': top200_only,
            'grade': grade or 'all',
            'source_tf': source_tf or 'all',
            'signal': signal or 'all',
            'symbol': symbol or 'all',
        },
        'available_symbols': symbol_list,
        'stats': {
            'n_trades': n,
            'wins': wins,
            'losses': losses,
            'win_rate': round(win_rate, 3),
            'avg_r': round(avg_r, 3),
            'total_r': round(float(row[5] or 0), 2),
            'expectancy': round(expectancy, 3),
            'avg_mae_r': round(float(row[6] or 0), 3),
            'avg_mfe_r': round(float(row[7] or 0), 3),
            'avg_bars': round(float(row[8] or 0), 1),
            'tp1_count': int(row[9] or 0),
            'tp2_count': int(row[10] or 0),
            'tp3_count': int(row[11] or 0),
        },
        'grade_breakdown': grade_breakdown,
    }


@app.get('/meta/analysis/summary')
async def meta_analysis_summary(window_days: int = 30, exchange: str = 'all', top200_only: bool = True):
    from .services.ohlc_store import init_db
    from .services.ohlc_store import _DB_LOCK, _CONN  # type: ignore
    from .services.backtester import STRATEGY_VERSION
    init_db()

    params = [window_days, STRATEGY_VERSION]
    where = ["window_days=?", "strategy_version=?", "resolved != 'NONE'"]
    if exchange != 'all':
        where.append('exchange=?')
        params.append(exchange)
    if top200_only:
        where.append('liquidity_top200 = 1')

    where_sql = ' AND '.join(where)
    with _DB_LOCK:
        row = _CONN.execute(
            f"""
            SELECT
              COUNT(*) as n,
              AVG(CASE WHEN resolved LIKE 'TP%' THEN 1.0 ELSE 0.0 END) as win_rate,
              AVG(r_multiple) as avg_r,
              AVG(mae_r) as avg_mae_r,
              AVG(mfe_r) as avg_mfe_r,
              AVG(bars_to_resolve) as avg_bars
            FROM backtest_trades
            WHERE {where_sql}
            """,
            tuple(params),
        ).fetchone()

    return {
        'window_days': window_days,
        'exchange': exchange,
        'top200_only': top200_only,
        'n_trades': int(row[0] or 0),
        'win_rate': row[1] or 0.0,
        'avg_r': row[2] or 0.0,
        'avg_mae_r': row[3] or 0.0,
        'avg_mfe_r': row[4] or 0.0,
        'avg_bars_to_resolve': row[5] or 0.0,
    }


@app.get('/meta/analysis/breakdown')
async def meta_analysis_breakdown(
    window_days: int = 30,
    exchange: str = 'all',
    top200_only: bool = True,
    min_trades: int = 1,
    limit: int = 500,
):
    from .services.ohlc_store import init_db
    from .services.ohlc_store import _DB_LOCK, _CONN  # type: ignore
    from .services.backtester import STRATEGY_VERSION
    init_db()

    params = [window_days, STRATEGY_VERSION]
    where = ["window_days=?", "strategy_version=?", "resolved != 'NONE'"]
    if exchange != 'all':
        where.append('exchange=?')
        params.append(exchange)
    if top200_only:
        where.append('liquidity_top200 = 1')
    where_sql = ' AND '.join(where)

    with _DB_LOCK:
        rows = _CONN.execute(
            f"""
            SELECT setup_grade, source_tf, signal,
                   COUNT(*) as n,
                   AVG(CASE WHEN resolved LIKE 'TP%' THEN 1.0 ELSE 0.0 END) as win_rate,
                   AVG(r_multiple) as avg_r
            FROM backtest_trades
            WHERE {where_sql}
            GROUP BY setup_grade, source_tf, signal
            HAVING COUNT(*) >= ?
            ORDER BY setup_grade, source_tf, signal
            LIMIT ?
            """,
            tuple(params + [max(1, int(min_trades)), max(1, int(limit))]),
        ).fetchall()

    out = []
    for r in rows:
        out.append({
            'setup_grade': r[0] or '—',
            'source_tf': r[1] or '—',
            'signal': r[2] or '—',
            'n': int(r[3] or 0),
            'win_rate': float(r[4] or 0.0),
            'avg_r': float(r[5] or 0.0),
        })
    return {
        'window_days': window_days,
        'exchange': exchange,
        'top200_only': top200_only,
        'min_trades': max(1, int(min_trades)),
        'limit': max(1, int(limit)),
        'rows': out,
    }


@app.get('/meta/analysis/symbols')
async def meta_analysis_symbols(window_days: int = 30, min_trades: int = 3):
    """Get per-symbol performance stats for the analysis dashboard.
    
    Returns symbols ranked by total R, with win rate, avg R, expectancy, etc.
    Used to identify best/worst performing symbols and feed the grader's auto-filtering.
    """
    from .services.analysis_backtester import get_symbol_performance_stats
    
    stats = get_symbol_performance_stats(window_days=window_days, min_trades=min_trades)
    
    # Split into best and worst
    best = [s for s in stats if s['total_r'] > 0][:20]
    worst = [s for s in stats if s['total_r'] <= 0][-20:][::-1]  # Reverse to show worst first
    
    return {
        'window_days': window_days,
        'min_trades': min_trades,
        'total_symbols': len(stats),
        'best_performers': best,
        'worst_performers': worst,
        'all_symbols': stats,
    }


@app.get('/meta/analysis/status')
async def meta_analysis_status(window_days: int = 30, exchange: str = 'all', top200_only: bool = True):
    from .services.ohlc_store import init_db, get_conn
    from .services.ohlc_store import _DB_LOCK  # type: ignore
    from .services.backtester import STRATEGY_VERSION
    init_db(); conn = get_conn()

    top = 1 if top200_only else 0
    with _DB_LOCK:
        last = conn.execute(
            """SELECT ts, n_alerts FROM analysis_runs WHERE window_days=? AND exchange=? AND top200_only=?""",
            (window_days, exchange, top),
        ).fetchone()

        totals = conn.execute(
            """
            SELECT
              COUNT(*) as total,
              SUM(CASE WHEN resolved = 'NONE' THEN 1 ELSE 0 END) as none_cnt,
              SUM(CASE WHEN resolved != 'NONE' THEN 1 ELSE 0 END) as resolved_cnt
            FROM backtest_trades
            WHERE window_days=? AND strategy_version=?
              AND (?='all' OR exchange=?)
              AND (?=0 OR liquidity_top200=1)
            """,
            (window_days, STRATEGY_VERSION, exchange, exchange, top),
        ).fetchone()

    total = int(totals[0] or 0)
    none_cnt = int(totals[1] or 0)
    resolved_cnt = int(totals[2] or 0)
    none_rate = (none_cnt / total) if total else 0.0

    return {
        'window_days': window_days,
        'exchange': exchange,
        'top200_only': top200_only,
        'last_run_ts': last[0] if last else None,
        'last_run_n_alerts': last[1] if last else None,
        'total_rows': total,
        'resolved_rows': resolved_cnt,
        'none_rows': none_cnt,
        'none_rate': none_rate,
    }


@app.get('/meta/analysis/worst_symbols')
async def meta_analysis_worst_symbols(window_days: int = 30, exchange: str = 'all', top200_only: bool = True, min_trades: int = 5, limit: int = 25):
    from .services.ohlc_store import init_db, get_conn
    from .services.ohlc_store import _DB_LOCK  # type: ignore
    from .services.backtester import STRATEGY_VERSION
    init_db()
    conn = get_conn()

    params = [window_days, STRATEGY_VERSION]
    where = ["window_days=?", "strategy_version=?", "resolved != 'NONE'"]
    if exchange != 'all':
        where.append('exchange=?')
        params.append(exchange)
    if top200_only:
        where.append('liquidity_top200 = 1')
    where_sql = ' AND '.join(where)

    q = f"""
      SELECT exchange, symbol, COUNT(*) as n, AVG(r_multiple) as avg_r,
             AVG(CASE WHEN resolved LIKE 'TP%' THEN 1.0 ELSE 0.0 END) as win_rate
      FROM backtest_trades
      WHERE {where_sql}
      GROUP BY exchange, symbol
      HAVING COUNT(*) >= ?
      ORDER BY avg_r ASC
      LIMIT ?
    """
    params2 = params + [min_trades, limit]

    with _DB_LOCK:
        rows = conn.execute(q, tuple(params2)).fetchall()

    out=[]
    for r in rows:
        out.append({'exchange': r[0], 'symbol': r[1], 'n': int(r[2] or 0), 'avg_r': float(r[3] or 0.0), 'win_rate': float(r[4] or 0.0)})
    return {'window_days': window_days, 'exchange': exchange, 'top200_only': top200_only, 'min_trades': min_trades, 'rows': out}


@app.get('/meta/analysis/best_symbols')
async def meta_analysis_best_symbols(window_days: int = 30, exchange: str = 'all', top200_only: bool = True, min_trades: int = 5, limit: int = 25):
    from .services.ohlc_store import init_db, get_conn
    from .services.ohlc_store import _DB_LOCK  # type: ignore
    from .services.backtester import STRATEGY_VERSION
    init_db(); conn = get_conn()

    params = [window_days, STRATEGY_VERSION]
    where = ["window_days=?", "strategy_version=?", "resolved != 'NONE'"]
    if exchange != 'all':
        where.append('exchange=?')
        params.append(exchange)
    if top200_only:
        where.append('liquidity_top200 = 1')
    where_sql = ' AND '.join(where)

    q = f"""
      SELECT exchange, symbol, COUNT(*) as n, AVG(r_multiple) as avg_r,
             AVG(CASE WHEN resolved LIKE 'TP%' THEN 1.0 ELSE 0.0 END) as win_rate
      FROM backtest_trades
      WHERE {where_sql}
      GROUP BY exchange, symbol
      HAVING COUNT(*) >= ?
      ORDER BY avg_r DESC
      LIMIT ?
    """
    params2 = params + [min_trades, limit]

    with _DB_LOCK:
        rows = conn.execute(q, tuple(params2)).fetchall()

    out=[]
    for r in rows:
        out.append({'exchange': r[0], 'symbol': r[1], 'n': int(r[2] or 0), 'avg_r': float(r[3] or 0.0), 'win_rate': float(r[4] or 0.0)})
    return {'window_days': window_days, 'exchange': exchange, 'top200_only': top200_only, 'min_trades': min_trades, 'rows': out}


@app.get('/meta/analysis/best_buckets')
async def meta_analysis_best_buckets(window_days: int = 30, exchange: str = 'all', top200_only: bool = True, min_trades: int = 10, limit: int = 25):
    """Best performing buckets (grade × TF × side) by avg R."""
    from .services.ohlc_store import init_db, get_conn
    from .services.ohlc_store import _DB_LOCK  # type: ignore
    from .services.backtester import STRATEGY_VERSION
    init_db(); conn = get_conn()

    params = [window_days, STRATEGY_VERSION]
    where = ["window_days=?", "strategy_version=?", "resolved != 'NONE'"]
    if exchange != 'all':
        where.append('exchange=?')
        params.append(exchange)
    if top200_only:
        where.append('liquidity_top200 = 1')
    where_sql = ' AND '.join(where)

    q = f"""
      SELECT setup_grade, source_tf, signal,
             COUNT(*) as n,
             AVG(CASE WHEN resolved LIKE 'TP%' THEN 1.0 ELSE 0.0 END) as win_rate,
             AVG(r_multiple) as avg_r
      FROM backtest_trades
      WHERE {where_sql}
      GROUP BY setup_grade, source_tf, signal
      HAVING COUNT(*) >= ?
      ORDER BY avg_r DESC
      LIMIT ?
    """
    params2 = params + [min_trades, limit]

    with _DB_LOCK:
        rows = conn.execute(q, tuple(params2)).fetchall()

    out=[]
    for r in rows:
        out.append({'setup_grade': r[0] or '—', 'source_tf': r[1] or '—', 'signal': r[2] or '—', 'n': int(r[3] or 0), 'win_rate': float(r[4] or 0.0), 'avg_r': float(r[5] or 0.0)})
    return {'window_days': window_days, 'exchange': exchange, 'top200_only': top200_only, 'min_trades': min_trades, 'rows': out}


@app.get('/meta/analysis/report')
async def meta_analysis_report(
    window_days: int = 30,
    exchange: str = 'all',
    top200_only: bool = True,
    # per-section filters
    breakdown_min_trades: int = 1,
    breakdown_limit: int = 500,
    bucket_min_trades: int = 10,
    bucket_limit: int = 25,
    symbol_min_trades: int = 5,
    symbol_limit: int = 25,
):
    """Combined analysis endpoint to reduce frontend round-trips.

    Returns the same shapes as the individual endpoints:
    - summary
    - status
    - breakdown
    - best_buckets
    - best_symbols
    - worst_symbols
    """
    summary = await meta_analysis_summary(window_days=window_days, exchange=exchange, top200_only=top200_only)
    status = await meta_analysis_status(window_days=window_days, exchange=exchange, top200_only=top200_only)
    breakdown = await meta_analysis_breakdown(
        window_days=window_days,
        exchange=exchange,
        top200_only=top200_only,
        min_trades=breakdown_min_trades,
        limit=breakdown_limit,
    )
    best_buckets = await meta_analysis_best_buckets(
        window_days=window_days,
        exchange=exchange,
        top200_only=top200_only,
        min_trades=bucket_min_trades,
        limit=bucket_limit,
    )
    best_symbols = await meta_analysis_best_symbols(
        window_days=window_days,
        exchange=exchange,
        top200_only=top200_only,
        min_trades=symbol_min_trades,
        limit=symbol_limit,
    )
    worst_symbols = await meta_analysis_worst_symbols(
        window_days=window_days,
        exchange=exchange,
        top200_only=top200_only,
        min_trades=symbol_min_trades,
        limit=symbol_limit,
    )

    return {
        'window_days': window_days,
        'exchange': exchange,
        'top200_only': top200_only,
        'summary': summary,
        'status': status,
        'breakdown': breakdown,
        'best_buckets': best_buckets,
        'best_symbols': best_symbols,
        'worst_symbols': worst_symbols,
    }


@app.websocket("/ws/orderflow")
async def ws_orderflow(
    ws: WebSocket,
    exchange: str = 'binance',
    symbol: str = 'BTCUSDT',
    tf: str = '1m',
    step: float = 0.0,
    lookback: int = 30,
    emit_ms: int = 300,
):
    """Trade-based footprint stream for a single symbol.

    - Sends an initial snapshot (last N candles)
    - Then periodically sends latest-candle deltas (replace-current-candle)

    Query params:
      exchange: binance|bybit
      symbol: e.g. BTCUSDT
      tf: 1m, 5m, 15m, 1h
      step: price bucket size (0 means no bucketing; not recommended)
      lookback: candles in initial snapshot
      emit_ms: delta emit interval
    """
    await ws.accept()

    from .services.orderflow import _tf_ms

    exchange = (exchange or 'binance').lower()
    symbol = (symbol or 'BTCUSDT').upper()
    tf_ms = _tf_ms(tf)
    step = float(step)
    lookback = max(1, min(int(lookback), 500))
    emit_ms = max(50, min(int(emit_ms), 2000))

    engine = await orderflow_mgr.subscribe(exchange, symbol, tf=tf, step=step)

    async def send_snapshot():
        snap = await engine.snapshot(tf_ms=tf_ms, step=step, lookback=lookback)
        await ws.send_json(snap)

    async def send_delta_loop():
        while True:
            await asyncio.sleep(emit_ms / 1000.0)
            d = await engine.delta(tf_ms=tf_ms, step=step)
            if d is not None:
                await ws.send_json(d)

    try:
        await send_snapshot()
        delta_task = asyncio.create_task(send_delta_loop())
        # Keep connection alive; we don't expect inbound messages.
        while True:
            try:
                await ws.receive_text()
            except Exception:
                await asyncio.sleep(60)
    except WebSocketDisconnect:
        pass
    finally:
        try:
            delta_task.cancel()  # type: ignore
        except Exception:
            pass
        try:
            await orderflow_mgr.unsubscribe(exchange, symbol, tf=tf, step=step)
        except Exception:
            pass


@app.websocket("/ws/screener")
async def ws_screener(ws: WebSocket):
    await ws.accept()
    import logging
    log = logging.getLogger(__name__)
    log.info("WS client connected")
    q = await stream_mgr.subscribe()

    async def send_latest():
        payload = stream_mgr.agg._build_snapshot_payload()  # type: ignore[attr-defined]
        await ws.send_text(payload)

    # initial send (guarded)
    try:
        await send_latest()
    except Exception:
        try:
            await stream_mgr.agg.unsubscribe(q)  # type: ignore[attr-defined]
        except Exception:
            pass
        return

    from .config import WS_HEARTBEAT_SEC
    periodic = asyncio.create_task(_periodic_sender(ws, send_latest, WS_HEARTBEAT_SEC))
    ping_task = asyncio.create_task(_pinger(ws))
    try:
        while True:
            payload = await q.get()
            try:
                await ws.send_text(payload)
            except Exception:
                break
    except WebSocketDisconnect:
        log.info("WS client disconnected")
    finally:
        ping_task.cancel()
        periodic.cancel()
        try:
            await stream_mgr.agg.unsubscribe(q)  # type: ignore[attr-defined]
        except Exception:
            pass

@app.websocket("/ws/screener/bybit")
async def ws_screener_bybit(ws: WebSocket):
    await ws.accept()
    import logging
    log = logging.getLogger(__name__)
    log.info("WS client connected (bybit)")
    q = await stream_mgr.subscribe_bybit()

    async def send_latest():
        payload = stream_mgr.agg_bybit._build_snapshot_payload()  # type: ignore[attr-defined]
        await ws.send_text(payload)

    # initial send (guarded)
    try:
        await send_latest()
    except Exception:
        try:
            await stream_mgr.agg_bybit.unsubscribe(q)  # type: ignore[attr-defined]
        except Exception:
            pass
        return

    from .config import WS_HEARTBEAT_SEC
    periodic = asyncio.create_task(_periodic_sender(ws, send_latest, WS_HEARTBEAT_SEC))
    ping_task = asyncio.create_task(_pinger(ws))
    try:
        while True:
            payload = await q.get()
            try:
                await ws.send_text(payload)
            except Exception:
                break
    except WebSocketDisconnect:
        log.info("WS client disconnected (bybit)")
    finally:
        ping_task.cancel()
        periodic.cancel()
        try:
            await stream_mgr.agg_bybit.unsubscribe(q)  # type: ignore[attr-defined]
        except Exception:
            pass

def _is_valid_bybit_liquidation_symbol(symbol: str) -> bool:
    """Check if a symbol is valid for Bybit liquidation streaming.
    
    Bybit liquidation streams only support major USDT perpetual symbols.
    Symbols like "4USDT" or other non-standard symbols are not supported.
    """
    return symbol.endswith('USDT') and len(symbol) >= 6


@app.websocket("/ws/orderbook/{exchange}/{symbol}")
async def ws_orderbook(websocket: WebSocket, exchange: str, symbol: str):
    """Real-time order book wall detection stream.
    
    Streams detected support/resistance walls from the live order book.
    Walls are large resting limit orders that act as support/resistance.
    
    Message format:
    {
        "type": "walls_update",
        "data": {
            "support": [...],
            "resistance": [...],
            "mid_price": float,
            "bid_ratio": float,
            "imbalance": "BID"|"ASK"|"NEUTRAL"
        },
        "ts": timestamp
    }
    """
    import time
    log = logging.getLogger(__name__)
    
    await websocket.accept()
    log.info(f"Orderbook WS connected: {exchange}:{symbol}")
    
    try:
        from .services.orderbook_hub import get_orderbook_hub
        hub = get_orderbook_hub()
        
        # Start order book collector for this symbol
        started = await hub.start_orderbook(exchange, symbol)
        if not started:
            await websocket.send_json({
                "type": "error",
                "message": f"Failed to start orderbook stream for {exchange}:{symbol}",
                "ts": int(time.time() * 1000)
            })
        
        # Wait a moment for initial data
        await asyncio.sleep(0.5)
        
        # Send initial state
        state = hub.get_orderbook_state(exchange, symbol)
        if state:
            await websocket.send_json({
                "type": "init",
                "data": state,
                "ts": int(time.time() * 1000)
            })
        
        # Stream wall updates
        UPDATE_INTERVAL = 0.5  # Send updates every 500ms
        last_walls_hash = ""
        
        while True:
            try:
                await asyncio.sleep(UPDATE_INTERVAL)
                
                # Get current walls - both scalping (close) and swing (further)
                scalp_walls = hub.get_walls(exchange, symbol, min_strength=1.5, max_distance_pct=3.0)
                swing_walls = hub.get_swing_walls(exchange, symbol, min_strength=1.3, max_distance_pct=10.0, cluster_pct=0.3)
                state = hub.get_orderbook_state(exchange, symbol)
                
                # Always send update (walls change frequently)
                await websocket.send_json({
                    "type": "walls_update",
                    "data": {
                        # Scalping walls (within 3% of price)
                        "support": scalp_walls.get("support", []),
                        "resistance": scalp_walls.get("resistance", []),
                        # Swing walls (within 10% of price, clustered)
                        "swing_support": swing_walls.get("support", []),
                        "swing_resistance": swing_walls.get("resistance", []),
                        # Order book state
                        "mid_price": state.get("mid_price") if state else None,
                        "best_bid": state.get("best_bid") if state else None,
                        "best_ask": state.get("best_ask") if state else None,
                        "spread": state.get("spread") if state else None,
                        "bid_ratio": state.get("bid_ratio") if state else 0.5,
                        "imbalance": state.get("imbalance") if state else "NEUTRAL",
                        "total_bid_value": state.get("total_bid_value") if state else 0,
                        "total_ask_value": state.get("total_ask_value") if state else 0,
                    },
                    "ts": int(time.time() * 1000)
                })
                
                last_walls_hash = walls_hash
                
            except asyncio.CancelledError:
                raise
            except Exception as e:
                if "not connected" in str(e).lower() or "closed" in str(e).lower():
                    break
                log.debug(f"Orderbook WS update error: {e}")
                continue
    
    except WebSocketDisconnect:
        log.debug(f"Orderbook WS disconnected: {exchange}:{symbol}")
    except Exception as e:
        err_str = str(e).lower()
        if "not connected" not in err_str and "closed" not in err_str:
            log.warning(f"Orderbook WS error {exchange}:{symbol}: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@app.websocket("/ws/liquidations/{exchange}/{symbol}")
async def ws_liquidations(websocket: WebSocket, exchange: str, symbol: str):
    """Real-time liquidation stream for a specific symbol.
    
    Streams liquidation events and updated heatmap levels in real-time.
    Also sends periodic heatmap updates even if no new liquidations occur.
    
    Message format:
    {
        "type": "liquidation" | "levels_update",
        "data": {...},
        "ts": timestamp
    }
    """
    import json
    import time
    log = logging.getLogger(__name__)
    
    await websocket.accept()
    
    # Check if Bybit symbol is valid for liquidation streaming
    bybit_stream_supported = True
    if exchange == 'bybit' and not _is_valid_bybit_liquidation_symbol(symbol):
        bybit_stream_supported = False
        log.debug(f"Liquidations WS: {symbol} not supported for Bybit streaming (will use periodic updates only)")
    
    log.info(f"Liquidations WS connected: {exchange}:{symbol} (stream_supported={bybit_stream_supported})")
    
    try:
        # Get current price for filtering levels
        current_price = 0
        try:
            if exchange == 'binance':
                snap = stream_mgr.agg.build_snapshot()
            else:
                snap = stream_mgr.agg_bybit.build_snapshot()
            for m in snap.metrics:
                if m.symbol == symbol:
                    current_price = m.last_price
                    break
        except Exception:
            pass
        
        # Send initial state (recent liquidations + levels)
        try:
            if exchange == 'binance':
                from .exchanges.binance_liquidations_ws import get_recent_liquidations, get_liquidation_levels
            else:
                from .exchanges.bybit_liquidations_ws import get_recent_liquidations, get_liquidation_levels
            
            initial_liqs = get_recent_liquidations(symbol, limit=20)
            initial_levels = get_liquidation_levels(symbol, current_price=current_price, range_pct=5.0)
            
            await websocket.send_json({
                "type": "init",
                "data": {
                    "liquidations": initial_liqs,
                    "levels": initial_levels,
                    "current_price": current_price,
                },
                "ts": int(time.time() * 1000)
            })
        except WebSocketDisconnect:
            log.debug(f"Liquidations WS disconnected before init data sent: {exchange}:{symbol}")
            return  # Exit early - client already disconnected
        except Exception as e:
            # Connection may have closed - this is normal during rapid open/close
            if "not connected" in str(e).lower() or "closed" in str(e).lower():
                log.debug(f"Liquidations WS closed before init data: {exchange}:{symbol}")
                return
            log.warning(f"Failed to send initial liquidations data: {e}")
        
        # Stream real-time updates (only if supported)
        stream_fn = None
        if exchange == 'binance':
            from .exchanges.binance_liquidations_ws import stream_all_liquidations
            stream_fn = stream_all_liquidations
        elif exchange == 'bybit' and bybit_stream_supported:
            from .exchanges.bybit_liquidations_ws import stream_liquidations
            stream_fn = lambda syms: stream_liquidations(symbol)
        
        last_levels_update = time.time()
        LEVELS_UPDATE_INTERVAL = 5  # Send levels update every 5 seconds
        
        # Create a task that streams liquidations
        async def stream_liqs():
            nonlocal last_levels_update
            
            # Skip streaming if not supported (e.g., invalid Bybit symbols)
            if stream_fn is None:
                log.debug(f"Liquidation streaming not available for {exchange}:{symbol}")
                # Just sleep forever - periodic_levels will handle updates
                while True:
                    await asyncio.sleep(3600)
            
            try:
                async for liq in stream_fn({symbol}):
                    if liq.get("symbol") == symbol:
                        # Send individual liquidation event
                        await websocket.send_json({
                            "type": "liquidation",
                            "data": liq,
                            "ts": int(time.time() * 1000)
                        })
                        
                        # Check if we should send levels update
                        now = time.time()
                        if now - last_levels_update >= LEVELS_UPDATE_INTERVAL:
                            try:
                                levels = get_liquidation_levels(symbol, current_price=current_price, range_pct=5.0)
                                await websocket.send_json({
                                    "type": "levels_update",
                                    "data": {"levels": levels},
                                    "ts": int(time.time() * 1000)
                                })
                                last_levels_update = now
                            except Exception:
                                pass
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning(f"Liquidation stream error: {e}")
        
        # Create a task for periodic levels updates (even without new liquidations)
        async def periodic_levels():
            nonlocal last_levels_update, current_price
            while True:
                await asyncio.sleep(LEVELS_UPDATE_INTERVAL)
                try:
                    # Update current price
                    try:
                        if exchange == 'binance':
                            snap = stream_mgr.agg.build_snapshot()
                        else:
                            snap = stream_mgr.agg_bybit.build_snapshot()
                        for m in snap.metrics:
                            if m.symbol == symbol:
                                current_price = m.last_price
                                break
                    except Exception:
                        pass
                    
                    levels = get_liquidation_levels(symbol, current_price=current_price, range_pct=5.0)
                    await websocket.send_json({
                        "type": "levels_update",
                        "data": {"levels": levels, "current_price": current_price},
                        "ts": int(time.time() * 1000)
                    })
                    last_levels_update = time.time()
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    log.debug(f"Periodic levels update error: {e}")
        
        # Run both tasks concurrently
        stream_task = asyncio.create_task(stream_liqs())
        levels_task = asyncio.create_task(periodic_levels())
        
        # Wait for client disconnect
        try:
            while True:
                # Check for incoming messages (ping/pong or close)
                try:
                    msg = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                    # Handle ping
                    if msg == "ping":
                        await websocket.send_text("pong")
                except asyncio.TimeoutError:
                    # Send ping to keep connection alive
                    try:
                        await websocket.send_json({"type": "ping", "ts": int(time.time() * 1000)})
                    except Exception:
                        break
        finally:
            stream_task.cancel()
            levels_task.cancel()
            try:
                await stream_task
            except asyncio.CancelledError:
                pass
            try:
                await levels_task
            except asyncio.CancelledError:
                pass
    
    except WebSocketDisconnect:
        log.debug(f"Liquidations WS disconnected: {exchange}:{symbol}")
    except Exception as e:
        # Filter out common "not connected" errors to reduce log noise
        err_str = str(e).lower()
        if "not connected" in err_str or "closed" in err_str or "cannot call" in err_str:
            log.debug(f"Liquidations WS closed: {exchange}:{symbol}")
        else:
            log.warning(f"Liquidations WS error {exchange}:{symbol}: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@app.websocket("/ws/screener/all")
async def ws_screener_all(ws: WebSocket):
    await ws.accept()
    import logging
    log = logging.getLogger(__name__)
    log.info("WS client connected (all)")
    q_bin = await stream_mgr.subscribe()
    q_byb = None
    try:
        q_byb = await stream_mgr.subscribe_bybit()  # type: ignore[attr-defined]
    except Exception as e:
        log.warning(f"subscribe_bybit failed; continuing with Binance only: {e}")

    async def build_combined_snapshot():
        try:
            snap_bin = stream_mgr.agg.build_snapshot()  # type: ignore[attr-defined]
        except Exception:
            snap_bin = None
        try:
            snap_byb = stream_mgr.agg_bybit.build_snapshot()  # type: ignore[attr-defined]
        except Exception:
            snap_byb = None
        metrics = []
        ts = 0
        if snap_bin:
            metrics.extend(snap_bin.metrics)
            ts = max(ts, snap_bin.ts)
        if snap_byb:
            metrics.extend(snap_byb.metrics)
            ts = max(ts, snap_byb.ts)
        return ScreenerSnapshot(exchange="all", ts=ts, metrics=metrics)

    async def send_combined():
        snap = await build_combined_snapshot()
        payload = snap.model_dump_json()
        try:
            log.debug(f"/ws/screener/all sending {len(snap.metrics)} metrics")
        except Exception:
            pass
        await ws.send_text(payload)

    # readiness wait: give bybit a brief window to populate before first send
    async def readiness_wait(timeout_s: float = 3.0):
        start = asyncio.get_event_loop().time()
        while True:
            snap = await build_combined_snapshot()
            has_bin = any((m.exchange or '').lower() == 'binance' for m in snap.metrics)
            has_byb = any((m.exchange or '').lower() == 'bybit' for m in snap.metrics)
            if has_bin and has_byb:
                return
            if (asyncio.get_event_loop().time() - start) > timeout_s:
                return
            await asyncio.sleep(0.2)

    try:
        await readiness_wait()
        await send_combined()
    except Exception:
        try:
            await send_combined()
        except Exception:
            # if even this fails, close out
            try:
                await stream_mgr.agg.unsubscribe(q_bin)  # type: ignore[attr-defined]
                if q_byb is not None:
                    await stream_mgr.agg_bybit.unsubscribe(q_byb)  # type: ignore[attr-defined]
            except Exception:
                pass
            return

    from .config import WS_HEARTBEAT_SEC
    periodic = asyncio.create_task(_periodic_sender(ws, send_combined, WS_HEARTBEAT_SEC))

    ping_task = asyncio.create_task(_pinger(ws))
    try:
        while True:
            tasks = {asyncio.create_task(q_bin.get())}
            if q_byb is not None:
                tasks.add(asyncio.create_task(q_byb.get()))
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
            try:
                await send_combined()
            except Exception:
                break
    except WebSocketDisconnect:
        log.info("WS client disconnected (all)")
    finally:
        ping_task.cancel()
        periodic.cancel()
        try:
            await stream_mgr.agg.unsubscribe(q_bin)  # type: ignore[attr-defined]
            if q_byb is not None:
                await stream_mgr.agg_bybit.unsubscribe(q_byb)  # type: ignore[attr-defined]
        except Exception:
            pass

async def _periodic_sender(ws: WebSocket, send_fn, interval: float):
    while True:
        await asyncio.sleep(interval)
        try:
            await send_fn()
        except Exception:
            break

async def _pinger(ws: WebSocket):
    while True:
        await asyncio.sleep(20)
        try:
            await ws.send_json({"type": "ping"})
        except Exception:
            break
