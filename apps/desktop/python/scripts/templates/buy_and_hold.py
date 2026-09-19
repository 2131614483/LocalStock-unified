# 买入持有策略模板
# 约束：策略里不要用 print()（会破坏回测结果 JSON），请用 log()；
#       g.stocks 用带后缀代码（600519.XSHG / 000001.XSHE），数据库里是 6 位纯数字。
def initialize(context):
    # 股票池：改成你想回测的股票
    g.stocks = ['600519.XSHG']
    g.bought = False
    # 注册每日调度（每个交易日执行）
    run_daily(buy)


def buy(context):
    # 首次交易日满仓买入（留 5% 现金应付手续费）
    if not g.bought:
        order_target_value(g.stocks[0], context.portfolio.total_value * 0.95)
        g.bought = True
        log.info('买入 ' + g.stocks[0])
