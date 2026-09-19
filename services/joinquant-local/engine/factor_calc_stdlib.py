# -*- coding: utf-8 -*-
"""
纯标准库因子计算器 —— web 引擎用（engine/backtest_engine.py 的子模块）。

与研究管线 scripts/factor_lib.py 共用 factor_registry.json 因子定义，保证口径一致。
不引入 pandas，只用 sqlite3 + 标准库。

技术因子：一次 SQL 拉取 lookback 天历史，Python 侧分组计算。
基本面因子：报告期 + 4 个月滞后对齐（declare_date 92% 为空），report_type='A' 合并，
市值 mkt_cap_total 单位「千元」x1000 转元，NULL 时用参考股本 x 收盘价推算。
因子值按 (factor, date) 缓存，月频调仓场景性能可控。
"""
import json
import math
import os
import sqlite3
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.environ.get('LOCALSTOCK_MARKET_DB') or os.path.join(BASE_DIR, 'data', 'stock_data.db')
REGISTRY_PATH = os.path.join(BASE_DIR, 'scripts', 'factor_registry.json')

# CSMAR 科目代码（与 scripts/factor_lib.py 一致，实证校验）
C_REVENUE = 'B001100000'
C_OPCOST = 'B001200000'
C_NETPROFIT = 'B002000000'
C_PARENT = 'B002000101'
C_EQUITY = 'A003100000'
C_EQUITY_ALL = 'A003000000'
C_TOTAL_ASSETS = 'A001000000'
C_TOTAL_LIAB = 'A002000000'
C_OPCF = 'C001000000'

FIN_KEYWORDS = ['银行', '证券', '保险', '信托', '期货', '金融', '租赁',
                '资管', '担保', '消金', '人寿', '人保', '财险']


class FactorCalcStdlib:
    """纯标准库多因子计算器。"""

    DISCLOSURE_LAG_MONTHS = 4
    REF_SHARES_WINDOW = ('2026-05-01', '2026-06-12')

    def __init__(self, conn=None):
        self.conn = conn or sqlite3.connect(DB_PATH)
        self.registry = self._load_registry()
        self._cache = {}        # (factor, date) -> {code: value}
        self._shares_ref = None
        self._fs_latest = {}    # (table, lag_date) -> {code: row}
        self._rep_tail = {}     # (table, lag_date) -> {code: [rows]}

    def _load_registry(self):
        with open(REGISTRY_PATH, encoding="utf-8") as f:
            return json.load(f)["factors"]

    def factor_direction(self, factor):
        return self.registry[factor]["direction"]

    def get_all_stocks(self, date_str, exclude_financial=True):
        sql = "SELECT s.stock_code, st.name, st.first_trade_date FROM stock_daily s JOIN stocks st ON s.stock_code = st.stock_code WHERE s.trade_date = ? AND s.trade_status = 1 AND s.close_price > 0 AND s.volume > 0 AND (s.limit_up IS NULL OR s.close_price < s.limit_up) AND (s.limit_down IS NULL OR s.close_price > s.limit_down) AND st.status = 1 AND st.market_type NOT IN (2, 8, 64)"
        rows = self.conn.execute(sql, (date_str,)).fetchall()
        out = []
        for code, name, ft in rows:
            if ft and ft <= date_str:
                age = (datetime.strptime(date_str, "%Y-%m-%d") - datetime.strptime(ft, "%Y-%m-%d")).days
                if age < int(120 * 7 / 5):
                    continue
            if exclude_financial and name:
                if any(k in name for k in FIN_KEYWORDS):
                    continue
            out.append(code)
        return out

    def _shares_for(self, code):
        if self._shares_ref is None:
            self._shares_ref = {}
            s, e = self.REF_SHARES_WINDOW
            rows = self.conn.execute(
                "SELECT stock_code, close_price, mkt_cap_total FROM stock_daily "
                "WHERE trade_date BETWEEN ? AND ? AND mkt_cap_total > 0", (s, e)).fetchall()
            tmp = {}
            for c, close, mkt in rows:
                if close and close > 0:
                    tmp.setdefault(c, []).append(float(mkt) * 1000.0 / float(close))
            for c, vals in tmp.items():
                vals.sort()
                self._shares_ref[c] = vals[len(vals) // 2]
        return self._shares_ref.get(code)

    def _mkt_cap_yuan(self, close, mkt, code):
        if mkt and mkt > 0:
            return float(mkt) * 1000.0
        if close and close > 0:
            shares = self._shares_for(code)
            if shares:
                return shares * float(close)
        return None

    def _cum_ret(self, rets, n):
        if len(rets) < n:
            return None
        r = 1.0
        for v in rets[-n:]:
            r *= (1.0 + v)
        return r - 1.0

    def _tech_value(self, f, rets, closes, highs, lows, amts, cap):
        p = self.registry[f].get("params", {})
        if f == "ln_cap":
            return math.log(cap) if cap and cap > 0 else None
        if f in ("mom_1m", "mom_3m", "mom_6m", "mom_12m"):
            return self._cum_ret(rets, p["window"])
        if f == "mom_12m1m":
            w, sk = p["window"], p["skip"]
            if len(rets) < w:
                return None
            r = 1.0
            for v in rets[-w:-sk]:
                r *= (1.0 + v)
            return r - 1.0
        if f in ("rev_5d", "rev_10d"):
            return self._cum_ret(rets, p["window"])
        if f in ("vol_20d", "vol_60d"):
            n = p["window"]
            if len(rets) < n:
                return None
            seg = rets[-n:]
            m = sum(seg) / n
            var = sum((x - m) ** 2 for x in seg) / (n - 1)
            return (var ** 0.5) * (252 ** 0.5)
        if f == "amplitude_20d":
            n = p["window"]
            if len(closes) < n:
                return None
            vals = []
            for i in range(len(closes) - n, len(closes)):
                if closes[i] and closes[i] > 0 and highs[i] is not None and lows[i] is not None:
                    vals.append((highs[i] - lows[i]) / closes[i])
            return sum(vals) / n if vals else None
        if f == "liq_20d":
            if len(amts) < p["window"]:
                return None
            avg = sum(amts[-p["window"]:]) / p["window"]
            return math.log(avg) if avg and avg > 0 else None
        if f == "turnover_20d":
            if len(amts) < p["window"] or not cap:
                return None
            avg = sum(amts[-p["window"]:]) / p["window"]
            return avg / cap if cap > 0 else None
        if f == "rsi_14":
            if len(rets) < p["window"] + 1:
                return None
            gains = losses = 0.0
            for v in rets[-(p["window"] + 1):]:
                if v > 0:
                    gains += v
                else:
                    losses += -v
            if losses == 0:
                return 100.0
            rs = gains / losses
            return 100.0 - 100.0 / (1.0 + rs)
        if f == "ma_dev_20":
            n = p["window"]
            if len(closes) < n:
                return None
            ma = sum(closes[-n:]) / n
            return closes[-1] / ma - 1.0 if ma > 0 else None
        return None

    def technical_factors(self, codes, factors, date_str):
        tech = [f for f in factors if self.registry[f]["data_source"] == "stock_daily"]
        if not tech or not codes:
            return {}
        start = (datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=450)).strftime("%Y-%m-%d")
        ph = ",".join("?" * len(codes))
        sql = ("SELECT stock_code, trade_date, close_price, dretwd, high_price, low_price, amount, mkt_cap_total FROM stock_daily " "WHERE stock_code IN (" + ph + ") AND trade_date BETWEEN ? AND ? " "AND trade_status = 1 AND close_price > 0 AND dretwd IS NOT NULL ORDER BY stock_code, trade_date")
        rows = self.conn.execute(sql, codes + [start, date_str]).fetchall()
        data = {}
        for code, dt, close, dret, hi, lo, amt, mkt in rows:
            data.setdefault(code, []).append((close, dret, hi, lo, amt, mkt))
        out = {f: {} for f in tech}
        for code in codes:
            d = data.get(code, [])
            if not d:
                continue
            closes = [x[0] for x in d]; rets = [x[1] for x in d]
            highs = [x[2] for x in d]; lows = [x[3] for x in d]; amts = [x[4] for x in d]
            cap = self._mkt_cap_yuan(closes[-1], d[-1][5], code)
            for f in tech:
                v = self._tech_value(f, rets, closes, highs, lows, amts, cap)
                if v is not None:
                    out[f][code] = float(v)
        return out

    def _fs_tail(self, table, lag_date, n=8, codes=None):
        # codes 过滤：单股查询（jqcompat get_fundamentals）时只取目标股票，避免全表扫描
        # 兼容性：codes=None 时行为与原先完全一致（批量因子计算走全表）
        key = (table, lag_date, tuple(sorted(codes)) if codes is not None else None)
        if key not in self._rep_tail:
            cols = {C_REVENUE, C_OPCOST, C_PARENT} if table == "fs_comins" else ({C_EQUITY, C_EQUITY_ALL, C_TOTAL_ASSETS, C_TOTAL_LIAB} if table == "fs_combas" else {C_OPCF})
            sel = ", ".join(["stock_code", "acc_period"] + sorted(cols))
            start = (datetime.strptime(lag_date, "%Y-%m-%d") - timedelta(days=1100)).strftime("%Y-%m-%d")
            q = ("SELECT " + sel + " FROM " + table + " WHERE report_type='A' AND acc_period BETWEEN ? AND ? "
                 "AND (acc_period LIKE '%-12-31' OR acc_period LIKE '%-06-30' OR acc_period LIKE '%-09-30' OR acc_period LIKE '%-03-31')")
            args = [start, lag_date]
            if codes is not None:
                ph = ",".join("?" * len(codes))
                q += " AND stock_code IN (" + ph + ")"
                args += list(codes)
            q += " ORDER BY stock_code, acc_period"
            rows = self.conn.execute(q, args).fetchall()
            tmp = {}
            for r in rows:
                code = r[0]
                rec = {'acc_period': r[1]}
                for _i, _col in enumerate(sorted(cols)):
                    rec[_col] = r[_i + 2]
                tmp.setdefault(code, []).append(rec)
            res = {}
            for code, recs in tmp.items():
                res[code] = recs[-n:]
            self._rep_tail[key] = res
        return self._rep_tail[key]

    def _fund_value(self, gi, gb, gf, cap, factors):
        def num(x):
            try:
                return None if x is None else float(x)
            except (TypeError, ValueError):
                return None
        def pd_(s):
            return datetime.strptime(s, "%Y-%m-%d") if s else None
        rev = cost = np_ = None
        ttm_np = ttm_rev = None
        ann_np = ann_rev = prev_ann_np = prev_ann_rev = None
        if gi:
            lr = gi[-1]
            P = pd_(lr["acc_period"])
            rev = num(lr.get(C_REVENUE)); cost = num(lr.get(C_OPCOST)); np_ = num(lr.get(C_PARENT))
            if P and P.month == 12 and P.day == 31:
                ttm_np, ttm_rev = np_, rev
            else:
                py = P.replace(year=P.year - 1)
                pv = next((x for x in gi if pd_(x["acc_period"]) == py), None)
                fy = datetime(P.year - 1, 12, 31)
                fyr = next((x for x in gi if pd_(x["acc_period"]) == fy), None)
                ttm_np, ttm_rev = np_, rev
                if np_ is None or rev is None:
                    ttm_np = ttm_rev = None
                elif pv and fyr and num(pv.get(C_PARENT)) is not None and num(fyr.get(C_PARENT)) is not None and num(pv.get(C_REVENUE)) is not None and num(fyr.get(C_REVENUE)) is not None:
                    ttm_np = np_ - num(pv.get(C_PARENT)) + num(fyr.get(C_PARENT))
                    ttm_rev = rev - num(pv.get(C_REVENUE)) + num(fyr.get(C_REVENUE))
                elif pv and num(pv.get(C_PARENT)) is not None and num(pv.get(C_REVENUE)) is not None:
                    ttm_np = np_ - num(pv.get(C_PARENT))
                    ttm_rev = rev - num(pv.get(C_REVENUE))
            annual = [x for x in gi if pd_(x["acc_period"]).month == 12]
            if annual:
                ann_np = num(annual[-1].get(C_PARENT)); ann_rev = num(annual[-1].get(C_REVENUE))
            if len(annual) >= 2:
                prev_ann_np = num(annual[-2].get(C_PARENT)); prev_ann_rev = num(annual[-2].get(C_REVENUE))
        eq = la = ta = None
        if gb:
            lr = gb[-1]
            eq = num(lr.get(C_EQUITY))
            if eq is None:
                eq = num(lr.get(C_EQUITY_ALL))
            la = num(lr.get(C_TOTAL_LIAB)); ta = num(lr.get(C_TOTAL_ASSETS))
        oc = None
        if gf:
            oc = num(gf[-1].get(C_OPCF))
        out = {}
        for f in factors:
            if f == "ep_ttm": out[f] = ttm_np / cap if (ttm_np is not None and cap) else None
            elif f == "ep_annual": out[f] = ann_np / cap if (ann_np is not None and cap) else None
            elif f == "bp": out[f] = eq / cap if (eq is not None and cap) else None
            elif f == "sp_ttm": out[f] = ttm_rev / cap if (ttm_rev is not None and cap) else None
            elif f == "roe_ttm": out[f] = ttm_np / eq if (ttm_np is not None and eq) else None
            elif f == "roe_annual": out[f] = ann_np / eq if (ann_np is not None and eq) else None
            elif f == "gross_margin": out[f] = (rev - cost) / rev if (rev is not None and cost is not None and rev != 0) else None
            elif f == "debt_ratio": out[f] = la / ta if (la is not None and ta and ta != 0) else None
            elif f == "op_cf_ratio": out[f] = oc / np_ if (oc is not None and np_ is not None and np_ != 0) else None
            elif f == "rev_growth_yr": out[f] = ann_rev / prev_ann_rev - 1 if (ann_rev is not None and prev_ann_rev and prev_ann_rev != 0) else None
            elif f == "profit_growth_yr": out[f] = ann_np / prev_ann_np - 1 if (ann_np is not None and prev_ann_np and prev_ann_np != 0) else None
        return out

    def fundamental_factors(self, codes, factors, date_str):
        fund = [f for f in factors if self.registry[f]["data_source"].startswith("fs_")]
        if not fund or not codes:
            return {}
        lag_date = (datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=self.DISCLOSURE_LAG_MONTHS * 30)).strftime("%Y-%m-%d")
        # 单股/小池走 codes 过滤（jqcompat），大批量走全表（兼容旧行为）
        use_codes_filter = len(codes) <= 50
        ci = self._fs_tail("fs_comins", lag_date, codes=codes if use_codes_filter else None)
        cb = self._fs_tail("fs_combas", lag_date, codes=codes if use_codes_filter else None)
        cf = self._fs_tail("fs_comscfd", lag_date, codes=codes if use_codes_filter else None)
        ph = ",".join("?" * len(codes))
        prices = {}
        for code, close, mkt in self.conn.execute("SELECT stock_code, close_price, mkt_cap_total FROM stock_daily WHERE trade_date=? AND stock_code IN (" + ph + ")", [date_str] + codes):
            prices[code] = (close, mkt)
        out = {f: {} for f in fund}
        for code in codes:
            cap = None
            if code in prices:
                close, mkt = prices[code]
                cap = self._mkt_cap_yuan(close, mkt, code)
            vals = self._fund_value(ci.get(code, []), cb.get(code, []), cf.get(code, []), cap, fund)
            for f in fund:
                if vals.get(f) is not None:
                    out[f][code] = float(vals[f])
        return out

    def get_factors(self, codes, factors, date_str):
        tech = self.technical_factors(codes, factors, date_str)
        fund = self.fundamental_factors(codes, factors, date_str)
        out = {c: {} for c in codes}
        for f, m in tech.items():
            for c, v in m.items():
                out[c][f] = v
        for f, m in fund.items():
            for c, v in m.items():
                out[c][f] = v
        return out

    def get_factor(self, code, factor, date_str):
        r = self.get_factors([code], [factor], date_str)
        return r.get(code, {}).get(factor)

    def rank_normalize(self, values):
        items = [(k, v) for k, v in values.items() if v is not None]
        if not items:
            return {}
        vals = [v for _, v in items]
        n = len(vals)
        mu = sum(vals) / n
        var = sum((v - mu) ** 2 for v in vals) / (n - 1) if n > 1 else 0.0
        std = var ** 0.5
        if std == 0:
            return {k: 0.0 for k, _ in items}
        return {k: (v - mu) / std for k, v in items}
