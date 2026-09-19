# 财务数据按需抓取工具：新浪财报（HTML 表格）+ 腾讯实时估值字段
# 定位：分析具体股票时按需实时访问网站抓取，不写入数据库、不做批量下载（本地仅存既有历史行情库）。
# 用法: python scripts/probe-financial.py 600519
# 实测 2026-08-12：新浪四大接口可用（GBK HTML，pandas.read_html 解析）；
#   腾讯财务接口(yjbg/cwzb/zcfz/lrb/xjll)已下线或不存在，仅实时报价估值字段可用。
import io
import sys
import urllib.request

import pandas as pd

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'}
SINA_FMT = 'https://money.finance.sina.com.cn/corp/go.php/{kind}/stockid/{code}/ctrl/{year}/displaytype/4.phtml'
TENCENT_FMT = 'https://qt.gtimg.cn/q={symbol}'

# 腾讯实时报价估值字段下标（GBK，~ 分隔）
TENCENT_FIELDS = {
    1: '名称', 2: '代码', 3: '现价', 31: '涨跌', 32: '涨跌%', 38: '换手率',
    39: '市盈率TTM', 43: '振幅', 44: '流通市值(亿)', 45: '总市值(亿)',
    46: '市净率', 49: '量比', 52: '市盈率动', 53: '市盈率静',
}


def _get(url, enc='gbk'):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode(enc, 'ignore')


def symbol_of(code):
    """6 位代码 → 腾讯 symbol（sh/sz）"""
    return ('sh' if code.startswith('6') else 'sz') + code


def _biggest_table(html):
    tables = pd.read_html(io.StringIO(html))
    return max(tables, key=lambda t: t.shape[0] * t.shape[1])


def sina_financial(code, year):
    """新浪财务摘要：93 项指标 × 各报告期，返回 DataFrame"""
    url = SINA_FMT.format(kind='vFD_FinancialGuideLine', code=code, year=year)
    return _biggest_table(_get(url))


def sina_statements(code, year):
    """新浪三大报表，返回 {'balance': df, 'income': df, 'cashflow': df}"""
    out = {}
    for kind, name in [('vFD_BalanceSheet', 'balance'),
                       ('vFD_ProfitStatement', 'income'),
                       ('vFD_CashFlow', 'cashflow')]:
        url = SINA_FMT.format(kind=kind, code=code, year=year)
        out[name] = _biggest_table(_get(url))
    return out


def tencent_valuation(code):
    """腾讯实时报价估值字段：返回 dict（随行情刷新，非年报）"""
    raw = _get(TENCENT_FMT.format(symbol=symbol_of(code)))
    f = raw.split('~')
    return {v: f[k] for k, v in TENCENT_FIELDS.items() if k < len(f)}


if __name__ == '__main__':
    code = sys.argv[1] if len(sys.argv) > 1 else '600519'
    year = sys.argv[2] if len(sys.argv) > 2 else '2023'
    print(f'=== 腾讯估值 {code} ===')
    print(tencent_valuation(code))
    print(f'\n=== 新浪财务摘要 {code} {year}（前 12 行）===')
    df = sina_financial(code, year)
    print(df.head(12).to_string(max_colwidth=22))
    print(f'\n=== 新浪三大报表 shape ===')
    for name, t in sina_statements(code, year).items():
        print(f'  {name}: {t.shape}')
