# -*- coding: utf-8 -*-
"""上次选股表现追踪 —— daily-stock-pick skill 复盘闭环的数据基础。

读 Obsidian「每日选股」目录里最新一份「非今日」报告 → 提取 top-10 代码 + 收盘价 →
抓当前价（腾讯）→ 算区间平均涨跌幅 → 对比同期沪深300（index_daily 取报告日收盘）→ 超额。

用法（任意 python）：
  C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe scripts/track_picks.py
可选 --report 指定报告文件名（默认取最新非今日报告）。
"""
import glob
import json
import os
import re
import sqlite3
import sys
import urllib.request
from datetime import date, datetime

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

VAULT = os.environ.get('OBSIDIAN_VAULT', 'C:/Users/he/Documents/Obsidian Vault')
DIR = os.path.join(VAULT, '量化回测平台', '每日选股')
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(BASE, 'data', 'stock_data.db')
HIST = os.path.join(BASE, 'data', 'picks_track_history.json')
TODAY = date.today().strftime('%Y-%m-%d')


def load_hist():
    if os.path.exists(HIST):
        try:
            with open(HIST, encoding='utf-8') as f:
                return json.load(f)
        except Exception:  # noqa: BLE001
            return []
    return []


def save_hist(h):
    try:
        with open(HIST, 'w', encoding='utf-8') as f:
            json.dump(h, f, ensure_ascii=False, indent=2)
    except Exception:  # noqa: BLE001
        pass


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    return urllib.request.urlopen(req, timeout=12).read().decode('utf-8', 'replace')


def fetch_quotes(codes):
    out = {}
    pref = [('sh' if c[0] in '69' else 'sz') + c for c in codes]
    try:
        r = get('https://qt.gtimg.cn/q=' + ','.join(pref))
        for line in r.strip().split(';'):
            if '="' not in line:
                continue
            f = line.split('="', 1)[1].rstrip('";').split('~')
            if len(f) < 35:
                continue
            try:
                out[f[2]] = {'price': float(f[3]), 'time': f[30]}
            except ValueError:
                pass
    except Exception as e:  # noqa: BLE001
        print(f'行情获取失败: {e}')
    return out


def hs300_close_on(d):
    """报告日沪深300收盘（本地 index_daily）。"""
    try:
        conn = sqlite3.connect(DB)
        row = conn.execute("SELECT close_index FROM index_daily WHERE index_code='000300' AND trade_date=?", (d,)).fetchone()
        conn.close()
        return float(row[0]) if row else None
    except Exception:  # noqa: BLE001
        return None


def main():
    if not os.path.isdir(DIR):
        print('Obsidian 每日选股目录不存在:', DIR)
        return 1
    reports = sorted(glob.glob(os.path.join(DIR, '每日选股_*.md')))
    candidates = [p for p in reports if os.path.basename(p) != '每日选股_%s.md' % TODAY]
    if not candidates:
        print('没有历史报告可复盘（今天是首次？）')
        return 0
    prev = candidates[-1]
    fname = os.path.basename(prev)
    txt = open(prev, encoding='utf-8').read()
    m = re.search(r'数据截至\s*(\d{4}-\d{2}-\d{2})', txt)
    data_date = m.group(1) if m else '?'
    rows = re.findall(r'^\| (\d+) \| (\d{6}) \| ([^|]+) \| ([0-9.]+)', txt, re.M)
    top = [(int(i), code, name, float(close)) for i, code, name, close in rows[:10]]
    if not top:
        print(f'{fname} 未提取到名单行')
        return 0
    codes = [t[1] for t in top]
    quotes = fetch_quotes(codes)

    print(f'# 上次选股表现复盘 · {fname}')
    print('')
    print(f'> 名单数据日期：{data_date} · 现价为今日最新（腾讯）· 覆盖 top-10')
    print('')
    print('| 排名 | 代码 | 名称 | 报告收盘 | 现价 | 区间涨跌% |')
    print('|---|---|---|---|---|---|')
    rets = []
    for i, code, name, close in top:
        q = quotes.get(code)
        if not q:
            print(f'| {i} | {code} | {name} | {close} | — | — |')
            continue
        ret = (q['price'] / close - 1) * 100
        rets.append(ret)
        print(f'| {i} | {code} | {name} | {close} | {q["price"]} | {ret:+.2f}% |')
    if not rets:
        print('（无有效行情）')
        return 0
    avg = sum(rets) / len(rets)
    print('')
    print(f'**top-10 平均区间涨跌：{avg:+.2f}%**')
    # 同期沪深300
    hs = hs300_close_on(data_date)
    hs_ret = diff = None
    if hs:
        try:
            r = get('https://qt.gtimg.cn/q=sh000300')
            cur = float(r.split('="', 1)[1].split('~')[3])
            hs_ret = (cur / hs - 1) * 100
            diff = avg - hs_ret
            print(f'同期沪深300（{data_date} {hs:.0f} → 今 {cur:.0f}）：{hs_ret:+.2f}%')
            print(f'**超额收益：{diff:+.2f} 个百分点（{"跑赢" if diff > 0 else "跑输"}基准）**')
        except Exception as e:  # noqa: BLE001
            print(f'沪深300 对比失败: {e}')
    else:
        print('（本地无该报告日沪深300收盘，跳过基准对比）')

    # 累积历史 + 跑赢率 + 连续跑输提示
    hist = load_hist()
    rec = {'report': fname, 'data_date': data_date,
           'date': datetime.now().strftime('%Y-%m-%d %H:%M'),
           'avg_ret': round(avg, 2),
           'hs300_ret': round(hs_ret, 2) if hs_ret is not None else None,
           'excess': round(diff, 2) if diff is not None else None}
    if not any(h.get('report') == fname for h in hist):
        hist.append(rec)
        save_hist(hist)
    valid = [h for h in hist if h.get('excess') is not None]
    if valid:
        n = len(valid)
        wins = sum(1 for h in valid if h['excess'] > 0)
        avg_ex = sum(h['excess'] for h in valid) / n
        streak = 0
        for h in reversed(valid):
            if h['excess'] < 0:
                streak += 1
            else:
                break
        print('')
        print(f'**累计追踪 {n} 次 · 跑赢率 {wins / n * 100:.0f}% · 平均超额 {avg_ex:+.2f}pp · 当前连续跑输 {streak} 次**')
        if streak >= 2:
            print('⚠️ **连续 2+ 次跑输基准 → 建议重跑 `validate_daily_schemes.py` 对比候选方案、评估 ln_cap 权重**')
        print('历史明细见 data/picks_track_history.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
