# 多因子打分轮动策略：月度对股票池按 动量/低波动/趋势/量能 加权打分，持有前 K 只
# 权重可调（g.weight_*）；纯价量因子，无基本面
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.stocks = [
        '600519.XSHG', '000001.XSHE', '000858.XSHE', '300750.XSHE',
        '601318.XSHG', '002594.XSHE', '300059.XSHE', '002475.XSHE',
    ]
    g.lookback = 20
    g.hold_k = 2
    g.weight_mom = 1.0      # 动量
    g.weight_lowvol = -2.0  # 低波动（负权重：波动越小分越高）
    g.weight_trend = 1.0    # 趋势（价格/MA60）
    g.weight_vol = 0.2      # 量能（近5日均量/前20日均量）
    run_daily(rebalance)


def rebalance(context):
    month = context.current_dt.strftime('%Y-%m')
    if getattr(g, 'last_month', None) == month:
        return
    g.last_month = month

    scores = []
    for stock in g.stocks:
        hist = attribute_history(stock, 60, '1d', ('close', 'volume'))
        closes = list(hist['close'])
        vols = list(hist['volume'])
        if len(closes) < 40:
            continue
        mom = closes[-1] / closes[-g.lookback - 1] - 1
        rets = [closes[i] / closes[i - 1] - 1 for i in range(-g.lookback, 0)]
        vol = (sum((r - sum(rets) / len(rets)) ** 2 for r in rets) / len(rets)) ** 0.5
        ma60 = sum(closes[-60:]) / 60
        trend = closes[-1] / ma60 - 1
        vol_ratio = (sum(vols[-5:]) / 5) / (sum(vols[-25:-5]) / 20 + 1e-9)
        score = g.weight_mom * mom + g.weight_lowvol * vol + g.weight_trend * trend + g.weight_vol * vol_ratio
        scores.append((stock, score))

    scores.sort(key=lambda x: x[1], reverse=True)
    top = [s for s, _ in scores[:g.hold_k]]
    target = context.portfolio.total_value * 0.95 / len(top)
    for stock in g.stocks:
        position = context.portfolio.positions.get(stock)
        if stock in top and not position:
            order_target_value(stock, target)
            log.info('因子轮动买入 ' + stock)
        elif stock not in top and position:
            order_target_value(stock, 0)
            log.info('因子轮动卖出 ' + stock)
