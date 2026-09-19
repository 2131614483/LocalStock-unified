# 均线偏离回归策略：收盘 < MA20×(1−deviation%)（超卖偏离）买入，回升突破 MA20 卖出
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.stocks = ['600519.XSHG', '000001.XSHE']
    g.long = 20
    g.deviation = 0.05  # 偏离均线阈值（5%）
    g.weight = 0.9
    run_daily(trade)


def trade(context):
    for stock in g.stocks:
        hist = attribute_history(stock, g.long + 1, '1d', ('close',))
        closes = list(hist['close'])
        if len(closes) < g.long + 1:
            continue
        ma = sum(closes[-g.long:]) / g.long
        price = closes[-1]
        position = context.portfolio.positions.get(stock)
        if price < ma * (1 - g.deviation) and not position:
            order_target_value(stock, context.portfolio.total_value * g.weight / len(g.stocks))
            log.info('超卖偏离买入 ' + stock)
        elif price > ma and position:
            order_target_value(stock, 0)
            log.info('回归卖出 ' + stock)
