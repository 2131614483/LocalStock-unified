# 验证策略模板都能被回测引擎执行（2020-2023，真实行情库）
import glob
import json
import os
import subprocess

engine = 'python/engine/backtest_engine.py'
db = os.path.expandvars(r'%APPDATA%/localstock-desktop/stock_data.db')
runs = [
    ('buy_and_hold', '2020-01-01', '2023-01-01', 1000000),
    ('dual_ma', '2020-01-01', '2023-01-01', 1000000),
    ('bollinger', '2020-01-01', '2023-01-01', 1000000),
    ('turtle', '2020-01-01', '2023-01-01', 1000000),
    ('ma_alignment', '2020-01-01', '2023-01-01', 1000000),
    ('macd_cross', '2020-01-01', '2023-01-01', 1000000),
    ('breakout', '2020-01-01', '2023-01-01', 1000000),
    ('momentum_rotation', '2020-01-01', '2023-01-01', 1000000),
    ('rsi_reversion', '2020-01-01', '2023-01-01', 1000000),
    ('ma_deviation', '2020-01-01', '2023-01-01', 1000000),
    ('dollar_cost_average', '2020-01-01', '2023-01-01', 1000000),
    ('grid', '2020-01-01', '2023-01-01', 1000000),
    ('factor_rotation', '2020-01-01', '2023-01-01', 1000000),
    ('large_small_rotation', '2020-01-01', '2023-01-01', 1000000),
    ('confluence', '2020-01-01', '2023-01-01', 1000000),
    ('momentum_breakout_stop', '2020-01-01', '2023-01-01', 1000000),
    ('ma_squeeze', '2020-01-01', '2023-01-01', 1000000),
    ('breakout_retest', '2020-01-01', '2023-01-01', 1000000),
    ('trend_pullback', '2020-01-01', '2023-01-01', 1000000),
    ('equal_weight_rebalance', '2020-01-01', '2023-01-01', 1000000),
    ('smart_dca', '2020-01-01', '2023-01-01', 1000000),
    ('double_bottom', '2020-01-01', '2023-01-01', 1000000),
]

for name, start, end, cap in runs:
    code = open(f'python/scripts/templates/{name}.py', encoding='utf-8').read()
    r = subprocess.run(
        ['python', engine, '--code', code, '--db', db,
         '--start', start, '--end', end, '--capital', str(cap)],
        capture_output=True, text=True, encoding='utf-8', timeout=120,
        env={**os.environ, 'PYTHONUTF8': '1'})
    try:
        res = json.loads(r.stdout)
        d = res.get('data', {})
        print(f"{name:18s} code={res.get('code')} ret={d.get('totalReturns')} "
              f"trades={d.get('tradesCount')} msg={str(res.get('message'))[:30]}")
    except Exception:
        print(f"{name:18s} FAILED stdout={r.stdout[:150]!r} stderr={r.stderr[:150]!r}")
