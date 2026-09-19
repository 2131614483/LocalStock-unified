# -*- coding: utf-8 -*-
"""每日选股：全市场多因子打分 → top-N 名单 → 报告（docs/project-docs/每日选股/ + Obsidian）。

复用 engine/factor_calc_stdlib.py（纯标准库，无 pandas）：
  get_all_stocks()   可交易股票池（自动剔除 ST/涨跌停/停牌/次新/B股/北交所/金融股）
  get_factors()      因子截面
  rank_normalize()   z-score
打分方向正确：score += w * DIR[f] * z（方向显式应用），与研究管线
  compare_strategies_panel.py / validate_daily_schemes.py 完全一致。
  （注意：scripts/strategies/*.py 生产策略的 rank_normalize 未乘方向，vol_60d 会被当成正向——
   那是引擎侧待修 bug，本脚本不受影响。）

方案（validate_daily_schemes.py 历史验证 2018-2026，102 个月，含成本）：
  A multifactor   bp0.3+ep0.2+roe0.15+毛利0.1+现金流0.1+低波0.15         N50  +4.9%
  B value         bp0.6+ep0.4                                          N30  -1.2%
  C smallcap(旧默认)  A + ln_cap 0.10（小市值）                          N50 +12.8%
     smallcap30 同 C 但 N30（回测 +23.2%、夏普 0.07 最高，单票风险更大）
  V valuelowvol(新默认) bp0.3+ep0.2+低波0.3+小市值0.2（去失效质量因子）   N50 +29.7% ← 夏普 0.10 最优
     lean        小市值0.5+价值0.4+roe0.1（去低波/毛利/现金流）          N50 +67.7%（小市值虚高，实盘下调）
用法（系统 Python311，与数据同步一致；纯标准库也可用任意 python）：
  C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe scripts/daily_stock_pick.py \
      [--strategy valuelowvol] [--n 50] [--date 2026-08-07] [--write-report 0]
  --date 默认最新交易日（取 stock_daily 最大日期，数据同步后即当日）；
  --write-report 0 只打印不写文件；--n 0 用方案默认。
报告含：市场概况、top-N 名单表（含因子明细）、每只入选理由、口径与风险提示。
"""
import argparse
import json
import math
import os
import sys
from datetime import datetime

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, 'engine'))

from factor_calc_stdlib import FactorCalcStdlib  # noqa: E402

VAULT = os.environ.get('OBSIDIAN_VAULT', 'C:/Users/he/Documents/Obsidian Vault')
DOCS_DIR = os.path.join(BASE_DIR, 'docs', 'project-docs', '每日选股')
OBS_DIR = os.path.join(VAULT, '量化回测平台', '每日选股')
REPORT_SUBDIR = '每日选股'

# 行业剔除（2026-08-26 起）：证监会行业分类（baostock query_stock_industry → data/stock_industry.json）
# 建筑业 E47房屋建筑 / E48土木工程建筑 / E49建筑安装 / E50建筑装饰装修 整体剔除——
# 该类股票多为「现金流/净利为负」价值陷阱（如安徽建工/山东路桥），用户要求从每日筛选中剔除。
# 映射文件缺失时不阻塞选股（跳过行业剔除并提示）；用 scripts/update_stock_industry.py 刷新（建议季度）。
INDUSTRY_PATH = os.path.join(BASE_DIR, 'data', 'stock_industry.json')
EXCLUDE_INDUSTRY_CODES = ('E47', 'E48', 'E49', 'E50')  # 证监会行业分类：建筑业

# 候选方案：名称 -> (因子权重, 默认选股数)。权重为正，方向由注册表 direction 处理。
_BASE_MULTI = {'bp': 0.3, 'ep_ttm': 0.2, 'roe_ttm': 0.15,
               'gross_margin': 0.1, 'op_cf_ratio': 0.1, 'vol_60d': 0.15}
STRATEGIES = {
    'multifactor': (_BASE_MULTI, 50),
    'value': ({'bp': 0.6, 'ep_ttm': 0.4}, 30),
    'smallcap': (dict(_BASE_MULTI, **{'ln_cap': 0.10}), 50),   # 历史默认（保留作对照/历史可比）
    'smallcap30': (dict(_BASE_MULTI, **{'ln_cap': 0.10}), 30),  # 更集中，回测最好
    # 优化版（2026-08-25）：剔除近期 IC 失效的 roe/毛利/现金流，加重有效因子 bp+ep+低波+小市值。
    # 面板验证 2018-2026-07：+29.7% / 夏普 0.10 / 回撤 -24.8%（vs 旧 smallcap +12.8%/0.02/-27.6%）。
    'valuelowvol': ({'bp': 0.30, 'ep_ttm': 0.20, 'vol_60d': 0.30, 'ln_cap': 0.20}, 50),  # 新默认
    # 精简失效因子（2026-08-15 重构）：剔除毛利/现金流/低波，大幅提高小市值权重，保留 bp+ep+roe。
    # 回测 +67.7%/夏普 0.24/回撤 -26.9%（小市值容量/流动性未充分计价，实盘预期下调）。
    'lean': ({'ln_cap': 0.50, 'bp': 0.25, 'ep_ttm': 0.15, 'roe_ttm': 0.10}, 50),
}

# 因子中文名/短说明（报告展示用）
FACTOR_CN = {
    'bp': '账面市值比', 'ep_ttm': '盈余收益率', 'roe_ttm': '净资产收益率',
    'gross_margin': '毛利率', 'op_cf_ratio': '现金流/净利', 'vol_60d': '60日波动',
    'ln_cap': '总市值(ln)', 'debt_ratio': '负债率', 'rev_growth_yr': '营收增速',
    'profit_growth_yr': '净利增速', 'mom_12m1m': '动量12-1月', 'liq_20d': '流动性20日',
    'turnover_20d': '换手20日', 'ma_dev_20': '均线偏离', 'rsi_14': 'RSI14',
    'rev_5d': '5日反转', 'rev_10d': '10日反转', 'mom_1m': '动量1月',
    'mom_3m': '动量3月', 'mom_6m': '动量6月', 'mom_12m': '动量12月',
    'ep_annual': '盈余收益率(年报)', 'roe_annual': 'ROE(年报)', 'sp_ttm': '市销率倒数',
}


def load_factor_registry():
    """读取 scripts/factor_registry.json（因子定义唯一来源），失败返回 {}。"""
    p = os.path.join(BASE_DIR, 'scripts', 'factor_registry.json')
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f).get('factors', {})
    except (OSError, ValueError):
        return {}


def latest_date(conn, min_rows=4000):
    """取最近一个「数据完整」的交易日（行数 ≥ min_rows），避免被限时杀掉的部分同步留下半截数据污染打分。"""
    row = conn.execute(
        "SELECT trade_date, COUNT(*) FROM stock_daily GROUP BY trade_date "
        "HAVING COUNT(*) >= ? ORDER BY trade_date DESC LIMIT 1", (min_rows,)).fetchone()
    return row[0] if row and row[0] else None


def score_stocks(fc, stocks, factors, weights, date_str):
    """截面打分：逐因子 缩尾[1%,99%] → z-score → 乘方向与权重求和。返回 {code: score}。

    缩尾与研究管线一致（compare_strategies_panel / validate_daily_schemes / multi_factor_backtest
    都先 clip 再 z-score），否则现金流/净利这类因子会被极端值（如 13940140%）扭曲打分。
    缺失因子贡献 0（与研究管线 fillna(0) 等价）。
    """
    data = fc.get_factors(stocks, factors, date_str)
    scores = {}
    for f, w in weights.items():
        vals = {s: d.get(f) for s, d in data.items()}
        valid = sorted(v for v in vals.values() if v is not None)
        if not valid:
            continue
        lo = valid[max(0, int(0.01 * (len(valid) - 1)))]
        hi = valid[min(len(valid) - 1, int(0.99 * (len(valid) - 1)))]
        clipped = {s: (v if v is None else max(lo, min(hi, v))) for s, v in vals.items()}
        z = fc.rank_normalize(clipped)   # 纯 z-score，方向在下方统一乘
        dir_ = fc.factor_direction(f)
        for s in stocks:
            scores[s] = scores.get(s, 0) + w * dir_ * z.get(s, 0)
    return scores, data


# 各方案历史验证（validate_daily_schemes.py，2018-2026，102 个月，含交易成本）
VALIDATION = {
    'smallcap': ('+12.8%', '+0.02', '-27.6%'),
    'smallcap30': ('+23.2%', '+0.07', '-27.3%'),
    'multifactor': ('+4.9%', '-0.03', '-27.9%'),
    'value': ('-1.2%', '-0.05', '-32.5%'),
    'lean': ('+67.7%', '+0.24', '-26.9%'),
    'valuelowvol': ('+29.7%', '+0.10', '-24.8%'),
}
MAIN_INDICES = [
    ('000001', '上证综指'), ('000016', '上证50'), ('000300', '沪深300'),
    ('000905', '中证500'), ('399001', '深证成指'), ('399106', '深证综指'),
]


def market_context(conn, date_str):
    """市场概况：主要指数表现 + 市场广度（涨跌家数/成交额）。"""
    codes = [c for c, _ in MAIN_INDICES]
    ph = ','.join('?' * len(codes))
    idx = {code: (close, ret) for code, close, ret in conn.execute(
        "SELECT index_code, close_index, return_index FROM index_daily "
        "WHERE trade_date=? AND index_code IN (" + ph + ")", [date_str] + codes)}
    b = conn.execute(
        "SELECT COUNT(*), SUM(close_price>pre_close_price), SUM(close_price<pre_close_price), "
        "SUM(close_price=pre_close_price), SUM(amount) FROM stock_daily "
        "WHERE trade_date=? AND close_price>0 AND pre_close_price>0", (date_str,)).fetchone()
    lines = ['## 一、市场概况', '']
    lines.append('### 1.1 主要指数表现')
    lines.append('')
    lines.append('| 指数 | 收盘 | 涨跌幅 |')
    lines.append('|---|---|---|')
    for code, nm in MAIN_INDICES:
        if code in idx:
            close, ret = idx[code]
            lines.append(f'| {nm}（{code}） | {close:.2f} | {ret*100:+.2f}% |')
    lines.append('')
    if b and b[0]:
        total, up, down, flat, amount = b
        lines.append('### 1.2 市场广度')
        lines.append('')
        lines.append(f'- 全市场 **{total} 只**：上涨 **{up}** / 下跌 **{down}** / 平盘 {flat}')
        lines.append(f'- 总成交额 ≈ **{amount / 1e8:.0f} 亿元**')
    lines.append('')
    return '\n'.join(lines)


def portfolio_profile(fc, weights, ranked, data):
    """组合画像：各因子百分位均值（按方向归一 0-100 越大越好）+ 估值/市值中位数。"""
    res = {}
    for f in weights:
        vals = [x.get(f) for x in data.values() if x.get(f) is not None]
        if not vals:
            continue
        dir_ = fc.factor_direction(f)
        pcts = []
        for c in ranked:
            v = data.get(c, {}).get(f)
            if v is not None:
                pcts.append(sum(1 for x in vals if dir_ * (x - v) < 0) / len(vals) * 100)
        res[f] = sum(pcts) / len(pcts) if pcts else None

    def med(lst):
        return lst[len(lst) // 2] if lst else None

    eps = []
    bps = []
    caps = []
    for c in ranked:
        d = data.get(c, {})
        if d.get('ep_ttm'):
            eps.append(1.0 / d['ep_ttm'])
        if d.get('bp'):
            bps.append(1.0 / d['bp'])
        if d.get('ln_cap'):
            caps.append(math.exp(d['ln_cap']))
    return {'factor_pct': res, 'med_pe': med(sorted(eps)),
            'med_pb': med(sorted(bps)), 'med_cap': med(sorted(caps))}


def build_report(fc, date_str, name, weights, n, stocks, scores, data):
    ranked = sorted(scores, key=lambda s: scores[s], reverse=True)[:n]
    # 名称/收盘价
    ph = ','.join('?' * len(ranked))
    name_map = dict(fc.conn.execute(
        "SELECT stock_code, name FROM stocks WHERE stock_code IN (" + ph + ")", ranked))
    close_map = dict(fc.conn.execute(
        "SELECT stock_code, close_price FROM stock_daily WHERE trade_date=? AND stock_code IN (" + ph + ")",
        [date_str] + ranked))

    def fmt(v, is_pct=False):
        if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
            return '—'
        if is_pct:
            return f'{v * 100:.1f}%'
        return f'{v:.4f}'

    def num(v, nd=1):
        if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))) or v <= 0:
            return '—'
        return f'{v:.{nd}f}'

    lines = []
    gen_date = datetime.now().strftime('%Y-%m-%d')
    lines.append(f'# 每日选股报告 · {gen_date}')
    lines.append('')
    lines.append(f'> 方案：**{name}** · 权重 '
                 + ' + '.join(f'{FACTOR_CN.get(f, f)} {w:.2f}' for f, w in weights.items())
                 + f' · 选 top-{n} · 等权持仓（建议月频调仓）')
    total_ret, sharpe, mdd = VALIDATION.get(name, ('—', '—', '—'))
    lines.append(f'> 历史验证 2018-2026（含交易成本）：总收益 **{total_ret}** · 夏普 {sharpe} · 最大回撤 {mdd}')
    lines.append(f'> 生成：{datetime.now().strftime("%Y-%m-%d %H:%M")} · 数据截至 {date_str}')
    lines.append('')
    lines.append(market_context(fc.conn, date_str))
    lines.append(f'- 当日可交易股票池（剔除 ST/涨跌停/停牌/次新/B股/北交所/金融股）：**{len(stocks)} 只**')
    lines.append(f'- 打分因子：`{name}` 权重因子共 {len(weights)} 个')
    lines.append('')
    lines.append('## 二、选股方案与方法')
    lines.append('')
    lines.append(f'- 模型：多因子截面打分。每因子先 [1%,99%] 缩尾去极端 → z-score 标准化 → 乘方向与权重加权求和 → 取 top-{n} 等权。')
    lines.append(f'- 权重：{"、".join(f"{FACTOR_CN.get(f, f)} {w}" for f, w in weights.items())}（研究管线 `validate_daily_schemes.py` 历史验证选定）。')
    lines.append('- 无未来函数：基本面用「报告期 + 4 个月披露滞后」；动量 skip 最近 20 交易日；股票池剔除 ST/涨跌停/停牌/次新(<120日)/B股/北交所/金融股。')
    lines.append('')
    lines.append('### 2.1 因子定义与公式')
    lines.append('')
    lines.append('> 打分公式：`综合得分 = Σ wᵢ × 方向ᵢ × z-score(缩尾[1%,99%] 因子ᵢ)`，缺失因子贡献 0。')
    lines.append('')
    lines.append('| 因子 | 方向 | 权重 | 公式/定义 | 数据源 |')
    lines.append('|---|---|---|---|---|')
    reg = load_factor_registry()
    for f, w in weights.items():
        d = reg.get(f, {})
        desc = d.get('desc') or '—'
        dirn = d.get('direction')
        dirn = fc.factor_direction(f) if dirn is None else dirn
        src = d.get('data_source') or '—'
        lines.append(f'| {FACTOR_CN.get(f, f)}（{f}） | {dirn}（{"越大越好" if dirn > 0 else "越小越好"}） | {w:.2f} | {desc} | {src} |')
    lines.append('')
    lines.append(f'- 选股数：top-{n} 等权（建议月频调仓）；方向由 `factor_registry.json` 统一管理。')
    lines.append('')
    lines.append('## 三、今日 Top-%d 名单' % n)
    lines.append('')
    lines.append('> PE/PB 为按盈余收益率(ep_ttm)/账面市值比(bp)换算的**估算值**，仅供参考；baostock 段市值用参考股本×收盘推算，个别票 PE/PB 可能失真。')
    lines.append('')
    header = ['排名', '代码', '名称', '收盘价', 'PE(估)', 'PB(估)', '综合得分'] + [FACTOR_CN.get(f, f) for f in weights]
    lines.append('| ' + ' | '.join(header) + ' |')
    lines.append('|' + '---|' * len(header))
    for i, code in enumerate(ranked, 1):
        d = data.get(code, {})
        close = close_map.get(code)
        pe = num(1.0 / d['ep_ttm'] if d.get('ep_ttm') else None)
        pb = num(1.0 / d['bp'] if d.get('bp') else None)
        row = [str(i), code, name_map.get(code, ''), fmt(close, False), pe, pb, f'{scores[code]:.2f}']
        row += [fmt(d.get(f), f in ('gross_margin', 'op_cf_ratio', 'vol_60d', 'debt_ratio'))
                for f in weights]
        lines.append('| ' + ' | '.join(row) + ' |')
    lines.append('')
    # 组合画像
    prof = portfolio_profile(fc, weights, ranked, data)
    lines.append('## 四、组合画像（top-%d 统计）' % n)
    lines.append('')
    lines.append('| 维度 | 数值 | 含义 |')
    lines.append('|---|---|---|')
    for f, pct in prof['factor_pct'].items():
        if pct is not None:
            lines.append(f'| {FACTOR_CN.get(f, f)}平均百分位 | **{pct:.0f}%** | 组合在该因子上相对全市场的位置（越大越好） |')
    lines.append(f'| PE(中位数, 估) | {num(prof["med_pe"])} | 组合估值水平 |')
    lines.append(f'| PB(中位数, 估) | {num(prof["med_pb"])} | 组合市净率水平 |')
    lines.append(f'| 市值(中位数) | {num(prof["med_cap"] / 1e8) if prof["med_cap"] else "—"} 亿元 | 组合规模风格 |')
    lines.append('')
    # 入选理由
    lines.append('## 五、前 10 入选理由（因子百分位）')
    lines.append('')
    lines.append('> 百分位为当日全市场该因子的分布位置（0-100，**已按因子方向归一**，越大越好）。')
    lines.append('')
    for i, code in enumerate(ranked[:10], 1):
        d = data.get(code, {})
        name = name_map.get(code, '')
        items = [f'### {i}. **{name}**（{code}，收盘 {fmt(close_map.get(code))}）', '']
        for f, w in weights.items():
            v = d.get(f)
            if v is None:
                continue
            dir_ = fc.factor_direction(f)
            vals = [x.get(f) for x in data.values() if x.get(f) is not None]
            if not vals:
                continue
            pct = sum(1 for x in vals if dir_ * (x - v) < 0) / len(vals) * 100
            items.append(
                f'- {FACTOR_CN.get(f, f)} {fmt(v, f in ("gross_margin", "op_cf_ratio", "vol_60d", "debt_ratio"))}'
                f'（权重 {w:.2f}，全市场前 {pct:.0f}%）')
        lines.append('\n'.join(items))
        lines.append('')
    lines.append('')
    lines.append('## 六、口径与风险提示')
    lines.append('')
    lines.append('- 因子无未来函数：基本面用「报告期 + 4 个月滞后」；动量 skip 最近 20 交易日；股票池剔除 ST/涨跌停/次新/金融股。')
    lines.append('- **动量在 A 股 2018-2026 方向反向**，本方案不含动量因子；成长因子不显著，仅作参考。')
    lines.append('- 小市值增强（ln_cap）是 A 股 2018-2026 有效因子，但小市值波动大、流动性差，请控制单票仓位。')
    lines.append('- **名单是「当日截面快照」，不构成调仓指令**。建议月度调仓、等权持有，避免高频换手吞噬收益；单票止损参考 -8%。')
    lines.append('- 数据源：CSMAR 全量 + baostock 每日增量；本地因子数据可能落后 1 天（baostock 滞后），实时行情请见 Claude 点评补充。')
    lines.append('')
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description='每日选股')
    ap.add_argument('--strategy', default='valuelowvol', choices=sorted(STRATEGIES),
                    help='打分方案（默认 valuelowvol，优化版：bp+ep+低波+小市值）')
    ap.add_argument('--n', type=int, default=0, help='选股数（0 用方案默认）')
    ap.add_argument('--date', default=None, help='截面日期 YYYY-MM-DD（默认最新交易日）')
    ap.add_argument('--write-report', type=int, default=1, help='0 只打印不写文件')
    args = ap.parse_args()

    weights, default_n = STRATEGIES[args.strategy]
    n = args.n or default_n

    fc = FactorCalcStdlib()
    date_str = args.date or latest_date(fc.conn)
    if not date_str:
        print('stock_data.db 无行情数据，先跑数据同步。')
        return 1
    print(f'[{datetime.now().strftime("%H:%M:%S")}] 方案={args.strategy} 日期={date_str} 选股数={n}')

    stocks = fc.get_all_stocks(date_str)
    # 名称级过滤（baostock 增量段 trade_status 不标 ST，需按名称兜底）：
    #   - 名称含 "ST"（含 *ST/S*ST）剔除
    #   - 短名银行/证券不含"银行/证券"字样，漏过 FIN_KEYWORDS，按精确名单补漏
    #     （FIN_SHORTNAMES 为实测扫描 2026-08-07 全市场得出；银河电子/浙江建投等非金融勿加）
    ph = ','.join('?' * len(stocks))
    name_map = dict(fc.conn.execute(
        "SELECT stock_code, name FROM stocks WHERE stock_code IN (" + ph + ")", stocks))
    FIN_SHORTNAMES = {'张家港行', '中国银河', '中信建投', '湘财股份', '东方财富'}
    NAME_BANK_PATTERN = ('农商', '城商')
    # 行业映射（剔除建筑业 E47-E50；映射缺失时跳过行业剔除并提示，不阻塞）
    try:
        with open(INDUSTRY_PATH, encoding='utf-8') as _f:
            industry_map = json.load(_f)
    except OSError:
        industry_map = {}
        print(f'警告: {INDUSTRY_PATH} 缺失，行业剔除跳过（建筑股不会被过滤）；'
              f'可用 scripts/update_stock_industry.py 刷新')
    clean = []
    for c in stocks:
        nm = name_map.get(c) or ''
        if 'ST' in nm.upper() or any(k in nm for k in NAME_BANK_PATTERN) or nm in FIN_SHORTNAMES:
            continue
        if industry_map.get(c, '').startswith(EXCLUDE_INDUSTRY_CODES):
            continue
        clean.append(c)
    dropped_st = len(stocks) - len(clean)
    dropped_ind = sum(1 for c in stocks if industry_map.get(c, '').startswith(EXCLUDE_INDUSTRY_CODES))
    stocks = clean
    print(f'可交易股票池: {len(stocks)} 只（名称过滤剔除 {dropped_st} 只 ST/农商城商/金融短名'
          f'，行业剔除 {dropped_ind} 只建筑业 E47-E50）')
    if len(stocks) < n * 3:
        print(f'股票池不足（{len(stocks)} < {n * 3}），跳过。')
        return 1
    scores, data = score_stocks(fc, stocks, list(weights.keys()), weights, date_str)

    report = build_report(fc, date_str, args.strategy, weights, n, stocks, scores, data)

    if args.write_report:
        # 追加：七基本面与估值快照 / 八技术面图 / 九因子诊断；任一失败不阻塞报告
        ranked = sorted(scores, key=lambda s: scores[s], reverse=True)[:n]
        img_dirs = [os.path.join(DOCS_DIR, 'images'), os.path.join(OBS_DIR, 'images')]
        try:
            import fetch_fundamental
            report += fetch_fundamental.build_fundamental_md(date_str, ranked, name_map, fc)
        except Exception as e:  # noqa: BLE001
            report += f"\n## 七、基本面与估值快照\n\n> 基本面获取失败（已跳过）: {e}\n"
        try:
            import chart_strategies
            report += chart_strategies.build_technical_md(date_str, ranked, name_map, img_dirs)
        except Exception as e:  # noqa: BLE001
            report += f"\n## 八、技术面辅助\n\n> 图表生成失败（已跳过）: {e}\n"
        try:
            import optimize_factors
            report += optimize_factors.build_optimization_md(date_str, weights, name_map, img_dirs)
        except Exception as e:  # noqa: BLE001
            report += f"\n## 九、因子诊断与优化建议\n\n> 优化分析失败（已跳过）: {e}\n"
        # 记录本次 top-N 名单（供 optimize_factors 追踪后续表现）
        try:
            hist_path = os.path.join(BASE_DIR, 'data', 'picks_history.json')
            hist = {}
            if os.path.exists(hist_path):
                with open(hist_path, encoding='utf-8') as f:
                    hist = json.load(f)
            hist[date_str] = ranked
            with open(hist_path, 'w', encoding='utf-8') as f:
                json.dump(hist, f, ensure_ascii=False)
        except OSError:
            pass

    # 打印控制台摘要
    print('\n' + '\n'.join(report.splitlines()[:40]))
    print(f'\n...（完整报告 {report.count(chr(10))} 行，见文件）')

    if args.write_report:
        os.makedirs(DOCS_DIR, exist_ok=True)
        os.makedirs(OBS_DIR, exist_ok=True)
        fname = f'每日选股_{datetime.now().strftime("%Y-%m-%d")}.md'  # 文件名用系统日期（非数据日期）
        for d in (DOCS_DIR, OBS_DIR):
            with open(os.path.join(d, fname), 'w', encoding='utf-8') as f:
                f.write(report)
            print(f'已写入: {os.path.join(d, fname)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
