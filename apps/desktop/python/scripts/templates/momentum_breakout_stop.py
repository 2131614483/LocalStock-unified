# 动量突破 + 移动止损策略：突破前 N 日最高买入，此后跟踪最高价，跌破峰值×(1−trailing) 止损离场
# 只持有一只，趋势+风控结合
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.stock = '600519.XSHG'
    g.entry_n = 20
    g.trailing = 0.10  # 移动止损 10%
    run_daily(trade)


def trade(context):
    hist = attribute_history(g.stock, g.entry_n + 2, '1d', ('close',))
    closes = list(hist['close'])
    if len(closes) < g.entry_n + 1:
        return
    price = closes[-1]
    entry_high = max(closes[-g.entry_n:-1])  # 不含今日
    position = context.portfolio.positions.get(g.stock)

    if not position:
        if price > entry_high:
            order_target_value(g.stock, context.portfolio.total_value * 0.95)
            g.peak = price
            log.info('动量突破买入 ' + g.stock)
    else:
        g.peak = max(getattr(g, 'peak', price), price)
        if price < g.peak * (1 - g.trailing):
            order_target_value(g.stock, 0)
            log.info('移动止损离场，峰值 %s' % round(g.peak, 2))
