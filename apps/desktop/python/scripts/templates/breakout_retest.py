# 突破回踩策略：突破前 N 日最高后不追高，等回踩到突破价附近企稳再买（retest）
# 回踩跌破突破价×(1−retest_lo) 视为假突破重置；持仓跌破突破价×(1−stop) 离场
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.stock = '600519.XSHG'
    g.entry_n = 20
    g.retest_hi = 0.02  # 回踩上界：突破价 ×(1+retest_hi) 内企稳可买
    g.retest_lo = 0.04  # 回踩下界：跌破突破价 ×(1-retest_lo) 视为假突破
    g.stop = 0.05       # 持仓跌破突破价 ×(1-stop) 离场
    g.weight = 0.95
    run_daily(trade)


def trade(context):
    hist = attribute_history(g.stock, g.entry_n + 2, '1d', ('close',))
    closes = list(hist['close'])
    if len(closes) < g.entry_n + 1:
        return
    price = closes[-1]
    entry_high = max(closes[-g.entry_n:-1])  # 不含今日的前 N 日最高
    position = context.portfolio.positions.get(g.stock)

    if not position:
        if not getattr(g, 'broke', False):
            if price > entry_high:
                g.broke = True
                g.level = entry_high
                log.info('突破前 N 高 %s，等待回踩' % round(entry_high, 2))
        else:
            level = g.level
            if price >= level * (1 - g.retest_lo):
                if price <= level * (1 + g.retest_hi):
                    order_target_value(g.stock, context.portfolio.total_value * g.weight)
                    log.info('回踩企稳买入，价 %s' % round(price, 2))
            else:
                g.broke = False  # 跌破回踩下界，假突破
                log.info('回踩失败重置')
    else:
        if price < getattr(g, 'level', price) * (1 - g.stop):
            g.broke = False
            order_target_value(g.stock, 0)
            log.info('跌破突破价止损离场')
