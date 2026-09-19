# -*- coding: utf-8 -*-
"""技术面辅助图：布林带 + 海龟通道 + 当日表现对比。生成 PNG 到 每日选股/images/，返回 markdown 片段。

供 daily_stock_pick.py 追加报告「七、技术面辅助」；也可独立运行调试。
数据：stock_daily（腾讯/新浪回填后完整）；指数用 index_daily，缺 08-10/08-11 时腾讯实时兜底。
运行：系统 Python311（有 matplotlib，SimHei 中文）。
"""
import json
import os
import sqlite3
import sys
import urllib.request

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402

plt.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei']
plt.rcParams['axes.unicode_minus'] = False

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(BASE, 'data', 'stock_data.db')
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

INDICES = {  # 当日对比用：腾讯代码 -> 中文名
    'sh000001': '上证指数', 'sh000300': '沪深300', 'sz399006': '创业板指',
}


def get(url, hdrs=None, timeout=12):
    req = urllib.request.Request(url, headers={**UA, **(hdrs or {})})
    return urllib.request.urlopen(req, timeout=timeout).read().decode('utf-8', 'replace')


def fetch_bars(conn, code, date_str, n=160):
    """取某股截至 date_str 的最近 n 个交易日（升序）。"""
    rows = conn.execute(
        "SELECT trade_date, open_price, high_price, low_price, close_price, volume "
        "FROM stock_daily WHERE stock_code=? AND trade_date<=? ORDER BY trade_date DESC LIMIT ?",
        (code, date_str, n)).fetchall()
    return list(reversed(rows))


def ma(vals, w):
    out = []
    for i in range(len(vals)):
        lo = max(0, i - w + 1)
        seg = vals[lo:i + 1]
        out.append(sum(seg) / len(seg))
    return out


def bollinger(closes, w=20, k=2.0):
    m = ma(closes, w)
    up, lo = [], []
    for i in range(len(closes)):
        seg = closes[max(0, i - w + 1):i + 1]
        mu = sum(seg) / len(seg)
        sd = (sum((x - mu) ** 2 for x in seg) / len(seg)) ** 0.5
        up.append(mu + k * sd)
        lo.append(mu - k * sd)
    return m, up, lo


def donchian(highs, lows, w=20):
    up, dn = [], []
    for i in range(len(highs)):
        up.append(max(highs[max(0, i - w + 1):i + 1]))
        dn.append(min(lows[max(0, i - w + 1):i + 1]))
    return up, dn


def draw_candles(ax, x, opens, highs, lows, closes, width=0.6):
    """K 线蜡烛图：A 股惯例红涨绿跌，含上下影线。high/low 为 None 时退化为无影线实体。"""
    if not closes:
        return
    span = (max(highs) - min(lows)) or 1.0
    for i in range(len(closes)):
        o, h, l, c = opens[i], highs[i], lows[i], closes[i]
        up = c >= o
        color = '#e23838' if up else '#16a34a'  # 红涨绿跌
        # 影线
        ax.plot([x[i], x[i]], [l, h], color=color, lw=0.8, zorder=2)
        # 实体
        body_lo, body_hi = min(o, c), max(o, c)
        if body_hi - body_lo < 1e-9:  # 平盘给极小实体
            body_hi = body_lo + span * 0.004
        ax.bar(x[i], body_hi - body_lo, bottom=body_lo, width=width,
               color=color, edgecolor=color, zorder=3)


def plot_stock(code, name, date_str, out_path):
    conn = sqlite3.connect(DB)
    bars = fetch_bars(conn, code, date_str)
    conn.close()
    if len(bars) < 25:
        return False
    dates = [b[0] for b in bars]
    opens = [float(b[1]) if b[1] is not None else float(b[4]) for b in bars]
    closes = [float(b[4]) for b in bars]
    # 存量 baostock 段 high/low 全 NULL，海龟通道用 close 近似（K 线影线随之退化为实体）
    highs = [float(b[2]) if b[2] is not None else float(b[4]) for b in bars]
    lows = [float(b[3]) if b[3] is not None else float(b[4]) for b in bars]
    vols = [int(b[5]) for b in bars]
    n = len(dates)
    x = list(range(n))
    m, up, lo = bollinger(closes)
    don_up, don_dn = donchian(highs, lows)

    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(12, 6.2), dpi=110, sharex=True,
        gridspec_kw={'height_ratios': [3, 1]})
    draw_candles(ax1, x, opens, highs, lows, closes)
    ax1.plot(x, m, lw=1.0, color='#ff7f0e', label='MA20')
    ax1.fill_between(x, lo, up, alpha=0.15, color='#1f77b4', label='布林带 (MA20±2σ)')
    ax1.plot(x, don_up, '--', lw=0.8, color='#2ca02c', label='海龟上轨 (20日高)')
    ax1.plot(x, don_dn, '--', lw=0.8, color='#d62728', label='海龟下轨 (20日低)')
    ax1.set_title(f'{name}（{code}）· K线 + 布林带 + 海龟通道 · 截至 {date_str}')
    ax1.legend(fontsize=7, loc='upper left', ncol=5)
    ax1.grid(alpha=0.3)
    ax2.bar(x, [v / 1e4 for v in vols], color='#7f7f7f', alpha=0.5)
    ax2.set_ylabel('成交量(万手)')
    ax2.grid(alpha=0.3)
    step = max(1, n // 8)
    ax1.set_xticks(x[::step])
    ax1.set_xticklabels([dates[i][5:] for i in range(0, n, step)], rotation=0, fontsize=8)
    plt.tight_layout()
    plt.savefig(out_path, bbox_inches='tight')
    plt.close(fig)
    return True


def index_change_today():
    """上证/沪深300/创业板 最新交易日涨跌幅（腾讯实时）。返回 {腾讯code: (name, pct, date)}。"""
    try:
        r = get('https://qt.gtimg.cn/q=' + ','.join(INDICES))
        out = {}
        for line in r.strip().split(';'):
            if '="' not in line:
                continue
            key = line.split('=')[0].replace('v_', '').strip()
            if key not in INDICES:
                continue
            body = line.split('="', 1)[1].rstrip('";')
            f = body.split('~')
            if len(f) < 33:
                continue
            ts = f[30] if len(f) > 30 else ''
            d = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}" if len(ts) >= 8 else ''
            out[key] = (INDICES[key], float(f[32]), d)
        return out
    except Exception:  # noqa: BLE001
        return {}


def bench_close_map(start_date, end_date):
    """沪深300 (000300) 在 [start,end] 的收盘价序列。腾讯 fqkline 优先（含最近两日），本地 index_daily 兜底。"""
    try:
        r = get('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000300,day,%s,%s,120,bfq' % (start_date, end_date))
        d = json.loads(r)
        data = (d.get('data') or {}).get('sh000300', {})
        kline = data.get('bfqday') or data.get('day') or []  # 指数返回键为 'day'
        if kline:
            return {row[0]: float(row[2]) for row in kline if len(row) >= 3}
    except Exception:  # noqa: BLE001
        pass
    try:
        conn = sqlite3.connect(DB)
        m = dict(conn.execute(
            "SELECT trade_date, close_index FROM index_daily WHERE index_code='000300' "
            "AND trade_date>=? AND trade_date<=?", (start_date, end_date)).fetchall())
        conn.close()
        return m
    except Exception:  # noqa: BLE001
        return {}


def plot_portfolio_vs_benchmark(date_str, ranked_codes, out_path, lookback=60):
    """top-N 等权净值（当前名单历史回放，近似）vs 沪深300 净值，近 lookback 交易日。"""
    conn = sqlite3.connect(DB)
    dates = [r[0] for r in conn.execute(
        "SELECT DISTINCT trade_date FROM stock_daily WHERE trade_date<=? "
        "ORDER BY trade_date DESC LIMIT ?", (date_str, lookback))]
    conn.close()
    dates.reverse()
    if len(dates) < 25:
        return False
    # 组合每日等权收益
    conn = sqlite3.connect(DB)
    cc = {}
    for code in ranked_codes:
        rows = conn.execute(
            "SELECT trade_date, close_price FROM stock_daily WHERE stock_code=? AND trade_date IN (%s)"
            % ','.join('?' * len(dates)), [code] + dates).fetchall()
        cc[code] = dict(rows)
    conn.close()
    port_rets = []
    for i in range(1, len(dates)):
        d0, d1 = dates[i - 1], dates[i]
        rets = []
        for code in ranked_codes:
            c0, c1 = cc[code].get(d0), cc[code].get(d1)
            if c0 and c1 and c0 > 0:
                rets.append(c1 / c0 - 1)
        port_rets.append(sum(rets) / len(rets) if rets else 0.0)
    # 基准净值
    bm = bench_close_map(dates[0], dates[-1])
    bench_nav = []
    prev = None
    for d in dates:
        c = bm.get(d)
        if c:
            prev = c
        bench_nav.append(prev)
    if prev is None or len([x for x in bench_nav if x]) < 20:
        return False
    nav_port = 1.0
    port_nav = [1.0]
    for r in port_rets:
        nav_port *= (1 + r)
        port_nav.append(nav_port)
    nav_bench = [b / bench_nav[0] if bench_nav[0] else 1.0 for b in bench_nav]

    fig, ax = plt.subplots(figsize=(12, 4.8), dpi=110)
    ax.plot(range(len(port_nav)), [v * 100 - 100 for v in port_nav], lw=1.4, color='#1f77b4',
            label=f'组合（top-{len(ranked_codes)} 等权，当前名单回放近似）')
    ax.plot(range(len(bench_nav)), [v * 100 - 100 for v in nav_bench], lw=1.2, color='#d62728',
            label='沪深300')
    ax.axhline(0, color='#333', lw=0.8)
    ax.set_title(f'组合 vs 沪深300 累计收益（近 {len(dates)} 交易日，至 {date_str}）')
    ax.legend(fontsize=8, loc='upper left')
    ax.grid(alpha=0.3)
    step = max(1, len(dates) // 8)
    ax.set_xticks(range(0, len(dates), step))
    ax.set_xticklabels([dates[i][5:] for i in range(0, len(dates), step)], fontsize=8)
    ax.set_ylabel('累计收益 %')
    plt.tight_layout()
    plt.savefig(out_path, bbox_inches='tight')
    plt.close(fig)
    return True


def build_technical_md(date_str, ranked_codes, name_map, images_dirs, top_n=10):
    """生成 top-n 技术面图 + 当日表现条形图。返回 markdown 片段。"""
    for d in images_dirs:
        os.makedirs(d, exist_ok=True)
    md = ['', '## 八、技术面辅助（K线 + 布林带 + 海龟通道）', '']
    md.append('> 图为**股价 K 线**（红涨绿跌，A 股惯例）+ 布林带（MA20 ± 2σ，超买/超卖参考）+ 海龟通道（20 日唐奇安高低轨，突破上下轨为潜在趋势信号）。'
              ' **仅辅助参考，不构成买卖指令。** 数据：`stock_daily` 截至 %s。' % date_str)
    md.append('')
    ok = 0
    for i, code in enumerate(ranked_codes[:top_n]):
        name = name_map.get(code, code)
        fname = f'tech_{code}_{date_str}.png'
        # 写第一处即可，随后复制到其余目录
        if plot_stock(code, name, date_str, os.path.join(images_dirs[0], fname)):
            ok += 1
            for d in images_dirs[1:]:
                try:
                    import shutil
                    shutil.copy(os.path.join(images_dirs[0], fname), os.path.join(d, fname))
                except OSError:
                    pass
        md.append(f'### {i + 1}. {name}（{code}）')
        md.append('')
        md.append(f'![{name} 技术面](images/{fname})')
        md.append('')
    if ok == 0:
        md.append('> （图表生成失败：数据不足）')
        md.append('')
    # 当日表现条形图
    idx = index_change_today()
    conn = sqlite3.connect(DB)
    ph = ','.join('?' * len(ranked_codes[:top_n]))
    rows = conn.execute(
        "SELECT stock_code, close_price, pre_close_price FROM stock_daily "
        "WHERE trade_date=? AND stock_code IN (%s)" % ph, [date_str] + list(ranked_codes[:top_n])).fetchall()
    conn.close()
    if rows and idx:
        bars = []
        labels = []
        for code in ranked_codes[:top_n]:
            r = dict((x[0], x) for x in rows).get(code)
            if r and r[2] > 0:
                bars.append((r[1] / r[2] - 1) * 100)
                labels.append(name_map.get(code, code))
        for sym, (nm, pct, d) in idx.items():
            bars.append(pct)
            labels.append(nm + '↓' if pct < 0 else nm)
        fname = f'perf_{date_str}.png'
        fig, ax = plt.subplots(figsize=(12, 5.2), dpi=110)
        colors = ['#d62728' if b < 0 else '#2ca02c' for b in bars]
        ax.bar(range(len(bars)), bars, color=colors, alpha=0.85)
        ax.axhline(0, color='#333', lw=0.8)
        ax.set_xticks(range(len(bars)))
        ax.set_xticklabels(labels, rotation=60, fontsize=8)
        ax.set_ylabel('涨跌幅 %')
        ax.set_title(f'当日表现：top-{top_n} vs 大盘（{date_str}）')
        ax.grid(alpha=0.3, axis='y')
        for i, v in enumerate(bars):
            ax.text(i, v + (0.15 if v >= 0 else -0.6), f'{v:+.1f}%', ha='center', fontsize=7)
        plt.tight_layout()
        plt.savefig(os.path.join(images_dirs[0], fname), bbox_inches='tight')
        plt.close(fig)
        for d in images_dirs[1:]:
            import shutil
            try:
                shutil.copy(os.path.join(images_dirs[0], fname), os.path.join(d, fname))
            except OSError:
                pass
        md.append('### 当日表现：top-%d vs 大盘' % top_n)
        md.append('')
        md.append(f'![当日表现](images/{fname})')
        md.append('')
    # 组合 vs 沪深300 净值曲线
    pnav = f'port_vs_bench_{date_str}.png'
    if plot_portfolio_vs_benchmark(date_str, ranked_codes[:top_n], os.path.join(images_dirs[0], pnav)):
        for d in images_dirs[1:]:
            import shutil
            try:
                shutil.copy(os.path.join(images_dirs[0], pnav), os.path.join(d, pnav))
            except OSError:
                pass
        md.append('### 组合 vs 沪深300（近 60 交易日，当前名单回放近似）')
        md.append('')
        md.append(f'![组合 vs 沪深300](images/{pnav})')
        md.append('')
        md.append('> 组合为**当前 top-%d 名单**从窗口起点等权回放（非历史换手），仅作趋势参考；沪深300 用腾讯指数补齐最近两日。' % top_n)
        md.append('')
    return '\n'.join(md)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', default=None)
    ap.add_argument('--codes', default='600269,000726,600639,600502,000498')
    a = ap.parse_args()
    codes = [c for c in a.codes.split(',') if c]
    nm = {}
    conn = sqlite3.connect(DB)
    for code in codes:
        row = conn.execute('SELECT name FROM stocks WHERE stock_code=?', (code,)).fetchone()
        nm[code] = row[0] if row else code
    conn.close()
    outdir = os.path.join(BASE, 'docs', 'project-docs', '每日选股', 'images')
    print(build_technical_md(a.date or '2026-08-11', codes, nm, [outdir]))
