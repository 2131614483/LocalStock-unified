# -*- coding: utf-8 -*-
"""
多因子组合回测引擎（pandas 版，用于快速迭代参数/权重）。

设计要点（为什么这样写）：
1. **参数化配置** StrategyConfig：因子+权重、选股数 N、调仓频率、股票池过滤、成本模型、基准、区间，
   便于做横向对比（不同权重/选股数/成本假设）。
2. **打分流程**：每因子截面 winsorize(1%/99%) 去极端 → z-score 标准化 → 按因子方向取正负 → 加权求和。
   （方向来自 factor_registry.json；z-score 比原始值更适合跨因子加总）
3. **组合构建**：得分 top-N，等权，月频调仓；用下月收益计算组合收益；换手率按集合差异算。
4. **成本模型**：买入付滑点+佣金，卖出付滑点+佣金+印花税；调仓按换手率计成本。
5. **指标口径**：与 web 引擎 backtest_engine._calculate_metrics 对齐
   （totalReturns/annualReturns/sharpe/maxDrawdown/volatility/alpha/beta/IR，无风险 3%）。

运行：C:\\Users\\he\\AppData\\Local\\Programs\\Python\\Python311\\python.exe scripts/multi_factor_backtest.py
"""
import os
import sys
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from factor_lib import FactorCalculator, DB_PATH

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@dataclass
class StrategyConfig:
    name: str = "strategy"
    factor_weights: dict = field(default_factory=dict)   # {'mom_12m1m': 0.3, 'bp': 0.3}
    n_stocks: int = 50
    start: str = "2018-01-01"
    end: str = "2026-07-31"
    benchmark: str = "000300"
    slippage: float = 0.002
    commission: float = 0.0003
    stamp_tax: float = 0.001
    exclude_financial: bool = True

class MultiFactorBacktest:
    RF_ANNUAL = 0.03

    def __init__(self, db_path=DB_PATH, calc=None):
        self.calc = calc or FactorCalculator(db_path)
        self.conn = self.calc.conn

    def month_end_dates(self, start, end):
        sql = ("SELECT trade_date FROM trade_calendar " "WHERE trade_date BETWEEN ? AND ? AND is_trading_day=1 ORDER BY trade_date")
        rows = self.conn.execute(sql, (start, end)).fetchall()
        df = pd.DataFrame({"d": [r[0] for r in rows]})
        df["ym"] = df["d"].str[:7]
        return df.groupby("ym")["d"].max().sort_values().tolist()

    def compute_scores(self, date, universe, weights):
        df = self.calc.compute_factors(date, universe, list(weights.keys()))
        score = pd.Series(0.0, index=universe)
        for f, w in weights.items():
            s = df[f].astype(float)
            lo, hi = s.quantile(0.01), s.quantile(0.99)
            s = s.clip(lo, hi)
            mu, sd = s.mean(), s.std()
            if sd and sd > 0:
                s = (s - mu) / sd
            d = self.calc.factor_direction(f)
            score += w * d * s.fillna(0)
        return score

    def run(self, cfg):
        dates = self.month_end_dates(cfg.start, cfg.end)
        if len(dates) < 3:
            raise RuntimeError("调仓日不足")
        ph = ",".join("?" * len(dates))
        closes = pd.read_sql_query(
            "SELECT trade_date, stock_code, close_price FROM stock_daily "
            "WHERE trade_date IN (" + ph + ") AND close_price>0",
            self.conn, params=dates)
        close_mx = closes.pivot_table(index="trade_date", columns="stock_code", values="close_price")
        rows = []
        prev_picks = set()
        for i, d in enumerate(dates):
            universe = self.calc.get_universe(d, exclude_financial=cfg.exclude_financial)
            if len(universe) < cfg.n_stocks:
                continue
            scores = self.compute_scores(d, universe, cfg.factor_weights)
            picks = set(scores.nlargest(cfg.n_stocks).index)
            nd = dates[i + 1] if i + 1 < len(dates) else None
            if nd is None:
                break
            cc = close_mx.loc[d]; nn = close_mx.loc[nd]
            frs = []
            for c in picks:
                p0, p1 = cc.get(c), nn.get(c)
                if p0 and p1 and p0 > 0:
                    frs.append(p1 / p0 - 1)
            ret = float(np.mean(frs)) if frs else 0.0
            if prev_picks:
                turn = 1 - len(picks & prev_picks) / len(picks)
            else:
                turn = 1.0
            cost = turn * (2 * cfg.slippage + 2 * cfg.commission + cfg.stamp_tax)
            ret -= cost
            rows.append((d, nd, ret, turn))
            prev_picks = picks
        df = pd.DataFrame(rows, columns=["d", "nd", "ret", "turnover"])
        if df.empty:
            return {"metrics": {}, "df": df}
        bench = self._benchmark_returns(cfg.benchmark, list(zip(df["d"], df["nd"])))
        df["bench"] = bench
        metrics = self._metrics(df["ret"].values, df["bench"].values)
        metrics["avg_turnover"] = round(float(df["turnover"].mean()), 4)
        metrics["sample"] = df["sample"].tolist() if "sample" in df else []
        return {"metrics": metrics, "df": df}

    def _benchmark_returns(self, code, periods):
        dates = sorted({x for p in periods for x in p})
        ph = ",".join("?" * len(dates))
        rows = self.conn.execute(
            "SELECT trade_date, close_index FROM index_daily "
            "WHERE index_code=? AND trade_date IN (" + ph + ")",
            (code, *dates)).fetchall()
        cm = dict(rows)
        out = []
        for d, nd in periods:
            a, b = cm.get(d), cm.get(nd)
            out.append(b / a - 1 if a and b and a > 0 else 0.0)
        return np.array(out)

    def _metrics(self, rets, bench):
        n = len(rets)
        if n == 0:
            return {}
        cum = np.cumprod(1 + rets)
        total = cum[-1] - 1
        annual = (1 + total) ** (12.0 / n) - 1
        vol = float(np.std(rets) * np.sqrt(12)) if n > 1 else 0.0
        excess = rets - self.RF_ANNUAL / 12.0
        sharpe = (excess.mean() * 12) / vol if vol > 0 else 0.0
        peak = np.maximum.accumulate(cum)
        mdd = float(np.min(cum / peak - 1))
        b = 0.0
        if n > 1 and np.std(bench) > 0:
            b = float(np.cov(rets, bench)[0, 1] / np.var(bench))
        rf_m = self.RF_ANNUAL / 12.0
        a = (rets.mean() - rf_m) - b * (bench.mean() - rf_m)
        te = float(np.std(rets - bench) * np.sqrt(12)) if n > 1 else 0.0
        ir = ((rets - bench).mean() * 12) / te if te > 0 else 0.0
        win = float((rets > 0).mean()) if n else 0.0
        return {
            "totalReturns": round(total, 4),
            "annualReturns": round(annual, 4),
            "maxDrawdown": round(mdd, 4),
            "sharpe": round(sharpe, 3),
            "volatility": round(vol, 4),
            "alpha": round(a * 12, 4),
            "beta": round(b, 3),
            "informationRatio": round(ir, 3),
            "winRate": round(win, 3),
            "n_months": n,
        }

    def compare_strategies(self, configs):
        out = []
        for cfg in configs:
            r = self.run(cfg)
            m = r["metrics"]
            out.append({
                "name": cfg.name, "n": m.get("n_months"),
                "totalReturns": m.get("totalReturns"), "annualReturns": m.get("annualReturns"),
                "sharpe": m.get("sharpe"), "maxDrawdown": m.get("maxDrawdown"),
                "volatility": m.get("volatility"), "alpha": m.get("alpha"), "beta": m.get("beta"),
                "IR": m.get("informationRatio"), "winRate": m.get("winRate"),
                "turnover": m.get("avg_turnover"),
            })
        return pd.DataFrame(out)

def main():
    bt = MultiFactorBacktest()
    configs = [
        StrategyConfig(name="动量(mom12m1m)", factor_weights={"mom_12m1m": 1.0}, n_stocks=50),
        StrategyConfig(name="价值(bp+ep)", factor_weights={"bp": 0.5, "ep_ttm": 0.5}, n_stocks=50),
        StrategyConfig(name="质量(roe+gm+debt)", factor_weights={"roe_ttm": 0.4, "gross_margin": 0.3, "debt_ratio": 0.3}, n_stocks=50),
        StrategyConfig(name="成长", factor_weights={"rev_growth_yr": 0.5, "profit_growth_yr": 0.5}, n_stocks=50),
        StrategyConfig(name="多因子综合", factor_weights={"mom_12m1m": 0.25, "bp": 0.25, "roe_ttm": 0.25, "vol_60d": 0.25}, n_stocks=50),
        StrategyConfig(name="低波", factor_weights={"vol_60d": 1.0}, n_stocks=50),
    ]
    df = bt.compare_strategies(configs)
    pd.set_option("display.width", 220)
    print(df.to_string(index=False))
    return df

if __name__ == "__main__":
    main()
