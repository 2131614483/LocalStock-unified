# 布林带策略模板：收盘价突破上轨买入，跌破下轨卖出
def initialize(context):
    g.stocks = ['600519.XSHG']
    g.n = 20    # 布林周期
    g.k = 2.0   # 标准差倍数
    run_daily(trade)


def trade(context):
    stock = g.stocks[0]
    hist = attribute_history(stock, g.n + 1, '1d', ('close',))
    n = len(hist['close'])
    if n < g.n + 1:
        return
    closes = [hist['close'][i] for i in range(n)]
    window = closes[-g.n:]
    ma = sum(window) / g.n
    variance = sum((x - ma) ** 2 for x in window) / g.n
    std = variance ** 0.5
    upper = ma + g.k * std
    lower = ma - g.k * std
    price = closes[-1]
    position = context.portfolio.positions.get(stock)
    if price > upper and not position:
        order_target_value(stock, context.portfolio.total_value * 0.95)
        log.info('突破上轨买入 ' + stock)
    elif price < lower and position:
        order_target_value(stock, 0)
        log.info('跌破下轨卖出 ' + stock)
