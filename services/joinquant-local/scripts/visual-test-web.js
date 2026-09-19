/**
 * 网页平台回测结果页 K 线视觉测试（visual-test 原则：启动 → 截图 → DOM/画布断言）。
 * 打开回测详情 → 断言 klineChart canvas 真实绘制（非空白像素）→ 截图。
 * 运行：node scripts/visual-test-web.js [backtest_id]
 */
const { chromium } = require('playwright');

const BACKTEST_ID = process.argv[2] || '5a893a8bd2943ed32c187087ced30e35'; // value_v1 有完整回测
const URL = `http://localhost:8080/index.html?backtest_id=${BACKTEST_ID}`;

async function main() {
    let browser;
    try {
        browser = await chromium.launch({ channel: 'msedge' });   // 用系统 Edge，免下载浏览器
    } catch (e) {
        browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    }
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    console.log('[1] 打开回测详情页...', URL);
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(4000); // 等 Chart.js 渲染

    const report = {};
    report.canvas_returns = await page.locator('#returnsChart').count();
    report.canvas_kline = await page.locator('#klineChart').count();

    // kline 是否真实绘制（非空白像素）
    report.kline_drawn = await page.evaluate(() => {
        const c = document.getElementById('klineChart');
        if (!c) return { exists: false };
        const w = c.width, h = c.height;
        if (!w || !h) return { exists: true, drawn: false, reason: '0-size' };
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(0, 0, w, h).data;
        let nonBlank = 0;
        for (let i = 0; i < d.length; i += 40) { if (d[i] || d[i + 1] || d[i + 2]) nonBlank++; }
        return { exists: true, drawn: nonBlank > 50, nonBlank, w, h };
    });

    // 是否创建了 Chart 实例
    report.kline_chart_instance = await page.evaluate(() => {
        try { return !!(window.klineChart && typeof window.klineChart === 'object'); }
        catch (e) { return false; }
    });

    // 截两张图：整页 + 滚动到 K线图区域
    await page.screenshot({ path: 'data/vt_kline_full.png', fullPage: false });
    await page.locator('#klineChart').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const kbox = await page.locator('#klineChart').boundingBox();
    if (kbox) {
        await page.screenshot({ path: 'data/vt_kline_chart.png', clip: { x: kbox.x - 10, y: kbox.y - 40, width: kbox.width + 20, height: kbox.height + 70 } });
    }

    report.js_errors = errors;
    console.log('\n===== 测试报告 =====');
    console.log(JSON.stringify(report, null, 2));
    const pass = report.canvas_returns > 0 && report.canvas_kline > 0
        && report.kline_drawn && report.kline_drawn.drawn
        && report.kline_chart_instance && errors.length === 0;
    console.log('\n' + (pass ? '✅ 测试通过：K线已渲染' : '❌ 测试失败：见上方报告'));
    await browser.close();
    process.exit(pass ? 0 : 1);
}

main().catch(e => { console.error('脚本失败:', e); process.exit(1); });
