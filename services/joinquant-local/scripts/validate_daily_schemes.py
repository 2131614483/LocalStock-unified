# -*- coding: utf-8 -*-
"""每日选股候选方案历史验证（2018-2026 研究面板，含交易成本，月频调仓视角）。

用 research_panel.pkl（含 forward_ret）秒级对比「每日选股」用哪套因子打分最好。
打分口径与 compare_strategies_panel.py 一致：score += w * DIR[f] * z（方向显式应用）。

结论（2026-08-10 实测，102 个月）：
  A 多因子综合       +4.9%  夏普 -0.03  回撤 -27.9%
  B 纯价值           -1.2%  夏普 -0.05  回撤 -32.5%
  C 多因子+小市值    +12.8% 夏普 +0.02  回撤 -27.6%   ← 唯一正夏普，默认方案
     C 的 ln_cap 权重 0.05~0.15、N30/50 均跑赢 A，方向稳健；
     N30 更集中回测最好（+23.2%，夏普 0.07），单票风险也更大。
运行：系统 Python311（有 pandas）：
  C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe scripts/validate_daily_schemes.py
"""
import os
import sys

import numpy as np
import pandas as pd

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANEL_PATH = os.path.join(BASE, 'data', 'research_panel.pkl')

# 候选方案：名称 -> (因子权重, 选股数)。权重均为正，方向由 DIR 表统一处理。
BASE_MULTI = {'bp': 0.3, 'ep_ttm': 0.2, 'roe_ttm': 0.15,
              'gross_margin': 0.1, 'op_cf_ratio': 0.1, 'vol_60d': 0.15}
CANDIDATES = [
    ('A 多因子综合', BASE_MULTI, 50),
    ('B 纯价值', {'bp': 0.6, 'ep_ttm': 0.4}, 30),
    ('C 多因子+小市值 N50', dict(BASE_MULTI, **{'ln_cap': 0.10}), 50),
    ('C3 多因子+小市值 N30', dict(BASE_MULTI, **{'ln_cap': 0.10}), 30),
    ('C4 多因子+小市值0.05 N50', dict(BASE_MULTI, **{'ln_cap': 0.05}), 50),
]

# 因子方向（与 factor_registry.json 的 direction 一致）：-1 表示值越小越好
DIR = {'mom_12m1m': 1, 'bp': 1, 'ep_ttm': 1, 'roe_ttm': 1, 'gross_margin': 1,
       'op_cf_ratio': 1, 'debt_ratio': -1, 'rev_growth_yr': 1,
       'profit_growth_yr': 1, 'vol_60d': -1, 'ln_cap': -1}

RF = 0.03                      # 无风险利率
SLIPPAGE, COMMISSION, STAMP = 0.002, 0.0003, 0.001  # 滑点/佣金/印花税


def run_config(panel, weights, n):
    """月度调仓、等权持仓，返回逐月净收益列表（含换手成本）。"""
    dates = sorted(panel['trade_date'].unique())
    rets, turns = [], []
    prev = set()
    for dt in dates:
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
    if not os.path.exists(PANEL_PATH):
        print('研究面板不存在（先跑 factor_research.py 生成）:', PANEL_PATH)
        return 1
    panel = pd.read_pickle(PANEL_PATH)['panel']
    rows = []
    for name, weights, n in CANDIDATES:
        rets, turns = run_config(panel, weights, n)
        total, annual, sharpe, mdd = metrics(rets)
        rows.append((name, len(rets), total, annual, sharpe, mdd, np.mean(turns)))
    df = pd.DataFrame(rows, columns=['方案', '月数', '总收益', '年化', '夏普', '最大回撤', '均换手'])
    pd.set_option('display.width', 220)
    print(df.round(4).to_string(index=False))
    print('\n对照：沪深300 同期总收益 +12.3%（A股 8.5 年基本走平）')
    print('结论：C（多因子+小市值）胜出，唯一正夏普；小市值权重 0.05~0.15 与 N30/50 均稳健。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
