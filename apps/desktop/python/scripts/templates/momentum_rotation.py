# 动量轮动策略：每月按 N 日涨幅排序，持有前 K 只（等权），卖出落选者
# 经典的大小盘/二八轮动思路，在股票池间轮动强势品种
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.stocks = [
        '600519.XSHG', '000001.XSHE', '000858.XSHE', '300750.XSHE',
        '601318.XSHG', '002594.XSHE', '300059.XSHE', '002475.XSHE',
    ]
    g.lookback = 20   # 动量回看天数
    g.hold_k = 2      # 持有前 K 只
    g.weight = 0.95
    run_daily(rebalance)


def rebalance(context):
    # 月变化检测：每个交易月只调仓一次（首个交易日）
    month = context.current_dt.strftime('%Y-%m')
    if getattr(g, 'last_month', None) == month:
        return
    g.last_month = month

    returns = []
    for stock in g.stocks:
        hist = attribute_history(stock, g.lookback + 1, '1d', ('close',))
        closes = list(hist['close'])
        if len(closes) < g.lookback + 1:
            continue
        ret = closes[-1] / closes[-g.lookback - 1] - 1
        returns.append((stock, ret))
    if not returns:
        return

    returns.sort(key=lambda x: x[1], reverse=True)
    top = [s for s, _ in returns[:g.hold_k]]
    target = context.portfolio.total_value * g.weight / len(top)

    for stock in g.stocks:
        position = context.portfolio.positions.get(stock)
        if stock in top and not position:
            order_target_value(stock, target)
            log.info('轮动买入 ' + stock)
        elif stock not in top and position:
            order_target_value(stock, 0)
            log.info('轮动卖出 ' + stock)
