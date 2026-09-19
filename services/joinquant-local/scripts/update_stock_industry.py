# -*- coding: utf-8 -*-
"""同步证监会行业分类（baostock query_stock_industry）→ data/stock_industry.json。

用途：daily_stock_pick.py 股票池按行业剔除（如建筑 E47-E50）。
- 只覆盖非北交所股票（baostock 无 920xxx），北交所本就无源被剔除，不影响。
- 幂等：重跑直接覆盖；建议季度刷新（证监会分类更新缓慢）。
- baostock 登录/查询失败时打印错误并保留旧文件，不阻塞选股（选股脚本缺映射时跳过行业剔除并提示）。
"""
import collections
import json
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(BASE_DIR, 'data', 'stock_industry.json')


def main():
    import baostock as bs
    lg = bs.login()
    if lg.error_code != '0':
        print(f'baostock 登录失败: {lg.error_code} {lg.error_msg}，保留旧行业映射')
        return 1
    try:
        industry_map = {}
        for attempt in range(1, 6):
            rs = bs.query_stock_industry()
            if rs.error_code != '0':
                print(f'行业查询失败: {rs.error_code} {rs.error_msg}，保留旧行业映射')
                return 1
            m = {}   # '600502' -> 'E48土木工程建筑业'
            while rs.next():
                f = rs.get_row_data()   # [update_date, code(sh.600502), name, industry, src]
                code = f[1].split('.')[-1]
                industry = f[3] or ''
                if industry:
                    m[code] = industry
            print(f'第 {attempt} 次拉取: {len(m)} 只' + ('（连接中断，重试…）' if len(m) < 5000 else ''))
            if len(m) >= 5000:
                industry_map = m
                break
        if len(industry_map) < 5000:
            print('警告: 多次重试仍未拉全（可能为 baostock 服务端故障），使用最后一次结果')
            industry_map = m
        with open(OUT_PATH, 'w', encoding='utf-8') as fp:
            json.dump(industry_map, fp, ensure_ascii=False, indent=0, sort_keys=True)
        cnt = collections.Counter(industry_map.values())
        e_cnt = sum(v for k, v in cnt.items() if k.startswith('E'))
        print(f'已保存 {len(industry_map)} 只行业分类 → {OUT_PATH}')
        print(f'其中建筑板块 E*（E47/E48/E49/E50）共 {e_cnt} 只，明细：')
        for k in sorted(k for k in cnt if k.startswith('E')):
            print(f'  {k}: {cnt[k]}')
        return 0
    finally:
        bs.logout()


if __name__ == '__main__':
    sys.exit(main())
