# -*- coding: utf-8 -*-
"""
画线算法引擎：执行用户 Python 算法，在 K 线上生成画线。

用法:
  python draw_engine.py --code <算法代码> --data <K线JSON文件>

注入环境:
  data     = { dates, opens, highs, lows, closes, volumes, n }（K线数组，与索引对齐）
  n        = K线根数
  画线函数:
    draw_line(x1,y1,x2,y2, color=None, label=None)    趋势线
    draw_ray(x1,y1,x2,y2, color=None, label=None)     射线
    draw_hline(y, color=None, label=None)             水平线
    draw_rect(x1,y1,x2,y2, color=None, label=None)    矩形
    draw_fib(x1,y1,x2,y2, color=None, label=None)     斐波那契回调
    draw_channel(x1,y1,x2,y2, color=None, label=None) 通道
  x 为 K 线索引（0~n-1），y 为价格。算法内不要用 print()（会破坏 JSON），
  可用 log()（本文件注入）或直接调用画线函数。

stdout 输出纯 JSON: {"code":0,"drawings":[...]} 或 {"code":-1,"error":"..."}
"""
import argparse
import json
import sys

# Windows 管道下强制 UTF-8 输出
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding='utf-8')
    except Exception:
        pass


class _Log:
    def __init__(self):
        self.entries = []

    def info(self, msg):
        self.entries.append(str(msg))

    def warn(self, msg):
        self.entries.append(str(msg))

    def error(self, msg):
        self.entries.append(str(msg))


def main():
    parser = argparse.ArgumentParser(description='K线画线算法引擎')
    parser.add_argument('--code', required=True, help='算法代码')
    parser.add_argument('--data', required=True, help='K线数据 JSON 文件')
    args = parser.parse_args()

    with open(args.data, 'r', encoding='utf-8') as f:
        kline = json.load(f)

    points = kline.get('points') or []
    n = len(points)
    data = {
        'dates': [p.get('time') for p in points],
        'opens': [p.get('open') for p in points],
        'highs': [p.get('high') for p in points],
        'lows': [p.get('low') for p in points],
        'closes': [p.get('close') for p in points],
        'volumes': [p.get('volume') for p in points],
        'n': n,
    }

    drawings = []

    def _mk(type_, pts, color, label):
        drawings.append({
            'type': type_,
            'points': [{'x': int(p[0]), 'y': float(p[1])} for p in pts],
            'color': color or '#2f81f7',
            'label': label,
        })

    def draw_line(x1, y1, x2, y2, color=None, label=None):
        _mk('segment', [(x1, y1), (x2, y2)], color, label)

    def draw_ray(x1, y1, x2, y2, color=None, label=None):
        _mk('ray', [(x1, y1), (x2, y2)], color, label)

    def draw_hline(y, color=None, label=None):
        _mk('hline', [(0, y)], color, label)

    def draw_rect(x1, y1, x2, y2, color=None, label=None):
        _mk('rect', [(x1, y1), (x2, y2)], color, label)

    def draw_fib(x1, y1, x2, y2, color=None, label=None):
        _mk('fib', [(x1, y1), (x2, y2)], color, label)

    def draw_channel(x1, y1, x2, y2, color=None, label=None):
        _mk('channel', [(x1, y1), (x2, y2)], color, label)

    log = _Log()
    env = {
        'data': data,
        'n': n,
        'draw_line': draw_line,
        'draw_ray': draw_ray,
        'draw_hline': draw_hline,
        'draw_rect': draw_rect,
        'draw_fib': draw_fib,
        'draw_channel': draw_channel,
        'drawings': drawings,
        'log': log,
    }

    try:
        exec(args.code, env)
    except Exception as e:
        print(json.dumps({'code': -1, 'error': str(e)}, ensure_ascii=False))
        return

    print(json.dumps({'code': 0, 'drawings': drawings, 'logs': log.entries}, ensure_ascii=False))


if __name__ == '__main__':
    main()
