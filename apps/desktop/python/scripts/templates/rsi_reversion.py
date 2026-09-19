# RSI 超买超卖策略：RSI < 30（超卖）买入，RSI > 70（超买）卖出（Wilder 平滑）
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def _rsi(closes, n=14):
    out = [None] * len(closes)
    if len(closes) < n + 1:
        return out
    gains = [max(closes[i] - closes[i - 1], 0) for i in range(1, len(closes))]
    losses = [max(closes[i - 1] - closes[i], 0) for i in range(1, len(closes))]
    avg_g = sum(gains[:n]) / n
    avg_l = sum(losses[:n]) / n
    out[n] = 100 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
    for i in range(n + 1, len(closes)):
        avg_g = (avg_g * (n - 1) + gains[i - 1]) / n
        avg_l = (avg_l * (n - 1) + losses[i - 1]) / n
        out[i] = 100 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
    return out


def initialize(context):
    g.stocks = ['600519.XSHG', '000001.XSHE']
    g.n = 14
    g.oversold = 30
    g.overbought = 70
    g.weight = 0.9
    run_daily(trade)


def trade(context):
    for stock in g.stocks:
        hist = attribute_history(stock, g.n * 3, '1d', ('close',))
        closes = list(hist['close'])
        if len(closes) < g.n * 2:
            continue
        r = _rsi(closes, g.n)[-1]
        if r is None:
            continue
        position = context.portfolio.positions.get(stock)
        if r < g.oversold and not position:
            order_target_value(stock, context.portfolio.total_value * g.weight / len(g.stocks))
            log.info('RSI超卖买入 ' + stock)
        elif r > g.overbought and position:
            order_target_value(stock, 0)
            log.info('RSI超买卖出 ' + stock)
