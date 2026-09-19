// 前端 UI 模拟点击测试（puppeteer + Edge 无头）
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:8080';
const BID = '886dc04e9fe1547dac9b4b43d647ae9d';
let pass = 0, fail = 0;

function check(name, cond, detail = '') {
    if (cond) { pass++; console.log('  [PASS] ' + name); }
    else { fail++; console.log('  [FAIL] ' + name + '  ' + detail); }
}
async function launch() {
    return puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function testIndex(browser) {
    console.log('== 首页 index.html ==');
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('totalReturns').textContent.trim() !== '--',
        { timeout: 15000 });
    check('摘要卡片已加载', true);

    for (const t of ['returns', 'tradePosition', 'benchmark', 'logs', 'code']) {
        await page.click(`.tab-item[data-tab="${t}"]`);
        await wait(300);
        const active = await page.$eval(`#tab-${t}`, el => el.classList.contains('active'));
        check(`Tab 切换 ${t}`, active);
    }

    await page.click('.tab-item[data-tab="tradePosition"]');
    try {
        await page.waitForFunction(() => document.querySelectorAll('#tradesBody tr').length > 0, { timeout: 10000 });
        check('交易表有数据', true);
    } catch (e) { check('交易表有数据', false, '渲染超时'); }
    const tradeRows = await page.$$eval('#tradesBody tr', els => els.length);
    const posRows = await page.$$eval('#positionsBody tr', els => els.length);
    check('持仓表有数据', posRows > 0, 'rows=' + posRows);

    await page.type('#tpSearch', '600519');
    await wait(500);
    const filtered = await page.$$eval('#tradesBody tr', els => els.length);
    check('搜索过滤生效', filtered <= tradeRows, `${filtered}<=${tradeRows}`);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
    await wait(300);

    await page.click('.tab-item[data-tab="benchmark"]');
    await wait(600);
    const optCount = await page.$$eval('#benchmarkSelect option', els => els.length);
    check('基准选择器有选项', optCount > 1, 'opts=' + optCount);
    if (optCount > 1) {
        const val = await page.$eval('#benchmarkSelect option:nth-child(2)', el => el.value);
        await page.select('#benchmarkSelect', val);
        await wait(900);
        const hint = await page.$eval('#benchmarkSelectHint', el => el.textContent.trim());
        check('切换基准提示更新', hint.length > 0, hint.slice(0, 25));
    }
    check('首页无 JS 错误', errors.length === 0, errors.slice(0, 2).join('; '));
    return page;
}
async function testRunAndEdit(browser) {
    const page = await browser.newPage();
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('totalReturns').textContent.trim() !== '--',
        { timeout: 15000 });
    await page.click('.btn-success');
    await wait(300);
    const duringText = await page.$eval('.btn-success', el => el.textContent);
    check('运行回测按钮响应', duringText.includes('回测'), duringText);
    try {
        await page.waitForFunction(() => document.querySelector('.btn-success').textContent.includes('运行回测'),
            { timeout: 90000 });
        check('回测执行完成(按钮恢复)', true);
    } catch (e) { check('回测执行完成(按钮恢复)', false, '超时'); }

    const modalExists = await page.evaluate(() => !!document.querySelector('.result-modal'));
    if (modalExists) {
        await page.evaluate(() => document.querySelector('.result-modal .btn-primary').click());
        await wait(2500);
        await page.waitForFunction(() => document.getElementById('totalReturns').textContent.trim() !== '--',
            { timeout: 15000 });
    }
    await page.click('button[onclick="editStrategy()"]');
    await wait(2500);
    const url = page.url();
    check('编辑策略跳转', url.includes('/pages/edit.html'), url);
    return page;
}

async function testEdit(browser) {
    console.log('== 编辑页 edit.html ==');
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
    await page.goto(BASE + '/pages/edit.html?id=' + BID, { waitUntil: 'networkidle2', timeout: 30000 });
    await wait(2500);
    const codeLen = await page.$eval('#codeEditor', el => el.value.length);
    check('策略代码已加载', codeLen > 50, 'len=' + codeLen);

    await page.click('#startDateInput');
    await wait(600);
    const calExists = await page.evaluate(() => !!document.getElementById('calPopup'));
    check('日历弹出', calExists);
    const dayCount = await page.$$eval('.cal-cell.trade-day', els => els.length);
    check('日历有可选交易日', dayCount > 0, 'days=' + dayCount);
    if (dayCount > 0) {
        await page.evaluate(() => document.querySelector('.cal-cell.trade-day').click());
        await wait(500);
        const startVal = await page.$eval('#startDateInput', el => el.value);
        check('选中开始日期', startVal.length === 10, startVal);
    }

    await page.click('#runBtn');
    await wait(500);
    const runText = await page.$eval('#runBtn', el => el.textContent);
    check('编辑页运行回测', runText.includes('回测'), runText);
    check('编辑页无 JS 错误', errors.length === 0, errors.slice(0, 2).join('; '));
    return page;
}
(async () => {
    let browser;
    try {
        browser = await launch();
        await testIndex(browser);
        await testRunAndEdit(browser);
        await testEdit(browser);
    } catch (e) {
        fail++;
        console.log('  [FAIL] 测试异常: ' + e.message);
    } finally {
        if (browser) await browser.close();
    }
    console.log('===== UI 测试完成: ' + pass + ' 通过, ' + fail + ' 失败 =====');
    process.exit(fail ? 1 : 0);
})();
