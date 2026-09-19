# -*- coding: utf-8 -*-
# Tkinter 同步 GUI 按钮模拟点击测试（invoke 触发真实命令链）
import sys
import time
sys.path.insert(0, 'scripts')
import tkinter as tk
from sync_gui import SyncApp

pass_n = 0
fail_n = 0

def check(name, cond, detail=''):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print('[PASS] ' + name)
    else:
        fail_n += 1
        print('[FAIL] ' + name + '  ' + detail)

root = tk.Tk()
root.withdraw()
app = SyncApp(root)

# 状态区初始显示
check('状态区有上次同步行', '上次同步' in app.lbl_last.cget('text') or '同步' in app.lbl_last.cget('text'))

# 强制无新交易日快速退出，避免长同步
app.var_end.set('2026-08-07')

# 模拟点击「立即同步」按钮
try:
    app.btn_sync.invoke()
    check('点击立即同步后进入运行态', app.running)
except Exception as e:
    check('点击立即同步后进入运行态', False, str(e))

# 等待 worker 线程完成（登录 + 探针快速退出）
deadline = time.time() + 120
logs = []
done_stats = None
while time.time() < deadline and done_stats is None:
    while not app.q.empty():
        item = app.q.get_nowait()
        kind = item[0]
        if kind == 'log':
            logs.append(item[1])
        elif kind == 'done':
            done_stats = item[1]
    time.sleep(0.3)

# 模拟主循环处理 done 事件（无 mainloop 时需手动）
if done_stats is not None:
    app.on_done(done_stats)
check('同步流程结束(running=False)', not app.running, 'done未到达')
joined = '\n'.join(logs)
check('日志含同步区间', '区间' in joined, joined[:60])
check('日志含快速退出或完成', ('无新交易日' in joined or '完成' in joined or '数据未更新' in joined), joined[-60:])
print('  日志片段: ' + ' | '.join(logs[:4]))

root.destroy()
print('===== GUI 按钮测试: ' + str(pass_n) + ' 通过, ' + str(fail_n) + ' 失败 =====')
sys.exit(1 if fail_n else 0)
