# -*- coding: utf-8 -*-
"""每日因子诊断与优化建议：名单追踪 + 因子 IC 诊断 + 月度权重校验。

供 daily_stock_pick.py 追加报告「八、因子诊断与优化建议」；也可独立运行调试。
- 名单追踪：读 data/picks_history.json（daily_stock_pick 每日记录 top-N），算每期名单至今等权收益 vs 沪深300。
- IC 诊断：从 stock_daily 周频截面（近 ~10 周）算方案因子 vs 未来 5 日收益的 rank IC，标出近期衰减因子。
- 月度权重校验：用 research_panel.pkl 滚动评估当前方案 vs 候选；仅当候选持续跑赢才建议调权（防过拟合，权重不日更）。

运行：系统 Python311（有 pandas）。
"""
import json
import math
import os
import sqlite3
import sys

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE, 'engine'))
sys.path.insert(0, os.path.join(BASE, 'scripts'))
DB = os.path.join(BASE, 'data', 'stock_data.db')
HIST_PATH = os.path.join(BASE, 'data', 'picks_history.json')
PANEL_PATH = os.path.join(BASE, 'data', 'research_panel.pkl')

FACTOR_CN = {
    'bp': '账面市值比', 'ep_ttm': '盈余收益率', 'roe_ttm': '净资产收益率',
    'gross_margin': '毛利率', 'op_cf_ratio': '现金流/净利', 'vol_60d': '60日波动',
    'ln_cap': '总市值(ln)', 'debt_ratio': '负债率', 'rev_growth_yr': '营收增速',
    'profit_growth_yr': '净利增速', 'mom_12m1m': '动量12-1月', 'liq_20d': '流动性20日',
    'turnover_20d': '换手20日', 'ma_dev_20': '均线偏离', 'rsi_14': 'RSI14',
    'rev_5d': '5日反转', 'rev_10d': '10日反转', 'mom_1m': '动量1月',
}


def _bench_return(conn, d0, d1):
    """沪深300 (000300) 在 [d0,d1] 的收益；缺任一日期返回 None。"""
    r = conn.execute(
        "SELECT close_index FROM index_daily WHERE trade_date=? AND index_code='000300'", (d0,)).fetchone()
    r2 = conn.execute(
        "SELECT close_index FROM index_daily WHERE trade_date=? AND index_code='000300'", (d1,)).fetchone()
    if r and r2 and r[0] > 0:
        return r2[0] / r[0] - 1
    return None


def track_picks_md(date_str):
    """历史名单至今表现（等权）vs 沪深300。"""
    if not os.path.exists(HIST_PATH):
        return '> 暂无历史名单记录（首次运行后次日开始追踪）。'
    with open(HIST_PATH, encoding='utf-8') as f:
        hist = json.load(f)
    conn = sqlite3.connect(DB)
    lines = ['#### 8.1 历史名单表现追踪（至今）', '']
    lines.append('| 名单日 | 股票数 | 名单等权至今 | 沪深300至今 | 超额 |')
    lines.append('|---|---|---|---|---|')
    shown = 0
    for past in sorted(hist):
        if past >= date_str:
            continue
        codes = hist[past][:50]
        rets = []
        for c in codes:
            r = conn.execute('SELECT close_price FROM stock_daily WHERE stock_code=? AND trade_date=?', (c, past)).fetchone()
            r2 = conn.execute('SELECT close_price FROM stock_daily WHERE stock_code=? AND trade_date=?', (c, date_str)).fetchone()
            if r and r2 and r[0] and r[0] > 0:
                rets.append(r2[0] / r[0] - 1)
        if not rets:
            continue
        pr = sum(rets) / len(rets)
        b = _bench_return(conn, past, date_str)
        if b is None:
            lines.append(f'| {past} | {len(codes)} | {pr * 100:+.1f}% | — | — |')
        else:
            lines.append(f'| {past} | {len(codes)} | {pr * 100:+.1f}% | {b * 100:+.1f}% | {(pr - b) * 100:+.1f}pp |')
        shown += 1
    conn.close()
    if not shown:
        return '> 暂无完整历史窗口可追踪（需名单日早于今日且有行情）。'
    lines.append('')
    lines.append('> 说明：等权持有名单至今（未换手），个股停牌则该日不计入；分红未计入，短期窗口影响小。')
    lines.append('')
    return '\n'.join(lines)


def ic_diagnosis_md(date_str, weights):
    """周频截面 IC：方案因子 vs 未来 5 日收益（rank 相关），标出近期衰减。"""
    try:
        from factor_calc_stdlib import FactorCalcStdlib
        import pandas as pd
    except ImportError as e:
        return f'> IC 诊断依赖 factor_calc_stdlib/pandas，失败: {e}'
    conn = sqlite3.connect(DB)
    all_dates = [r[0] for r in conn.execute(
        "SELECT DISTINCT trade_date FROM stock_daily WHERE trade_date<=? ORDER BY trade_date", (date_str,))]
    conn.close()
    if len(all_dates) < 60:
        return '> 历史交易日不足，跳过 IC 诊断。'
    fc = FactorCalcStdlib()
    stocks = fc.get_all_stocks(date_str)
    snapshots = all_dates[-55::5]  # 近 ~10 个周频快照
    usable = [t for t in snapshots if any(d > t for d in all_dates[-10:])]

    # 预取快照日与快照+5日的 close，算 forward 收益
    conn = sqlite3.connect(DB)
    closes = {}
    for t in usable:
        nxt = None
        for d in all_dates:
            if d > t:
                nxt = d
                break
        if nxt is None:
            continue
        m0 = dict(conn.execute("SELECT stock_code, close_price FROM stock_daily WHERE trade_date=?", (t,)).fetchall())
        m1 = dict(conn.execute("SELECT stock_code, close_price FROM stock_daily WHERE trade_date=?", (nxt,)).fetchall())
        fwd = {s: m1[s] / m0[s] - 1 for s in m0 if s in m1 and m0[s] > 0}
        closes[t] = (fwd, nxt)

    lines = ['#### 8.2 因子 IC 诊断（近 %d 周截面，因子 vs 未来 5 日收益）' % len(usable), '']
    lines.append('| 因子 | 方向 | 近%d个快照 IC | 有效快照 | 判断 |' % len(usable))
    lines.append('|---|---|---|---|---|')
    for f, w in weights.items():
        ics = []
        n_ok = 0
        for t, (fwd, nxt) in closes.items():
            try:
                data = fc.get_factors(list(fwd.keys()), [f], t)
            except Exception:  # noqa: BLE001
                continue
            vals = {}
            for s, d in data.items():
                v = d.get(f)
                if v is not None and not (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
                    vals[s] = v
            common = [s for s in fwd if s in vals]
            if len(common) < 30:
                continue
            df = pd.DataFrame({'x': [vals[s] for s in common], 'y': [fwd[s] for s in common]})
            ic = df['x'].corr(df['y'], method='spearman')
            if ic == ic:
                ics.append(ic)
                n_ok += 1
        if not ics:
            lines.append(f'| {FACTOR_CN.get(f, f)} | {fc.factor_direction(f)} | — | 0 | 无有效快照 |')
            continue
        mean_ic = sum(ics) / len(ics)
        dirn = fc.factor_direction(f)
        # 判断：方向对齐 & |IC| 尚可 → 有效；否则衰减/失效
        if dirn * mean_ic > 0.02:
            judge = '有效'
        elif abs(mean_ic) < 0.02:
            judge = '中性（区分度弱）'
        else:
            judge = '⚠ 方向反了/失效'
        lines.append(f'| {FACTOR_CN.get(f, f)} | {dirn} | {mean_ic:+.3f} | {n_ok} | {judge} |')
    lines.append('')
    lines.append('> IC = 因子值与未来 5 日收益的秩相关（越大越有效）；与注册表方向同号且 |IC|≥0.02 判为有效。'
                 ' 单因子短期 IC 波动大，仅供诊断，不构成当日调权依据。')
    lines.append('')
    return '\n'.join(lines)


def panel_validation_md(weights):
    """月度权重校验：research_panel.pkl 滚动评估当前方案 vs 候选。"""
    if not os.path.exists(PANEL_PATH):
        return '> `research_panel.pkl` 缺失（先跑 `factor_research.py` 重建），跳过月度权重校验。'
    try:
        import pandas as pd
        import numpy as np
        from validate_daily_schemes import run_config, metrics, DIR
    except ImportError as e:
        return f'> 月度校验依赖 pandas/validate_daily_schemes，失败: {e}'
    panel = pd.read_pickle(PANEL_PATH)['panel']
    dates = sorted(panel['trade_date'].unique())
    if not dates:
        return '> 面板为空。'
    # 最近 36 个月
    recent_start = dates[-37] if len(dates) > 37 else dates[0]
    recent = panel[panel['trade_date'] >= recent_start]
    n50 = 50
    candidates = [
        ('当前', weights, n50),
        ('bp0.3+ep0.2+roe0.15+毛利0.1+现金流0.1+低波0.15',
         {'bp': 0.3, 'ep_ttm': 0.2, 'roe_ttm': 0.15, 'gross_margin': 0.1, 'op_cf_ratio': 0.1, 'vol_60d': 0.15}, 50),
        ('当前+小市值0.05', dict(weights, **{'ln_cap': 0.05}), n50),
        ('纯价值 bp0.6+ep0.4', {'bp': 0.6, 'ep_ttm': 0.4}, 30),
    ]
    lines = ['#### 8.3 月度权重校验（research_panel.pkl 滚动）', '']
    lines.append('> 面板数据截至 %s。仅作参考：**权重建议月度复核，不日更**（防过拟合）。' % dates[-1])
    lines.append('')
    lines.append('| 方案 | 最近%d月总收益 | 夏普 | 回撤 |' % len(recent['trade_date'].unique()))
    lines.append('|---|---|---|---|')
    rows = []
    for name, w, n in candidates:
        try:
            rets, _ = run_config(recent, w, n)
            total, annual, sharpe, mdd = metrics(rets)
            rows.append((name, total, sharpe, mdd))
            lines.append(f'| {name} | {total * 100:+.1f}% | {sharpe:+.2f} | {mdd * 100:.1f}% |')
        except Exception as e:  # noqa: BLE001
            lines.append(f'| {name} | 计算失败: {e} | | |')
    lines.append('')
    if rows:
        best = max(rows, key=lambda r: r[2] if r[2] == r[2] else -9)
        if best[0] != '当前' and best[2] > (rows[0][2] if rows[0][2] == rows[0][2] else 9):
            lines.append(f'> ⚠ 候选「{best[0]}」近期夏普最高（{best[2]:+.2f}）且高于当前——建议**月度复核时**考虑微调权重，勿当日追改。')
        else:
            lines.append('> 当前方案近期表现未明显落后于候选，**无需调整权重**。')
    lines.append('')
    return '\n'.join(lines)


def build_optimization_md(date_str, weights, name_map=None, images_dirs=None):
    md = ['', '## 九、因子诊断与优化建议', '']
    md.append(track_picks_md(date_str))
    md.append(ic_diagnosis_md(date_str, weights))
    md.append(panel_validation_md(weights))
    return '\n'.join(md)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', default='2026-08-11')
    a = ap.parse_args()
    w = {'bp': 0.3, 'ep_ttm': 0.2, 'roe_ttm': 0.15, 'gross_margin': 0.1, 'op_cf_ratio': 0.1, 'vol_60d': 0.15, 'ln_cap': 0.10}
    print(build_optimization_md(a.date, w))
