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

@app.on_event("startup")
async def on_startup():
    await stream_mgr.start()

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
async def debug_status():
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
    
    bin_stale = stream_mgr.agg.stale_symbols(now_ms)
    byb_stale = stream_mgr.agg_bybit.stale_symbols(now_ms) if hasattr(stream_mgr, 'agg_bybit') else {"ticker":[],"kline":[],"ticker_count":0,"kline_count":0}

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
                })
        return {
            "exchange": "binance",
            "total_symbols": len(snap.metrics),
            "symbols_with_oi": len(oi_metrics),
            "oi_data": oi_metrics[:10]  # Show first 10
        }
    except Exception as e:
        return {"error": str(e)}

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

@app.websocket("/ws/screener")
async def ws_screener(ws: WebSocket):
    await ws.accept()
    import logging
    logging.getLogger(__name__).info("WS client connected")
    q = await stream_mgr.subscribe()
    # Send current snapshot immediately (may be empty)
    async def send_latest():
        try:
            payload = stream_mgr.agg._build_snapshot_payload()  # type: ignore[attr-defined]
            await ws.send_text(payload)
        except Exception:
            pass
    await send_latest()
    # periodic heartbeat using WS_HEARTBEAT_SEC
    from .config import WS_HEARTBEAT_SEC
    periodic = asyncio.create_task(_periodic_sender(ws, send_latest, WS_HEARTBEAT_SEC))
    try:
        ping_task = asyncio.create_task(_pinger(ws))
        while True:
            payload = await q.get()
            await ws.send_text(payload)
    except WebSocketDisconnect:
        logging.getLogger(__name__).info("WS client disconnected")
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
    logging.getLogger(__name__).info("WS client connected (bybit)")
    q = await stream_mgr.subscribe_bybit()
    async def send_latest():
        try:
            payload = stream_mgr.agg_bybit._build_snapshot_payload()  # type: ignore[attr-defined]
            await ws.send_text(payload)
        except Exception:
            pass
    await send_latest()
    from .config import WS_HEARTBEAT_SEC
    periodic = asyncio.create_task(_periodic_sender(ws, send_latest, WS_HEARTBEAT_SEC))
    try:
        ping_task = asyncio.create_task(_pinger(ws))
        while True:
            payload = await q.get()
            await ws.send_text(payload)
    except WebSocketDisconnect:
        logging.getLogger(__name__).info("WS client disconnected (bybit)")
    finally:
        ping_task.cancel()
        periodic.cancel()
        try:
            await stream_mgr.agg_bybit.unsubscribe(q)  # type: ignore[attr-defined]
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

    async def send_combined():
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
        payload = ScreenerSnapshot(exchange="all", ts=ts, metrics=metrics).model_dump_json()
        try:
            log.debug(f"/ws/screener/all sending {len(metrics)} metrics")
        except Exception:
            pass
        await ws.send_text(payload)

    # initial
    try:
        await send_combined()
    except Exception:
        pass

    # periodic heartbeat snapshot every WS_HEARTBEAT_SEC
    from .config import WS_HEARTBEAT_SEC
    periodic = asyncio.create_task(_periodic_sender(ws, send_combined, WS_HEARTBEAT_SEC))

    try:
        ping_task = asyncio.create_task(_pinger(ws))
        while True:
            tasks = {asyncio.create_task(q_bin.get())}
            if q_byb is not None:
                tasks.add(asyncio.create_task(q_byb.get()))
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
            await send_combined()
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
