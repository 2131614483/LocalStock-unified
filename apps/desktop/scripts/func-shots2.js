const { _electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const APP_EXE = path.resolve(__dirname, '../dist/win-unpacked/LocalStock.exe');
const SHOTS_DIR = path.resolve(__dirname, '../test-results');
fs.mkdirSync(SHOTS_DIR, { recursive: true });
async function jsClick(win, loc) { await loc.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
(async () => {
  const app = await _electron.launch({ executablePath: APP_EXE, env: { ...process.env, LOCALSTOCK_NO_SINGLETON: '1' } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus() });
  await win.waitForTimeout(6000);

  // 选股
  try {
    const sel = win.locator('.sidebar-item', { hasText: '选股' }).first();
    await jsClick(win, sel);
    await win.waitForTimeout(5000);
    await win.screenshot({ path: path.join(SHOTS_DIR, 'func-selection2.png') });
    console.log('OK selection');
  } catch(e) { console.log('ERR selection', e.message.slice(0,100)); }

  // 价格行为 AI（带空格）
  try {
    const pa = win.locator('.sidebar-item', { hasText: '价格行为' }).first();
    await jsClick(win, pa);
    await win.waitForTimeout(6000);
    await win.screenshot({ path: path.join(SHOTS_DIR, 'func-pa.png') });
    console.log('OK pa');
  } catch(e) { console.log('ERR pa', e.message.slice(0,100)); }

  await app.close();
})();
