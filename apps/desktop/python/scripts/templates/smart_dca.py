# 智能定投策略：每月固定投入，且偏离 MA60 越大加码越多（跌多买多），越贵投越少
# 相比固定定投，熊市吸筹更充分；min/max 比例控制投入波动
# 注意：引擎按 100 股整手买入，金额需足够买 1 手；策略里不要用 print()，请用 log()
def initialize(context):
    g.stock = '000001.XSHE'  # 平安银行（低价股）；高价股如 600519 需调大金额
    g.monthly_amount = 50000  # 基准每月投入
    g.ma = 60
    g.boost = 4.0     # 乖离每 10% 对应的加码倍数（乖离 ×4）
    g.min_scale = 0.5  # 越贵时的最低投入比例
    g.max_scale = 3.0  # 越便宜时的最高投入比例
    run_monthly(buy, 5)


def buy(context):
    hist = attribute_history(g.stock, g.ma + 1, '1d', ('close',))
    closes = list(hist['close'])
    if len(closes) < g.ma + 1:
        return
    price = closes[-1]
    ma = sum(closes[-g.ma:]) / g.ma
    dev = (ma - price) / ma  # >0 表示低于均线（便宜）
    scale = max(g.min_scale, min(g.max_scale, 1 + g.boost * dev))
    amount = g.monthly_amount * scale
    position = context.portfolio.positions.get(g.stock)
    current = position.value if position else 0.0
    order_target_value(g.stock, current + amount)
    log.info('定投买入 %s（乖离 %+.1f%%×%.2f）' % (round(amount), dev * 100, scale))
