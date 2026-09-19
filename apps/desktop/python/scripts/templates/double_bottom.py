# 双底反转策略：近 W 日内出现两个相近低点（价差 < tol），收盘上穿两低点间颈线买入
# 跌破颈线×(1−stop) 离场；经典底部反转形态
# 注意：策略里不要用 print()（会破坏回测结果 JSON），请用 log()
def initialize(context):
    g.stock = '300750.XSHE'  # 宁德时代（高波动，能体现反复入场+止损）；强势趋势股可能只买一次
    g.window = 45   # 形态观察窗口
    g.tol = 0.06    # 两低点容差
    g.span = 15     # 两谷最大间距（天）
    g.stop = 0.05   # 跌破颈线离场比例
    g.weight = 0.95
    run_daily(trade)


def _double_bottom(closes, window, tol, span):
    """扫描窗口内任意两处相近的局部谷底（价差 < tol、间距 < span），返回 (价差, 颈线价) 或 None"""
    data = closes[-window:]
    n = len(data)
    if n < 12:
        return None
    # 局部低点（谷）：比两侧收盘都低
    valleys = [i for i in range(1, n - 1)
               if data[i] <= data[i - 1] and data[i] < data[i + 1]]
    if len(valleys) < 2:
        return None
    best = None
    for a in range(len(valleys)):
        for b in range(a + 1, len(valleys)):
            i, j = valleys[a], valleys[b]
            if j - i > span:
                break  # 间距超限，更远的谷只会更远
            diff = abs(data[i] - data[j]) / max(data[i], data[j])
            if diff > tol:
                continue
            neck = max(data[i + 1:j])  # 两谷之间的最高收盘 = 颈线
            if best is None or diff < best[0]:
                best = (diff, neck)
    return best


def trade(context):
    hist = attribute_history(g.stock, g.window + 1, '1d', ('close',))
    closes = list(hist['close'])
    if len(closes) < g.window + 1:
        return
    price = closes[-1]
    position = context.portfolio.positions.get(g.stock)

    if not position:
        pat = _double_bottom(closes[:-1], g.window, g.tol, g.span)  # 形态只看今日之前
        if pat and price > pat[1]:
            g.neck = pat[1]
            order_target_value(g.stock, context.portfolio.total_value * g.weight)
            log.info('双底突破买入，颈线 %s' % round(pat[1], 2))
    else:
        if price < getattr(g, 'neck', price) * (1 - g.stop):
            order_target_value(g.stock, 0)
            log.info('跌破颈线离场')
