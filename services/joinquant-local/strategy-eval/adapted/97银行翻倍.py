# -*- coding: utf-8 -*-
"""适配版：银行翻倍策略（原文 97 银行翻倍策略）
原逻辑：26 只银行股，取最近 PB/ROE 均值算"翻倍期"，选翻倍期最短的 5 只月频等权持有。
适配改动（不改选股逻辑）：
- 删 set_option/log.set_level（引擎忽略）
- Python2 print → log.info
- df.sort() → df.sort_values()（pandas 2.x）
- get_fundamentals_continuously(count=250) → 引擎采样最近 20 交易日（jqcompat 上限）
"""
import jqdata
import math
import pandas as pd

log.set_level('order', 'error')


def initialize(context):
    set_benchmark('000300.XSHG')
    set_option('use_real_price', True)
    run_monthly(handle, 1, 'before_open')
    set_order_cost(OrderCost(open_tax=0, close_tax=0, open_commission=0.0003,
                             close_commission=0.0013, close_today_commission=0,
                             min_commission=0), type='stock')
    set_slippage(FixedSlippage(0.02))


def handle(context):
    buylist = check_stock(context)
    for stock in context.portfolio.positions:
        if stock not in buylist:
            order_target_value(stock, 0)
    for stock in buylist:
        order_target_value(stock, context.portfolio.total_value / len(buylist))


def check_stock(context):
    stock_list = ['000001.XSHE', '002142.XSHE', '002807.XSHE', '002839.XSHE', '600000.XSHG',
                  '600015.XSHG', '600016.XSHG', '600036.XSHG', '600908.XSHG', '600919.XSHG',
                  '600926.XSHG', '601009.XSHG', '601128.XSHG', '601166.XSHG', '601169.XSHG',
                  '601229.XSHG', '601288.XSHG', '601328.XSHG', '601398.XSHG', '601818.XSHG',
                  '601838.XSHG', '601939.XSHG', '601988.XSHG', '601997.XSHG', '601998.XSHG',
                  '603323.XSHG']
    df = pd.DataFrame(index=stock_list, columns=['ROE', 'PB'])
    for stk1 in stock_list:
        P = get_fundamentals_continuously(query(indicator.code, valuation.pb_ratio)
                                          .filter(valuation.code == stk1), count=250)
        RO = get_fundamentals_continuously(query(indicator.code, indicator.roe)
                                           .filter(valuation.code == stk1), count=250)
        df['PB'][stk1] = P['pb_ratio'].values.mean()
        df['ROE'][stk1] = RO['roe'].values.mean() / 100

    df = df[df['ROE'] > -1]
    df['double_time'] = df.apply(lambda row: round(math.log(2.0 * row['PB'],
                                                             (1.0 + row['ROE'])), 2), axis=1)
    df = df.sort_values('double_time')
    log.info(context.current_dt.strftime('%Y-%m-%d') + ' 选股为 ' + str(df.index[:5].values))
    return df.index[:5]