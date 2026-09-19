# -*- coding: utf-8 -*-
"""全球市场监控快照 —— daily-stock-pick skill「全球市场与政策监控」工具。

纯 HTTP（腾讯 + 新浪），无 DeepSeek/浏览器。抓取：
  1) 全球主要指数：美股三大（道指/纳指/标普）、港股（恒指/国企）、日经225、英国富时、德国DAX(ETF代理)
  2) 美股龙头企业：苹果/微软/英伟达/谷歌A/亚马逊/Meta/特斯拉
  3) 期货与贵金属：COMEX黄金/白银、伦敦金、WTI原油、COMEX铜
  4) 政策监控：美联储（加息/降息/FOMC/鲍威尔）+ 中国央行（LPR/降准/MLF/逆回购）相关要闻
原始数据给 Claude 解读，写 Obsidian「全球市场/」笔记。

用法：C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe scripts/fetch_global.py [--policy-num 20]
"""
import argparse
import json
import sys
import urllib.request
from datetime import datetime

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

TENCENT_SYMS = [
    # 美股指数
    ('usDJI', '道琼斯'), ('usIXIC', '纳斯达克'), ('usINX', '标普500'),
    # 港股
    ('hkHSI', '恒生指数'), ('hkHSCEI', '恒生国企'),
    # 德国 DAX（腾讯给的是 ETF 代理）
    ('usDAX', '德国DAX(ETF)'),
]
US_LEADERS = [
    ('usAAPL', '苹果'), ('usMSFT', '微软'), ('usNVDA', '英伟达'),
    ('usGOOGL', '谷歌A'), ('usAMZN', '亚马逊'), ('usMETA', 'Meta'), ('usTSLA', '特斯拉'),
]
SINA_INT = [('int_nikkei', '日经225'), ('int_ftse', '英国富时100')]
SINA_HF = [
    ('hf_GC', 'COMEX黄金'), ('hf_SI', 'COMEX白银'), ('hf_XAU', '伦敦金现货'),
    ('hf_CL', 'WTI原油'), ('hf_HG', 'COMEX铜'),
]
# 政策监控关键词（美联储 / 中国央行）
POLICY_KW = ['美联储', 'FOMC', '鲍威尔', '加息', '降息', '缩表', '点阵图', '央行',
             'LPR', '降准', 'MLF', '逆回购', '货币政策', '潘功胜', '利率决议']


def get(url, hdrs=None):
    req = urllib.request.Request(url, headers={**UA, **(hdrs or {})})
    return urllib.request.urlopen(req, timeout=15).read().decode('utf-8', 'replace')


def fetch_tencent(symbols):
    """腾讯：us/hk。返回 {code: (name, price, pct, time)}。"""
    out = {}
    try:
        r = get('https://qt.gtimg.cn/q=' + ','.join(s for s, _ in symbols))
        for line in r.strip().split(';'):
            if '="' not in line:
                continue
            key = line.split('=')[0].replace('v_', '').strip()
            f = line.split('="', 1)[1].rstrip('";').split('~')
            if len(f) > 32 and f[1]:
                out[key] = (f[1], f[3], f[32], f[30])
    except Exception as e:  # noqa: BLE001
        out['_error'] = f'腾讯失败: {e}'
    return out


def fetch_sina_list(symbols):
    """新浪 int_ 指数：名称/现价/涨跌/涨跌%。返回 {code: (name, price, pct, '')}。"""
    out = {}
    try:
        r = get('https://hq.sinajs.cn/list=' + ','.join(s for s, _ in symbols),
                {'Referer': 'https://finance.sina.com.cn'})
        for line in r.strip().split(';'):
            if '="' not in line:
                continue
            key = line.split('=')[0].replace('var hq_str_', '').strip()
            f = line.split('="', 1)[1].rstrip('";').split(',')
            if len(f) >= 4 and f[0]:
                out[key] = (f[0], f[1], f[3], '')
    except Exception as e:  # noqa: BLE001
        out['_error'] = f'新浪指数失败: {e}'
    return out


def fetch_sina_hf(symbols):
    """新浪 hf_ 期货/贵金属：最新=f[0], 昨收=f[7], 时间=f[6]。返回 {code: (name, price, pct, time)}。"""
    out = {}
    try:
        r = get('https://hq.sinajs.cn/list=' + ','.join(s for s, _ in symbols),
                {'Referer': 'https://finance.sina.com.cn'})
        for line in r.strip().split(';'):
            if '="' not in line:
                continue
            key = line.split('=')[0].replace('var hq_str_', '').strip()
            f = line.split('="', 1)[1].rstrip('";').split(',')
            if len(f) > 7:
                price = f[0]
                prev = f[7]
                try:
                    pct = '%.2f' % ((float(price) - float(prev)) / float(prev) * 100) if prev else ''
                except ValueError:
                    pct = ''
                name = dict(SINA_HF).get(key, key)
                out[key] = (name, price, pct, f[6])
    except Exception as e:  # noqa: BLE001
        out['_error'] = f'新浪期货失败: {e}'
    return out


def fetch_policy_news(num=20):
    """抓财经要闻，筛出美联储/中国央行政策相关。返回标题列表。"""
    try:
        r = get('https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2517&num=60&page=1',
                {'Referer': 'https://finance.sina.com.cn'})
        items = json.loads(r).get('result', {}).get('data', [])
        hits = []
        for it in items:
            t = (it.get('title') or '').strip()
            if t and any(k in t for k in POLICY_KW):
                hits.append(t)
        return hits[:num]
    except Exception as e:  # noqa: BLE001
        return [f'政策要闻获取失败: {e}']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--policy-num', type=int, default=20)
    args = ap.parse_args()

    tx = fetch_tencent(TENCENT_SYMS)
    leaders = fetch_tencent(US_LEADERS)
    sinta = fetch_sina_list(SINA_INT)
    hf = fetch_sina_hf(SINA_HF)
    policy = fetch_policy_news(args.policy_num)
    ts = datetime.now().strftime('%Y-%m-%d %H:%M')

    lines = [f'# 全球市场监控快照 · {ts}', '']
    lines.append('> 美股/德股为上一交易日收盘（美盘时间滞后）；港/日/欧为当日；期货贵金属为最新价。数据源：腾讯+新浪。')
    lines.append('')
    lines.append('## 全球主要指数')
    lines.append('')
    lines.append('| 市场 | 指数 | 点位 | 涨跌% |')
    lines.append('|---|---|---|---|')
    for code, label in TENCENT_SYMS:
        if code in tx:
            n, p, pct, t = tx[code]
            lines.append(f'| {label} | {n} | {p} | {pct}% |')
    for code, label in SINA_INT:
        if code in sinta:
            n, p, pct, _ = sinta[code]
            lines.append(f'| {label} | {n} | {p} | {pct}% |')
    lines.append('')
    lines.append('## 美股龙头企业')
    lines.append('')
    lines.append('| 公司 | 现价(USD) | 涨跌% |')
    lines.append('|---|---|---|')
    for code, label in US_LEADERS:
        if code in leaders:
            n, p, pct, _ = leaders[code]
            lines.append(f'| {label} | {p} | {pct}% |')
    lines.append('')
    lines.append('## 期货与贵金属')
    lines.append('')
    lines.append('| 品种 | 价格 | 涨跌% | 时间 |')
    lines.append('|---|---|---|---|')
    for code, label in SINA_HF:
        if code in hf:
            n, p, pct, t = hf[code]
            lines.append(f'| {label} | {p} | {pct}% | {t} |')
    lines.append('')
    lines.append('## 美联储 / 中国货币政策要闻')
    lines.append('')
    for t in policy:
        lines.append(f'- {t}')
    for d in (tx, leaders, sinta, hf):
        if d.get('_error'):
            lines.append(f'\n[提示] {d["_error"]}')
    print('\n'.join(lines))
    return 0


if __name__ == '__main__':
    sys.exit(main())
