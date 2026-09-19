

# -*- coding: utf-8 -*-
"""
数据同步 GUI 工具
默认数据源 = 腾讯/新浪（与 daily-stock-pick skill 一致，稳定免登录）；baostock 备选。
配合 Windows 计划任务每天自动同步行情数据。

运行（必须用系统 Python311，含 tkinter）:
  C:\\Users\\he\\AppData\\Local\\Programs\\Python\\Python311\\python.exe scripts/sync_gui.py
  --silent    无界面直接同步（供计划任务调用），日志写 data/sync.log；--source txsina|baostock
  --register  注册每日计划任务后退出
"""
import os
import sys
import json
import queue
import subprocess
import threading
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
from datetime import date, datetime

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META_PATH = os.path.join(BASE_DIR, 'data', 'sync_meta.json')
SYNC_LOG = os.path.join(BASE_DIR, 'data', 'sync.log')
SCRIPT = os.path.abspath(__file__)
PY = sys.executable

from baostock_sync import SyncConfig, run_sync


def read_meta():
    try:
        with open(META_PATH, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


class SyncApp:
    def __init__(self, root):
        self.root = root
        root.title('量化回测平台 - 数据同步')
        root.geometry('660x580')
        self.q = queue.Queue()
        self.running = False
        self._build_ui()
        self._show_meta()
        self.poll_queue()
        root.protocol('WM_DELETE_WINDOW', self.on_close)

    def _build_ui(self):
        frm = ttk.LabelFrame(self.root, text='同步状态', padding=8)
        frm.pack(fill='x', padx=10, pady=6)
        self.lbl_last = ttk.Label(frm, text='上次同步: -')
        self.lbl_last.grid(row=0, column=0, sticky='w')
        self.lbl_range = ttk.Label(frm, text='数据范围: -')
        self.lbl_range.grid(row=1, column=0, sticky='w')
        self.lbl_result = ttk.Label(frm, text='上次结果: -')
        self.lbl_result.grid(row=2, column=0, sticky='w')


        frm2 = ttk.LabelFrame(self.root, text='同步设置', padding=8)
        frm2.pack(fill='x', padx=10, pady=6)
        ttk.Label(frm2, text='结束日期:').grid(row=0, column=0, sticky='w')
        self.var_end = tk.StringVar(value=date.today().strftime('%Y-%m-%d'))
        ttk.Entry(frm2, textvariable=self.var_end, width=12).grid(row=0, column=1, sticky='w')
        ttk.Label(frm2, text='延迟(秒):').grid(row=0, column=2, sticky='w', padx=(12, 0))
        self.var_delay = tk.StringVar(value='0.2')
        ttk.Entry(frm2, textvariable=self.var_delay, width=6).grid(row=0, column=3, sticky='w')
        self.var_no_idx = tk.BooleanVar(value=False)
        ttk.Checkbutton(frm2, text='跳过指数', variable=self.var_no_idx).grid(
            row=0, column=4, sticky='w', padx=(12, 0))
        ttk.Label(frm2, text='计划任务时间:').grid(row=1, column=0, sticky='w', pady=(6, 0))
        self.var_sched = tk.StringVar(value='18:00')
        ttk.Entry(frm2, textvariable=self.var_sched, width=8).grid(
            row=1, column=1, sticky='w', pady=(6, 0))
        ttk.Label(frm2, text='数据源:').grid(row=2, column=0, sticky='w', pady=(6, 0))
        self.var_source = tk.StringVar(value='腾讯/新浪')
        ttk.Combobox(frm2, textvariable=self.var_source,
                     values=('腾讯/新浪', 'baostock'), state='readonly', width=10).grid(
            row=2, column=1, sticky='w', pady=(6, 0))
        ttk.Label(frm2, text='(与 skill 一致，稳定免登录)', foreground='#888').grid(
            row=2, column=2, columnspan=3, sticky='w', pady=(6, 0))


        btns = ttk.Frame(self.root)
        btns.pack(fill='x', padx=10, pady=4)
        self.btn_sync = ttk.Button(btns, text='立即同步', command=self.start_sync)
        self.btn_sync.pack(side='left', padx=2)
        ttk.Button(btns, text='注册计划任务', command=self.register_task).pack(side='left', padx=2)
        ttk.Button(btns, text='打开数据目录', command=self.open_dir).pack(side='left', padx=2)
        ttk.Button(btns, text='退出', command=self.root.destroy).pack(side='right', padx=2)
        self.prog = ttk.Progressbar(self.root, mode='determinate')
        self.prog.pack(fill='x', padx=10, pady=4)
        self.lbl_prog = ttk.Label(self.root, text='就绪')
        self.lbl_prog.pack(anchor='w', padx=10)
        self.log = scrolledtext.ScrolledText(self.root, height=16, state='disabled')
        self.log.pack(fill='both', expand=True, padx=10, pady=(4, 10))


    def _show_meta(self):
        m = read_meta()
        if not m:
            return
        self.lbl_last.config(text='上次同步: ' + m.get('last_sync', '-'))
        self.lbl_range.config(text='数据范围: ' + m.get('start', '-') + ' ~ ' + m.get('end', '-'))
        self.lbl_result.config(text='上次结果: 新增 %s 行, 失败 %s' % (m.get('rows', 0), m.get('failed', 0)))


    def append_log(self, msg):
        self.log.config(state='normal')
        self.log.insert('end', msg + '\n')
        self.log.see('end')
        self.log.config(state='disabled')


    def start_sync(self):
        if self.running:
            messagebox.showinfo('提示', '同步正在进行中')
            return
        try:
            delay = float(self.var_delay.get())
        except ValueError:
            messagebox.showerror('错误', '延迟必须是数字')
            return


        cfg = SyncConfig(end=self.var_end.get().strip(), delay=delay, no_indices=self.var_no_idx.get())
        source = self.var_source.get()
        self.running = True
        self.btn_sync.config(state='disabled')
        self.prog['value'] = 0
        self.append_log('=== 开始同步（数据源: %s）===' % source)
        self.worker = threading.Thread(target=self._run_worker, args=(cfg, source), daemon=True)
        self.worker.start()


    def _run_worker(self, cfg, source):
        def logfn(msg):
            self.q.put(('log', msg))
        def progfn(i, total, rows, failed, skipped):
            self.q.put(('prog', i, total, rows, failed, skipped))
        try:
            if source == 'baostock':
                stats = run_sync(cfg, log_fn=logfn, progress_fn=progfn)
            else:
                import backfill_daily_tx_sina as bf
                stats = bf.run_backfill(end=cfg.end or None, log_fn=logfn, progress_fn=progfn)
            self.q.put(('done', stats))
        except Exception as e:
            self.q.put(('done', {'error': str(e)}))


    def on_close(self):
        if self.running:
            if messagebox.askyesno('确认', '同步正在进行中，确定退出吗？'):
                self.root.destroy()
        else:
            self.root.destroy()


    def poll_queue(self):
        try:
            while True:
                item = self.q.get_nowait()
                kind = item[0]
                if kind == 'log':
                    self.append_log(item[1])
                elif kind == 'prog':
                    self.update_progress(*item[1:])
                elif kind == 'done':
                    self.on_done(item[1])
        except queue.Empty:
            pass
        self.root.after(150, self.poll_queue)

    def update_progress(self, i, total, rows, failed, skipped):
        if total:
            self.prog['value'] = i * 100.0 / total
            self.lbl_prog.config(text='%d/%d 只 | 新增 %d 行 | 失败 %d | 跳过 %d' % (i, total, rows, failed, skipped))


    def on_done(self, stats):
        self.running = False
        self.btn_sync.config(state='normal')
        if stats.get('error'):
            self.append_log('出错: ' + stats['error'])
            self.lbl_prog.config(text='同步出错')
            messagebox.showerror('错误', stats['error'])
            return
        if stats.get('source') == 'txsina':
            if stats.get('no_new'):
                self.append_log('腾讯/新浪：本地数据已最新，无需回填（%s）' % stats.get('local_max'))
            else:
                self.append_log('腾讯/新浪回填完成: 新增 %s 行, 失败 %s, 最新 %s'
                                % (stats.get('rows'), stats.get('failed'), stats.get('new_max')))
        elif stats.get('skipped_lock'):
            self.append_log('另一同步正在进行，已跳过')
        elif stats.get('login_failed'):
            self.append_log('baostock 登录失败')
        elif stats.get('no_new_days'):
            self.append_log('无新交易日，无需同步')
        else:
            self.append_log('完成: 新增 %s 行, 失败 %s' % (stats.get('rows'), stats.get('failed')))
        self._show_meta()
        self.prog['value'] = 100
        self.lbl_prog.config(text='同步完成')


    def register_task(self):
        sched = self.var_sched.get().strip()
        if len(sched.split(':')) != 2:
            messagebox.showerror('错误', '计划任务时间格式应为 HH:MM')
            return
        cmd = ['schtasks', '/Create', '/TN', 'QuantBacktestDataSync', '/F',
               '/SC', 'DAILY', '/ST', sched,
               '/TR', '"%s" "%s" --silent' % (PY, SCRIPT)]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            out = (r.stdout or '') + (r.stderr or '')
            if r.returncode == 0:
                messagebox.showinfo('成功', '计划任务已注册: QuantBacktestDataSync\n每日 %s 自动同步' % sched)
            else:
                messagebox.showerror('失败', '注册失败（可能需要管理员权限）:\n' + out[:500])
        except Exception as e:
            messagebox.showerror('错误', '执行 schtasks 失败: ' + str(e))


    def open_dir(self):
        d = os.path.join(BASE_DIR, 'data')
        if os.path.isdir(d):
            os.startfile(d)


def register_task_cli():
    cmd = ['schtasks', '/Create', '/TN', 'QuantBacktestDataSync', '/F',
           '/SC', 'DAILY', '/ST', '18:00',
           '/TR', '"%s" "%s" --silent' % (PY, SCRIPT)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    out = (r.stdout or '') + (r.stderr or '')
    print(out)
    return r.returncode


def run_silent(source='txsina'):
    if source == 'txsina':
        # 计划任务与命令行统一走同一入口，保证行情、交易日历和 AI 状态一起更新。
        from unified_data_sync import run as run_unified
        return run_unified()
    log_lines = []
    def logfn(msg):
        line = '[%s] %s' % (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), msg)
        log_lines.append(line)
        print(line, flush=True)
        try:
            with open(SYNC_LOG, 'a', encoding='utf-8') as f:
                f.write(line + '\n')
        except OSError:
            pass
    def progfn(i, total, rows, failed, skipped):
        if i % 500 == 0:
            logfn('progress %d/%d' % (i, total))
    if source == 'baostock':
        cfg = SyncConfig()
        stats = run_sync(cfg, log_fn=logfn, progress_fn=progfn)
    else:
        import backfill_daily_tx_sina as bf
        stats = bf.run_backfill(log_fn=logfn, progress_fn=progfn)
    logfn('done: %s' % json.dumps(stats, ensure_ascii=False))
    if stats.get('error'):
        return 1
    if stats.get('source') == 'txsina':
        return 0 if not stats.get('failed') or stats.get('failed', 0) <= 100 else 1
    if stats.get('skipped_lock') or stats.get('login_failed') or stats.get('no_new_days'):
        return 0
    return 1 if stats.get('failed', 0) > 50 else 0


def main():
    import argparse
    ap = argparse.ArgumentParser(description='Data sync GUI')
    ap.add_argument('--silent', action='store_true', help='run sync without GUI')
    ap.add_argument('--register', action='store_true', help='register daily scheduled task')
    ap.add_argument('--source', default='txsina', choices=['txsina', 'baostock'],
                    help='data source (default txsina: Tencent/Sina, same as daily-stock-pick skill)')
    args = ap.parse_args()
    if args.register:
        sys.exit(register_task_cli())
    if args.silent:
        sys.exit(run_silent(args.source))
    root = tk.Tk()
    SyncApp(root)
    root.mainloop()


if __name__ == '__main__':
    main()
