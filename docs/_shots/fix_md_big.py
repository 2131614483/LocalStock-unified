import pathlib
p = pathlib.Path(r'D:\pythonpro\LocalStock-unified\docs\项目介绍.md')
s = p.read_text(encoding='utf-8')

start = s.index('## 五点五、真实运行截图')
end = s.index('---\n\n## 六、快速开始')

new_section = '''## 五点五、真实运行截图

> 以下截图来自打包后的 `LocalStock.exe` 与聚宽服务 `localhost:3000`，2026-09-18 实际运行。

### 行情浏览

**自选股主界面**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/desktop-watchlist.png" width="900">

**沪深 A 股全市场**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/desktop-market.png" width="900">

**个股分时图**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/desktop-minute.png" width="900">

### K 线多周期

**日 K：蜡烛 + MA + 五档盘口 + 画线 + 新闻**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/desktop-dayk.png" width="900">

**周 K：本地日线聚合**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/desktop-weekk.png" width="900">

**月 K：长周期定位**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/desktop-monthk.png" width="900">

### 工具

**回测编辑器：策略模板 + CodeMirror Python**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/desktop-backtest.png" width="900">

**预警规则：均线金叉死叉，立即扫描**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/desktop-alert.png" width="900">

**K 线画线：趋势线拖拽，自动保存**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/desktop-drawing.png" width="900">

### AI 与设置

**AI 助手独立页：读行情 / 写策略 / 选股**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/desktop-ai-page.png" width="900">

**价格行为 AI：茅台日线 + EMA20 + 多阶段分析**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/desktop-pa.png" width="900">

**全局设置：行情刷新 / 快捷键 / AI 后端**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/desktop-settings.png" width="900">

### 聚宽服务网页

**策略列表：12 个因子策略**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/jq-algorithms.png" width="900">

**海龟多因子回测详情：总收益 49.53% / 年化 23.20% / 夏普 0.65**

<img src="file:///D:/pythonpro/LocalStock-unified/docs/_shots/jq-home.png" width="900">

'''

s = s[:start] + new_section + s[end:]
p.write_text(s, encoding='utf-8')
print('OK')
