# 均线+MACD 共振策略：MA金叉 且 MACD金叉 同时出现才买入（共振降假信号），任一死叉即卖出
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
    g.fast = 5
    g.slow = 20
    g.macd_fast = 12
    g.macd_slow = 26
    g.macd_signal = 9
    g.weight = 0.9
    run_daily(trade)


def trade(context):
    need = max(g.slow, g.macd_slow * 3) + 1
    for stock in g.stocks:
        hist = attribute_history(stock, need, '1d', ('close',))
        closes = list(hist['close'])
        if len(closes) < g.macd_slow * 2:
            continue
        ma_f = sum(closes[-g.fast:]) / g.fast
        ma_s = sum(closes[-g.slow:]) / g.slow
        ema_f = _ema(closes, g.macd_fast)
        ema_s = _ema(closes, g.macd_slow)
        dif = [a - b for a, b in zip(ema_f, ema_s)]
        dea = _ema(dif, g.macd_signal)
        n = len(dif)
        macd_golden = dif[n - 2] <= dea[n - 2] and dif[n - 1] > dea[n - 1]
        macd_death = dif[n - 2] >= dea[n - 2] and dif[n - 1] < dea[n - 1]
        position = context.portfolio.positions.get(stock)
        # 共振买入：MA 金叉 且 MACD 金叉
        if ma_f > ma_s and macd_golden and not position:
            order_target_value(stock, context.portfolio.total_value * g.weight / len(g.stocks))
            log.info('共振买入 ' + stock)
        # 任一死叉卖出
        elif (ma_f < ma_s or macd_death) and position:
            order_target_value(stock, 0)
            log.info('共振离场 ' + stock)
