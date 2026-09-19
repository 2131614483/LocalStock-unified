# -*- coding: utf-8 -*-
"""快速数据同步：baostock 探针放子进程 + 硬超时，任何情况都在 ~25s 内返回（绝不挂起）。

背景：baostock 全量同步约 40+ 分钟，本环境后台任务约 5 分钟被限时杀掉；baostock 查询偶发卡死
（socket.setdefaulttimeout 对其自定义连接不生效）。故探针在子进程跑，subprocess 超时兜底。

结论一行：
  - 无新交易日 / 数据未发布 / 登录失败 / 超时 → 跳过同步（打印原因）
  - 数据已发布 → 后台启动全量同步（不阻塞）并立即返回

daily-stock-pick skill 第 1 步调用本脚本（外层可再套 timeout 150 双保险）：
  无论同步是否完成，都继续用「最新完整数据 + 腾讯实时行情」生成报告。

用法：C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe scripts/sync_quick.py
"""
import os
import subprocess
import sys
from datetime import date

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(BASE, 'data', 'stock_data.db')
SYNC = os.path.join(BASE, 'scripts', 'sync_gui.py')

# 探针代码：在子进程运行，DB 路径由 argv[1] 传入，结论打印为最后一行
PROBE = r'''
import os, socket, sqlite3, sys
from datetime import date
socket.setdefaulttimeout(10)
DB = sys.argv[1]
import baostock as bs
try:
    lg = bs.login()
    if lg.error_code != "0":
        print("PROBE_OUT:LOGIN_FAIL:" + lg.error_code); sys.exit(0)
    conn = sqlite3.connect(DB)
    last_local = conn.execute("SELECT MAX(trade_date) FROM stock_daily").fetchone()[0]
    conn.close()
    today = date.today().strftime("%Y-%m-%d")
    rs = bs.query_trade_dates(start_date=last_local or "2015-01-01", end_date=today)
    new_days = []
    if rs.error_code == "0":
        while rs.next():
            r = rs.get_row_data()
            if len(r) >= 2 and r[1] == "1" and r[0] > (last_local or ""):
                new_days.append(r[0])
    if not new_days:
        print("PROBE_OUT:NO_NEW"); sys.exit(0)
    latest = new_days[-1]
    # 探针应覆盖「本地最新之后」整个区间，而非只看 new_days[-1]：
    # 最新交易日（如今天）数据常未发布，但更早的新交易日（如昨日）已可同步，
    # 只查最后一天会误判"未发布"而漏同步。
    probe = bs.query_history_k_data_plus("sz.000001", "date,code", start_date=last_local, end_date=today, frequency="d", adjustflag="3")
    avail = []
    while probe.next():
        r = probe.get_row_data()
        if len(r) >= 1 and r[0] > (last_local or ""):
            avail.append(r[0])
    if avail:
        print("PROBE_OUT:READY:" + max(avail))
    else:
        print("PROBE_OUT:NOT_PUBLISHED:" + latest)
except Exception as e:
    print("PROBE_OUT:ERR:" + repr(e))
finally:
    try:
        bs.logout()
    except Exception:
        pass
'''


def main():
    try:
        r = subprocess.run([sys.executable, '-c', PROBE, DB],
                           timeout=25, capture_output=True, text=True,
                           encoding='utf-8', errors='replace')
        lines = [l.strip() for l in (r.stdout or '').splitlines() if l.strip()]
        # 结论行带 PROBE_OUT: 前缀（baostock login/logout 会向 stdout 打印
        # "login success!"/"logout success!"，会覆盖最后的裸 print，必须过滤）
        out = next((l for l in reversed(lines) if l.startswith('PROBE_OUT:')), '')
        out = out[len('PROBE_OUT:'):] if out else ''
    except subprocess.TimeoutExpired:
        print('baostock 探测超时（>25s），跳过同步')
        return 0
    except Exception as e:  # noqa: BLE001
        print(f'探测启动失败: {e}，跳过同步')
        return 0
    if not out:
        print(f'同步探测无输出（rc={r.returncode}），跳过同步')
        return 0
    if out.startswith('READY:'):
        latest = out.split(':', 1)[1]
        print(f'{latest} 数据已发布，后台启动全量同步（不阻塞，约 40 分钟）')
        try:
            logf = open(os.path.join(BASE, 'data', 'sync_background.log'), 'w', encoding='utf-8')
            subprocess.Popen([sys.executable, SYNC, '--silent'],
                             stdout=logf, stderr=subprocess.STDOUT, cwd=BASE)
        except Exception as e:  # noqa: BLE001
            print(f'后台同步启动失败: {e}（不影响本报告）')
        return 0
    if out.startswith('NO_NEW'):
        print('无新交易日，跳过同步')
        return 0
    if out.startswith('LOGIN_FAIL'):
        print(f'baostock 登录失败（{out}），跳过同步')
        return 0
    if out.startswith('NOT_PUBLISHED'):
        print(f'{out.split(":", 1)[1]} 数据未发布（baostock 滞后），跳过同步')
        return 0
    print(f'同步探测结果[{out}]，跳过同步')
    return 0


if __name__ == '__main__':
    sys.exit(main())
