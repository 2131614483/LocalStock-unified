# 均线多头排列策略：MA5 > MA10 > MA20（多头排列）买入，排列破坏（MA5<MA10）或收盘破 MA20 卖出
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.stocks = ['600519.XSHG', '000001.XSHE']
    g.short = 5
    g.mid = 10
    g.long = 20
    g.weight = 0.9  # 满仓仓位系数
    run_daily(trade)


def trade(context):
    for stock in g.stocks:
        hist = attribute_history(stock, g.long + 1, '1d', ('close',))
        closes = list(hist['close'])
        if len(closes) < g.long + 1:
            continue
        ma_short = sum(closes[-g.short:]) / g.short
        ma_mid = sum(closes[-g.mid:]) / g.mid
        ma_long = sum(closes[-g.long:]) / g.long
        price = closes[-1]
        position = context.portfolio.positions.get(stock)
        # 多头排列：MA5 > MA10 > MA20
        if ma_short > ma_mid > ma_long and not position:
            order_target_value(stock, context.portfolio.total_value * g.weight / len(g.stocks))
            log.info('多头排列买入 ' + stock)
        # 排列破坏或破 MA20 离场
        elif (ma_short < ma_mid or price < ma_long) and position:
            order_target_value(stock, 0)
            log.info('排列破坏卖出 ' + stock)
