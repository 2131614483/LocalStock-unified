def initialize(context):
    # 低波策略：60日波动率最低选股（稳健防御），月频调仓
    # 设计理由：低波动因子在A股有显著超额（vol_60d IC 为负）
    set_benchmark("000300.XSHG")
    set_slippage(FixedSlippage(0.002))
    set_order_cost(OrderCost(close_tax=0.001, open_commission=0.0003, close_commission=0.0003, min_commission=5), type="stock")
    g.n_stocks = 30
    g.weights = {"vol_60d": 1.0}
    g.stop_loss = -0.08
    run_monthly(rebalance, monthday=1, time="09:30")
    log.info("低波策略初始化完成")

# vol_60d 方向为 -1（低波动更好），必须 ascending=False，否则会选高波股（历史 bug 已修）。
ASC = {"vol_60d": False}

def rebalance(context):
    stocks = get_all_stocks()
    if len(stocks) < g.n_stocks * 3:
        log.warn("股票池不足")
        return
    data = get_factors(stocks, list(g.weights.keys()))
    scores = {}
    for f, w in g.weights.items():
        vals = {s: d.get(f) for s, d in data.items()}
        z = rank_normalize(vals, ascending=ASC.get(f, True))
        for s in stocks:
            scores[s] = scores.get(s, 0) + w * z.get(s, 0)
    ranked = sorted(scores, key=lambda s: scores[s], reverse=True)[:g.n_stocks]
    _apply_rebalance(context, ranked, g.n_stocks, g.stop_loss)
    log.info("调仓完成: %d 只" % len(ranked))

def _apply_rebalance(context, ranked, n_stocks, stop_loss):
    for s in list(context.portfolio.positions.keys()):
        pos = context.portfolio.positions[s]
        if pos.avg_cost and (pos.price - pos.avg_cost) / pos.avg_cost < stop_loss:
            order_target(s, 0)
            log.warn("止损卖出 %s" % s)
    pct = 1.0 / n_stocks
    for s in ranked:
        order_target_percent(s, pct)
    for s in list(context.portfolio.positions.keys()):
        if s not in ranked:
            order_target(s, 0)
