# -*- coding: utf-8 -*-
"""基于研究面板的快速策略对比（不重算因子，秒级出结果）。"""
import pickle
import os
import numpy as np
import pandas as pd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
panel = pickle.load(open(os.path.join(BASE, 'data', 'research_panel.pkl'), 'rb'))['panel']

CONFIGS = [
    ('动量', {'mom_12m1m': 1.0}, 20),
    ('价值', {'bp': 0.6, 'ep_ttm': 0.4}, 30),
    ('质量', {'roe_ttm': 0.35, 'gross_margin': 0.25, 'op_cf_ratio': 0.25, 'debt_ratio': 0.15}, 30),
    ('成长', {'rev_growth_yr': 0.5, 'profit_growth_yr': 0.5}, 30),
    ('低波', {'vol_60d': 1.0}, 30),
    ('多因子综合', {'bp': 0.3, 'ep_ttm': 0.2, 'roe_ttm': 0.15, 'gross_margin': 0.1, 'op_cf_ratio': 0.1, 'vol_60d': 0.15}, 50),
]
DIR = {'mom_12m1m': 1, 'bp': 1, 'ep_ttm': 1, 'roe_ttm': 1, 'gross_margin': 1,
       'op_cf_ratio': 1, 'debt_ratio': -1, 'rev_growth_yr': 1, 'profit_growth_yr': 1, 'vol_60d': -1}
RF = 0.03
SLIPPAGE, COMMISSION, STAMP = 0.002, 0.0003, 0.001


def run_config(weights, n):
    dates = sorted(panel['trade_date'].unique())
    rets, turns = [], []
    prev = set()
    for i, dt in enumerate(dates):
        g = panel[panel['trade_date'] == dt]
        if len(g) < n:
            continue
        score = pd.Series(0.0, index=g.index)
        for f, w in weights.items():
            s = g[f].astype(float)
            lo, hi = s.quantile(0.01), s.quantile(0.99)
            s = s.clip(lo, hi)
            mu, sd = s.mean(), s.std()
            if sd and sd > 0:
                s = (s - mu) / sd
            score += w * DIR[f] * s.fillna(0)
        top_rows = score.nlargest(n).index
        picks = set(g.loc[top_rows, 'stock_code'])
        fwd = g.loc[list(top_rows), 'forward_ret'].dropna()
        if len(fwd):
            turn = 1 - len(picks & prev) / len(picks) if prev else 1.0
            cost = turn * (2 * SLIPPAGE + 2 * COMMISSION + STAMP)
            rets.append(fwd.mean() - cost)
            turns.append(turn)
        prev = picks
    return rets, turns


def metrics(rets):
    if not rets:
        return (0, 0, 0, 0)
    r = np.array(rets)
    cum = np.cumprod(1 + r)
    total = cum[-1] - 1
    n = len(r)
    annual = (1 + total) ** (12.0 / n) - 1
    vol = np.std(r) * np.sqrt(12)
    sharpe = ((r - RF / 12).mean() * 12) / vol if vol > 0 else 0
    peak = np.maximum.accumulate(cum)
    mdd = np.min(cum / peak - 1)
    return (total, annual, sharpe, mdd)


def main():
    rows = []
    for name, weights, n in CONFIGS:
        rets, turns = run_config(weights, n)
        total, annual, sharpe, mdd = metrics(rets)
        rows.append((name, len(rets), total, annual, sharpe, mdd, np.mean(turns)))
    df = pd.DataFrame(rows, columns=['策略', '月数', '总收益', '年化', '夏普', '最大回撤', '均换手'])
    pd.set_option('display.width', 220)
    print(df.round(4).to_string(index=False))


if __name__ == '__main__':
    main()
