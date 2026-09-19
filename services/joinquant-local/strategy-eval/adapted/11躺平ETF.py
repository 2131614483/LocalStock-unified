# -*- coding: utf-8 -*-
"""适配版：定投ETF之躺平赢（原文 11.致敬市场--5）
逻辑：每周一全市场 ETF/LOF，过滤上市>1年+流动性(21日均额>100万)；
对每只做 CAPM 回归（基准 399300），选 alpha>0、0.9<beta<1.1、残差波动小的 top5 买入 5% 仓位，其余清仓。
适配改动（不改逻辑，仅 API/语法）：
- after_code_changed 的 unschedule_all/schedule 在引擎无意义 → 直接 initialize 里 run_weekly
- np/cov/history(时间序列版) 已由 jqcompat 支持
- get_current_data()[s].name 已支持
"""
import pandas as pd
import datetime as dt

def initialize(context):
    log.set_level('order', 'error')
    set_option('use_real_price', True)
    set_option('avoid_future_data', True)
    run_weekly(iTrader, 1, time='open')


def iTrader(context):
    # 参数
    index = '399300.XSHE'
    # 过滤，当前在市、一年前上市的基金
    dt_now = context.current_dt.date()
    dt_1y = dt_now - dt.timedelta(days=365)
    all_fund = get_all_securities(['etf', 'lof'], dt_now)
    all_fund = all_fund[all_fund.start_date < dt_1y]
    funds = all_fund.index.tolist()
    if not funds:
        return
    # 流动性过滤
    hm = history(21, '1d', 'money', funds).min()
    funds = [s for s in hm.index if hm[s] > 1e6]
    if not funds:
        return
    # 历史价格
    h = history(241, '1d', 'close', funds + [index])
    h = h.iloc[:min(len(h), 241)]
    if len(h) < 60:
        return
    r = np.log(h).diff()[1:]
    rx = r[index]
    # CAPM
    capm = pd.DataFrame(columns=['alpha', 'beta', 'delta', 'name'])
    for s in funds:
        rs = r[s]
        cm = cov(rs, rx)
        beta = cm[0, 1] / cm[1, 1]
        z = rs - beta * rx
        alpha = 24000 * z.mean()
        delta = 1550 * z.std()
        if alpha > 0 and 0.9 < beta < 1.1 and delta < 10:
            capm.loc[s] = [alpha, beta, delta, all_fund.display_name.get(s, s)]
    capm = capm.sort_values(by='alpha', ascending=False).head(10)
    funds = capm.index.tolist()
    log.info('\n', capm)
    cdata = get_current_data()
    for s in context.portfolio.positions:
        if s not in funds:
            order_target(s, 0)
    psize = 0.05 * context.portfolio.total_value
    for s in funds[:5]:
        if context.portfolio.available_cash < psize:
            break
        order_value(s, psize)