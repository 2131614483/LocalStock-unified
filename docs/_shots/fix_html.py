import pathlib
p = pathlib.Path(r'D:\pythonpro\LocalStock-unified\docs\项目介绍.html')
s = p.read_text(encoding='utf-8')

old = '''    <h3>桌面端：自选股 / 日 K / 回测编辑器</h3>
    <div class="shot-grid">
      <figure><img src="_shots/desktop-dayk.png" alt="日K详情"><figcaption>个股日 K：蜡烛 + MA + 五档盘口 + 画线工具 + AI 多周期预测</figcaption></figure>
      <figure><img src="_shots/desktop-watchlist.png" alt="自选股"><figcaption>自选股主界面：红涨绿跌，实时刷新</figcaption></figure>
      <figure><img src="_shots/desktop-backtest.png" alt="回测编辑器"><figcaption>回测页：策略模板 + CodeMirror Python 编辑器</figcaption></figure>
    </div>'''

new = '''    <h3>行情浏览：自选股 / 沪深 A 股 / 分时</h3>
    <div class="shot-grid three">
      <figure><img src="_shots/desktop-watchlist.png" alt="自选股"><figcaption>自选股：14 只，红涨绿跌实时刷新</figcaption></figure>
      <figure><img src="_shots/desktop-market.png" alt="沪深A股"><figcaption>沪深 A 股：全市场 5973 只股票</figcaption></figure>
      <figure><img src="_shots/desktop-minute.png" alt="分时"><figcaption>分时图：价格线 + 均价线 + 昨收</figcaption></figure>
    </div>

    <h3>K 线多周期：日 K / 周 K / 月 K</h3>
    <div class="shot-grid three">
      <figure><img src="_shots/desktop-dayk.png" alt="日K"><figcaption>日 K：蜡烛 + MA + 五档盘口 + 画线 + 新闻</figcaption></figure>
      <figure><img src="_shots/desktop-weekk.png" alt="周K"><figcaption>周 K：本地日线聚合</figcaption></figure>
      <figure><img src="_shots/desktop-monthk.png" alt="月K"><figcaption>月 K：长周期定位</figcaption></figure>
    </div>

    <h3>工具：回测 / 预警 / 画线</h3>
    <div class="shot-grid three">
      <figure><img src="_shots/desktop-backtest.png" alt="回测"><figcaption>回测：策略模板 + CodeMirror Python 编辑器</figcaption></figure>
      <figure><img src="_shots/desktop-alert.png" alt="预警"><figcaption>预警：均线金叉死叉规则，立即扫描</figcaption></figure>
      <figure><img src="_shots/desktop-drawing.png" alt="画线"><figcaption>画线：趋势线拖拽，自动保存</figcaption></figure>
    </div>

    <h3>AI：助手 / 价格行为 / 设置</h3>
    <div class="shot-grid three">
      <figure><img src="_shots/desktop-ai-page.png" alt="AI助手"><figcaption>AI 助手独立页：读行情/写策略/选股</figcaption></figure>
      <figure><img src="_shots/desktop-pa.png" alt="价格行为AI"><figcaption>价格行为 AI：茅台日线 + EMA20 + 多阶段分析</figcaption></figure>
      <figure><img src="_shots/desktop-settings.png" alt="设置"><figcaption>设置：行情刷新/快捷键/AI 后端配置</figcaption></figure>
    </div>'''

assert old in s, 'old block not found'
s = s.replace(old, new)

# 删掉旧的 AI 助手面板 section（已被新的 AI section 覆盖）
old_ai = '''
    <h3>AI 助手面板</h3>
    <div class="shot-grid two">
      <figure><img src="_shots/desktop-ai-panel.png" alt="AI面板"><figcaption>侧边栏 AI 助手：读行情、写策略、一键选股</figcaption></figure>
      <figure><img src="_shots/desktop-ai-config.png" alt="AI配置"><figcaption>模型配置：OpenAI 兼容 / DeepSeek / Ollama，写操作审计</figcaption></figure>
    </div>'''
assert old_ai in s, 'old ai block not found'
s = s.replace(old_ai, '')

# 加 three 列 grid 的 CSS
old_css = '.shot-grid.two{grid-template-columns:1fr 1fr}'
new_css = '.shot-grid.two{grid-template-columns:1fr 1fr}\n.shot-grid.three{grid-template-columns:1fr 1fr 1fr}\n@media(max-width:900px){.shot-grid.three{grid-template-columns:1fr}}'
assert old_css in s
s = s.replace(old_css, new_css)

# 改标题
s = s.replace('真实运行截图：不是示意图，是跑起来的样子', '真实运行截图：每个功能都跑过')

p.write_text(s, encoding='utf-8')
print('OK, len=', len(s))
