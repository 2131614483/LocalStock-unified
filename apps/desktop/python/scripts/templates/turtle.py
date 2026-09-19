# 海龟策略模板：唐奇安通道突破——突破 N 日最高价买入，跌破 M 日最低价卖出
def initialize(context):
    g.stocks = ['600519.XSHG']
    g.entry_n = 20  # 入场通道周期
    g.exit_n = 10   # 离场通道周期
    run_daily(trade)


def trade(context):
    stock = g.stocks[0]
    hist = attribute_history(stock, g.entry_n + 1, '1d', ('close', 'high', 'low'))
    n = len(hist['close'])
    if n < g.entry_n + 1:
        return
    highs = [hist['high'][i] for i in range(n)]
    lows = [hist['low'][i] for i in range(n)]
    closes = [hist['close'][i] for i in range(n)]
    entry_high = max(highs[-g.entry_n:-1])   # 不含今日的 N 日高点
    exit_low = min(lows[-g.exit_n:-1])       # 不含今日的 M 日低点
    price = closes[-1]
    position = context.portfolio.positions.get(stock)
    if price > entry_high and not position:
        order_target_value(stock, context.portfolio.total_value * 0.95)
        log.info('突破买入 ' + stock)
    elif price < exit_low and position:
        order_target_value(stock, 0)
        log.info('跌破离场 ' + stock)
