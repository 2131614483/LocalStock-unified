def initialize(context):
    # 多因子综合：价值+质量+低波+动量均衡，月频调仓
    # 设计理由：多因子分散单一因子失效风险，降低回撤
    set_benchmark("000300.XSHG")
    set_slippage(FixedSlippage(0.002))
    set_order_cost(OrderCost(close_tax=0.001, open_commission=0.0003, close_commission=0.0003, min_commission=5), type="stock")
    g.n_stocks = 50
    g.weights = {"bp": 0.3, "ep_ttm": 0.2, "roe_ttm": 0.15, "gross_margin": 0.1, "op_cf_ratio": 0.1, "vol_60d": 0.15}
    g.stop_loss = -0.08
    run_monthly(rebalance, monthday=1, time="09:30")
    log.info("多因子综合策略初始化完成")

# 因子方向：ascending=True 表示值越高越好(+1)，False 表示值越低越好(-1)。与 factor_registry.json 一致。
ASC = {"bp": True, "ep_ttm": True, "roe_ttm": True, "gross_margin": True, "op_cf_ratio": True,
       "vol_60d": False, "debt_ratio": False, "ln_cap": False, "liq_20d": False, "turnover_20d": False,
       "rev_5d": False, "rev_10d": False, "mom_12m1m": True, "rev_growth_yr": True, "profit_growth_yr": True}

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
