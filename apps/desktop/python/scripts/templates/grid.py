# 网格交易策略：以初始价为基准，价格每下跌一格买入一层、每上涨一格卖出一层（仅做多，长期网格摊低成本）
# 适合震荡市；趋势单边下跌会满仓套牢，需配合止损（g.emergency_stop）
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.stock = '600519.XSHG'
    g.step = 0.05      # 网格步长 5%
    g.levels = 3       # 向下网格层数（可买 3 层）
    g.emergency_stop = 0.2  # 从初始价下跌 20% 强制清仓止损（0=关闭）
    g.base = None      # 首次运行时设为初始价
    g.level = 0        # 当前买入层数（0=空仓，1..levels 层）
    run_daily(trade)


def trade(context):
    hist = attribute_history(g.stock, 2, '1d', ('close',))
    price = hist['close'][-1]
    if g.base is None:
        g.base = price
        return
    total = context.portfolio.total_value
    unit = total * 0.9 / g.levels  # 每层仓位
    position = context.portfolio.positions.get(g.stock)
    current_value = position.value if position else 0.0

    # 止损：跌破初始价×(1-emergency_stop) 清仓
    if g.emergency_stop > 0 and price < g.base * (1 - g.emergency_stop) and g.level > 0:
        order_target_value(g.stock, 0)
        g.level = 0
        log.info('网格止损清仓 ' + g.stock)
        return

    # 下跌一格买入一层
    if price <= g.base * (1 - g.step * g.level) and g.level < g.levels:
        g.level += 1
        order_target_value(g.stock, current_value + unit)
        log.info('网格第%d层买入，价 %s' % (g.level, price))
    # 上涨一格卖出一层（卖出后回到上一层的价值）
    elif price >= g.base * (1 - g.step * g.level) and g.level > 0:
        g.level -= 1
        order_target_value(g.stock, current_value - unit)
        log.info('网格卖出一层，价 %s' % price)
