# 定投策略：每月固定投入（不管价格），A股经典长期定投，成本摊薄
# 注意：引擎按 100 股整手买入，故月度金额需足够买 1 手（高价股请调大 monthly_amount 或换低价股）
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.stock = '000001.XSHE'  # 平安银行（低价股，5万可买整手）；高价股如 600519 需调大金额
    g.monthly_amount = 50000  # 每月投入金额
    run_monthly(buy, 5)  # 每月 5 号定投


def buy(context):
    position = context.portfolio.positions.get(g.stock)
    current = position.value if position else 0.0
    # 目标 = 当前持仓市值 + 本月投入（近似"买入 amount 市值"的份额）
    order_target_value(g.stock, current + g.monthly_amount)
    log.info('定投买入，持仓市值至 ' + str(round(current + g.monthly_amount)))
