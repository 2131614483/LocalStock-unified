# 二八轮动策略：月度比较"大盘(蓝筹) vs 小盘(成长)"池的 N 日动量，持有强势池（等权），清仓弱势池
# A股经典轮动思路：市场风格切换时跟随强势风格
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.large = ['600519.XSHG', '601318.XSHG']  # 大盘蓝筹（沪深300 代表）
    g.small = ['300750.XSHE', '300059.XSHE']  # 成长/创业板
    g.lookback = 20
    g.weight = 0.95
    run_daily(rebalance)


def _pool_return(stocks):
    rets = []
    for s in stocks:
        hist = attribute_history(s, g.lookback + 1, '1d', ('close',))
        closes = list(hist['close'])
        if len(closes) >= g.lookback + 1:
            rets.append(closes[-1] / closes[-g.lookback - 1] - 1)
    return sum(rets) / len(rets) if rets else -1.0


def rebalance(context):
    month = context.current_dt.strftime('%Y-%m')
    if getattr(g, 'last_month', None) == month:
        return
    g.last_month = month

    rl = _pool_return(g.large)
    rs = _pool_return(g.small)
    hold = g.large if rl >= rs else g.small
    log.info('二八轮动：大盘 %s 小盘 %s → 持有%s' % (round(rl, 4), round(rs, 4), '大盘' if hold is g.large else '小盘'))

    for pool in (g.large, g.small):
        for stock in pool:
            position = context.portfolio.positions.get(stock)
            if pool is hold and not position:
                order_target_value(stock, context.portfolio.total_value * g.weight / len(pool))
                log.info('轮动买入 ' + stock)
            elif pool is not hold and position:
                order_target_value(stock, 0)
                log.info('轮动卖出 ' + stock)
