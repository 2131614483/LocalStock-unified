# -*- coding: utf-8 -*-
"""新闻热点快照 —— daily-stock-pick skill「新闻热点追踪」的工具。

抓当前财经要闻（新浪 feed.mix.sina.com.cn，免费免登录）→ 按主题关键词聚类出热点 →
打印结构化快照，供 Claude 写 Obsidian 热点笔记。纯 HTTP，无 DeepSeek/浏览器。

6 个时段建议（A 股市场节奏）：
  06:00 盘前（隔夜外围/宏观） / 09:00 开盘（早间要闻/公告） / 11:30 午间（半日复盘）
  13:00 午后（午后要点） / 15:00 收盘（当日复盘） / 24:00 深夜（全天回顾）

用法（任意 python）：
  C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe scripts/fetch_news_snapshot.py [--num 60]
可选 --out <路径.md> 把快照原样写入文件（默认只打印）。
"""
import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

# 热点主题 → 关键词（命中即计入该主题；可后续按复盘日志扩充）
THEMES = [
    ('能源/石油', ['石油', '原油', '油价', '能源署', '霍尔木兹', '天然气', '欧佩克', 'OPEC', '油气']),
    ('美联储/宏观', ['美联储', '加息', '降息', 'CPI', '通胀', '美债', '利率', '关税', 'PMI']),
    ('科技/AI/半导体', ['AI', '人工智能', '芯片', '算力', '大模型', '机器人', '半导体', 'GPU', '数据中心']),
    ('A股/盘面', ['涨停', '跌停', 'A股', '沪深', '沪指', '深成指', '创业板', '两市', '北向', '融资']),
    ('港股/海外股市', ['港股', '恒生', '恒指', '科指', '美股', '纳指', '标普', '道指', '日经']),
    ('公司/资本运作', ['定增', '增持', '减持', '回购', '业绩', '财报', '净利润', '分红', '重组', '停牌']),
    ('政策/监管', ['监管', '证监会', '央行', '国务院', '通知', '考核', '处罚', '警示函', '政策']),
]


def get(url, hdrs=None):
    req = urllib.request.Request(url, headers={**UA, **(hdrs or {})})
    return urllib.request.urlopen(req, timeout=15).read().decode('utf-8', 'replace')


def fetch_news(num=60):
    r = get('https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2517&num=%d&page=1' % num,
            {'Referer': 'https://finance.sina.com.cn'})
    items = json.loads(r).get('result', {}).get('data', [])
    out = []
    for it in items:
        t = (it.get('title') or '').strip()
        if t:
            out.append((t, (it.get('ctime') or '')))
    return out


def classify(titles):
    """返回 [(theme, count, examples)]，按命中条数降序。titles 为 (title, ctime) 列表。"""
    res = []
    for theme, kws in THEMES:
        hits = [t for t, _ in titles if any(k in t for k in kws)]
        if hits:
            res.append((theme, len(hits), hits[:3]))
    res.sort(key=lambda x: -x[1])
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--num', type=int, default=60)
    ap.add_argument('--out', default=None, help='写入文件路径（可选）')
    args = ap.parse_args()

    titles = fetch_news(args.num)
    ts = datetime.now().strftime('%Y-%m-%d %H:%M')
    lines = []
    lines.append(f'# 新闻热点快照 · {ts}')
    lines.append('')
    lines.append(f'> 来源：新浪财经要闻 · 本次抓取 {len(titles)} 条 · 数据未做 LLM 加工，Claude 解读')
    lines.append('')
    lines.append('## 热点主题（按命中条数排序）')
    lines.append('')
    for theme, cnt, ex in classify(titles):
        lines.append(f'- **{theme}**（{cnt} 条）：{ex[0][:38]}')
    lines.append('')
    lines.append('## 全部要闻')
    lines.append('')
    for t, c in titles:
        lines.append(f'- {t}')
    text = '\n'.join(lines)

    print(text)
    if args.out:
        import os
        os.makedirs(os.path.dirname(args.out), exist_ok=True)
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(text)
        print(f'\n[已写入] {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
