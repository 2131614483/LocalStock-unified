# -*- coding: utf-8 -*-
"""适配版：抗熊市的中短期低市值策略（原文 14）
逻辑：全市场（综指≈全A），取市值最小 20 只买入（各 5 万），
持仓股依价格跌破 MA20/MA15/MA10 分级加仓、盈利>5%/10%/15% 分级减仓。
适配改动（不改选股逻辑，仅调度/语法）：
- 原文 run_daily(每交易日) 因全市场基本面查询过重，本地改 run_monthly（月频轮动，
  更符合小市值策略低换手意图；日频调仓在本地引擎会因每交易日全量查询而不可行）
- context.portfolio.cash / order_value 已由引擎+jqcompat 支持
"""
import jqdata

def initialize(context):
    run_monthly(period, 1, 'before_open')
    g.stocksnum = 20


def period(context):
    scu = get_index_stocks('000001.XSHG') + get_index_stocks('399106.XSHE')
    q = query(valuation.code).filter(valuation.code.in_(scu)).order_by(
        valuation.market_cap.asc()).limit(g.stocksnum)
    df = get_fundamentals(q)
    stocklist = list(df['code'])
    m = get_current_data()
    buylist = stocklist
    for stock in context.portfolio.positions:
        if stock not in buylist:
            order_target(stock, 0)
    for stk in buylist:
        order_value(stk, 50000)
    # 移出持仓的股票已清仓；对仍持有的按均线/利润分级加减仓
    for stk in context.portfolio.positions:
        pos = context.portfolio.positions[stk]
        cost = pos.price
        close_data = attribute_history(stk, 10, '1d', ['close'])
        close_data2 = attribute_history(stk, 15, '1d', ['close'])
        close_data3 = attribute_history(stk, 20, '1d', ['close'])
        MA10 = close_data['close'].mean()
        MA15 = close_data2['close'].mean()
        MA20 = close_data3['close'].mean()
        price = close_data['close'][-1]
        ret = price / cost - 1
        cash = context.portfolio.cash / 20
        if price < MA20:
            order_value(stk, cash * 0.5)
        elif price < MA15:
            order_value(stk, cash * 0.3)
        elif price < MA10:
            order_value(stk, cash * 0.2)
        elif ret > 0.15:
            order_value(stk, -cash * 0.5)
        elif ret > 0.10:
            order_value(stk, -cash * 0.3)
        elif ret > 0.05:
            order_value(stk, -cash * 0.2)