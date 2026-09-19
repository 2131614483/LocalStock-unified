# N日新高突破策略：收盘价突破前 N 日最高买入，跌破前 M 日最低卖出（收盘价版唐奇安通道）
# 可选用量能确认（突破日量 > 均量×倍数），设 vol_confirm=0 关闭
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.stocks = ['600519.XSHG', '000001.XSHE']
    g.entry_n = 20  # 入场通道周期
    g.exit_n = 10   # 离场通道周期
    g.vol_confirm = 1.5  # 突破日量能确认倍数（0=关闭）
    g.weight = 0.95
    run_daily(trade)


def trade(context):
    for stock in g.stocks:
        hist = attribute_history(stock, max(g.entry_n, g.exit_n) + 1, '1d', ('close', 'volume'))
        closes = list(hist['close'])
        vols = list(hist['volume'])
        if len(closes) < max(g.entry_n, g.exit_n) + 1:
            continue
        entry_high = max(closes[-g.entry_n:-1])  # 不含今日的前 N 日最高
        exit_low = min(closes[-g.exit_n:-1])     # 不含今日的前 M 日最低
        price = closes[-1]
        position = context.portfolio.positions.get(stock)
        if price > entry_high and not position:
            if g.vol_confirm <= 0 or vols[-1] > (sum(vols[-g.entry_n:-1]) / (g.entry_n - 1)) * g.vol_confirm:
                order_target_value(stock, context.portfolio.total_value * g.weight / len(g.stocks))
                log.info('新高突破买入 ' + stock)
        elif price < exit_low and position:
            order_target_value(stock, 0)
            log.info('跌破离场 ' + stock)
