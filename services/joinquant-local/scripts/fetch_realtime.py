# -*- coding: utf-8 -*-
"""A股实时信息抓取 —— daily-stock-pick skill 第 3 步工具（纯 HTTP，无 DeepSeek、无浏览器）。

数据源（免费、无需登录、本机直连）：
  - 行情：腾讯 qt.gtimg.cn（主，含最新交易日数据）+ 新浪 hq.sinajs.cn（备）
  - 财经要闻：新浪 feed.mix.sina.com.cn（市场级标题）
原始数据直接打印给 Claude 解读，不在抓取层做任何 LLM 加工。

用法（任意 python）：
  C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe scripts/fetch_realtime.py "600269,000726,600639" [top_news=5]

输出：每只股票的 名称/现价/昨收/涨跌幅/今开/最高/最低/时间戳（腾讯有 08-10 数据）+ 最近财经要闻标题。
"""
import json
import sys
import urllib.request

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}


def get(url, hdrs=None):
    req = urllib.request.Request(url, headers={**UA, **(hdrs or {})})
    return urllib.request.urlopen(req, timeout=15).read().decode('utf-8', 'replace')


def code_prefix(code):
    code = code.strip()
    if code[:1] in ('6', '9') or code.startswith('68'):
        return 'sh' + code
    if code[:1] in ('0', '1', '2', '3'):
        return 'sz' + code
    return 'sh' + code  # 兜底


def parse_tencent(line):
    """解析腾讯行情一行 v_xxx="..." → dict。字段以 ~ 分隔，布局见实测。"""
    try:
        body = line.split('="', 1)[1].rstrip('";')
    except Exception:  # noqa: BLE001
        return None
    f = body.split('~')
    if len(f) < 35:
        return None
    ts = f[30] if len(f) > 30 else ''
    ts = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]} {ts[8:10]}:{ts[10:12]}" if len(ts) >= 12 else ts
    return {
        'name': f[1], 'code': f[2], 'price': f[3], 'prev_close': f[4],
        'open': f[5], 'high': f[33], 'low': f[34], 'change_pct': f[32],
        'volume_手': f[6], 'amount_元': f[36] if len(f) > 36 else '',
        'time': ts,
    }


def fetch_quotes(codes):
    """腾讯行情（主）+ 新浪（备）批量取。返回 {code: dict}。"""
    out = {}
    prefixed = [code_prefix(c) for c in codes]
    try:
        r = get('https://qt.gtimg.cn/q=' + ','.join(prefixed))
        for line in r.strip().split(';'):
            if '=' not in line:
                continue
            key = line.split('=')[0].replace('v_', '').strip()
            d = parse_tencent(line)
            if d:
                out[d['code']] = d
    except Exception as e:  # noqa: BLE001
        out['_error'] = f'腾讯行情失败: {e}'
    # 新浪兜底：仅补腾讯缺失的
    missing = [p for p in prefixed if p[2:] not in out]
    if missing:
        try:
            r = get('https://hq.sinajs.cn/list=' + ','.join(missing),
                    {'Referer': 'https://finance.sina.com.cn'})
            for line in r.strip().split(';'):
                if '="' not in line:
                    continue
                key = line.split('=')[0].replace('var hq_str_', '').strip()
                f = line.split('="', 1)[1].rstrip('";').split(',')
                if len(f) >= 32 and f[0]:
                    code = key[2:]
                    out[code] = {'name': f[0], 'price': f[3], 'prev_close': f[2],
                                 'open': f[1], 'high': f[4], 'low': f[5],
                                 'change_pct': '', 'volume_手': f[8], 'amount_元': f[9],
                                 'time': f[30] + ' ' + f[31]}
        except Exception as e:  # noqa: BLE001
            out['_error'] = out.get('_error', '') + f'; 新浪兜底失败: {e}'
    return out


def fetch_news(top=5):
    try:
        r = get('https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2517&num=%d&page=1' % top,
                {'Referer': 'https://finance.sina.com.cn'})
        items = json.loads(r).get('result', {}).get('data', [])
        return [x.get('title', '').strip() for x in items if x.get('title')]
    except Exception as e:  # noqa: BLE001
        return [f'财经要闻获取失败: {e}']


def fetch_indices():
    """主要市场指数（腾讯，含最新交易日）。返回 {code: dict}。"""
    syms = {'sh000001': '上证指数', 'sh000300': '沪深300', 'sz399001': '深证成指',
            'sz399006': '创业板指', 'sh000016': '上证50'}
    out = {}
    try:
        r = get('https://qt.gtimg.cn/q=' + ','.join(syms))
        for line in r.strip().split(';'):
            if '=' not in line:
                continue
            key = line.split('=')[0].replace('v_', '').strip()
            d = parse_tencent(line)
            if d:
                d['name'] = syms.get(key, d.get('name', ''))
                out[key] = d
    except Exception as e:  # noqa: BLE001
        out['_error'] = f'指数行情失败: {e}'
    return out


def fetch_stock_news(code, n=3):
    """腾讯个股新闻。拉 20 条按时间倒序取最近 n 条（腾讯 n 大才含最新新闻，之前 n=3 只返回最旧）。
    备用源：同花顺 news.10jqka.com.cn（更及时但相关性较松）。返回 [{title,time,url}]。"""
    try:
        sym = code_prefix(code)
        r = get('https://proxy.finance.qq.com/ifzqgtimg/appstock/news/info/search?symbol=%s&n=20&page=1&type=1' % sym)
        d = json.loads(r)
        if d.get('code') != 0:
            return []
        items = [{'title': it.get('title', '').strip(),
                  'time': (it.get('time') or '')[:10],
                  'url': it.get('url', '')} for it in d.get('data', {}).get('data', []) if it.get('title')]
        items.sort(key=lambda x: x['time'], reverse=True)  # 按时间倒序，取最新
        return items[:n]
    except Exception as e:  # noqa: BLE001
        return [{'title': f'(个股新闻获取失败: {e})', 'time': '', 'url': ''}]


def main():
    if len(sys.argv) < 2:
        print('用法: fetch_realtime.py "600269,000726,..." [top_news]')
        return 2
    codes = [c.strip() for c in sys.argv[1].replace('，', ',').split(',') if c.strip()]
    top_news = int(sys.argv[2]) if len(sys.argv) > 2 else 5

    quotes = fetch_quotes(codes)
    indices = fetch_indices()
    news = fetch_news(top_news)

    print('## 大盘指数（腾讯，最新交易日）')
    print('| 指数 | 点位 | 涨跌% | 时间 |')
    print('|---|---|---|---|')
    for sym, nm in [('sh000001', '上证指数'), ('sh000300', '沪深300'), ('sz399001', '深证成指'),
                    ('sz399006', '创业板指'), ('sh000016', '上证50')]:
        d = indices.get(sym)
        if d:
            print(f"| {d.get('name', nm)} | {d.get('price', '')} | {d.get('change_pct', '')}% | {d.get('time', '')} |")
    if indices.get('_error'):
        print('[提示] ' + indices['_error'])
    print()
    print('## 实时行情（腾讯/新浪）')
    print('| 代码 | 名称 | 现价 | 昨收 | 涨跌% | 今开 | 最高 | 最低 | 时间 |')
    print('|---|---|---|---|---|---|---|---|---|')
    for code in codes:
        d = quotes.get(code) or quotes.get(code_prefix(code)[2:])
        if not d:
            print(f'| {code} | — | | | | | | | |')
            continue
        print(f"| {d.get('code', code)} | {d.get('name', '')} | {d.get('price', '')} | "
              f"{d.get('prev_close', '')} | {d.get('change_pct', '')}% | {d.get('open', '')} | "
              f"{d.get('high', '')} | {d.get('low', '')} | {d.get('time', '')} |")
    print()
    print('## 个股新闻（腾讯，前 %d 只各 %d 条）' % (len(codes), min(3, 5)))
    for code in codes[:5]:
        stock_news = fetch_stock_news(code, 3)
        print('### %s' % code)
        for it in stock_news:
            print('- [%s] %s' % (it['time'] or '—', it['title']))
    print()
    print('## 最近财经要闻（新浪）')
    for t in news:
        print('- ' + t)
    if quotes.get('_error'):
        print('\n[提示] ' + quotes['_error'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
