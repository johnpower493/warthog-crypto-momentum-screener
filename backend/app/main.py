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
    return {"status": "ok"}

@app.get("/debug/status")
async def debug_status():
    try:
        bin_syms = await stream_mgr.binance.symbols()
    except Exception:
        bin_syms = []
    try:
        byb_syms = await stream_mgr.bybit.symbols()  # type: ignore[attr-defined]
    except Exception:
        byb_syms = []
    return {
        "binance": {
            "symbols": len(bin_syms),
            "state": getattr(stream_mgr.agg, 'state_count', lambda: 0)(),
            "last_emit_ts": getattr(stream_mgr.agg, 'last_emit_ts', 0),
            "last_ingest_ts": getattr(stream_mgr.agg, 'last_ingest_ts', 0),
        },
        "bybit": {
            "symbols": len(byb_syms),
            "state": getattr(stream_mgr.agg_bybit, 'state_count', lambda: 0)() if hasattr(stream_mgr, 'agg_bybit') else 0,
            "last_emit_ts": getattr(stream_mgr.agg_bybit, 'last_emit_ts', 0) if hasattr(stream_mgr, 'agg_bybit') else 0,
            "last_ingest_ts": getattr(stream_mgr.agg_bybit, 'last_ingest_ts', 0) if hasattr(stream_mgr, 'agg_bybit') else 0,
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
