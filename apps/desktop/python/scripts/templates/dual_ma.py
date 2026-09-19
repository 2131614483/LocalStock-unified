# 双均线策略模板：MA5 上穿 MA20 买入，下穿卖出（对股票池中每只股票独立判断）
def initialize(context):
    g.stocks = ['600519.XSHG', '000001.XSHE']
    g.short = 5
    g.long = 20
    run_daily(trade)


def trade(context):
    for stock in g.stocks:
        hist = attribute_history(stock, g.long + 1, '1d', ('close',))
        n = len(hist['close'])
        if n < g.long + 1:
            continue
        closes = [hist['close'][i] for i in range(n)]
        ma_short = sum(closes[-g.short:]) / g.short
        ma_long = sum(closes[-g.long:]) / g.long
        position = context.portfolio.positions.get(stock)
        if ma_short > ma_long and not position:
            # 金叉：买入，单只仓位不超过 90% / 股票数
            order_target_value(stock, context.portfolio.total_value * 0.9 / len(g.stocks))
            log.info('金叉买入 ' + stock)
        elif ma_short < ma_long and position:
            # 死叉：清仓
            order_target_value(stock, 0)
            log.info('死叉卖出 ' + stock)
