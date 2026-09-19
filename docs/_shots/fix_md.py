import pathlib
p = pathlib.Path(r'D:\pythonpro\LocalStock-unified\docs\项目介绍.md')
s = p.read_text(encoding='utf-8')

old = '''### 桌面端

| 自选股主界面 | 个股日 K 详情 |
|---|---|
| ![自选股](_shots/desktop-watchlist.png) | ![日K](_shots/desktop-dayk.png) |

| 回测策略编辑器 | AI 助手面板 |
|---|---|
| ![回测](_shots/desktop-backtest.png) | ![AI面板](_shots/desktop-ai-panel.png) |'''

new = '''### 行情浏览

| 自选股主界面 | 沪深 A 股 | 分时图 |
|---|---|---|
| ![自选股](_shots/desktop-watchlist.png) | ![沪深A股](_shots/desktop-market.png) | ![分时](_shots/desktop-minute.png) |

### K 线多周期

| 日 K | 周 K | 月 K |
|---|---|---|
| ![日K](_shots/desktop-dayk.png) | ![周K](_shots/desktop-weekk.png) | ![月K](_shots/desktop-monthk.png) |

### 工具

| 回测编辑器 | 预警规则 | K 线画线 |
|---|---|---|
| ![回测](_shots/desktop-backtest.png) | ![预警](_shots/desktop-alert.png) | ![画线](_shots/desktop-drawing.png) |

### AI 与设置

| AI 助手独立页 | 价格行为 AI | 全局设置 |
|---|---|---|
| ![AI助手](_shots/desktop-ai-page.png) | ![价格行为AI](_shots/desktop-pa.png) | ![设置](_shots/desktop-settings.png) |'''

assert old in s, 'old not found'
s = s.replace(old, new)

# 删掉旧的 AI 模型配置单独 section（已并入 AI 与设置）
old_cfg = '''### AI 模型配置

![AI配置](_shots/desktop-ai-config.png)

'''
s = s.replace(old_cfg, '')

p.write_text(s, encoding='utf-8')
print('OK')
