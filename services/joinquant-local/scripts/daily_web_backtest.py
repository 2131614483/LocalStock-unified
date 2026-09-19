# -*- coding: utf-8 -*-
"""每日网页端回测 —— daily-stock-pick skill「复盘」的数据基础。

在网页端引擎（server/index.js）跑种子策略回测，累积历史、对比基准、输出反思提示。
数据源：POST /api/backtest/<id>/run（调 engine/backtest_engine.py，120s 超时）。

用法（任意 python）：
  C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe scripts/daily_web_backtest.py \
      [--port 8080] [--days 120] [--strategies smallcap_v1,multifactor_v1,lowvol_v1]

- 默认窗口：最近 days 个交易日（days=120 ≈ 6 个月，每策略 ~30s，避免 120s 超时）。
- 结果累积到 data/backtest_history.json；打印对比表 + 跑输提示。
- 若服务器未启动会尝试拉起（PORT 需避开 3000 保留段，默认 8080）。
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIST = os.path.join(BASE, 'data', 'backtest_history.json')

# 名称 -> (backtest_id, 策略名)。backtest_id = 策略文件名 md5（seed_strategies.py 生成）。
STRATEGIES = {
    'smallcap_v1': ('e0d2631deef410f44ce28cdb7e1f87bd', '小市值多因子'),
    'multifactor_v1': ('2f0db51766c02c265758ecf5355e560b', '多因子综合'),
    'lowvol_v1': ('34c201ac84d5125050b2541da25cbf87', '低波'),
    'value_v1': ('5a893a8bd2943ed32c187087ced30e35', '价值'),
    'quality_v1': ('42fe8ad3adf383c88d5282181c10f0fe', '质量'),
    'growth_v1': ('d7d6d66f59e4e1959034b7615021e6e3', '成长'),
    'momentum_v1': ('6acfb4797539d52042db243a48cad4b8', '动量'),
}


def server_up(port):
    try:
        urllib.request.urlopen('http://127.0.0.1:%d/api/' % port, timeout=3)
        return True
    except urllib.error.HTTPError:
        return True  # 服务器在响应（即使 404）
    except Exception:  # noqa: BLE001
        return False


def ensure_server(port):
    if server_up(port):
        return True
    print(f'网页服务器未启动，尝试拉起 PORT={port} ...')
    try:
        env = dict(os.environ, PORT=str(port))
        subprocess.Popen(['node', os.path.join(BASE, 'server', 'index.js')],
                         cwd=BASE, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(20):
            time.sleep(1)
            if server_up(port):
                print('服务器已启动。')
                return True
        print('服务器启动超时（请手动 `PORT=%d node server/index.js`）' % port)
        return False
    except Exception as e:  # noqa: BLE001
        print(f'启动服务器失败: {e}')
        return False


def run_backtest(port, bt_id, start, end):
    url = 'http://127.0.0.1:%d/api/backtest/%s/run' % (port, bt_id)
    body = json.dumps({'startDate': start, 'endDate': end, 'capitalBase': 1000000}).encode()
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
    r = json.loads(urllib.request.urlopen(req, timeout=118).read().decode('utf-8'))
    return r.get('data') or {}


def load_hist():
    if os.path.exists(HIST):
        try:
            with open(HIST, encoding='utf-8') as f:
                return json.load(f)
        except Exception:  # noqa: BLE001
            return []
    return []


def calendar_max():
    """trade_calendar 最大日期（web /run 校验用它，常落后于 stock_daily）。"""
    try:
        import sqlite3
        conn = sqlite3.connect(os.path.join(BASE, 'data', 'stock_data.db'))
        row = conn.execute('SELECT MAX(trade_date) FROM trade_calendar').fetchone()
        conn.close()
        return row[0] if row and row[0] else None
    except Exception:  # noqa: BLE001
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--days', type=int, default=120)
    ap.add_argument('--strategies', default='smallcap_v1,multifactor_v1,lowvol_v1')
    args = ap.parse_args()

    if not ensure_server(args.port):
        return 1
    names = [s.strip() for s in args.strategies.split(',') if s.strip()]
    today = date.today().strftime('%Y-%m-%d')
    # end 用日历最大值封顶（web /run 校验 endDate ≤ 日历 max；日历常落后 stock_daily）
    cal_max = calendar_max()
    end = min(today, cal_max) if cal_max else today
    start = (date.today() - timedelta(days=args.days * 7 // 5 + 30)).strftime('%Y-%m-%d')
    if cal_max and start > cal_max:
        start = cal_max

    print(f'# 每日网页端回测 · {today} · 窗口 {start} ~ {end}')
    print('')
    rows = []
    for name in names:
        if name not in STRATEGIES:
            print(f'跳过未知策略: {name}')
            continue
        bt_id, label = STRATEGIES[name]
        print(f'回测 {label} ...')
        m = run_backtest(args.port, bt_id, start, end)
        rec = {'date': today, 'strategy': name, 'label': label, 'start': start, 'end': end,
               'total_returns': m.get('totalReturns'), 'benchmark_total_returns': m.get('benchmarkTotalReturns'),
               'sharpe': m.get('sharpe'), 'max_drawdown': m.get('maxDrawdown'), 'win_rate': m.get('winRate')}
        rows.append(rec)
        # 累积历史（同日期+策略 覆盖）
        hist = load_hist()
        hist = [h for h in hist if not (h.get('date') == today and h.get('strategy') == name)]
        hist.append(rec)
        with open(HIST, 'w', encoding='utf-8') as f:
            json.dump(hist, f, ensure_ascii=False, indent=2)

    print('')
    print('| 策略 | 区间收益 | 基准收益 | 超额 | 夏普 | 最大回撤 |')
    print('|---|---|---|---|---|---|')
    for r in rows:
        if r['total_returns'] is None:
            continue
        excess = (r['total_returns'] - r['benchmark_total_returns']) * 100 if r['benchmark_total_returns'] is not None else None
        exc = '%.1fpp(%s)' % (excess, '跑赢' if excess > 0 else '跑输') if excess is not None else '—'
        print('| %s | %.1f%% | %.1f%% | %s | %.2f | %.1f%% |' % (
            r['label'], r['total_returns'] * 100,
            (r['benchmark_total_returns'] or 0) * 100, exc, r['sharpe'] or 0, (r['max_drawdown'] or 0) * 100))

    # 跑输提示（smallcap 跑输基准即提示重验）
    under = [r for r in rows if r['total_returns'] is not None and r['benchmark_total_returns'] is not None
             and r['total_returns'] < r['benchmark_total_returns']]
    if under:
        print('')
        print('⚠️ 跑输基准：' + '、'.join(r['label'] for r in under) +
              ' → 复盘反思：是否因子失效/风格不匹配；可重跑 validate_daily_schemes.py、评估权重。')
    print('')
    print('历史明细见 data/backtest_history.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
