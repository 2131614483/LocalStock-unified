# -*- coding: utf-8 -*-
"""
jqcompat —— 聚宽 API 兼容层（本地回测引擎桥接模块）

把候选策略最常用的聚宽 API 映射到本地数据/引擎。原则：
- 纯新增、不侵入引擎既有行为；引擎 run() 用 `merge_jqcompat(env)` 合并本层
- pandas 可用（Anaconda 3.13 / python311），DataFrame 返回真实 pandas 对象
- 数据口径复用 factor_calc_stdlib（同一 registry、同一报告期+4个月滞后铁律）
- 本地无精确数据的字段返回 NaN（不报错）；近似项一律在报告中声明

覆盖 API：
  query / valuation.indicator.balance.income.cash_flow / get_fundamentals
  get_current_data / get_index_stocks / get_all_securities / get_trade_days
  history / order_value / order_shares / set_option / log.set_level
  filter_st_stock / filter_paused_stock / filter_new_stock / filter_kcb_stock
  get_extras(is_st) / get_factor_values
"""
import datetime
import math
import sqlite3

import pandas as pd

# ---- CSMAR 科目代码（与 factor_calc_stdlib 一致）----
C_REVENUE = 'B001100000'
C_OPCOST = 'B001200000'
C_PARENT = 'B002000101'
C_TOTAL_ASSETS = 'A001000000'
C_TOTAL_LIAB = 'A002000000'
C_EQUITY = 'A003100000'
C_OPCF = 'C001000000'


# ==================== 查询 DSL ====================

class _Col:
    """列引用：valuation.market_cap"""
    __slots__ = ('table', 'name')
    def __init__(self, table, name):
        self.table = table
        self.name = name
    def __str__(self):
        return f'{self.table}.{self.name}'
    def __lt__(self, o): return _Cond(self, '<', o)
    def __le__(self, o): return _Cond(self, '<=', o)
    def __gt__(self, o): return _Cond(self, '>', o)
    def __ge__(self, o): return _Cond(self, '>=', o)
    def __eq__(self, o): return _Cond(self, '==', o)
    def __ne__(self, o): return _Cond(self, '!=', o)
    def in_(self, v): return _Cond(self, 'in', v)
    def asc(self): return _AscDesc(self, 1)
    def desc(self): return _AscDesc(self, -1)
    def __add__(self, o): return _Expr(self, '+', o)
    def __sub__(self, o): return _Expr(self, '-', o)
    def __mul__(self, o): return _Expr(self, '*', o)
    def __truediv__(self, o): return _Expr(self, '/', o)
    def __radd__(self, o): return _Expr(o, '+', self)
    def __rsub__(self, o): return _Expr(o, '-', self)
    def __rmul__(self, o): return _Expr(o, '*', self)


class _Expr:
    __slots__ = ('left', 'op', 'right')
    def __init__(self, left, op, right):
        self.left = left
        self.op = op
        self.right = right
    def _cols(self):
        out = []
        for x in (self.left, self.right):
            if isinstance(x, _Col):
                out.append(x)
            elif isinstance(x, _Expr):
                out.extend(x._cols())
        return out


class _Cond:
    """筛选条件（AND 语义）"""
    __slots__ = ('col', 'op', 'value')
    def __init__(self, col, op, value):
        self.col = col
        self.op = op
        self.value = value
    def _cols(self):
        out = [self.col]
        if isinstance(self.value, _Col):
            out.append(self.value)
        elif isinstance(self.value, _Expr):
            out.extend(self.value._cols())
        return out


class _Table:
    def __init__(self, name):
        self._name = name
    def __getattr__(self, item):
        if item.startswith('_'):
            raise AttributeError(item)
        return _Col(self._name, item)


valuation = _Table('valuation')
indicator = _Table('indicator')
balance = _Table('balance')
income = _Table('income')
cash_flow = _Table('cash_flow')


class _Query:
    def __init__(self, cols):
        self.cols = list(cols)
        self.conds = []
        self._order = []    # [(col, asc)]
        self._limit = None
    def filter(self, *conds):
        self.conds.extend(conds)
        return self
    def order_by(self, *orderings):
        for o in orderings:
            if isinstance(o, _AscDesc):
                self._order.append((o.col, o.direction))
            else:
                self._order.append((o, True))
        return self
    def limit(self, n):
        self._limit = int(n)
        return self


def query(*cols):
    return _Query(list(cols))


class _AscDesc:
    """order_by 修饰：valuation.market_cap.asc() / .desc()"""
    __slots__ = ('col', 'direction')
    def __init__(self, col, direction):
        self.col = col
        self.direction = direction  # 1=asc, -1=desc


# ---- JQ 字段 → 因子 / 原始科目 映射 ----
# 估值 → 因子取倒数
_FAC_INV = {'pe_ratio': 'ep_ttm', 'pe_ratio_lyr': 'ep_annual', 'pe_ratio_ttm': 'ep_ttm',
            'pb_ratio': 'bp', 'ps_ratio': 'sp_ttm', 'ps_ttm': 'sp_ttm', 'pc_ratio': 'sp_ttm'}
_FAC_DIR = {'roe': 'roe_ttm', 'inc_net_profit_year_on_year': 'profit_growth_yr',
            'inc_revenue_year_on_year': 'rev_growth_yr', 'inc_total_revenue_year_on_year': 'rev_growth_yr',
            'inc_net_profit_to_shareholders_year_on_year': 'profit_growth_yr',
            'gross_profit_margin': 'gross_margin', 'debt_to_assets': 'debt_ratio'}
# JQ 的 indicator 字段是百分数口径（如 roe=10.47 表示 10.47%），而因子库给小数（0.1047）。
# 兼容策略里常见的 /100 或 >15 这类比较，百分比型字段输出 ×100。
_PERCENT_IDX_FIELDS = {'roe', 'inc_net_profit_year_on_year', 'inc_revenue_year_on_year',
                       'inc_total_revenue_year_on_year', 'inc_net_profit_to_shareholders_year_on_year',
                       'gross_profit_margin', 'debt_to_assets', 'roa', 'net_profit_margin',
                       'inc_net_profit_annual', 'op_cf_ratio'}
# income / cash_flow / balance → CSMAR 科目
_FS_COL = {
    ('income', 'revenue'): C_REVENUE, ('income', 'operating_revenue'): C_REVENUE,
    ('income', 'net_profit'): C_PARENT, ('income', 'net_profit_parent_company'): C_PARENT,
    ('income', 'operating_cost'): C_OPCOST,
    ('balance', 'total_assets'): C_TOTAL_ASSETS, ('balance', 'total_liability'): C_TOTAL_LIAB,
    ('balance', 'total_liabilities'): C_TOTAL_LIAB, ('balance', 'net_assets'): C_EQUITY,
    ('cash_flow', 'net_cash_flow_operate'): C_OPCF, ('cash_flow', 'forward_contract_value'): None,
}

# 涨跌停推导近似：与引擎一致
def _board_ratio(market_type):
    return 0.20 if market_type in (16, 32) else 0.10


# ==================== get_fundamentals ====================

class FundData:
    """get_fundamentals 实现：universe 批量取数 + 求值 + 过滤"""

    def __init__(self, engine):
        self.engine = engine
        self.fc = engine._factor_calc

    def _collect(self, q):
        """收集所有列引用 + 涉及的因子 + universe 限定条件"""
        cols = list(q.cols)
        conds = q.conds
        all_cols = []
        for c in cols:
            all_cols.extend(c._cols() if isinstance(c, _Expr) else [c])
        for cond in conds:
            all_cols.extend(cond._cols())
        # 去重
        seen = set()
        uniq = []
        for c in all_cols:
            k = (c.table, c.name)
            if k not in seen:
                seen.add(k)
                uniq.append(c)
        # universe：valuation.code.in_(codes) / valuation.code==code → 限定池
        universe = None
        for cond in conds:
            if cond.col.table == 'valuation' and cond.col.name == 'code' and cond.op == 'in':
                universe = [str(c).split('.')[0] for c in cond.value]
                break
            if cond.col.table == 'valuation' and cond.col.name == 'code' and cond.op == '==':
                universe = [str(cond.value).split('.')[0]]
                break
        factors = set()
        for c in uniq:
            name = c.name
            if name in _FAC_INV:
                factors.add(_FAC_INV[name])
            if name in _FAC_DIR:
                factors.add(_FAC_DIR[name])
        return uniq, factors, universe

    def _fs_latest(self, codes, table, date_str):
        """批量取最近一期财报（报告期+4个月滞后），返回 {code: {col: value, acc_period}}"""
        lag = (datetime.datetime.strptime(date_str, '%Y-%m-%d')
               - datetime.timedelta(days=120)).strftime('%Y-%m-%d')
        cols = sorted({c for (t, n), c in _FS_COL.items() if t == table and c})
        if not cols:
            return {}
        sel = ','.join(['stock_code', 'acc_period'] + cols)
        ph = ','.join('?' * len(codes))
        sql = (f'SELECT {sel} FROM {table} WHERE stock_code IN ({ph}) AND report_type=\'A\' '
               f'AND acc_period<=? ORDER BY stock_code, acc_period DESC')
        rows = self.engine.conn.execute(sql, codes + [lag]).fetchall()
        out = {}
        for r in rows:
            code = r[0]
            if code in out:
                continue
            rec = {'acc_period': r[1]}
            for i, col in enumerate(cols):
                rec[col] = r[i + 2]
            out[code] = rec
        return out

    def _mcap_batch(self, codes, date_str):
        """返回 {code: (close, cap_yuan)}"""
        if not codes:
            return {}
        ph = ','.join('?' * len(codes))
        rows = self.engine.conn.execute(
            'SELECT stock_code, close_price, mkt_cap_total FROM stock_daily '
            'WHERE trade_date=? AND stock_code IN (' + ph + ')', [date_str] + codes).fetchall()
        return {r[0]: (float(r[1]) if r[1] else None,
                       float(r[2]) * 1000.0 if r[2] else None) for r in rows}

    def build(self, q, date_str):
        uniq, factors, universe = self._collect(q)
        if universe is None:
            universe = self.fc.get_all_stocks(date_str)
            universe = [c.split('.')[0] for c in universe]
        codes = [c for c in universe]
        # 批量因子 + 财务 + 市值
        fvals_all = self.fc.get_factors(codes, sorted(factors), date_str) if factors else {}
        fs_income = self._fs_latest(codes, 'fs_comins', date_str)
        fs_balance = self._fs_latest(codes, 'fs_combas', date_str)
        fs_cashflow = self._fs_latest(codes, 'fs_comscfd', date_str)
        mcap = self._mcap_batch(codes, date_str)

        rows = []
        for code in codes:
            close, cap = mcap.get(code, (None, None))
            if close is None and cap is None:
                continue
            shares = (cap / close) if (cap and close) else None
            fv = fvals_all.get(code, {})
            fi, fb = fs_income.get(code, {}), fs_balance.get(code, {})
            fc_ = fs_cashflow.get(code, {})
            vals = self._vals(code, close, cap, shares, fv, fi, fb, fc_)
            # 过滤
            ok = True
            for cond in q.conds:
                if not self._test(cond, vals):
                    ok = False
                    break
            if ok:
                rec = {'code': code}
                for c in q.cols:
                    # JQ 惯例：列名 = 字段名（'pb_ratio'），code 字段一律输出为 'code'
                    col_name = 'code' if c.name == 'code' else c.name
                    rec[col_name] = self._eval(c, vals)
                # 排序列若未在 query 列中，也补算（供 order_by 排序）
                for oc, _dir in (q._order or []):
                    ocn = 'code' if oc.name == 'code' else oc.name
                    if ocn not in rec:
                        rec[ocn] = self._eval(oc, vals)
                rows.append(rec)
        if q.cols:
            cols_out = []
            for c in q.cols:
                cols_out.append('code' if c.name == 'code' else c.name)
            # 排序列补进输出列
            for oc, _dir in (q._order or []):
                ocn = 'code' if oc.name == 'code' else oc.name
                if ocn not in cols_out:
                    cols_out.append(ocn)
            seen = set()
            dedup = []
            for cn in cols_out:
                if cn not in seen:
                    seen.add(cn)
                    dedup.append(cn)
            cols_out = dedup
        else:
            cols_out = ['code']
        # order_by 排序（排序列已在 rec 补齐）
        if q._order and rows:
            for key, direction in reversed([(('code' if oc.name == 'code' else oc.name), d)
                                            for oc, d in q._order]):
                if key in rows[0]:
                    rows.sort(key=lambda r: (r.get(key) is None, r.get(key)), reverse=(direction < 0))
        # limit 截断
        if q._limit is not None:
            rows = rows[:q._limit]
        df = pd.DataFrame(rows, columns=cols_out)
        if not rows:
            df = pd.DataFrame(columns=cols_out)
        return df

    def _vals(self, code, close, cap, shares, fv, fi, fb, fc_):
        val = {'code': code}
        # 因子反推估值
        for jqf, fac in _FAC_INV.items():
            v = fv.get(fac)
            val[jqf] = (1.0 / v) if (v is not None and v != 0) else None
        for jqf, fac in _FAC_DIR.items():
            v = fv.get(fac)
            val[jqf] = (v * 100.0) if (v is not None and jqf in _PERCENT_IDX_FIELDS) else v
        # 市值/股本
        val['market_cap'] = cap
        val['circulating_market_cap'] = cap          # 无流通股本，近似 = 总市值（声明）
        val['capitalization'] = shares               # 总股本(股)
        val['circulating_cap'] = shares              # 流通股本近似 = 总股本
        val['turnover_ratio'] = None                 # 无流通股本 → NaN
        # income 原始科目（归母口径）
        for jqf, code_ in [('revenue', C_REVENUE), ('net_profit', C_PARENT), ('operating_cost', C_OPCOST)]:
            v = fi.get(code_)
            val[jqf] = float(v) if v is not None else None
        # balance
        for jqf, code_ in [('total_assets', C_TOTAL_ASSETS), ('total_liability', C_TOTAL_LIAB),
                           ('net_assets', C_EQUITY)]:
            v = fb.get(code_)
            val[jqf] = float(v) if v is not None else None
        # cash_flow
        v = fc_.get(C_OPCF)
        val['net_cash_flow_operate'] = float(v) if v is not None else None
        # roa / eps / net_profit_margin / growth 由原始科目推（百分数口径同 JQ）
        ta, np_, rev = val.get('total_assets'), val.get('net_profit'), val.get('revenue')
        val['roa'] = (np_ / ta * 100.0) if (np_ is not None and ta) else None
        val['eps'] = (np_ / shares) if (np_ is not None and shares) else None
        val['net_profit_margin'] = (np_ / rev * 100.0) if (np_ is not None and rev) else None
        v_oc = fv.get('op_cf_ratio')
        val['op_cf_ratio'] = (v_oc * 100.0) if v_oc is not None else None
        val['ocf_to_operating_profit'] = val['op_cf_ratio']
        v_pg = fv.get('profit_growth_yr')
        val['inc_net_profit_annual'] = (v_pg * 100.0) if v_pg is not None else None
        val['operation_profit_to_total_revenue'] = None
        return val

    def _eval(self, col_or_expr, vals):
        if isinstance(col_or_expr, _Col):
            return vals.get(col_or_expr.name)
        if isinstance(col_or_expr, _Expr):
            l = self._eval(col_or_expr.left, vals)
            r = self._eval(col_or_expr.right, vals)
            if l is None or r is None:
                return None
            try:
                if col_or_expr.op == '+': return l + r
                if col_or_expr.op == '-': return l - r
                if col_or_expr.op == '*': return l * r
                if col_or_expr.op == '/': return l / r if r != 0 else None
            except TypeError:
                return None
        return None

    def _test(self, cond, vals):
        l = self._eval(cond.col, vals)
        if cond.op == 'in':
            # code 列表条目可能是带后缀（000001.XSHE）或纯代码，归一化后比较
            if cond.col.name == 'code' and l is not None:
                lc = l.split('.')[0]
                return lc in {str(v).split('.')[0] for v in cond.value}
            return l in cond.value
        r = cond.value if not isinstance(cond.value, (_Col, _Expr)) else None
        if isinstance(cond.value, _Col):
            r = vals.get(cond.value.name)
        elif isinstance(cond.value, _Expr):
            r = self._eval(cond.value, vals)
        if l is None or r is None:
            return False
        # code 比较归一化后缀
        if cond.col.name == 'code':
            l = l.split('.')[0]
            r = str(r).split('.')[0]
        try:
            if cond.op == '<': return l < r
            if cond.op == '<=': return l <= r
            if cond.op == '>': return l > r
            if cond.op == '>=': return l >= r
            if cond.op == '==': return l == r
            if cond.op == '!=': return l != r
        except TypeError:
            return False
        return False


# ==================== get_current_data ====================

class CurrentData:
    __slots__ = ('paused', 'is_st', 'name', 'last_price', 'day_open', 'high_limit', 'low_limit',
                 'current_price', 'high_price', 'low_price', 'volume_ratio', 'pe_ratio', 'turnover_ratio')

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


class CurrentDataDict:
    """get_current_data() 返回：dict-like，支持 cd[stock]、cd.get()、cd.keys()"""
    def __init__(self, mapping):
        self._m = mapping
    def __getitem__(self, key):
        if isinstance(key, list):
            return {s: self._m[s] for s in key if s in self._m}
        return self._m[key]
    def __contains__(self, key):
        return key in self._m
    def get(self, key, default=None):
        return self._m.get(key, default)
    def keys(self):
        return self._m.keys()


def get_current_data(engine):
    """当前所有持仓+候选池股票的当日实时字段。"""
    date_str = engine.context.current_dt.strftime('%Y-%m-%d')
    codes = set()
    for s in engine.context.portfolio.positions:
        codes.add(s.split('.')[0])
    # 引擎持仓缓存里已加载的股票
    for c in list(engine._price_cache.keys()):
        if date_str in engine._price_cache[c]:
            codes.add(c)
    if not codes:
        return CurrentDataDict({})
    ph = ','.join('?' * len(codes))
    rows = engine.conn.execute(
        'SELECT sd.stock_code, sd.open_price, sd.close_price, sd.pre_close_price, '
        'sd.market_type, sd.trade_status, st.name, sd.volume '
        'FROM stock_daily sd LEFT JOIN stocks st ON sd.stock_code=st.stock_code '
        'WHERE sd.trade_date=? AND sd.stock_code IN (' + ph + ')', [date_str] + list(codes)).fetchall()
    m = {}
    for r in rows:
        code, o, c, pre, mt, ts, name, vol = r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]
        ratio = _board_ratio(mt)
        lu = round(pre * (1 + ratio), 2) if pre else c
        ld = round(pre * (1 - ratio), 2) if pre else c
        is_st = bool(name and ('ST' in str(name).upper() or '退' in str(name)))
        m[engine._fmt_stock(code)] = CurrentData(
            paused=(ts != 1 or not vol),
            is_st=is_st,
            name=str(name or code),
            last_price=c,
            day_open=o,
            high_limit=lu,
            low_limit=ld,
            current_price=c,
            high_price=c, low_price=c,  # 简化：当前是无缝日内路径，明日 bar 才有高低
            volume_ratio=0.0,
        )
    return CurrentDataDict(m)


# ==================== 股票池 ====================

def get_all_stocks_compat(engine):
    return engine.api_get_all_stocks()


def get_all_securities(engine, types=None):
    """全市场证券（股票 + 已回填基金）。返回 DataFrame：display_name/name/start_date/end_date/type。
    JQ 语义：index=证券代码（带后缀），types=['etf','lof','stock'] 等。"""
    import math
    rows_all = []
    date_str = engine.context.current_dt.strftime('%Y-%m-%d')
    # 基金（fund_daily）：type 按代码段细分 etf/lof（简化：沪 51/56/58 深 159 = etf，16 = lof）
    if types is None or {'etf', 'lof', 'fund'} & set(types):
        frows = engine.conn.execute(
            'SELECT fund_code, MIN(trade_date) FROM fund_daily GROUP BY fund_code').fetchall()
        for fc, fd in frows:
            ftype = 'lof' if fc.startswith('16') else 'etf'
            rows_all.append({'code': engine._fmt_stock(fc), 'type': ftype,
                             'start_date': datetime.datetime.strptime(fd, '%Y-%m-%d').date() if fd else None,
                             'end_date': datetime.datetime.strptime(date_str, '%Y-%m-%d').date()})
    # 股票
    if types is None or 'stock' in types:
        srows = engine.conn.execute(
            "SELECT stock_code, name, first_trade_date FROM stocks WHERE status=1 "
            "AND market_type NOT IN (2,8,64)").fetchall()
        # 过滤当日无行情的
        codes_all = [r[0] for r in srows]
        have = set()
        if codes_all:
            ph = ','.join('?' * len(codes_all))
            for (c,) in engine.conn.execute(
                    'SELECT DISTINCT stock_code FROM stock_daily WHERE trade_date=? AND stock_code IN (' + ph + ')',
                    [date_str] + codes_all):
                have.add(c)
        for code, name, ft in srows:
            if code in have:
                rows_all.append({'code': engine._fmt_stock(code), 'type': 'stock',
                                 'name': name,
                                 'start_date': datetime.datetime.strptime(ft, '%Y-%m-%d').date() if ft else None,
                                 'end_date': datetime.datetime.strptime(date_str, '%Y-%m-%d').date(),
                                 'display_name': name})
    df = pd.DataFrame(rows_all)
    if df.empty:
        return df
    df = df.set_index('code')
    # 补 display_name / name
    if 'display_name' not in df.columns:
        df['display_name'] = df.index
    if 'name' not in df.columns:
        df['name'] = df.index
    if types is not None and isinstance(types, (list, tuple)):
        df = df[df['type'].isin(types)]
    return df


def get_index_stocks_compat(engine, index_code):
    """近似成分股：无指数成分名单，按当日市值排名近似。
    000300=前300，000905=301~800，000016=沪市前50，000852=801~1800。
    有前视偏差（市值排名假设可见当日），报告中必须声明。"""
    date_str = engine.context.current_dt.strftime('%Y-%m-%d')
    code6 = index_code.split('.')[0]
    stocks = engine._factor_calc.get_all_stocks(date_str)
    codes = [s.split('.')[0] for s in stocks]
    if not codes:
        return []
    ph = ','.join('?' * len(codes))
    rows = engine.conn.execute(
        'SELECT stock_code, mkt_cap_total FROM stock_daily WHERE trade_date=? AND stock_code IN (' +
        ph + ') AND mkt_cap_total IS NOT NULL', [date_str] + codes).fetchall()
    ranked = sorted([(r[1], r[0]) for r in rows], reverse=True)
    if code6 in ('000300', '399300'):
        sel = ranked[:300]
    elif code6 in ('000905',):
        sel = ranked[300:800]
    elif code6 in ('000852', '399852'):
        sel = ranked[800:1800]
    elif code6 == '000016':
        sel = [(m, c) for m, c in ranked if c.startswith('6')][:50]
    elif code6 in ('000001', '399106', '399001'):
        # 全市场代理：stocks 表全量（含上市日期的 A 股），对日期敏感度低、最稳
        allrows = engine.conn.execute(
            "SELECT stock_code FROM stocks WHERE market_type NOT IN (2, 8, 64) AND status=1").fetchall()
        # 再过滤当日有行情的
        if allrows:
            codes2 = [r[0] for r in allrows]
            ph = ','.join('?' * len(codes2))
            have = engine.conn.execute(
                'SELECT DISTINCT stock_code FROM stock_daily WHERE trade_date=? AND stock_code IN (' + ph + ')',
                [date_str] + codes2).fetchall()
            have_set = {r[0] for r in have}
            sel = [(m, c) for m, c in ranked if c in have_set]
        else:
            sel = [(m, c) for m, c in ranked if m > 0]
    else:
        sel = ranked[:300]
    return [engine._fmt_stock(c) for _, c in sel]


# ==================== 交易日 ====================

def get_trade_days(engine, exchange='XSHG', start_date=None, end_date=None, count=None):
    sd = start_date or engine.context.previous_date or engine.start_date
    ed = end_date or engine.context.current_dt.strftime('%Y-%m-%d')
    if sd is None:
        sd = '1991-01-01'
    rows = engine.conn.execute(
        'SELECT trade_date FROM trade_calendar WHERE is_trading_day=1 AND trade_date>=? '
        'AND trade_date<=? ORDER BY trade_date', (sd, ed)).fetchall()
    out = [r[0] for r in rows]
    return out


# ==================== history ====================

def history_compat(engine, count, unit='1d', field='close', security_list=None,
                   fq='pre', skip_paused=False, df=True, date=None, **kw):
    """多证券历史行情，返回 pandas DataFrame（index=证券）。

    注意：聚宽 history 语义是 index=证券、列=field，本实现与之一致；
    若需 index=日期的时间序列（np.log(h) 等），用 history_ts_compat。"""
    if security_list is None:
        security_list = [s for s in engine.context.portfolio.positions] or get_all_stocks_compat(engine)[:50]
    if isinstance(field, str):
        fields = [field]
    else:
        fields = list(field)
    recs = {}
    for s in security_list:
        h = engine.api_attribute_history(s, count, unit, tuple(fields))
        row = {}
        for f in fields:
            ser = getattr(h, f)
            row[f] = float(ser[-1]) if len(ser) else None
        recs[s] = row
    return pd.DataFrame(recs).T


def history_ts_compat(engine, count, unit='1d', field='close', security_list=None,
                      fq='pre', df=True, date=None, **kw):
    """时间序列版 history：返回 DataFrame（index=日期，columns=证券或('field',证券)）。
    聚宽 history(n,'1d','close',[funds]) 返回 index=日期、列=每证券 close 值。"""
    if security_list is None:
        security_list = [s for s in engine.context.portfolio.positions] or get_all_stocks_compat(engine)[:50]
    if isinstance(field, str):
        fields = [field]
    else:
        fields = list(field)
    # 收集每证券的日期序列（用最长的对齐）
    series = {}
    for s in security_list:
        h = engine.api_attribute_history(s, count, unit, tuple(fields))
        for f in fields:
            ser = getattr(h, f)
            if len(ser):
                series[(f, s)] = pd.Series(list(ser._data))
    if not series:
        return pd.DataFrame()
    # 取每列自身索引（证券间 length 可能略异，就此对齐 index=0..n）
    frame = pd.DataFrame(series)
    if len(fields) == 1:
        frame.columns = security_list[:len(frame.columns)]
    return frame


# ==================== 下单别名 ====================

def order_value(engine, stock, value):
    """order(按金额)。JQ 语义：买/卖 value 元市值。"""
    pos = engine.context.portfolio.positions.get(stock)
    cur = pos.value if pos else 0
    return engine.api_order_target_value(stock, cur + value)


def order_shares(engine, stock, amount):
    pos = engine.context.portfolio.positions.get(stock)
    cur = pos.amount if pos else 0
    return engine.api_order_target(stock, cur + amount)


# ==================== 过滤器 ====================

def _today_names(engine):
    date_str = engine.context.current_dt.strftime('%Y-%m-%d')
    out = {}
    for s in (list(engine.context.portfolio.positions) or []):
        code = s.split('.')[0]
        r = engine.conn.execute('SELECT name FROM stocks WHERE stock_code=?', (code,)).fetchone()
        out[s] = (r[0] if r else '')
    return out


def filter_st_stock(engine, stock_list):
    out = []
    for s in stock_list:
        code = s.split('.')[0]
        r = engine.conn.execute('SELECT name FROM stocks WHERE stock_code=?', (code,)).fetchone()
        name = str(r[0]) if r and r[0] else ''
        if 'ST' in name.upper() or '退' in name:
            continue
        out.append(s)
    return out


def filter_paused_stock(engine, stock_list):
    date_str = engine.context.current_dt.strftime('%Y-%m-%d')
    out = []
    for s in stock_list:
        code = s.split('.')[0]
        r = engine.conn.execute(
            'SELECT trade_status, volume FROM stock_daily WHERE stock_code=? AND trade_date=?',
            (code, date_str)).fetchone()
        if r and (r[0] == 1 and r[1] > 0):
            out.append(s)
    return out


def filter_new_stock(engine, stock_list, days=60):
    date_str = engine.context.current_dt.strftime('%Y-%m-%d')
    limit = (datetime.datetime.strptime(date_str, '%Y-%m-%d')
             - datetime.timedelta(days=days)).strftime('%Y-%m-%d')
    out = []
    for s in stock_list:
        code = s.split('.')[0]
        r = engine.conn.execute('SELECT first_trade_date FROM stocks WHERE stock_code=?', (code,)).fetchone()
        if r and r[0] and r[0] <= limit:
            out.append(s)
    return out


def filter_kcb_stock(engine, stock_list):
    return [s for s in stock_list if not s.split('.')[0].startswith('688')]


# ==================== get_extras ====================

def get_extras(engine, info, stock_list, end_date=None, df=True, **kw):
    """is_st 用当前名近似（无历史 ST 表，报告中声明前视偏差）。"""
    rows = {}
    for s in stock_list:
        code = s.split('.')[0]
        r = engine.conn.execute('SELECT name FROM stocks WHERE stock_code=?', (code,)).fetchone()
        name = str(r[0]) if r and r[0] else ''
        rows[s] = ('ST' in name.upper() or '退' in name) if info == 'is_st' else 0
    return pd.Series(rows) if df else rows


# ==================== get_factor_values（jqfactor 简化）====================

def get_factor_values(engine, securities, factors, start_date=None, end_date=None,
                      count=None, skip_paused=False, frequency='daily'):
    """兼容 jqfactor.get_factor_values —— 返回 {security: {factor: pd.Series(date→value)}}。
    频率受限：仅日线，且由 count 或区间确定快照点（最多 ~120 个点防爆）。"""
    sd = start_date or engine.start_date
    ed = end_date or engine.context.precurrent if False else (end_date or engine.context.current_dt.strftime('%Y-%m-%d'))
    if count and count < 400:
        # 用最近 count 个交易日
        rows = engine.conn.execute(
            'SELECT trade_date FROM trade_calendar WHERE is_trading_day=1 AND trade_date<=? '
            'ORDER BY trade_date DESC LIMIT ?', (ed, count)).fetchall()
        dates = sorted(r[0] for r in rows)
    else:
        rows = engine.conn.execute(
            'SELECT trade_date FROM trade_calendar WHERE is_trading_day=1 AND trade_date>=? AND trade_date<=? '
            'ORDER BY trade_date', (sd, ed)).fetchall()
        dates = [r[0] for r in rows]
    dates = dates[-120:]  # 上限
    codes = [s.split('.')[0] for s in securities]
    out = {s: {} for s in securities}
    for d in dates:
        fv = engine._factor_calc.get_factors(codes, list(factors), d)
        for s, cd in zip(securities, codes):
            v = fv.get(cd, {}).get(next(iter(factors)) if len(factors) == 1 else None)
            if len(factors) == 1:
                out[s].setdefault(factors[0], {})[d] = v
            else:
                for fa in factors:
                    out[s].setdefault(fa, {})[d] = fv.get(cd, {}).get(fa)
    # Series 化
    res = {}
    for s, fert in out.items():
        res[s] = {fa: pd.Series(series) for fa, series in fert.items()}
    return res


# ==================== 无操作 ====================

def _noop(*args, **kwargs):
    return None


def set_option(*args, **kwargs):
    return None


def _log_set_level(self, *args, **kwargs):
    return None


# ==================== 桩模块（防 import 崩）====================
# 策略常见头部 import jqdata/jqfactor/jqlib/kuanke；本地用空桩替代，对外导出 pd/np。
# 桩不隐藏真实逻辑：真正需要的函数都在 env 直接注入，桩里的 * 只兜底 import 语法。

def _install_stubs():
    import sys
    import types as _types

    def _mk_module(name, exports=None):
        mod = _types.ModuleType(name)
        if exports:
            for k, v in exports.items():
                setattr(mod, k, v)
        sys.modules[name] = mod
        return mod

    # jqdata / jqfactor / kuanke
    _mk_module('jqdata')
    _mk_module('jqfactor')
    kuanke = _mk_module('kuanke')
    wizard = _types.ModuleType('kuanke.wizard')
    kuanke.wizard = wizard
    sys.modules['kuanke.wizard'] = wizard

    # jqlib.technical_analysis（少数策略 from jqlib.technical_analysis import *）
    jqlib = _mk_module('jqlib')
    try:
        import jqlib.technical_analysis as _ta  # noqa
    except Exception:
        _ta = _types.ModuleType('jqlib.technical_analysis')
    jqlib.technical_analysis = _ta
    sys.modules['jqlib'] = jqlib
    sys.modules['jqlib.technical_analysis'] = _ta
    return True


# ==================== get_fundamentals_continuously ====================

def get_fundamentals_continuously(engine, q, date=None, count=1, **kw):
    """兼容 get_fundamentals_continuously —— 采样最近 count 个交易日（上限 8 个点防爆），
    逐日调用 get_fundamentals，返回 DataFrame（index=date，columns=query 列）。
    注意：这是时间序列近似，PB/ROE 等慢变量 8 点均值与 250 日均值接近，报告中声明。"""
    fd = FundData(engine)
    end = date or engine.context.current_dt.strftime('%Y-%m-%d')
    n = min(int(count) if count else 8, 8)
    rows_dates = engine.conn.execute(
        'SELECT trade_date FROM trade_calendar WHERE is_trading_day=1 AND trade_date<=? '
        'ORDER BY trade_date DESC LIMIT ?', (end, n)).fetchall()
    dates = sorted(r[0] for r in rows_dates)
    cols_out = None
    frames = []
    for d in dates:
        if d > end:
            continue
        df = fd.build(q, d)
        if not df.empty:
            if cols_out is None:
                cols_out = list(df.columns)
            frames.append(df.iloc[0])
    if not frames:
        return pd.DataFrame(columns=cols_out or [])
    out = pd.DataFrame(frames, index=dates[:len(frames)])
    return out


# ==================== 合并入口 ====================

def merge_jqcompat(env, engine):
    """把兼容层 API 注入引擎执行环境（纯新增不覆盖既有）。"""
    env['query'] = query
    env['valuation'] = valuation
    env['indicator'] = indicator
    env['balance'] = balance
    env['income'] = income
    env['cash_flow'] = cash_flow
    _install_stubs()
    fd = FundData(engine)
    env['get_fundamentals'] = lambda q, date=None: fd.build(q, date or engine.context.current_dt.strftime('%Y-%m-%d'))
    env['get_fundamentals_continuously'] = lambda q, *a, **k: get_fundamentals_continuously(engine, q, *a, **k)
    env['get_current_data'] = lambda *a, **k: get_current_data(engine)
    env['get_index_stocks'] = lambda index, *a, **k: get_index_stocks_compat(engine, index)
    env['get_all_securities'] = lambda *a, **k: get_all_securities(engine, kw_pop_types(a, k))
    env['get_trade_days'] = lambda *a, **k: get_trade_days(engine, *a, **k)
    env['history'] = lambda *a, **k: history_ts_compat(engine, *a, **k)
    env['history_ts'] = lambda *a, **k: history_ts_compat(engine, *a, **k)
    # np 注入（聚宽策略常直接 np.log 而 import 中未显式 numpy）
    try:
        import numpy as _np
        env['np'] = _np
        env['cov'] = lambda x, y: _np.cov(x, y) if hasattr(x, 'values') else _np.cov(x, y)
    except Exception:
        env['cov'] = _noop
    env['unschedule_all'] = _noop
    env['schedule_function'] = _noop
    env['order_value'] = lambda stock, value: order_value(engine, stock, value)
    env['order_shares'] = lambda stock, amount: order_shares(engine, stock, amount)
    env['set_option'] = set_option
    env['filter_st_stock'] = lambda sl: filter_st_stock(engine, sl)
    env['filter_paused_stock'] = lambda sl: filter_paused_stock(engine, sl)
    env['filter_new_stock'] = lambda sl, *a, **k: filter_new_stock(engine, sl, *a, **k)
    env['filter_kcb_stock'] = lambda sl: filter_kcb_stock(engine, sl)
    env['get_extras'] = lambda *a, **k: get_extras(engine, *a, **k)
    env['get_factor_values'] = lambda *a, **k: get_factor_values(engine, *a, **k)
    # log.set_level 无操作
    for name in ('info', 'warn', 'error', 'debug'):
        pass
    if getattr(engine.log, 'set_level', None) is None:
        def _sl(self, *args, **kwargs):
            return None
        engine.log.set_level = _sl.__get__(engine.log, type(engine.log))
    return env


def kw_pop_types(args, kw):
    if args:
        return args[0]
    return kw.pop('types', None)