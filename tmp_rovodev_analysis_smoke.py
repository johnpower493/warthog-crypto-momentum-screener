import sqlite3
from backend.app.services.ohlc_store import init_db
from backend.app.services.analysis_backtester import run_analysis_backtest

print('running backtest...')
res = run_analysis_backtest(window_days=30, exchange='all', top200_only=True)
print('run_result', res)

init_db()
con = sqlite3.connect('ohlc.sqlite3')

n = con.execute('select count(*) from backtest_trades where window_days=30').fetchone()[0]
print('backtest_trades_rows', n)

row = con.execute("""
  select
    count(*) as n,
    avg(case when resolved like 'TP%' then 1.0 else 0.0 end) as win_rate,
    avg(r_multiple) as avg_r
  from backtest_trades
  where window_days=30 and resolved != 'NONE'
""").fetchone()
print('summary_sql', row)

rows = con.execute("""
  select setup_grade, source_tf, signal, count(*)
  from backtest_trades
  where window_days=30 and resolved != 'NONE'
  group by setup_grade, source_tf, signal
  order by count(*) desc
  limit 10
""").fetchall()
print('breakdown_top10', rows)

con.close()
