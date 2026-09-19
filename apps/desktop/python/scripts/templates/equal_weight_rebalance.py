# 等权组合再平衡策略：固定股票池按等权重持有，每月再平衡到目标权重
# 纪律化被动投资，避免主观择时；偏离超阈值才调，减少无谓换手
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.stocks = ['600519.XSHG', '000001.XSHE', '000858.XSHE', '300750.XSHE',
                '601318.XSHG', '002594.XSHE', '300059.XSHE', '002475.XSHE']
    g.target_weight = 0.95 / len(g.stocks)  # 总仓位 95% 等分
    g.threshold = 0.03  # 相对总资产偏离超 3% 才再平衡
    run_monthly(rebalance, 1)


def rebalance(context):
    tv = context.portfolio.total_value
    for stock in g.stocks:
        target = tv * g.target_weight
        position = context.portfolio.positions.get(stock)
        current = position.value if position else 0.0
        if abs(current - target) / tv > g.threshold:
            order_target_value(stock, target)
            log.info('再平衡 %s 至 %s' % (stock, round(target)))
