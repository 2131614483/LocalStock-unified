# 均线回踩企稳策略：上升趋势（MA20>MA60 且价>MA60）中，回踩跌破 MA20 后重新收回买入
# 持有中正常回踩不动，跌破 MA60 视为趋势破坏才离场
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.stock = '600519.XSHG'
    g.fast = 20
    g.trend = 60
    g.weight = 0.95
    run_daily(trade)


def _ma(vals, n):
    return sum(vals[-n:]) / n


def trade(context):
    hist = attribute_history(g.stock, g.trend + 2, '1d', ('close',))
    closes = list(hist['close'])
    if len(closes) < g.trend + 1:
        return
    price = closes[-1]
    ma_f = _ma(closes, g.fast)
    ma_t = _ma(closes, g.trend)
    prev_close = closes[-2]
    prev_ma_f = sum(closes[-g.fast - 1:-1]) / g.fast  # 昨日 MA(fast)
    position = context.portfolio.positions.get(g.stock)

    if not position:
        # 上升趋势 + 昨日跌破 MA20 + 今日收回 MA20
        if ma_f > ma_t and price > ma_t and prev_close < prev_ma_f and price > ma_f:
            order_target_value(g.stock, context.portfolio.total_value * g.weight)
            log.info('回踩企稳买入 ' + g.stock)
    else:
        if price < ma_t:
            order_target_value(g.stock, 0)
            log.info('跌破 MA60 趋势破坏离场')
