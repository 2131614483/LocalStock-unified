# -*- coding: utf-8 -*-
"""基本面与估值快照：腾讯行情实时估值（PE/PB/市值）+ CSMAR 财务指标（ROE/毛利/现金流/盈余收益率）。

供 daily_stock_pick.py 追加报告「基本面与估值快照」；也可独立运行调试。
说明：腾讯/新浪免费**财报 JSON 接口不可用**（实测 No dispatch info / Service not valid），
故企业财务指标用已入库的 CSMAR 季度报表（报告期+4 个月滞后，与因子一致）；估值用腾讯行情实时字段：
  f[39]=PE_TTM  f[46]=PB  f[44]=总市值(亿)  f[45]=流通市值(亿)
运行：系统 Python311。
"""
import os
import sqlite3
import sys
import urllib.request

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE, 'engine'))
DB = os.path.join(BASE, 'data', 'stock_data.db')
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}


def get(url, enc='gbk', hdrs=None, timeout=12):
    req = urllib.request.Request(url, headers={**UA, **(hdrs or {})})
    return urllib.request.urlopen(req, timeout=timeout).read().decode(enc, 'replace')


def code_prefix(code):
    if code[:1] in ('6', '9'):
        return 'sh' + code
    if code.startswith(('8', '4', '920')):
        return 'bj' + code
    return 'sz' + code


def tencent_quotes(codes, batch=100):
    """批量腾讯行情估值 → {code: dict(price, chg_pct, pe_ttm, pb, mkt_cap_yi, float_cap_yi)}。"""
    out = {}
    for i in range(0, len(codes), batch):
        chunk = codes[i:i + batch]
        try:
            r = get('https://qt.gtimg.cn/q=' + ','.join(code_prefix(c) for c in chunk))
        except Exception:  # noqa: BLE001
            continue
        for line in r.strip().split(';'):
            if '="' not in line:
                continue
            body = line.split('="', 1)[1].rstrip('";')
            f = body.split('~')
            if len(f) < 47 or not f[2]:
                continue
            try:
                out[f[2]] = {
                    'price': float(f[3]),
                    'chg_pct': float(f[32]) if f[32] else 0.0,
                    'pe_ttm': float(f[39]) if f[39] else None,
                    'mkt_cap_yi': float(f[44]) if f[44] else None,
                    'float_cap_yi': float(f[45]) if f[45] else None,
                    'pb': float(f[46]) if f[46] else None,
                }
            except (ValueError, IndexError):
                continue
    return out


def build_fundamental_md(date_str, top_codes, name_map, fc):
    """生成「基本面与估值快照」markdown（top-N）。fc 为 FactorCalcStdlib 实例。"""
    quotes = tencent_quotes(top_codes)
    factors = fc.get_factors(top_codes, ['ep_ttm', 'roe_ttm', 'gross_margin', 'op_cf_ratio'], date_str)

    def fmt(v, nd=1, pct=False):
        if v is None:
            return '—'
        try:
            v = float(v)
        except (TypeError, ValueError):
            return '—'
        return f'{v * 100:.1f}%' if pct else f'{v:.{nd}f}'

    md = ['', '## 七、基本面与估值快照', '']
    md.append('> 估值：腾讯行情实时（PE_TTM/PB/总市值，数据日期 ' + date_str + '）；财务：CSMAR 最新报告期（4 个月披露滞后）。'
              ' 可与此前因子换算的 PE/PB(估) 互相印证。')
    md.append('')
    md.append('| 代码 | 名称 | 现价 | 涨跌% | PE_TTM | PB | 总市值(亿) | 盈余收益率 | ROE_TTM | 毛利率 | 现金流/净利 |')
    md.append('|---|---|---|---|---|---|---|---|---|---|---|')
    for code in top_codes:
        q = quotes.get(code) or {}
        d = factors.get(code) or {}
        md.append(
            f'| {code} | {name_map.get(code, code)} | {fmt(q.get("price"))} | {fmt(q.get("chg_pct"))}% | '
            f'{fmt(q.get("pe_ttm"))} | {fmt(q.get("pb"))} | {fmt(q.get("mkt_cap_yi"))} | '
            f'{fmt(d.get("ep_ttm"), 3)} | {fmt(d.get("roe_ttm"), 3)} | {fmt(d.get("gross_margin"), 3, True)} | '
            f'{fmt(d.get("op_cf_ratio"), 3, True)} |')
    md.append('')
    # 组合估值均值
    pes = [q['pe_ttm'] for q in quotes.values() if q.get('pe_ttm')]
    pbs = [q['pb'] for q in quotes.values() if q.get('pb')]
    caps = [q['mkt_cap_yi'] for q in quotes.values() if q.get('mkt_cap_yi')]
    if pes and pbs:
        med = lambda x: sorted(x)[len(x) // 2]  # noqa: E731
        md.append(f'- top-{len(top_codes)} 估值（腾讯）：PE_TTM 中位 **{med(pes):.1f}** · PB 中位 **{med(pbs):.2f}** · 总市值中位 **{med(caps):.0f} 亿**')
        md.append('')
    md.append('> 说明：腾讯 PE/PB 与因子口径不同（腾讯用其财务模型），仅作实时参考；ROE/毛利率/现金流以 CSMAR 季度为准。')
    md.append('')
    return '\n'.join(md)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', default='2026-08-11')
    ap.add_argument('--codes', default='600269,000726,600639,600502,000498,600694,600938,000900,600020,600941')
    a = ap.parse_args()
    codes = [c for c in a.codes.split(',') if c]
    nm = {}
    conn = sqlite3.connect(DB)
    for code in codes:
        row = conn.execute('SELECT name FROM stocks WHERE stock_code=?', (code,)).fetchone()
        nm[code] = row[0] if row else code
    conn.close()
    from factor_calc_stdlib import FactorCalcStdlib
    print(build_fundamental_md(a.date, codes, nm, FactorCalcStdlib()))
