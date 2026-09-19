# -*- coding: utf-8 -*-
# 回测引擎边界测试：缺 initialize / 语法错误 / 空股票池 / 基准回退 / 无交易日等
import sys
sys.path.insert(0, 'engine')
from backtest_engine import BacktestEngine

pass_n = 0
fail_n = 0

def check(name, cond, detail=''):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print('  [PASS] ' + name)
    else:
        fail_n += 1
        print('  [FAIL] ' + name + '  ' + detail)

def run(code, start='2026-07-01', end='2026-08-07', capital=1000000):
    return BacktestEngine(start, end, capital).run(code)
# ============ 边界用例 ============
r = run('x = 1')
check('缺 initialize 报错', r['code'] != 0 and 'initialize' in str(r.get('message', '')),
    str(r.get('message', ''))[:60])

r = run('def initialize(context:\n pass')
check('语法错误报错', r['code'] != 0 and '执行错误' in str(r.get('message', '')),
    str(r.get('message', ''))[:60])

r = run('def initialize(context):\n    raise ValueError("boom")')
check('initialize 异常报错', r['code'] != 0, str(r.get('message', ''))[:60])

r = run('''def initialize(context):
    g.stocks = ['600519.XSHG']
    set_benchmark('000300.XSHG')
    run_daily(rebalance, '09:30')
def rebalance(context):
    order_target_value('600519.XSHG', context.portfolio.total_value)
''')
check('买入持有成功', r['code'] == 0 and r['data'] and r['data']['tradingDays'] > 0,
    str(r.get('message', ''))[:80])

r = run('''def initialize(context):
    g.stocks = ['600519.XSHG']
    set_benchmark('000300.XSHG')
    run_daily(rebalance, '09:30')
def rebalance(context):
    h = attribute_history('600519.XSHG', 20, '1d', ['close'])
    if len(h['close']) < 20: return
    s = h['close'][-5:].mean()
    l = h['close'].mean()
    order_target_value('600519.XSHG', context.portfolio.total_value if s > l else 0)
''')
check('均线策略有交易', r['code'] == 0 and r['data']['tradesCount'] > 0,
    'trades=' + str(r['data'].get('tradesCount', 0)))

r = run('''def initialize(context):
    g.stocks = []
    set_benchmark('000300.XSHG')
    run_daily(rebalance, '09:30')
def rebalance(context):
    pass
''')
check('空股票池不崩溃', r['code'] == 0, str(r.get('message', ''))[:60])

r = run('''def initialize(context):
    g.stocks = ['600519.XSHG']
    set_benchmark('999999.XSHG')
    run_daily(rebalance, '09:30')
def rebalance(context):
    pass
''')
check('无效基准回退不崩溃', r['code'] == 0, str(r.get('message', ''))[:60])

r = run('def initialize(context):\n    pass', start='2026-08-08', end='2026-08-09')
check('无交易日报错', r['code'] != 0 and '无交易日' in str(r.get('message', '')),
    str(r.get('message', ''))[:60])

r = run('''def initialize(context):
    g.stocks = ['600519.XSHG']
    run_daily(rebalance, '09:30')
def rebalance(context):
    h = attribute_history('600519.XSHG', 10, '1d', ['close'])
    log.info('mean=' + str(h['close'].mean()))
''')
check('attribute_history Series.mean() 可用', r['code'] == 0, str(r.get('message', ''))[:60])

r = run('''def initialize(context):
    g.stocks = ['600519.XSHG']
    set_benchmark('000300.XSHG')
    run_daily(rebalance, '09:30')
def rebalance(context):
    order_target_value('600519.XSHG', context.portfolio.total_value)
''')
if r['code'] == 0:
    d = r['data']
    keys = ['totalReturns', 'annualReturns', 'maxDrawdown', 'sharpe', 'volatility',
            'alpha', 'beta', 'informationRatio', 'winRate', 'benchmarkTotalReturns']
    check('指标字段齐全', all(k in d for k in keys), [k for k in keys if k not in d])
    check('基准序列长度对齐', len(r['benchmark']['dates']) == d['tradingDays'],
        str(len(r['benchmark']['dates'])) + 'vs' + str(d['tradingDays']))
else:
    check('指标字段齐全', False, r.get('message', ''))

r = run('''def initialize(context):
    g.stocks = ['600519.XSHG']
    run_daily(rebalance, '09:30')
def rebalance(context):
    order('600519.XSHG', 100)
''')
check('order 下单成功', r['code'] == 0, str(r.get('message', ''))[:60])

print('===== 引擎边界测试: ' + str(pass_n) + ' 通过, ' + str(fail_n) + ' 失败 =====')
sys.exit(1 if fail_n else 0)
