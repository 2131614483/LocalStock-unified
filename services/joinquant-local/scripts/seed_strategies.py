# -*- coding: utf-8 -*-
"""
策略库种子脚本：把 scripts/strategies/*.py 写入 data/backtest.db。

运行（任意 Python 均可，只用 sqlite3 + hashlib）：
  python scripts/seed_strategies.py

设计（为什么这样写）：
1. 策略代码放在 scripts/strategies/ 独立文件，便于阅读/修改；本脚本统一入库。
2. 每策略在 algorithms / backtests / backtest_code 三表各插一条：
   - algorithms 存策略名/描述（algorithm_id 用可读名，如 'value_v1'）
   - backtests 存回测容器（backtest_id = 算法名 md5，初始区间 2023-2026，status=pending）
   - backtest_code 存策略源码（code_hash = sha256）
3. INSERT OR IGNORE：重复运行不覆盖已有策略。
"""
import os
import sys
import sqlite3
import hashlib

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, 'data', 'backtest.db')
STRAT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'strategies')

# (文件名, 策略名, 描述)
STRATEGIES = [
    ('momentum_v1', '动量策略', '截面动量 mom_12m1m 选股，月频调仓，含 8% 止损'),
    ('value_v1', '价值策略', '低估值 BP+EP 选股，月频调仓，含 8% 止损'),
    ('quality_v1', '质量策略', '高ROE+高毛利+强现金流+低负债选股，月频调仓'),
    ('growth_v1', '成长策略', '营收/净利高增速选股，月频调仓'),
    ('lowvol_v1', '低波策略', '60日低波动稳健选股，月频调仓'),
    ('multifactor_v1', '多因子综合', '价值+质量+低波+动量多因子加权选股，月频调仓'),
    ('smallcap_v1', '小市值多因子', '多因子+小市值(ln_cap0.10)选股，月频调仓，与每日选股 smallcap 方案一致'),
]


def main():
    conn = sqlite3.connect(DB_PATH)
    n = 0
    for fname, name, desc in STRATEGIES:
        path = os.path.join(STRAT_DIR, fname + '.py')
        if not os.path.exists(path):
            print('  跳过（缺文件）: %s' % path)
            continue
        with open(path, encoding='utf-8') as f:
            code = f.read()
        algorithm_id = fname
        backtest_id = hashlib.md5(fname.encode()).hexdigest()
        conn.execute(
            'INSERT OR IGNORE INTO algorithms (algorithm_id, user_id, name, description) VALUES (?, 1, ?, ?)',
            (algorithm_id, name, desc))
        conn.execute(
            'INSERT OR IGNORE INTO backtests '
            '(backtest_id, algorithm_id, algorithm_name, start_date, end_date, capital_base, frequency, status, progress) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (backtest_id, algorithm_id, name, '2023-01-01', '2026-07-31', 1000000, 'day', 'pending', 0))
        code_hash = hashlib.sha256(code.encode()).hexdigest()
        # backtest_code 用 upsert：重跑时更新已变动的策略代码（历史 bug：INSERT OR IGNORE 导致修改不生效）
        if conn.execute('SELECT 1 FROM backtest_code WHERE backtest_id=?', (backtest_id,)).fetchone():
            conn.execute('UPDATE backtest_code SET code=?, code_hash=?, updated_at=datetime("now") WHERE backtest_id=?',
                         (code, code_hash, backtest_id))
        else:
            conn.execute(
                'INSERT INTO backtest_code (backtest_id, language, code, code_hash) VALUES (?, ?, ?, ?)',
                (backtest_id, 'python', code, code_hash))
        print('  入库: %s (%s)' % (name, backtest_id))
        n += 1
    conn.commit()
    conn.close()
    print('完成：写入 %d 个策略' % n)


if __name__ == '__main__':
    main()
