# -*- coding: utf-8 -*-
# 数据同步启动器：用系统 Python311 启动 scripts/sync_gui.py
# 命令行参数原样透传（--silent / --register 等）
# 打包: pyinstaller --onefile --noconsole --name 数据同步 launcher.py
import os
import sys
import ctypes
import subprocess


def find_python():
    la = os.environ.get('LOCALAPPDATA', 'C:/Users')
    cands = [
        la + '/Programs/Python/Python311/python.exe',
        'C:/Python311/python.exe',
        'C:/Program Files/Python311/python.exe',
    ]
    for p in cands:
        if os.path.exists(p):
            return p
    return None


def main():
    if getattr(sys, 'frozen', False):
        root = os.path.dirname(sys.executable)
    else:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    script = os.path.join(root, 'scripts', 'sync_gui.py')
    py = find_python()
    if not py:
        ctypes.windll.user32.MessageBoxW(0, '未找到系统 Python311，请先安装。', '数据同步启动器', 0x10)
        return 1
    if not os.path.exists(script):
        ctypes.windll.user32.MessageBoxW(0, '未找到 scripts/sync_gui.py，请把本程序放在项目根目录下。', '数据同步启动器', 0x10)
        return 1
    subprocess.Popen([py, script] + sys.argv[1:], cwd=root, creationflags=subprocess.CREATE_NO_WINDOW)
    return 0


if __name__ == '__main__':
    sys.exit(main())

