# MACD 金叉死叉策略：DIF 上穿 DEA 买入，下穿卖出；可限制只在 DIF>0（多头区）做多减少震荡假信号
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def _ema(vals, n):
    k = 2.0 / (n + 1)
    out = []
    prev = None
    for v in vals:
        prev = v if prev is None else v * k + prev * (1 - k)
        out.append(prev)
    return out


def initialize(context):
    g.stocks = ['600519.XSHG', '000001.XSHE']
    g.fast = 12
    g.slow = 26
    g.signal = 9
    g.only_positive = True  # True=仅在 DIF>0 时做多；False=金叉即做多
    g.weight = 0.9
    run_daily(trade)


def trade(context):
    for stock in g.stocks:
        hist = attribute_history(stock, g.slow * 3, '1d', ('close',))
        closes = list(hist['close'])
        if len(closes) < g.slow * 2:
            continue
        ema_f = _ema(closes, g.fast)
        ema_s = _ema(closes, g.slow)
        dif = [a - b for a, b in zip(ema_f, ema_s)]
        dea = _ema(dif, g.signal)
        n = len(dif)
        position = context.portfolio.positions.get(stock)
        golden = dif[n - 2] <= dea[n - 2] and dif[n - 1] > dea[n - 1]
        death = dif[n - 2] >= dea[n - 2] and dif[n - 1] < dea[n - 1]
        if golden and (not g.only_positive or dif[n - 1] > 0) and not position:
            order_target_value(stock, context.portfolio.total_value * g.weight / len(g.stocks))
            log.info('MACD金叉买入 ' + stock)
        elif death and position:
            order_target_value(stock, 0)
            log.info('MACD死叉卖出 ' + stock)
