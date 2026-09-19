def initialize(context):
    # 价值策略：BP(账面市值比) + EP(盈余收益率)，月频调仓
    # 设计理由：研究显示 bp 的 IC_IR=0.34 最稳健（A股价值因子长期有效）
    set_benchmark("000300.XSHG")
    set_slippage(FixedSlippage(0.002))
    set_order_cost(OrderCost(close_tax=0.001, open_commission=0.0003, close_commission=0.0003, min_commission=5), type="stock")
    g.n_stocks = 30
    g.weights = {"bp": 0.6, "ep_ttm": 0.4}
    g.stop_loss = -0.08
    run_monthly(rebalance, monthday=1, time="09:30")
    log.info("价值策略初始化完成")

def rebalance(context):
    stocks = get_all_stocks()
    if len(stocks) < g.n_stocks * 3:
        log.warn("股票池不足")
        return
    data = get_factors(stocks, list(g.weights.keys()))
    scores = {}
    for f, w in g.weights.items():
        vals = {s: d.get(f) for s, d in data.items()}
        z = rank_normalize(vals)
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
