# 均线粘合突破策略：MA5/10/20/60 收窄到同一条带（蓄势）后，收盘上穿粘合带上沿买入
# 典型"蓄势突破"：先震荡收敛，再选择方向；跌破 MA20 离场
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.stock = '600519.XSHG'
    g.short = 5
    g.mid = 20
    g.long = 60
    g.band = 0.06   # 粘合带宽：4 条均线极差 / 价格 < band 视为粘合
    g.weight = 0.95
    run_daily(trade)


def _ma(vals, n):
    return sum(vals[-n:]) / n


def trade(context):
    hist = attribute_history(g.stock, g.long + 1, '1d', ('close',))
    closes = list(hist['close'])
    if len(closes) < g.long + 1:
        return
    price = closes[-1]
    ma_s = _ma(closes, g.short)
    ma_m = _ma(closes, g.mid)
    ma_l = _ma(closes, g.long)
    mas = [ma_s, _ma(closes, 10), ma_m, ma_l]
    spread = (max(mas) - min(mas)) / price  # 相对极差
    position = context.portfolio.positions.get(g.stock)

    if not position:
        # 粘合蓄势 + 收盘突破粘合带上沿
        if spread < g.band and price > max(mas):
            order_target_value(g.stock, context.portfolio.total_value * g.weight)
            log.info('均线粘合突破买入，spread=%.3f' % spread)
    else:
        if price < ma_m:
            order_target_value(g.stock, 0)
            log.info('跌破 MA20 离场')
