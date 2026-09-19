# -*- coding: utf-8 -*-
"""
因子库：多因子截面计算（pandas 版，研究管线 scripts/ 使用）。

设计要点（为什么这样写）：
1. **单一数据源**：因子定义统一在 factor_registry.json（方向/频次/数据源），本模块与 web 引擎的
   engine/factor_calc_stdlib.py（纯标准库）共用同一份注册表，保证研究管线与生产引擎口径一致。
2. **无未来函数**（杜绝 lookahead bias，回测可信度的根基）：
   - 基本面因子采用「报告期 acc_period + 固定 4 个月披露滞后」对齐（declare_date 92% 为空不可用；
     年报 4/30、半年报 8/31、三季报 10/31 披露是监管惯例）。
   - 动量因子跳过最近 20 个交易日（规避短期反转噪音，标准做法）。
   - 股票池剔除 ST(trade_status!=1)/涨跌停/停牌/次新(<120交易日)/B股(2,8)/北交所(64)/退市。
3. **单位统一**：CSMAR 市值 mkt_cap_total 单位为「万元」，财务报表科目为「元」。PE/PB/PS 一律把市值
   转成元（x10000）再与报表科目相除。baostock 增量段（2026-06-13 后）无市值数据，用
   「参考股本 x 当日收盘价」推算。
4. **金融股剔除**：银行/证券/保险等金融机构的营收成本科目口径与工商企业不同（息差结构），
   会污染收入类因子（毛利率/市销率/营收增速），默认从选股池剔除（名称关键词）。

CSMAR 科目代码（经 平安银行 000001 / 贵州茅台 600519 2024 年报实证校验）：
- fs_comins: B001100000=营业收入  B001200000=营业总成本  B001000000=营业利润
             B001300000=利润总额  B002000000=净利润(含少数)  B002000101=归母净利润
             B002000201=少数股东损益  B003000000=基本EPS
- fs_combas: A001000000=资产总计  A002000000=负债合计  A003000000=所有者权益合计(含少数)
             A003100000=归母净资产  A001100000=流动资产合计  A002100000=流动负债合计
- fs_comscfd: C001000000=经营活动现金流量净额

运行解释器：系统 Python311（有 pandas）。
"""
import os
import json
import sqlite3

import numpy as np
import pandas as pd

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, 'data', 'stock_data.db')
REGISTRY_PATH = os.path.join(BASE_DIR, 'scripts', 'factor_registry.json')

# ---- CSMAR 科目代码映射（实证校验）----
FS_COLS = {
    # fs_comins
    'revenue': 'B001100000',         # 营业收入
    'op_cost': 'B001200000',         # 营业总成本
    'op_profit': 'B001000000',       # 营业利润
    'pretax': 'B001300000',          # 利润总额
    'net_profit': 'B002000000',      # 净利润(含少数)
    'parent_profit': 'B002000101',   # 归母净利润
    'minority': 'B002000201',        # 少数股东损益
    'eps': 'B003000000',             # 基本每股收益
    # fs_combas
    'total_assets': 'A001000000',    # 资产总计
    'total_liab': 'A002000000',      # 负债合计
    'equity': 'A003000000',          # 所有者权益合计(含少数)
    'parent_equity': 'A003100000',   # 归母净资产
    'current_assets': 'A001100000',  # 流动资产合计
    'current_liab': 'A002100000',    # 流动负债合计
    # fs_comscfd
    'op_cf': 'C001000000',           # 经营活动现金流量净额
}

# 金融股名称关键词（选股池剔除）
FIN_KEYWORDS = ['银行', '证券', '保险', '信托', '期货', '金融', '租赁',
                '资管', '担保', '消金', '人寿', '人保', '财险']

# 各表需加载的科目列
FS_TABLE_COLS = {
    'fs_comins': [FS_COLS[k] for k in
                  ('revenue', 'op_cost', 'op_profit', 'pretax', 'net_profit',
                   'parent_profit', 'minority', 'eps')],
    'fs_combas': [FS_COLS[k] for k in
                  ('total_assets', 'total_liab', 'equity', 'parent_equity',
                   'current_assets', 'current_liab')],
    'fs_comscfd': [FS_COLS['op_cf']],
}


class FactorCalculator:
    """多因子截面计算器。

    用法：
        calc = FactorCalculator()
        stocks = calc.get_universe('2024-12-31')
        df = calc.compute_factors('2024-12-31', stocks, ['mom_12m1m', 'bp', 'roe_ttm'])
    """

    DISCLOSURE_LAG_MONTHS = 4   # 财报披露滞后（月）
    MIN_TRADE_DAYS = 120        # 次新过滤：上市满 120 个交易日
    REF_SHARES_WINDOW = ('2026-05-01', '2026-06-12')  # 参考股本窗口

    def __init__(self, db_path=DB_PATH):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self.registry = self._load_registry()
        self._fs_cache = {}       # table -> DataFrame
        self._fs_group = {}       # table -> groupby('stock_code')
        self._rep_cache = {}      # (table, lag_date) -> {code: 最近4期报告 df}
        self._factor_cache = {}   # (date, frozenset(factors)) -> DataFrame
        self._shares_ref = None   # code -> 参考股本
        self._universe_cache = {}

    def _load_registry(self):
        with open(REGISTRY_PATH, encoding='utf-8') as f:
            return json.load(f)['factors']

    def factor_direction(self, factor):
        return self.registry[factor]['direction']

    # ------------------------------------------------------------------
    # 股票池（universe）
    # ------------------------------------------------------------------
    def get_universe(self, date, exclude_financial=True):
        """返回某日可交易股票池（纯 6 位代码列表）。

        过滤逻辑（无未来函数）：
        - trade_status=1（剔除 ST/*ST）
        - 当日有成交（volume>0, close>0）
        - 非涨跌停（limit_up/limit_down 为空则放行）
        - 上市满 MIN_TRADE_DAYS 交易日（用 first_trade_date + 日历近似）
        - 非退市（stocks.status=1）；非 B股(2,8)/北交所(64)
        - 可选剔除金融股（名称关键词）
        """
        key = (date, exclude_financial)
        if key in self._universe_cache:
            return self._universe_cache[key]
        sql = """
            SELECT s.stock_code, st.name, st.first_trade_date
            FROM stock_daily s
            JOIN stocks st ON s.stock_code = st.stock_code
            WHERE s.trade_date = ?
              AND s.trade_status = 1 AND s.close_price > 0 AND s.volume > 0
              AND (s.limit_up IS NULL OR s.close_price < s.limit_up)
              AND (s.limit_down IS NULL OR s.close_price > s.limit_down)
              AND st.status = 1
              AND st.market_type NOT IN (2, 8, 64)
        """
        rows = self.conn.execute(sql, (date,)).fetchall()
        codes = []
        for code, name, ft in rows:
            if ft and ft <= date:
                age_days = (pd.Timestamp(date) - pd.Timestamp(ft)).days
                if age_days < int(self.MIN_TRADE_DAYS * 7 / 5):
                    continue
            if exclude_financial and name:
                if any(k in name for k in FIN_KEYWORDS):
                    continue
            codes.append(code)
        self._universe_cache[key] = codes
        return codes

    # ------------------------------------------------------------------
    # 行情加载
    # ------------------------------------------------------------------
    def load_prices(self, date, codes, lookback=300):
        """加载 codes 在 [date-lookback 日历日, date] 的日线（trade_status=1）。

        返回 DataFrame：stock_code, trade_date, close_price, dretwd, high_price,
        low_price, volume, amount, mkt_cap_total（按股票、日期升序）。
        """
        if not codes:
            return pd.DataFrame()
        start = (pd.Timestamp(date) - pd.Timedelta(days=lookback * 7 / 5 + 30)
                 ).strftime('%Y-%m-%d')
        ph = ','.join('?' * len(codes))
        sql = f"""
            SELECT stock_code, trade_date, close_price, dretwd, high_price,
                   low_price, volume, amount, mkt_cap_total
            FROM stock_daily
            WHERE stock_code IN ({ph}) AND trade_date BETWEEN ? AND ?
              AND trade_status = 1 AND close_price > 0 AND dretwd IS NOT NULL
            ORDER BY stock_code, trade_date
        """
        df = pd.read_sql_query(sql, self.conn, params=codes + [start, date])
        if not df.empty:
            df['trade_date'] = pd.to_datetime(df['trade_date'])
        return df

    def _mkt_cap_yuan(self, close, mkt_cap_wan, code):
        """总市值（元）。CSMAR mkt_cap_total 单位是「千元」，x1000 转元；NULL 时用参考股本 x 收盘价推算。"""
        if mkt_cap_wan and mkt_cap_wan > 0:
            return float(mkt_cap_wan) * 1000.0
        if close and close > 0:
            shares = self._shares_for(code)
            if shares:
                return shares * float(close)
        return None

    def _shares_for(self, code):
        """参考股本：取 REF_SHARES_WINDOW 内 mkt_cap/close 的中位数（CSMAR 全量段，避免未来数据）。"""
        if self._shares_ref is None:
            self._shares_ref = {}
            s, e = self.REF_SHARES_WINDOW
            rows = self.conn.execute(
                'SELECT stock_code, close_price, mkt_cap_total FROM stock_daily '
                'WHERE trade_date BETWEEN ? AND ? AND mkt_cap_total > 0',
                (s, e)).fetchall()
            tmp = {}
            for code, close, mkt in rows:
                if close and close > 0:
                    tmp.setdefault(code, []).append(float(mkt) * 1000.0 / float(close))
            for code, vals in tmp.items():
                vals.sort()
                self._shares_ref[code] = vals[len(vals) // 2]
        return self._shares_ref.get(code)

    # ------------------------------------------------------------------
    # 技术因子
    # ------------------------------------------------------------------
    @staticmethod
    def _cum_ret(rets, n):
        if len(rets) < n:
            return None
        r = 1.0
        for v in rets[-n:]:
            r *= (1.0 + v)
        return r - 1.0

    def _tech_factor(self, f, rets, closes, highs, lows, vols, amts, cap_yuan):
        p = self.registry[f].get('params', {})
        if f == 'ln_cap':
            return float(np.log(cap_yuan)) if cap_yuan and cap_yuan > 0 else None
        if f == 'mom_1m':
            return self._cum_ret(rets, p['window'])
        if f == 'mom_3m':
            return self._cum_ret(rets, p['window'])
        if f == 'mom_6m':
            return self._cum_ret(rets, p['window'])
        if f == 'mom_12m':
            return self._cum_ret(rets, p['window'])
        if f == 'mom_12m1m':
            # 250~20 日累计（跳过最近 20 交易日）
            w, sk = p['window'], p['skip']
            if len(rets) < w:
                return None
            r = 1.0
            for v in rets[-w:-sk]:
                r *= (1.0 + v)
            return r - 1.0
        if f in ('rev_5d', 'rev_10d'):
            return self._cum_ret(rets, p['window'])
        if f in ('vol_20d', 'vol_60d'):
            n = p['window']
            if len(rets) < n:
                return None
            seg = rets[-n:]
            m = sum(seg) / n
            var = sum((x - m) ** 2 for x in seg) / (n - 1)
            return (var ** 0.5) * (252 ** 0.5)
        if f == 'amplitude_20d':
            n = p['window']
            if len(closes) < n:
                return None
            vals = []
            for i in range(len(closes) - n, len(closes)):
                if closes[i] and closes[i] > 0 and highs[i] is not None and lows[i] is not None:
                    vals.append((highs[i] - lows[i]) / closes[i])
            return sum(vals) / n if vals else None
        if f == 'liq_20d':
            if len(amts) < p['window']:
                return None
            avg = sum(amts[-p['window']:]) / p['window']
            return np.log(avg) if avg > 0 else None
        if f == 'turnover_20d':
            if len(amts) < p['window'] or not cap_yuan:
                return None
            avg = sum(amts[-p['window']:]) / p['window']
            return avg / cap_yuan if cap_yuan > 0 else None
        if f == 'rsi_14':
            if len(rets) < p['window'] + 1:
                return None
            gains = losses = 0.0
            for v in rets[-(p['window'] + 1):]:
                if v > 0:
                    gains += v
                else:
                    losses += -v
            if losses == 0:
                return 100.0
            rs = gains / losses
            return 100.0 - 100.0 / (1.0 + rs)
        if f == 'ma_dev_20':
            n = p['window']
            if len(closes) < n:
                return None
            ma = sum(closes[-n:]) / n
            return closes[-1] / ma - 1.0 if ma > 0 else None
        return None

    def compute_technical_factors(self, date, codes, factors):
        """批量计算技术因子，返回 {factor: {code: value}}。"""
        tech = [f for f in factors if self.registry[f]['data_source'] == 'stock_daily']
        if not tech:
            return {}
        df = self.load_prices(date, codes)
        out = {f: {} for f in tech}
        if df.empty:
            return out
        for code, g in df.groupby('stock_code'):
            g = g.sort_values('trade_date')
            rets = g['dretwd'].values
            closes = g['close_price'].values
            highs = g['high_price'].values
            lows = g['low_price'].values
            amts = g['amount'].values
            cap = self._mkt_cap_yuan(closes[-1], g['mkt_cap_total'].iloc[-1], code)
            for f in tech:
                v = self._tech_factor(f, rets, closes, highs, lows, None, amts, cap)
                if v is not None:
                    out[f][code] = float(v)
        return out

    # ------------------------------------------------------------------
    # 基本面因子
    # ------------------------------------------------------------------
    def _fs_df(self, table):
        """加载某报表表全部合并(A)季度末报告，缓存。列名用友好名（revenue 等）。"""
        if table not in self._fs_cache:
            codes = FS_TABLE_COLS[table]
            friendly = {v: k for k, v in FS_COLS.items()}
            sel = ['stock_code', 'acc_period'] + [
                f'{c} AS {friendly[c]}' for c in codes]
            df = pd.read_sql_query(
                f"SELECT {', '.join(sel)} FROM {table} WHERE report_type='A'",
                self.conn)
            df['acc_period'] = pd.to_datetime(df['acc_period'])
            mask = (df['acc_period'].dt.month.isin([3, 6, 9, 12])
                    & df['acc_period'].dt.day.isin([30, 31]))
            df = df[mask]
            df = df.sort_values(['stock_code', 'acc_period']).reset_index(drop=True)
            self._fs_cache[table] = df
            self._fs_group[table] = df.groupby('stock_code')
        return self._fs_cache[table]

    def _rep_tail(self, table, lag_date, n=8):
        """某报表表在 lag_date 前每只股票最近 n 期报告的 dict（按报告期升序）。"""
        key = (table, lag_date)
        if key not in self._rep_cache:
            df = self._fs_df(table)
            sub = df[df['acc_period'] <= lag_date].sort_values('acc_period')
            tail = sub.groupby('stock_code').tail(n)
            self._rep_cache[key] = {c: g for c, g in tail.groupby('stock_code')}
        return self._rep_cache[key]

    def _fs_sub(self, table, code, lag_date):
        """某股票 acc_period<=lag_date 的最近报告（升序）。dict 查找，避免 get_group 开销。"""
        return self._rep_tail(table, lag_date).get(code, pd.DataFrame())

    def _latest_annual(self, sub, field):
        """sub 中最近一个年报(12-31)的 field 值。"""
        a = sub[sub['acc_period'].dt.month == 12]
        if a.empty:
            return None
        v = a.iloc[-1][field]
        return None if pd.isna(v) else float(v)

    def _ttm(self, sub, field):
        """TTM 值：最新累计 - 去年同期累计 + 去年年报（CSMAR 报表为财年内累计值）。"""
        if sub.empty:
            return None
        latest = sub.iloc[-1]
        P = latest['acc_period']
        lv = latest[field]
        if P.month == 12 and P.day == 31:
            return None if pd.isna(lv) else float(lv)
        py = P - pd.DateOffset(years=1)
        prev = sub[sub['acc_period'] == py]
        if prev.empty:
            return None if pd.isna(lv) else float(lv)
        pv = prev[field].iloc[0]
        fy = pd.Timestamp(P.year - 1, 12, 31)
        fyr = sub[sub['acc_period'] == fy]
        if fyr.empty:
            if pd.isna(lv) or pd.isna(pv):
                return None
            return float(lv) - float(pv)
        fyv = fyr[field].iloc[0]
        if pd.isna(lv) or pd.isna(pv) or pd.isna(fyv):
            return None
        return float(lv) - float(pv) + float(fyv)

    def _price_on_date(self, date, codes):
        ph = ','.join('?' * len(codes))
        df = pd.read_sql_query(
            f"SELECT stock_code, close_price, mkt_cap_total FROM stock_daily "
            f"WHERE trade_date=? AND stock_code IN ({ph})",
            self.conn, params=[date] + codes)
        return df.set_index('stock_code')

    @staticmethod
    def _latest(sub, field):
        if sub.empty:
            return None
        v = sub.iloc[-1][field]
        return None if pd.isna(v) else float(v)

    def _latest_equity(self, sub):
        eq = self._latest(sub, 'parent_equity')
        if eq is None:
            eq = self._latest(sub, 'equity')
        return eq

    def _fund_values(self, date, code, factors, price_df):
        """计算单只股票的基本面因子值，返回 {factor: value}。"""
        lag = pd.Timestamp(date) - pd.DateOffset(months=self.DISCLOSURE_LAG_MONTHS)
        ci = self._fs_sub('fs_comins', code, lag)
        cb = self._fs_sub('fs_combas', code, lag)
        cf = self._fs_sub('fs_comscfd', code, lag)

        cap = None
        if code in price_df.index:
            r = price_df.loc[code]
            cap = self._mkt_cap_yuan(r['close_price'], r['mkt_cap_total'], code)

        out = {}
        for f in factors:
            if f == 'ep_ttm':
                np_ = self._ttm(ci, 'parent_profit')
                out[f] = np_ / cap if (np_ is not None and cap) else None
            elif f == 'ep_annual':
                np_ = self._latest_annual(ci, 'parent_profit')
                out[f] = np_ / cap if (np_ is not None and cap) else None
            elif f == 'bp':
                eq = self._latest_equity(cb)
                out[f] = eq / cap if (eq is not None and cap) else None
            elif f == 'sp_ttm':
                rev = self._ttm(ci, 'revenue')
                out[f] = rev / cap if (rev is not None and cap) else None

            elif f == 'roe_ttm':
                np_ = self._ttm(ci, 'parent_profit')
                eq = self._latest_equity(cb)
                out[f] = np_ / eq if (np_ is not None and eq) else None
            elif f == 'roe_annual':
                np_ = self._latest_annual(ci, 'parent_profit')
                eq = self._latest_equity(cb)
                out[f] = np_ / eq if (np_ is not None and eq) else None
            elif f == 'gross_margin':
                rev = self._latest(ci, 'revenue')
                cost = self._latest(ci, 'op_cost')
                out[f] = (rev - cost) / rev if (rev is not None and cost is not None and rev != 0) else None
            elif f == 'debt_ratio':
                la = self._latest(cb, 'total_liab')
                ta = self._latest(cb, 'total_assets')
                out[f] = la / ta if (la is not None and ta and ta != 0) else None
            elif f == 'op_cf_ratio':
                oc = self._latest(cf, 'op_cf')
                np_ = self._latest(ci, 'parent_profit')
                out[f] = oc / np_ if (oc is not None and np_ is not None and np_ != 0) else None
            elif f == 'rev_growth_yr':
                field = 'revenue'
                out[f] = self._growth(ci, field)
            elif f == 'profit_growth_yr':
                field = 'parent_profit'
                out[f] = self._growth(ci, field)
        return out

    def _growth(self, sub, field):
        """同比增速：最新年报 / 上一年报 - 1。"""
        a = sub[sub['acc_period'].dt.month == 12]
        if len(a) >= 2:
            cur = a.iloc[-1][field]
            prev = a.iloc[-2][field]
            if cur is not None and prev is not None and not pd.isna(cur) and not pd.isna(prev):
                if float(prev) != 0:
                    return float(cur) / float(prev) - 1.0
        return None

    def compute_fundamental_factors(self, date, codes, factors):
        """批量计算基本面因子，返回 {factor: {code: value}}。"""
        fund = [f for f in factors
                if self.registry[f]['data_source'].startswith('fs_')]
        if not fund:
            return {}
        price = self._price_on_date(date, codes)
        out = {f: {} for f in fund}
        for code in codes:
            vals = self._fund_values_fast(date, code, fund, price)
            for f in fund:
                v = vals.get(f)
                if v is not None:
                    out[f][code] = float(v)
        return out

    def compute_factors(self, date, codes, factors):
        """计算一批因子的截面值，返回 DataFrame（index=stock_code，每列一因子）。

        技术因子与基本面因子合并；两者都缺失时该股票某因子为 NaN。
        """
        key = (date, frozenset(factors))
        if key in self._factor_cache:
            return self._factor_cache[key].reindex(codes)
        tech = self.compute_technical_factors(date, codes, factors)
        fund = self.compute_fundamental_factors(date, codes, factors)
        df = pd.DataFrame(index=codes)
        for f in factors:
            vals = {}
            if f in tech:
                vals.update(tech[f])
            if f in fund:
                vals.update(fund[f])
            df[f] = pd.Series(vals)
        self._factor_cache[key] = df
        return df


    def _fund_values_fast(self, date, code, factors, price_df):
        lag = pd.Timestamp(date) - pd.DateOffset(months=self.DISCLOSURE_LAG_MONTHS)
        gi = self._fs_sub("fs_comins", code, lag)
        gb = self._fs_sub("fs_combas", code, lag)
        gf = self._fs_sub("fs_comscfd", code, lag)
        cap = None
        if code in price_df.index:
            r = price_df.loc[code]
            cap = self._mkt_cap_yuan(r["close_price"], r["mkt_cap_total"], code)
        def num(x):
            try:
                return None if pd.isna(x) else float(x)
            except (TypeError, ValueError):
                return None
        rev = cost = np_ = None
        ttm_np = ttm_rev = None
        ann_np = ann_rev = prev_ann_np = prev_ann_rev = None
        if not gi.empty:
            lr = gi.iloc[-1]
            rev = num(lr["revenue"]); cost = num(lr["op_cost"]); np_ = num(lr["parent_profit"])
            P = lr["acc_period"]
            if P.month == 12 and P.day == 31:
                ttm_np = np_; ttm_rev = rev
            else:
                py = P - pd.DateOffset(years=1)
                pv = gi[gi["acc_period"] == py]
                fy = pd.Timestamp(P.year - 1, 12, 31)
                fyr = gi[gi["acc_period"] == fy]
                ttm_np = np_; ttm_rev = rev
                if np_ is None or rev is None:
                    ttm_np = ttm_rev = None
                elif not pv.empty and not fyr.empty and num(pv["parent_profit"].iloc[0]) is not None and num(fyr["parent_profit"].iloc[0]) is not None and num(pv["revenue"].iloc[0]) is not None and num(fyr["revenue"].iloc[0]) is not None:
                    ttm_np = np_ - num(pv["parent_profit"].iloc[0]) + num(fyr["parent_profit"].iloc[0])
                    ttm_rev = rev - num(pv["revenue"].iloc[0]) + num(fyr["revenue"].iloc[0])
                elif not pv.empty and num(pv["parent_profit"].iloc[0]) is not None and num(pv["revenue"].iloc[0]) is not None:
                    ttm_np = np_ - num(pv["parent_profit"].iloc[0])
                    ttm_rev = rev - num(pv["revenue"].iloc[0])
            annual = gi[gi["acc_period"].dt.month == 12]
            if len(annual) >= 1:
                ann_np = num(annual.iloc[-1]["parent_profit"]); ann_rev = num(annual.iloc[-1]["revenue"])
            if len(annual) >= 2:
                prev_ann_np = num(annual.iloc[-2]["parent_profit"]); prev_ann_rev = num(annual.iloc[-2]["revenue"])
        eq = la = ta = None
        if not gb.empty:
            lr = gb.iloc[-1]
            eq = num(lr["parent_equity"]) if "parent_equity" in gb.columns else None
            if eq is None and "equity" in gb.columns:
                eq = num(lr["equity"])
            la = num(lr["total_liab"]); ta = num(lr["total_assets"])
        oc = None
        if not gf.empty and "op_cf" in gf.columns:
            oc = num(gf.iloc[-1]["op_cf"])
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

if __name__ == '__main__':
    calc = FactorCalculator()
    date = '2026-05-08'  # CSMAR 全量段，有市值/财务数据
    univ = calc.get_universe(date)
    print(f'股票池 {date}: {len(univ)} 只')
    # 已知真实值校验
    known = ['000001', '600519', '600036', '000858', '601318']
    factors = ['bp', 'ep_ttm', 'roe_ttm', 'debt_ratio', 'ln_cap',
               'mom_12m1m', 'vol_60d', 'liq_20d', 'ma_dev_20']
    df = calc.compute_factors(date, [c for c in known if c in univ], factors)
    print('\n已知股票因子值（2026-05-08）:')
    print(df.round(4).to_string())
    # 全池抽样：每因子覆盖率
    n = 1500
    sample = univ[:n]
    df2 = calc.compute_factors(date, sample, factors)
    print(f'\n全池前{n}只因子覆盖率:')
    print(df2.notna().mean().round(3).to_string())

