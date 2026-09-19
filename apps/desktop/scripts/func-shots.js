// 遍历侧边栏每个功能页截图
const { _electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe');
const SHOTS_DIR = path.resolve(__dirname, '../test-results');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

async function jsClick(win, locator) {
  await locator.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

(async () => {
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus() });
  await win.waitForTimeout(6000);

  const pages = [
    { name: 'watchlist', label: '自选股' },
    { name: 'market', label: '沪深A股' },
    { name: 'backtest', label: '回测' },
    { name: 'alert', label: '预警' },
    { name: 'selection', label: '选股' },
    { name: 'ai', label: 'AI' },
    { name: 'pa', label: '价格行为AI' },
    { name: 'settings', label: '设置' },
  ];

  for (const p of pages) {
    try {
      const item = win.locator('.sidebar-item', { hasText: p.label }).first();
      if (await item.count() === 0) { console.log('skip', p.label); continue; }
      await jsClick(win, item);
      await win.waitForTimeout(4000);
      await win.screenshot({ path: path.join(SHOTS_DIR, `func-${p.name}.png`) });
      console.log('OK', p.name);
    } catch (e) { console.log('ERR', p.name, e.message.slice(0,80)); }
  }

  // 进详情页截分时/日K/画线/新闻
  await jsClick(win, win.locator('.sidebar-item', { hasText: '自选股' }).first());
  await win.waitForTimeout(2000);
  await jsClick(win, win.locator('.stock-table tbody tr').first());
  await win.waitForTimeout(5000);

  for (const tab of ['分时', '日K', '周K', '月K']) {
    try {
      await jsClick(win, win.locator('.tab', { hasText: tab }).first());
      await win.waitForTimeout(3500);
      await win.screenshot({ path: path.join(SHOTS_DIR, `func-${tab}.png`) });
      console.log('OK tab', tab);
    } catch(e) { console.log('ERR tab', tab, e.message.slice(0,80)); }
  }

  await app.close();
})();
