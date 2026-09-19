# -*- coding: utf-8 -*-
"""
双轨一致性校验：研究管线（scripts/factor_lib.py, pandas） vs web 引擎
（engine/factor_calc_stdlib.py, 纯标准库）对同一批因子、同一截面算出的值应完全一致。

设计（为什么这样写）：
1. 因子定义唯一源 factor_registry.json 被两个模块共用；本脚本验证它们"算得一样"，
   保证研究结论能直接落到生产引擎（策略库）而不失真。
2. 缺失值表示差异（pandas 用 NaN、stdlib 用 None）不算不一致。
3. 在多个日期、多个因子上抽查，输出最大相对偏差；>0.001 即视为不一致并报错。

运行：C:\\Users\\he\\AppData\\Local\\Programs\\Python\\Python311\\python.exe scripts/verify_factor_consistency.py
"""
import math
import sqlite3
import sys
import os

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'engine'))
from factor_lib import FactorCalculator
from factor_calc_stdlib import FactorCalcStdlib

CHECK_DATES = ['2019-06-28', '2021-12-31', '2023-05-31', '2025-06-30']
CHECK_FACTORS = [
    'bp', 'ep_ttm', 'ep_annual', 'sp_ttm', 'roe_ttm', 'roe_annual',
    'debt_ratio', 'gross_margin', 'op_cf_ratio',
    'rev_growth_yr', 'profit_growth_yr',
    'mom_1m', 'mom_3m', 'mom_6m', 'mom_12m', 'mom_12m1m', 'rev_5d',
    'vol_20d', 'vol_60d', 'liq_20d', 'turnover_20d', 'rsi_14',
    'ma_dev_20', 'ln_cap',
]
MAX_REL_DIFF = 0.001
SAMPLE_N = 400


def _miss(v):
    return v is None or (isinstance(v, float) and math.isnan(v))


def main():
    calc = FactorCalculator()
    conn = sqlite3.connect(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'stock_data.db'))
    s = FactorCalcStdlib(conn)
    total_bad = 0
    for d in CHECK_DATES:
        univ = calc.get_universe(d)
        if len(univ) > SAMPLE_N:
            univ = univ[:SAMPLE_N]
        pdf = calc.compute_factors(d, univ, CHECK_FACTORS)
        sres = s.get_factors(univ, CHECK_FACTORS, d)
        for f in CHECK_FACTORS:
            worst = 0.0
            for code in univ:
                a = pdf.loc[code, f] if code in pdf.index else None
                b = sres.get(code, {}).get(f)
                if _miss(a) and _miss(b):
                    continue
                if _miss(a) or _miss(b):
                    worst = max(worst, 1.0)
                    continue
                if abs(a) > 1e-9:
                    worst = max(worst, abs(a - b) / abs(a))
                else:
                    worst = max(worst, abs(a - b))
            if worst > MAX_REL_DIFF:
                total_bad += 1
                print(f'  [不一致] {d} {f} 最大相对偏差={worst:.4f}')
    if total_bad == 0:
        print('OK: 研究管线(pandas) 与 引擎(stdlib) 在所有抽查日期/因子上完全一致（偏差<=%.3f）' % MAX_REL_DIFF)
    else:
        print(f'FAIL: {total_bad} 个因子-日期组合不一致，请检查实现')
        sys.exit(1)


if __name__ == '__main__':
    main()
