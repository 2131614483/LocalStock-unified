/**
 * 量化回测平台全量测试脚本
 * 覆盖：页面静态资源 / 回测业务 API / 行情数据 API / 回测链路 / 数据完整性 / 异常处理
 * 用法: node scripts/test-full.js   （服务器需已启动，默认 http://localhost:8080）
 * 可用环境变量 API_BASE 指定服务器地址
 */
const BASE = process.env.API_BASE || 'http://localhost:8080';
let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail = '') {
    if (cond) { pass++; results.push('  [PASS] ' + name); }
    else { fail++; results.push('  [FAIL] ' + name + '  ' + detail); }
}

async function api(path, opts = {}) {
    try {
        const r = await fetch(BASE + path, {
            method: opts.method || 'GET',
            headers: { 'Content-Type': 'application/json' },
            body: opts.body ? JSON.stringify(opts.body) : undefined,
        });
        return r.json();
    } catch (e) {
        return { code: -1, message: '网络错误: ' + e.message };
    }
}

const BID = '886dc04e9fe1547dac9b4b43d647ae9d';
async function main() {
    // ===== 1. 页面静态资源 =====
    console.log('== 1. 页面静态资源 ==');
    const pages = [['主页', '/index.html'], ['编辑页', '/pages/edit.html'],
        ['API文档', '/pages/api-doc.html'], ['样式', '/assets/css/style.css'],
        ['主脚本', '/assets/js/main.js'], ['API客户端', '/assets/js/api.js']];
    for (const [name, p] of pages) {
        const r = await fetch(BASE + p);
        check('页面可访问 ' + name, r.status === 200, r.status);
    }

    // ===== 2. 回测业务 API =====
    console.log('== 2. 回测业务 API ==');
    const alg = await api('/api/algorithm/list');
    check('策略列表', alg.code === 0 && Array.isArray(alg.data) && alg.data.length >= 3,
        JSON.stringify(alg).slice(0, 80));
    const summary = await api('/api/backtest/' + BID + '/summary');
    check('回测概要', summary.code === 0 && summary.data && typeof summary.data.totalReturns === 'number');
    const returns = await api('/api/backtest/' + BID + '/returns');
    check('策略收益', returns.code === 0 && returns.data && Array.isArray(returns.data.dates)
        && returns.data.dates.length > 0);
    const trades = await api('/api/backtest/' + BID + '/trades');
    check('交易详情', trades.code === 0 && Array.isArray(trades.data));
    const positions = await api('/api/backtest/' + BID + '/positions');
    check('每日持仓', positions.code === 0 && Array.isArray(positions.data));
    const benchmark = await api('/api/backtest/' + BID + '/benchmark');
    check('基准收益', benchmark.code === 0 && benchmark.data);
    const logs = await api('/api/backtest/' + BID + '/logs');
    check('日志', logs.code === 0 && Array.isArray(logs.data));
    const code = await api('/api/backtest/' + BID + '/code');
    check('策略代码', code.code === 0 && code.data && code.data.code);
    const exp = await fetch(BASE + '/api/backtest/' + BID + '/export?type=transaction');
    const expBuf = new Uint8Array(await exp.arrayBuffer());
    const hasBom = expBuf.length >= 3 && expBuf[0] === 0xEF && expBuf[1] === 0xBB && expBuf[2] === 0xBF;
    check('导出CSV', exp.status === 200 && hasBom, exp.status);
    // ===== 3. 行情数据 API =====
    console.log('== 3. 行情数据 API ==');
    const daily = await api('/api/stock/000001/daily?start=2026-07-01');
    check('个股日线', daily.code === 0 && Array.isArray(daily.data) && daily.data.length > 0,
        'len=' + (daily.data || []).length);
    const batch = await api('/api/stock/batch/daily', { method: 'POST',
        body: { codes: ['000001', '600519'], start: '2026-07-01' } });
    check('批量查询', batch.code === 0 && batch.data && typeof batch.data === 'object'
        && Object.keys(batch.data).length === 2, 'keys=' + (batch.data ? Object.keys(batch.data).length : 0));
    const market = await api('/api/stock/market/2026-07-01');
    check('全市场快照', market.code === 0 && Array.isArray(market.data) && market.data.length > 1000,
        'len=' + (market.data || []).length);
    const search = await api('/api/stock/search?q=平安');
    check('股票搜索', search.code === 0 && search.data && search.data.length > 0);
    const ret = await api('/api/stock/000001/return?start=2026-07-01&end=2026-07-31');
    check('收益率计算', ret.code === 0 && ret.data);
    const cal = await api('/api/calendar?year=2026');
    check('交易日历', cal.code === 0 && Array.isArray(cal.data) && cal.data.length > 100,
        'len=' + (cal.data || []).length);
    const range = await api('/api/calendar/range');
    check('日历范围', range.code === 0 && range.data.max_date === '2026-08-07',
        JSON.stringify(range.data));
    const month = await api('/api/calendar/month?year=2026&month=7');
    check('某月交易日', month.code === 0 && Array.isArray(month.data) && month.data.length >= 20,
        'len=' + (month.data || []).length);
    const st = await api('/api/stats');
    check('数据库统计', st.code === 0 && st.data.dailyRecords > 10000000);
    const idx = await api('/api/index/000300/daily?start=2026-07-01');
    check('指数日线', idx.code === 0 && Array.isArray(idx.data) && idx.data.length > 0);
    const idxSearch = await api('/api/index/search?q=沪深');
    check('指数搜索', idxSearch.code === 0 && idxSearch.data && idxSearch.data.length > 0);
    const rfr = await api('/api/risk-free-rate?start=2026-01-01');
    check('无风险利率', rfr.code === 0 && Array.isArray(rfr.data) && rfr.data.length > 0);
    const mkt = await api('/api/market/daily?start=2026-01-01&end=2026-03-31');
    check('市场回报率', mkt.code === 0 && Array.isArray(mkt.data) && mkt.data.length > 0,
        'len=' + (mkt.data || []).length + ' (market_daily 仅到 06-10)');
    // ===== 4. 回测链路 =====
    console.log('== 4. 回测链路 ==');
    const runRes = await api('/api/backtest/' + BID + '/run', { method: 'POST',
        body: { startDate: '2026-07-01', endDate: '2026-08-07', capitalBase: 1000000 } });
    check('运行回测(链路)', runRes.code === 0 && runRes.data, JSON.stringify(runRes).slice(0, 150));
    if (runRes.code === 0) {
        const s2 = await api('/api/backtest/' + BID + '/summary');
        check('回测结果已保存', s2.code === 0 && s2.data.endDate === '2026-08-07',
            JSON.stringify(s2.data));
    }

    // ===== 5. 异常处理 =====
    console.log('== 5. 异常处理 ==');
    const bad1 = await api('/api/backtest/nonexistent/summary');
    check('回测不存在', bad1.code === -1);
    const bad2 = await api('/api/backtest/nonexistent/code');
    check('代码不存在', bad2.code === -1);
    const bad3 = await api('/api/stock/search?q=');
    check('搜索缺参', bad3.code === -1);
    const bad4 = await api('/api/backtest/nonexistent/run', { method: 'POST', body: {} });
    check('运行不存在回测', bad4.code === -1);
    const bad5 = await api('/api/calendar/month?year=2026');
    check('月历缺参', bad5.code === -1);

    console.log('===== 测试完成: ' + pass + ' 通过, ' + fail + ' 失败 =====');
    results.forEach(r => console.log(r));
    process.exit(fail ? 1 : 0);
}

main();
