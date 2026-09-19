# -*- coding: utf-8 -*-
"""
因子研究管线：IC 分析、十分位分层、因子相关性、分市场状态检验。

流程（为什么这样设计）：
1. 每月最后一个交易日作为调仓日，计算全市场股票池的因子截面值；
2. 持有到下月调仓日的收益为 forward return（下月收益）；
3. Rank IC = 因子值与下月收益的 Spearman 秩相关，衡量因子的单调预测力；
   IC_IR = IC 均值/IC 标准差（>0.3 表示因子稳定）；IC>0 比例衡量方向一致性；
4. 十分位分层：按因子值分 10 组看等权组合下月收益单调性（Top-Bottom 多空价差）；
5. 因子相关性矩阵：选低相关因子配对（避免多重共线性）；
6. 分市场状态（2018-19 熊 / 2020-21 牛 / 2022-24 熊 / 2025-26 反弹）检验因子在不同环境下的稳定性。

运行：C:\\Users\\he\\AppData\\Local\\Programs\\Python\\Python311\\python.exe scripts/factor_research.py
输出：docs/project-docs/factor_report_*.md
"""
import os
import sys
import pickle
import json
from datetime import datetime

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from factor_lib import FactorCalculator, DB_PATH

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANEL_PATH = os.path.join(BASE_DIR, 'data', 'research_panel.pkl')
REPORT_DIR = os.path.join(BASE_DIR, 'docs', 'project-docs')

SUB_PERIODS = [
    ('2018-2019 熊市', '2018-01-01', '2019-12-31'),
    ('2020-2021 牛市', '2020-01-01', '2021-12-31'),
    ('2022-2024 熊市/震荡', '2022-01-01', '2024-10-31'),
    ('2025-2026 反弹', '2025-01-01', '2026-07-31'),
]

# 默认研究的因子（覆盖各方向）
DEFAULT_FACTORS = [
    'mom_1m', 'mom_3m', 'mom_6m', 'mom_12m1m',
    'rev_5d', 'vol_60d', 'liq_20d', 'turnover_20d',
    'rsi_14', 'ma_dev_20', 'ln_cap',
    'ep_ttm', 'bp', 'roe_ttm', 'gross_margin', 'debt_ratio', 'op_cf_ratio',
    'rev_growth_yr', 'profit_growth_yr',
]


class FactorResearch:
    """因子研究管线。"""

    def __init__(self, db_path=DB_PATH, start='2018-01-01', end='2026-07-31',
                 factors=None, exclude_financial=True, min_codes=100):
        self.calc = FactorCalculator(db_path)
        self.start = start
        self.end = end
        self.factors = factors or list(DEFAULT_FACTORS)
        self.exclude_financial = exclude_financial
        self.min_codes = min_codes
        self.panel = None

    # ------------------------------------------------------------------
    # 调仓日
    # ------------------------------------------------------------------
    def get_month_end_dates(self):
        """每月最后一个交易日。"""
        sql = ("SELECT trade_date FROM trade_calendar "
               "WHERE trade_date BETWEEN ? AND ? AND is_trading_day=1 "
               "ORDER BY trade_date")
        rows = self.calc.conn.execute(sql, (self.start, self.end)).fetchall()
        df = pd.DataFrame({'d': [r[0] for r in rows]})
        df['ym'] = df['d'].str[:7]
        return df.groupby('ym')['d'].max().sort_values().tolist()

    # ------------------------------------------------------------------
    # 面板构建
    # ------------------------------------------------------------------
    def build_panel(self, save=True, verbose=True):
        """逐月构建因子截面 + 下月收益面板，缓存到 data/research_panel.pkl。"""
        dates = self.get_month_end_dates()
        if len(dates) < 3:
            raise RuntimeError('调仓日不足')
        ph = ','.join('?' * len(dates))
        closes = pd.read_sql_query(
            'SELECT trade_date, stock_code, close_price FROM stock_daily '
            'WHERE trade_date IN (' + ph + ') AND trade_status=1 AND close_price>0',
            self.calc.conn, params=dates)
        close_mx = closes.pivot_table(
            index='trade_date', columns='stock_code', values='close_price')
        rows = []
        for i, d in enumerate(dates):
            codes = self.calc.get_universe(d, exclude_financial=self.exclude_financial)
            if len(codes) < self.min_codes:
                continue
            fdf = self.calc.compute_factors(d, codes, self.factors)
            fdf = fdf.reset_index().rename(columns={'index': 'stock_code'})
            fdf['trade_date'] = d
            nd = dates[i + 1] if i + 1 < len(dates) else None
            fdf['next_date'] = nd
            fdf['close'] = fdf['stock_code'].map(close_mx.loc[d])
            if nd:
                fdf['next_close'] = fdf['stock_code'].map(close_mx.loc[nd])
            else:
                fdf['next_close'] = np.nan
            fdf['forward_ret'] = fdf['next_close'] / fdf['close'] - 1.0
            rows.append(fdf)
            if verbose and (i + 1) % 12 == 0:
                print(f'  已处理 {i+1}/{len(dates)} 个月 ({d})')
        panel = pd.concat(rows, ignore_index=True)
        panel["period"] = panel["trade_date"].apply(self._period_of)
        self.panel = panel
        if save:
            os.makedirs(os.path.dirname(PANEL_PATH), exist_ok=True)
            with open(PANEL_PATH, "wb") as f:
                pickle.dump({"panel": panel, "factors": self.factors,
                "start": self.start, "end": self.end}, f)
        return panel

    def _period_of(self, d):
        for name, s, e in SUB_PERIODS:
            if s <= d <= e:
                return name
        return "其他"

    def load_panel(self):
        with open(PANEL_PATH, "rb") as f:
            data = pickle.load(f)
        self.panel = data["panel"]
        self.factors = data["factors"]
        return self.panel

    # ------------------------------------------------------------------
    # 分析：IC
    # ------------------------------------------------------------------
    def ic_analysis(self, min_codes=30):
        """Rank IC：每截面上因子值与下月收益的 Spearman 秩相关。"""
        df = self.panel.dropna(subset=["forward_ret"])
        results, series = {}, {}
        for f in self.factors:
            rows = []
            for d, g in df.groupby("trade_date"):
                v = g[[f, "forward_ret"]].dropna()
                if len(v) >= min_codes:
                    ic = v[f].corr(v["forward_ret"], method="spearman")
                    rows.append((d, ic))
            if not rows:
                continue
            s = pd.DataFrame(rows, columns=["date", "IC"])
            series[f] = s
            ic_mean = s["IC"].mean()
            ic_std = s["IC"].std()
            results[f] = {
                "IC_mean": ic_mean,
                "IC_std": ic_std,
                "IC_IR": ic_mean / ic_std if ic_std and ic_std > 0 else np.nan,
                "IC_gt0": (s["IC"] > 0).mean(),
                "n": len(s),
            }
        return results, series

    # ------------------------------------------------------------------
    # 分析：十分位分层
    # ------------------------------------------------------------------
    def decile_analysis(self, n_deciles=10, min_codes=100):
        """按月按因子值分 10 组，看各组等下月收益（Top-Bottom 价差）。"""
        df = self.panel.dropna(subset=["forward_ret"])
        out = {}
        for f in self.factors:
            monthly = []
            for d, g in df.groupby("trade_date"):
                v = g[[f, "forward_ret"]].dropna()
                if len(v) < min_codes:
                    continue
                try:
                    v["decile"] = pd.qcut(v[f].rank(method="first"), n_deciles, labels=False)
                except ValueError:
                    continue
                monthly.append(v.groupby("decile")["forward_ret"].mean())
            if not monthly:
                continue
            m = pd.DataFrame(monthly)
            top = m[n_deciles - 1].mean()
            bottom = m[0].mean()
            out[f] = {
                "top": top, "bottom": bottom,
                "spread": top - bottom,
                "monotonic": m.mean().values.tolist(),
            }
        return out

    def correlation_analysis(self, min_codes=30):
        df = self.panel
        cors = pd.DataFrame(index=self.factors, columns=self.factors, dtype=float)
        for i, f1 in enumerate(self.factors):
            for f2 in self.factors[i + 1:]:
                vals = []
                for d, g in df.groupby("trade_date"):
                    v = g[[f1, f2]].dropna()
                    if len(v) >= min_codes:
                        vals.append(v[f1].rank().corr(v[f2].rank()))
                if vals:
                    c = float(np.nanmean(vals))
                    cors.loc[f1, f2] = c
                    cors.loc[f2, f1] = c
        for f in self.factors:
            cors.loc[f, f] = 1.0
        return cors

    def sub_period_analysis(self, ic_series):
        rows = {}
        for f, s in ic_series.items():
            periods = {}
            for name, p_start, p_end in SUB_PERIODS:
                seg = s[(s["date"] >= p_start) & (s["date"] <= p_end)]
                if len(seg) > 0:
                    periods[name] = seg["IC"].mean()
            rows[f] = periods
        return pd.DataFrame(rows).T

    def generate_report(self):
        ic_results, ic_series = self.ic_analysis()
        decile = self.decile_analysis()
        corr = self.correlation_analysis()
        sub = self.sub_period_analysis(ic_series)
        os.makedirs(REPORT_DIR, exist_ok=True)
        fname = "factor_report_" + datetime.now().strftime("%Y%m%d_%H%M") + ".md"
        path = os.path.join(REPORT_DIR, fname)
        L = []
        L.append("# 因子研究报告")
        L.append("")
        L.append("- 生成时间: " + datetime.now().strftime("%Y-%m-%d %H:%M"))
        L.append("- 调仓: 每月末; 持有下月")
        L.append("")
        L.append("## 一、因子 IC 分析")
        L.append("| 因子 | 方向 | IC均值 | IC_IR | IC>0比例 | 月数 |")
        L.append("|---|---|---|---|---|---|")
        for f in self.factors:
            if f not in ic_results:
                continue
            r = ic_results[f]
            d = self.calc.factor_direction(f)
            L.append("| %s | %+d | %.4f | %.3f | %.2f | %d |" % (f, d, r["IC_mean"], r["IC_IR"], r["IC_gt0"], r["n"]))
        L.append("")
        L.append("## 二、十分位分层（下月等权收益）")
        L.append("| 因子 | D1(低) | D10(高) | 价差 | 单调性 |")
        L.append("|---|---|---|---|---|")
        for f in self.factors:
            if f not in decile:
                continue
            dc = decile[f]
            mono = "单调" if dc["monotonic"][-1] > dc["monotonic"][0] else "非单调"
            L.append("| %s | %.4f | %.4f | %+.4f | %s |" % (f, dc["bottom"], dc["top"], dc["spread"], mono))
        L.append("")
        L.append("## 三、分市场状态 IC")
        hdr = "| 因子 | " + " | ".join(n for n, _, _ in SUB_PERIODS) + " |"
        L.append(hdr)
        L.append("|---|" + "---|" * len(SUB_PERIODS))
        for f in self.factors:
            if f not in sub.index:
                continue
            vals = " | ".join("%.4f" % sub.loc[f][n] if n in sub.columns and not pd.isna(sub.loc[f][n]) else "-" for n, _, _ in SUB_PERIODS)
            L.append("| %s | %s |" % (f, vals))
        L.append("")
        L.append("## 四、因子相关性矩阵")
        L.append("```")
        L.append(corr.round(2).to_string())
        L.append("```")
        open(path, "w", encoding="utf-8").write("\n".join(L))
        print("报告已写入:", path)
        return path

def main():
    print("构建因子面板 ...")
    r = FactorResearch()
    panel = r.build_panel()
    print("面板:", panel.shape, " 调仓月数:", panel["trade_date"].nunique())
    ic, ic_series = r.ic_analysis()
    print("\nIC 汇总:")
    for f, v in sorted(ic.items(), key=lambda kv: -abs(kv[1]["IC_mean"])):
        print("  %-16s IC=%.4f IC_IR=%.3f IC>0=%.2f" % (f, v["IC_mean"], v["IC_IR"], v["IC_gt0"]))
    path = r.generate_report()
    print("\n完成。报告:", path)

if __name__ == "__main__":
    main()
