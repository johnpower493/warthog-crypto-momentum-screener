"""
Batch loading utilities to reduce database round-trips during initialization.
"""
from __future__ import annotations
import logging
from typing import List, Dict

logger = logging.getLogger(__name__)


def batch_seed_htf_data(exchange: str, symbols: List[str]) -> Dict[str, Dict[str, List]]:
    """
    Load 15m and 4h OHLC data for multiple symbols in batch.
    
    Returns: Dict[symbol][timeframe] = list of (ot, ct, o, h, l, c, v) tuples
    """
    from .ohlc_store import get_recent_batch
    
    result = {}
    
    try:
        # Batch fetch for 15m
        data_15m = get_recent_batch(exchange, symbols, '15m', limit=300)
        # Batch fetch for 4h
        data_4h = get_recent_batch(exchange, symbols, '4h', limit=300)
        
        # Combine into nested dict
        for sym in symbols:
            result[sym] = {
                '15m': data_15m.get(sym, []),
                '4h': data_4h.get(sym, []),
            }
        
        logger.info(f"Batch loaded HTF data for {len(symbols)} symbols (15m: {sum(len(v) for v in data_15m.values())} rows, 4h: {sum(len(v) for v in data_4h.values())} rows)")
    except Exception as e:
        logger.error(f"Error in batch HTF loading: {e}")
        # Return empty dict on error, individual symbols will fall back to lazy loading
        result = {}
    
    return result


def seed_symbol_state_batch(states: Dict[str, any], exchange: str):
    """
    Seed HTF data for all SymbolState objects in batch.
    
    Args:
        states: Dict mapping symbol -> SymbolState
        exchange: Exchange name
    """
    symbols = list(states.keys())
    if not symbols:
        return
    
    # Batch load all HTF data
    htf_data = batch_seed_htf_data(exchange, symbols)
    
    # Populate each state
    for sym, state in states.items():
        data = htf_data.get(sym, {})
        
        for tf in ['15m', '4h']:
            rows = data.get(tf, [])
            if rows:
                # Clear existing and populate
                try:
                    state._htf[tf]['close'].values.clear()
                    state._htf[tf]['high'].values.clear()
                    state._htf[tf]['low'].values.clear()
                    state._htf[tf]['vol'].values.clear()
                    
                    for (ot, ct, o, h, l, c, v) in rows:
                        state._htf[tf]['close'].append(c)
                        state._htf[tf]['high'].append(h)
                        state._htf[tf]['low'].append(l)
                        state._htf[tf]['vol'].append(v)
                except Exception as e:
                    logger.debug(f"Error seeding {sym} {tf}: {e}")
    
    logger.info(f"Seeded HTF data for {len(states)} symbol states")
