# -*- coding: utf-8 -*-
"""打包 daily-stock-pick skill（SKILL.md + 依赖脚本 + 排错文档）为 zip。"""
import os
import sys
import zipfile

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
root = 'D:/pythonpro/聚宽-local'
skill_src = 'C:/Users/he/.claude/skills/daily-stock-pick/SKILL.md'
outdir = root + '/docs/每日选股-skill-打包'
os.makedirs(outdir, exist_ok=True)
out = outdir + '/daily-stock-pick-skill_2026-08-12.zip'
scripts = ['daily_stock_pick.py', 'check_data_fresh.py', 'fetch_realtime.py', 'sync_quick.py',
           'update-daily-baostock.py', 'baostock_sync.py', 'sync_gui.py', 'launcher.py',
           'backfill_daily_tx_sina.py', 'validate_daily_schemes.py', 'sync-docs-obsidian.py',
           'chart_strategies.py', 'optimize_factors.py', 'fetch_fundamental.py', 'factor_registry.json']
readme = '''# daily-stock-pick skill 打包（2026-08-12）

每日选股 skill 完整运行包（SKILL.md + 依赖脚本 + 排错经验）。

## 安装
1. 将 SKILL.md 放回 `C:/Users/he/.claude/skills/daily-stock-pick/`
2. 将 scripts/ 下的脚本放回项目 `scripts/` 目录（或覆盖同名文件）
3. 依赖系统 Python311（baostock 可选，腾讯/新浪回填仅需 urllib）

## 运行
- skill 触发：用户说"选股/今天选什么股" → 按 SKILL.md 第 1~4 步执行
- 数据同步（默认腾讯/新浪，baostock 备选）：`python scripts/sync_gui.py --silent`
- 腾讯/新浪回填：`python scripts/backfill_daily_tx_sina.py`
- baostock 增量：`python scripts/update-daily-baostock.py`

## 排错
见 `文档/数据同步排错经验.md`（baostock 故障、探针 bug、腾讯/新浪回填口径）。
'''
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('README.md', readme)
    z.write(skill_src, 'SKILL.md')
    for s in scripts:
        p = os.path.join(root, 'scripts', s)
        if os.path.exists(p):
            z.write(p, 'scripts/' + s)
    doc = os.path.join(root, 'docs/project-docs/数据同步排错经验.md')
    if os.path.exists(doc):
        z.write(doc, '文档/数据同步排错经验.md')
print('OUT:', out)
print('SIZE_KB:', round(os.path.getsize(out) / 1024, 1))
with zipfile.ZipFile(out) as z:
    for n in z.namelist():
        print('  -', n)
