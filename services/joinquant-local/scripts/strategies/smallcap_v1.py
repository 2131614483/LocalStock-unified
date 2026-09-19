def initialize(context):
    # 小市值多因子综合：价值+质量+低波+小市值，月频调仓 —— 与 scripts/daily_stock_pick.py 的 smallcap 方案一致
    # 历史验证 2018-2026：总收益 +12.8%、夏普 +0.02（唯一正夏普），优于基础多因子
    set_benchmark("000300.XSHG")
    set_slippage(FixedSlippage(0.002))
    set_order_cost(OrderCost(close_tax=0.001, open_commission=0.0003, close_commission=0.0003, min_commission=5), type="stock")
    g.n_stocks = 50
    g.weights = {"bp": 0.3, "ep_ttm": 0.2, "roe_ttm": 0.15, "gross_margin": 0.1,
                 "op_cf_ratio": 0.1, "vol_60d": 0.15, "ln_cap": 0.10}
    g.stop_loss = -0.08
    run_monthly(rebalance, monthday=1, time="09:30")
    log.info("小市值多因子综合策略初始化完成")

# 因子方向：ascending=True 值越高越好(+1)，False 值越低越好(-1)。与 factor_registry.json 一致。
ASC = {"bp": True, "ep_ttm": True, "roe_ttm": True, "gross_margin": True, "op_cf_ratio": True,
       "vol_60d": False, "ln_cap": False, "debt_ratio": False, "liq_20d": False, "turnover_20d": False}

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
