const { chromium } = require('playwright');
(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge' });
  } catch (e) {
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  }
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'D:/pythonpro/LocalStock-unified/docs/_shots/jq-home.png' });
  console.log('OK home');

  // 策略列表页
  try {
    await page.goto('http://localhost:3000/strategies.html', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'D:/pythonpro/LocalStock-unified/docs/_shots/jq-strategies.png' });
    console.log('OK strategies');
  } catch(e) { console.log('strategies skip', e.message); }

  // 研究页
  try {
    await page.goto('http://localhost:3000/research.html', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'D:/pythonpro/LocalStock-unified/docs/_shots/jq-research.png' });
    console.log('OK research');
  } catch(e) { console.log('research skip', e.message); }

  await browser.close();
})();
