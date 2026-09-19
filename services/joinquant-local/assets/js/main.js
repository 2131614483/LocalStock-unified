/**
 * 量化回测平台 - 回测详情页面主脚本
 * 处理 Tab 切换、数据加载、图表渲染
 */

const BACKTEST_ID = new URLSearchParams(location.search).get('backtest_id') || '886dc04e9fe1547dac9b4b43d647ae9d';

// ========== 本地记忆工具（localStorage） ==========
const PREF_PREFIX = `pref_${BACKTEST_ID}_`;
function savePref(key, value) {
    try { localStorage.setItem(PREF_PREFIX + key, value); } catch (e) { /* 忽略 */ }
}
function loadPref(key) {
    try { return localStorage.getItem(PREF_PREFIX + key); } catch (e) { return null; }
}

// ========== 注册缩放插件 ==========
if (typeof Chart !== 'undefined' && typeof ChartZoom !== 'undefined') {
    Chart.register(ChartZoom);
}

// ========== 十字光标插件（同花顺风格） ==========
const crosshairPlugin = {
    id: 'crosshair',
    afterDraw: (chart) => {
        if (chart.tooltip?._active?.length) {
            const ctx = chart.ctx;
            const x = chart.tooltip._active[0].element.x;
            const top = chart.chartArea.top;
            const bottom = chart.chartArea.bottom;
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([4, 4]);
            ctx.moveTo(x, top);
            ctx.lineTo(x, bottom);
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#999';
            ctx.stroke();
            ctx.restore();
        }
    }
};

// ========== 缩放/平移公共配置 ==========
const ZOOM_OPTIONS = {
    pan: {
        enabled: true,
        mode: 'x',
        modifierKey: null,
    },
    zoom: {
        wheel: { enabled: true, speed: 0.1 },
        pinch: { enabled: true },
        mode: 'x',
    },
    limits: {
        x: { min: 'original', max: 'original' },
    },
};

// ========== 策略收益双图同步（缩放/平移/十字光标） ==========
let _syncingReturns = false;
let _returnsTooltipBound = false;

/** 创建带同步回调的 zoom 配置，操作一个图表时自动同步另一个 */
function makeSyncedZoomOptions(getPeer) {
    const syncRange = (chart) => {
        const peer = getPeer();
        if (!peer || _syncingReturns) return;
        _syncingReturns = true;
        try {
            const xs = chart.scales.x;
            if (xs && xs.min != null && xs.max != null) {
                peer.zoomScale('x', { min: xs.min, max: xs.max });
            }
        } catch (e) { /* ignore */ }
        _syncingReturns = false;
    };
    return {
        pan: {
            enabled: true,
            mode: 'x',
            modifierKey: null,
            onPanComplete: ({ chart }) => syncRange(chart),
        },
        zoom: {
            wheel: { enabled: true, speed: 0.1 },
            pinch: { enabled: true },
            mode: 'x',
            onZoom: ({ chart }) => syncRange(chart),
        },
        limits: {
            x: { min: 'original', max: 'original' },
        },
    };
}

/** 绑定双图 tooltip/十字光标同步 */
function bindReturnsTooltipSync() {
    if (_returnsTooltipBound) return;
    const c1 = document.getElementById('returnsChart');
    const c2 = document.getElementById('dailyReturnsChart');
    if (!c1 || !c2) return;
    _returnsTooltipBound = true;

    let syncingHover = false;

    function syncHover(sourceChart, targetChart, event) {
        if (!sourceChart || !targetChart || syncingHover) return;
        syncingHover = true;
        try {
            const points = sourceChart.getElementsAtEventForMode(event, 'index', { intersect: false }, false);
            if (points.length) {
                targetChart.setActiveElements([{ datasetIndex: 0, index: points[0].index }]);
                targetChart.update('none');
            }
        } catch (e) { /* ignore */ }
        syncingHover = false;
    }

    function clearHover(targetChart) {
        if (!targetChart || syncingHover) return;
        syncingHover = true;
        try { targetChart.setActiveElements([]); targetChart.update('none'); } catch (e) { /* ignore */ }
        syncingHover = false;
    }

    c1.addEventListener('mousemove', e => syncHover(window.returnsChart, window.dailyChart, e));
    c2.addEventListener('mousemove', e => syncHover(window.dailyChart, window.returnsChart, e));
    c1.addEventListener('mouseleave', () => clearHover(window.dailyChart));
    c2.addEventListener('mouseleave', () => clearHover(window.returnsChart));
}

// ========== 基准收益双图同步（缩放/平移/十字光标） ==========
let _syncingBenchmark = false;
let _benchmarkTooltipBound = false;

/** 绑定基准收益双图 tooltip/十字光标同步 */
function bindBenchmarkTooltipSync() {
    if (_benchmarkTooltipBound) return;
    const c1 = document.getElementById('benchmarkChart');
    const c2 = document.getElementById('excessChart');
    if (!c1 || !c2) return;
    _benchmarkTooltipBound = true;

    let syncingHover = false;

    function syncHover(sourceChart, targetChart, event) {
        if (!sourceChart || !targetChart || syncingHover) return;
        syncingHover = true;
        try {
            const points = sourceChart.getElementsAtEventForMode(event, 'index', { intersect: false }, false);
            if (points.length) {
                targetChart.setActiveElements([{ datasetIndex: 0, index: points[0].index }]);
                targetChart.update('none');
            }
        } catch (e) { /* ignore */ }
        syncingHover = false;
    }

    function clearHover(targetChart) {
        if (!targetChart || syncingHover) return;
        syncingHover = true;
        try { targetChart.setActiveElements([]); targetChart.update('none'); } catch (e) { /* ignore */ }
        syncingHover = false;
    }

    c1.addEventListener('mousemove', e => syncHover(window.benchmarkChart, window.excessChart, e));
    c2.addEventListener('mousemove', e => syncHover(window.excessChart, window.benchmarkChart, e));
    c1.addEventListener('mouseleave', () => clearHover(window.excessChart));
    c2.addEventListener('mouseleave', () => clearHover(window.benchmarkChart));
}

// ========== Toast 通知系统 ==========
const Toast = {
    _container: null,
    _init() {
        if (!this._container) {
            this._container = document.createElement('div');
            this._container.className = 'toast-container';
            document.body.appendChild(this._container);
        }
    },
    show(title, message, type = 'info', duration = 4000) {
        this._init();
        const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <div class="toast-body">
                <div class="toast-title">${title}</div>
                ${message ? `<div class="toast-msg">${message}</div>` : ''}
            </div>
            <button class="toast-close" onclick="this.parentElement.classList.add('removing');setTimeout(()=>this.parentElement.remove(),300)">&times;</button>
        `;
        this._container.appendChild(toast);
        if (duration > 0) {
            setTimeout(() => {
                toast.classList.add('removing');
                setTimeout(() => toast.remove(), 300);
            }, duration);
        }
        return toast;
    },
    success(title, message, duration) { return this.show(title, message, 'success', duration); },
    error(title, message, duration) { return this.show(title, message, 'error', duration || 6000); },
    warning(title, message, duration) { return this.show(title, message, 'warning', duration); },
    info(title, message, duration) { return this.show(title, message, 'info', duration); },
};

// ========== 加载遮罩工具 ==========
const Overlay = {
    show(title, sub) {
        this.hide();
        const overlay = document.createElement('div');
        overlay.className = 'overlay-mask';
        overlay.id = 'loadingOverlay';
        overlay.innerHTML = `
            <div class="overlay-card">
                <div class="spinner"></div>
                <div class="overlay-title">${title || '处理中...'}</div>
                <div class="overlay-sub">${sub || ''}</div>
            </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
    },
    hide() {
        const el = document.getElementById('loadingOverlay');
        if (el) el.remove();
    },
};

// ========== 回测结果弹窗 ==========
function showResultModal(result, startDate, endDate) {
    const modal = document.createElement('div');
    modal.className = 'result-modal';
    const period = startDate && endDate ? `${startDate} ~ ${endDate}` : '';
    const fmtPct = v => (v * 100).toFixed(2) + '%';
    const valClass = v => v >= 0 ? 'positive' : 'negative';
    const sign = v => v >= 0 ? '+' : '';
    modal.innerHTML = `
        <div class="result-card">
            <div class="result-header success">✓ 回测完成</div>
            <div class="result-body">
                ${period ? `<div class="result-row"><span class="result-label">回测期间</span><span class="result-value">${period}</span></div>` : ''}
                <div class="result-row"><span class="result-label">交易日</span><span class="result-value">${result.tradingDays} 天</span></div>
                <div class="result-row"><span class="result-label">总收益</span><span class="result-value ${valClass(result.totalReturns)}">${sign(result.totalReturns)}${fmtPct(result.totalReturns)}</span></div>
                <div class="result-row"><span class="result-label">年化收益</span><span class="result-value ${valClass(result.annualReturns)}">${sign(result.annualReturns)}${fmtPct(result.annualReturns)}</span></div>
                <div class="result-row"><span class="result-label">最大回撤</span><span class="result-value negative">${fmtPct(result.maxDrawdown)}</span></div>
                <div class="result-row"><span class="result-label">夏普比率</span><span class="result-value">${result.sharpe != null ? result.sharpe.toFixed(2) : '--'}</span></div>
                <div class="result-row"><span class="result-label">交易笔数</span><span class="result-value">${result.tradesCount} 笔</span></div>
            </div>
            <div class="result-footer">
                <button class="btn btn-primary" onclick="this.closest('.result-modal').remove();location.reload()">查看结果</button>
            </div>
        </div>
    `;
    modal.addEventListener('click', (e) => {
        if (e.target === modal) { modal.remove(); location.reload(); }
    });
    document.body.appendChild(modal);
}

// ========== 页面初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
    // 显示骨架屏
    showSummarySkeleton();

    // Tab 切换
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            const tabName = this.dataset.tab;
            switchTab(tabName);
        });
    });

    // 日志过滤 — 恢复记忆并绑定保存
    document.querySelectorAll('.log-filter input').forEach(cb => {
        const saved = loadPref('logfilter_' + cb.value);
        if (saved !== null) cb.checked = (saved === 'true');
        cb.addEventListener('change', () => {
            savePref('logfilter_' + cb.value, String(cb.checked));
            filterLogs();
        });
    });

    // 搜索框 — 恢复记忆并绑定保存
    const tpSearchEl = document.getElementById('tpSearch');
    if (tpSearchEl) {
        const saved = loadPref('search_tpSearch');
        if (saved) tpSearchEl.value = saved;
        tpSearchEl.addEventListener('input', () => savePref('search_tpSearch', tpSearchEl.value));
    }

    // 加载数据
    await loadAllData();

    // 检查 URL hash 切到对应 tab
    const hash = window.location.hash.replace('#tab-', '');
    if (hash) switchTab(hash);
});

/** 骨架屏 — 摘要卡片 */
function showSummarySkeleton() {
    const container = document.getElementById('summaryCards');
    container.innerHTML = Array(10).fill(0).map(() =>
        '<div class="skeleton-card"><div class="skeleton-line skeleton-label"></div><div class="skeleton-line skeleton-value"></div></div>'
    ).join('');
}

/** Tab 切换 */
function switchTab(name) {
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`.tab-item[data-tab="${name}"]`)?.classList.add('active');
    document.getElementById(`tab-${name}`)?.classList.add('active');
    
    // 调整图表大小
    setTimeout(() => {
        if (name === 'returns') {
            window.returnsChart?.resize();
            window.dailyChart?.resize();
        } else if (name === 'benchmark') {
            window.benchmarkChart?.resize();
            window.excessChart?.resize();
        }
    }, 100);

    history.replaceState(null, '', `#tab-${name}`);
}

/** 加载所有数据 */
async function loadAllData() {
    try {
        const results = await Promise.allSettled([
            ApiClient.getBacktestSummary(BACKTEST_ID),
            ApiClient.getBacktestReturns(BACKTEST_ID),
            ApiClient.getBacktestTrades(BACKTEST_ID),
            ApiClient.getBacktestPositions(BACKTEST_ID),
            ApiClient.getBacktestBenchmark(BACKTEST_ID),
            ApiClient.getBacktestLogs(BACKTEST_ID),
            ApiClient.getBacktestCode(BACKTEST_ID),
        ]);

        // 概要与收益是页面的必需数据；其他模块缺失时单独降级，不拖垮整页。
        if (results[0].status === 'rejected' || results[1].status === 'rejected') {
            throw results[0].reason || results[1].reason;
        }

        const valueOr = (index, fallback) =>
            results[index].status === 'fulfilled' ? results[index].value : fallback;
        const summary = valueOr(0, null);
        const returns = valueOr(1, { dates: [], dailyReturns: [], cumulativeReturns: [] });
        const trades = valueOr(2, []);
        const positions = valueOr(3, []);
        const benchmark = valueOr(4, {
            dates: [], dailyReturns: [], cumulativeReturns: [], excessReturns: []
        });
        const logs = valueOr(5, []);
        const code = valueOr(6, { language: 'python', code: '# 暂无策略代码' });

        // 缓存数据供基准选择器使用
        window._cachedReturns = returns;
        window._cachedBenchmark = benchmark;
        window._cachedSummary = summary;

        renderSummary(summary);
        renderReturnsChart(returns);
        renderDailyReturnsChart(returns);
        renderKlineChart(returns);
        renderTrades(trades);
        renderPositions(positions);
        renderBenchmarkChart(benchmark, returns);
        renderExcessChart(benchmark);
        renderBenchmarkSummary(benchmark);
        renderLogs(logs);
        renderCode(code);

        // 初始化基准选择器
        await initBenchmarkSelector(benchmark);

        // 恢复搜索框内容并触发过滤
    const _tpSearch = document.getElementById('tpSearch');
    if (_tpSearch && _tpSearch.value && typeof onTpSearch === 'function') onTpSearch(true);

    // 同步双表格水平滚动
    syncTableScroll();

    // 如果部分模块加载失败，提示用户
        const failedModules = [];
        if (results[2].status === 'rejected') failedModules.push('交易记录');
        if (results[3].status === 'rejected') failedModules.push('持仓明细');
        if (results[4].status === 'rejected') failedModules.push('基准收益');
        if (results[5].status === 'rejected') failedModules.push('日志');
        if (results[6].status === 'rejected') failedModules.push('策略代码');
        if (failedModules.length) {
            Toast.warning('部分数据加载失败', failedModules.join('、'));
        }
    } catch (err) {
        console.error('加载数据失败:', err);
        document.querySelector('.main-content').innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📡</div>
                <div class="empty-text">数据加载失败，请确保后端服务已启动 (npm start)</div>
                <button class="btn btn-primary" onclick="location.reload()" style="margin-top:16px;">重新加载</button>
            </div>
        `;
    }
}

// ========== 渲染函数 ==========

/** 渲染摘要卡片 */
function renderSummary(data) {
    // 恢复卡片 HTML 结构（骨架屏替换后）
    const container = document.getElementById('summaryCards');
    container.innerHTML = `
        <div class="card"><div class="card-label">总收益率</div><div class="card-value" id="totalReturns">--</div></div>
        <div class="card"><div class="card-label">年化收益率</div><div class="card-value" id="annualReturns">--</div></div>
        <div class="card"><div class="card-label">最大回撤</div><div class="card-value" id="maxDrawdown">--</div></div>
        <div class="card"><div class="card-label">夏普比率</div><div class="card-value" id="sharpe">--</div></div>
        <div class="card card-benchmark"><div class="card-label">基准收益 <span id="benchmarkNameLabel" class="card-sublabel"></span></div><div class="card-value" id="benchmarkReturns">--</div></div>
        <div class="card card-excess"><div class="card-label">超额收益</div><div class="card-value" id="excessReturns">--</div></div>
        <div class="card"><div class="card-label">Alpha</div><div class="card-value" id="alpha">--</div></div>
        <div class="card"><div class="card-label">Beta</div><div class="card-value" id="beta">--</div></div>
        <div class="card"><div class="card-label">波动率</div><div class="card-value" id="volatility">--</div></div>
        <div class="card"><div class="card-label">胜率</div><div class="card-value" id="winRate">--</div></div>
    `;

    const fmtPct = v => (v !== undefined && v !== null) ? (v * 100).toFixed(2) + '%' : '--';
    const setSigned = (id, value) => {
        const el = document.getElementById(id);
        el.textContent = fmtPct(value);
        el.classList.remove('positive', 'negative');
        if (value !== undefined && value !== null) {
            el.classList.add(value >= 0 ? 'positive' : 'negative');
        }
    };
    // 更新策略概要信息
    const capitalEl = document.getElementById('initialCapital');
    if (capitalEl) capitalEl.textContent = '¥' + (data.capitalBase || 1000000).toLocaleString();
    const nameEl = document.getElementById('strategyName');
    if (nameEl) nameEl.textContent = data.algorithmName || '策略';
    const periodEl = document.getElementById('backtestPeriod');
    if (periodEl) periodEl.textContent = (data.startDate || '') + ' ~ ' + (data.endDate || '');

    setSigned('totalReturns', data.totalReturns);
    setSigned('annualReturns', data.annualReturns);
    setSigned('maxDrawdown', data.maxDrawdown);
    document.getElementById('sharpe').textContent = data.sharpe != null ? data.sharpe.toFixed(2) : '--';
    document.getElementById('alpha').textContent = data.alpha != null ? data.alpha.toFixed(4) : '--';
    document.getElementById('beta').textContent = data.beta != null ? data.beta.toFixed(4) : '--';
    document.getElementById('volatility').textContent = data.volatility != null ? (data.volatility * 100).toFixed(2) + '%' : '--';
    document.getElementById('winRate').textContent = data.winRate != null ? (data.winRate * 100).toFixed(1) + '%' : '--';

    const benchName = data.benchmarkName || '基准';
    const benchLabelEl = document.getElementById('benchmarkNameLabel');
    if (benchLabelEl) benchLabelEl.textContent = `(${benchName})`;
    setSigned('benchmarkReturns', data.benchmarkTotalReturns);

    const excess = (data.totalReturns != null && data.benchmarkTotalReturns != null)
        ? data.totalReturns - data.benchmarkTotalReturns : null;
    setSigned('excessReturns', excess);
}

/** 渲染累计收益率曲线 */
function renderReturnsChart(data) {
    const ctx = document.getElementById('returnsChart').getContext('2d');
    window.returnsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.dates,
            datasets: [
                { label: '策略收益', data: data.cumulativeReturns, borderColor: '#1890ff', backgroundColor: 'rgba(24,144,255,0.1)', fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
            ]
        },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top' },
                tooltip: { callbacks: { label: ctx => (ctx.raw * 100).toFixed(2) + '%' } },
                zoom: makeSyncedZoomOptions(() => window.dailyChart),
            },
            scales: {
                y: { ticks: { callback: v => (v * 100).toFixed(1) + '%' } }
            }
        },
        plugins: [crosshairPlugin],
    });
}

/** 渲染每日收益率分布 */
function renderDailyReturnsChart(data) {
    const ctx = document.getElementById('dailyReturnsChart').getContext('2d');
    window.dailyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.dates,
            datasets: [{
                label: '每日收益率',
                data: data.dailyReturns,
                backgroundColor: data.dailyReturns.map(v => v >= 0 ? 'rgba(255,77,79,0.6)' : 'rgba(82,196,26,0.6)'),
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => (ctx.raw * 100).toFixed(2) + '%' } },
                zoom: makeSyncedZoomOptions(() => window.returnsChart),
            },
            scales: {
                y: { ticks: { callback: v => (v * 100).toFixed(1) + '%' } }
            }
        },
        plugins: [crosshairPlugin],
    });
    // 两个图表都创建完成后绑定 tooltip 同步
    bindReturnsTooltipSync();
}

/** 渲染 沪深300 K线（蜡烛）+ 策略累计收益叠加（双轴） */
async function renderKlineChart(returns) {
    try {
        const canvas = document.getElementById('klineChart');
        if (!canvas) return;
        const kline = await ApiClient.getBacktestKline(BACKTEST_ID);  // 已解包为 {dates, ohlc, close}
        const d = kline || {};
        const dates = d.dates || [];
        const ohlc = d.ohlc || [];
        if (!dates.length || !ohlc.length) return;
        // 策略累计收益（%）按日期对齐到 K线日期
        const retMap = {};
        (returns.dates || []).forEach((dt, i) => { retMap[dt] = (returns.cumulativeReturns || [])[i]; });
        const stratLine = dates.map(dt => retMap[dt] != null ? retMap[dt] * 100 : null);
        const colors = ohlc.map(o => o[3] >= o[0] ? '#e23838' : '#16a34a');  // 红涨绿跌
        const ctx = canvas.getContext('2d');
        window.klineChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: dates,
                datasets: [
                    { // 实体（开-收）
                        label: 'K线实体',
                        data: ohlc.map(o => [Math.min(o[0], o[3]), Math.max(o[0], o[3])]),
                        backgroundColor: colors, borderColor: colors, borderWidth: 1,
                        categoryPercentage: 0.7, barPercentage: 0.7, yAxisID: 'y',
                    },
                    { // 影线（低-高），细柱
                        label: 'K线影线',
                        data: ohlc.map(o => [Math.min(o[2], o[1]), Math.max(o[2], o[1])]),
                        backgroundColor: colors, borderColor: colors, borderWidth: 1,
                        categoryPercentage: 0.04, barPercentage: 0.04, yAxisID: 'y',
                    },
                    { // 策略累计收益（%，右侧轴）
                        type: 'line',
                        label: '策略累计收益',
                        data: stratLine,
                        borderColor: '#ff7f0e', backgroundColor: 'rgba(255,127,14,0.05)',
                        borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y2',
                    },
                ]
            },
            options: {
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top', labels: { filter: item => item.text !== 'K线影线' } },
                    tooltip: { callbacks: { label: c => c.dataset.label === '策略累计收益'
                        ? (c.raw != null ? c.raw.toFixed(2) + '%' : '—')
                        : (c.raw != null ? '开' + c.raw[0] + ' 收' + c.raw[1] : '') } },
                    zoom: {
                        pan: { enabled: true, mode: 'x', modifierKey: null },
                        zoom: { wheel: { enabled: true, speed: 0.1 }, pinch: { enabled: true }, mode: 'x' },
                        limits: { x: { min: 'original', max: 'original' } },
                    },
                },
                scales: {
                    x: { ticks: { maxTicksLimit: 12, callback: (v, i) => (dates[i] || '').slice(5) } },
                    y: { position: 'left', title: { display: true, text: '沪深300 点位' } },
                    y2: { position: 'right', title: { display: true, text: '策略累计收益 %' },
                          grid: { drawOnChartArea: false }, ticks: { callback: v => v.toFixed(0) + '%' } },
                },
            },
        });
    } catch (err) {
        console.error('K线图渲染失败:', err);
    }
}

// ========== 分页表格系统 ==========

// ========== 双表格按日期同步分页 ==========
const PAGE_DAYS = 20;
let _tpPage = 0;

/** 收集所有日期（trades + positions 并集，排序） */
function collectAllDates(trades, positions) {
    const dates = new Set();
    trades.forEach(t => dates.add(t.date));
    positions.forEach(p => dates.add(p.date));
    return Array.from(dates).sort();
}

/** 按日期同步分页渲染两个表格 */
function renderTradePosition(keepPage) {
    const trades = window._tradesData || [];
    const positions = window._positionsData || [];
    const searchText = document.getElementById('tpSearch')?.value || '';

    // 搜索过滤
    let filteredTrades = trades;
    let filteredPositions = positions;
    if (searchText) {
        const q = searchText.toLowerCase();
        filteredTrades = trades.filter(t => Object.values(t).some(v => String(v).toLowerCase().includes(q)));
        filteredPositions = positions.filter(p => Object.values(p).some(v => String(v).toLowerCase().includes(q)));
    }

    // 收集过滤后的日期并排序
    const dateSet = new Set();
    filteredTrades.forEach(t => dateSet.add(t.date));
    filteredPositions.forEach(p => dateSet.add(p.date));
    const sortedDates = Array.from(dateSet).sort();

    // 分页
    if (!keepPage) _tpPage = 0;
    const totalPages = Math.ceil(sortedDates.length / PAGE_DAYS) || 1;
    if (_tpPage >= totalPages) _tpPage = totalPages - 1;
    if (_tpPage < 0) _tpPage = 0;

    const startIdx = _tpPage * PAGE_DAYS;
    const pageDates = new Set(sortedDates.slice(startIdx, startIdx + PAGE_DAYS));
    const dateRangeText = sortedDates.length > 0
        ? (sortedDates[startIdx] || '') + ' ~ ' + (sortedDates[Math.min(startIdx + PAGE_DAYS - 1, sortedDates.length - 1)] || '')
        : '';

    // 过滤当前页数据
    const pageTrades = filteredTrades.filter(t => pageDates.has(t.date));
    const pagePositions = filteredPositions.filter(p => pageDates.has(p.date));

    // 按日期分组（保持排序）
    const pageSortedDates = sortedDates.slice(startIdx, startIdx + PAGE_DAYS);
    const tradesByDate = new Map();
    const positionsByDate = new Map();
    pageSortedDates.forEach(d => { tradesByDate.set(d, []); positionsByDate.set(d, []); });
    pageTrades.forEach(t => { if (tradesByDate.has(t.date)) tradesByDate.get(t.date).push(t); });
    pagePositions.forEach(p => { if (positionsByDate.has(p.date)) positionsByDate.get(p.date).push(p); });

    // 交易行渲染器
    const tradeRowHtml = (t, firstOfGroup) => `
        <tr class="${firstOfGroup ? 'date-group-start' : 'date-group-cont'}">
            <td>${firstOfGroup ? t.date : ''}</td>
            <td>${t.stock}</td>
            <td>${t.stockName}</td>
            <td class="${t.direction}">${t.direction === 'buy' ? '买入' : '卖出'}</td>
            <td>¥${t.price.toFixed(2)}</td>
            <td>${t.volume}</td>
            <td>¥${t.amount.toFixed(2)}</td>
            <td>¥${t.commission.toFixed(2)}</td>
            <td style="color:${t.profit >= 0 ? '#ff4d4f' : '#52c41a'}">${t.profit >= 0 ? '+' : ''}¥${t.profit.toFixed(2)}</td>
        </tr>`;
    // 持仓行渲染器
    const posRowHtml = (p, firstOfGroup) => `
        <tr class="${firstOfGroup ? 'date-group-start' : 'date-group-cont'}">
            <td>${firstOfGroup ? p.date : ''}</td>
            <td>${p.stock}</td>
            <td>${p.stockName}</td>
            <td>${p.volume}</td>
            <td>¥${p.price.toFixed(2)}</td>
            <td>¥${p.cost.toFixed(2)}</td>
            <td>¥${p.marketValue.toFixed(2)}</td>
            <td style="color:${p.profit >= 0 ? '#ff4d4f' : '#52c41a'}">${p.profit >= 0 ? '+' : ''}¥${p.profit.toFixed(2)}</td>
            <td style="color:${p.profitRate >= 0 ? '#ff4d4f' : '#52c41a'}">${(p.profitRate * 100).toFixed(2)}%</td>
            <td>${(p.weight * 100).toFixed(1)}%</td>
        </tr>`;
    // 空行（补齐对齐用）
    const emptyTradeRow = (firstOfGroup, date) => `
        <tr class="${firstOfGroup ? 'date-group-start' : 'date-group-cont'} empty-row">
            <td>${firstOfGroup ? date : ''}</td>
            <td colspan="8" style="color:var(--text-secondary);font-style:italic;">—</td>
        </tr>`;
    const emptyPosRow = (firstOfGroup, date) => `
        <tr class="${firstOfGroup ? 'date-group-start' : 'date-group-cont'} empty-row">
            <td>${firstOfGroup ? date : ''}</td>
            <td colspan="9" style="color:var(--text-secondary);font-style:italic;">—</td>
        </tr>`;

    // 逐日期构建两表行，按 max(交易数, 持仓数) 补齐，确保垂直对齐
    const tradeRows = [];
    const posRows = [];
    let hasTrades = false, hasPositions = false;
    pageSortedDates.forEach(d => {
        const ts = tradesByDate.get(d) || [];
        const ps = positionsByDate.get(d) || [];
        if (ts.length) hasTrades = true;
        if (ps.length) hasPositions = true;
        const maxRows = Math.max(ts.length, ps.length, 1);
        for (let i = 0; i < maxRows; i++) {
            const first = (i === 0);
            tradeRows.push(ts[i] ? tradeRowHtml(ts[i], first) : emptyTradeRow(first, d));
            posRows.push(ps[i] ? posRowHtml(ps[i], first) : emptyPosRow(first, d));
        }
    });

    // 渲染交易表（始终使用补齐行，保证与持仓表行数一致、日期对齐）
    const tradesBody = document.getElementById('tradesBody');
    tradesBody.innerHTML = tradeRows.join('');

    // 渲染持仓表（始终使用补齐行，保证与交易表行数一致、日期对齐）
    const positionsBody = document.getElementById('positionsBody');
    positionsBody.innerHTML = posRows.join('');

    // 更新计数和日期范围
    document.getElementById('tradesCount').textContent = pageTrades.length + ' 条';
    document.getElementById('positionsCount').textContent = pagePositions.length + ' 条';
    const rangeEl = document.getElementById('tpDateRange');
    if (rangeEl) rangeEl.textContent = dateRangeText;

    // 渲染分页控件
    renderTpPagination(sortedDates.length, totalPages, startIdx);

    // 渲染后重置滚动位置到顶部，确保两表同步
    resetTableScroll();
}

/** 渲染分页控件 */
function renderTpPagination(totalDates, totalPages, startIdx) {
    const paginationEl = document.getElementById('tpPagination');
    if (!paginationEl) return;
    if (totalDates <= PAGE_DAYS) { paginationEl.innerHTML = ''; return; }

    const maxButtons = 7;
    let startPage = Math.max(0, _tpPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons);
    startPage = Math.max(0, endPage - maxButtons);

    let html = '';
    html += '<button class="page-btn" ' + (_tpPage === 0 ? 'disabled' : '') + ' onclick="goToTpPage(0)">«</button>';
    html += '<button class="page-btn" ' + (_tpPage === 0 ? 'disabled' : '') + ' onclick="goToTpPage(' + (_tpPage - 1) + ')">‹</button>';
    for (let i = startPage; i < endPage; i++) {
        html += '<button class="page-btn ' + (i === _tpPage ? 'active' : '') + '" onclick="goToTpPage(' + i + ')">' + (i + 1) + '</button>';
    }
    html += '<button class="page-btn" ' + (_tpPage >= totalPages - 1 ? 'disabled' : '') + ' onclick="goToTpPage(' + (_tpPage + 1) + ')">›</button>';
    html += '<button class="page-btn" ' + (_tpPage >= totalPages - 1 ? 'disabled' : '') + ' onclick="goToTpPage(' + (totalPages - 1) + ')">»</button>';
    html += '<span class="page-info">' + (startIdx + 1) + '-' + Math.min(startIdx + PAGE_DAYS, totalDates) + ' / ' + totalDates + ' 天</span>';
    paginationEl.innerHTML = html;
}

/** 跳转到指定页 */
function goToTpPage(page) {
    _tpPage = page;
    renderTradePosition(true);
}

/** 搜索框输入事件 */
function onTpSearch(keepPage) {
    if (!keepPage) _tpPage = 0;
    renderTradePosition(keepPage);
}

// ========== 交易与持仓记录 ==========

function renderTrades(trades) {
    window._tradesData = trades;
    _tpPage = 0;
    renderTradePosition();
}

function renderPositions(positions) {
    window._positionsData = positions;
    _tpPage = 0;
    renderTradePosition();
}

// ========== 滚动同步（水平 + 垂直） ==========
function syncTableScroll() {
    const containers = [
        document.getElementById('tradesScroll'),
        document.getElementById('positionsScroll'),
    ].filter(Boolean);
    if (containers.length < 2) return;

    // 防止重复绑定
    if (containers[0].dataset.scrollSynced === '1') return;
    containers.forEach(c => { c.dataset.scrollSynced = '1'; });

    let syncing = false;
    containers.forEach((c, i) => {
        c.addEventListener('scroll', () => {
            if (syncing) return;
            syncing = true;
            containers.forEach((other, j) => {
                if (i !== j) {
                    other.scrollLeft = c.scrollLeft;
                    other.scrollTop = c.scrollTop;
                }
            });
            syncing = false;
        });
    });
}

/** 重置双表格滚动位置（翻页时调用） */
function resetTableScroll() {
    const ts = document.getElementById('tradesScroll');
    const ps = document.getElementById('positionsScroll');
    if (ts) { ts.scrollTop = 0; ts.scrollLeft = 0; }
    if (ps) { ps.scrollTop = 0; ps.scrollLeft = 0; }
}

/** 渲染基准收益对比图 */
function renderBenchmarkChart(benchmark, returns) {
    const ctx = document.getElementById('benchmarkChart').getContext('2d');
    window.benchmarkChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: benchmark.dates,
            datasets: [
                { label: '策略收益', data: returns.cumulativeReturns, borderColor: '#1890ff', tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
                { label: `基准: ${benchmark.benchmarkName}`, data: benchmark.cumulativeReturns, borderColor: '#52c41a', tension: 0.3, borderDash: [5,5], pointRadius: 0, pointHoverRadius: 4 },
            ]
        },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top' },
                tooltip: { callbacks: { label: ctx => (ctx.raw * 100).toFixed(2) + '%' } },
                zoom: makeSyncedZoomOptions(() => window.excessChart),
            },
            scales: {
                y: { ticks: { callback: v => (v * 100).toFixed(1) + '%' } }
            }
        },
        plugins: [crosshairPlugin],
    });
}

/** 渲染超额收益图 */
function renderExcessChart(benchmark) {
    const ctx = document.getElementById('excessChart').getContext('2d');
    window.excessChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: benchmark.dates,
            datasets: [{
                label: '超额收益',
                data: benchmark.excessReturns,
                backgroundColor: benchmark.excessReturns.map(v => v >= 0 ? 'rgba(255,77,79,0.6)' : 'rgba(82,196,26,0.6)'),
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => (ctx.raw * 100).toFixed(2) + '%' } },
                zoom: makeSyncedZoomOptions(() => window.benchmarkChart),
            },
            scales: {
                y: { ticks: { callback: v => (v * 100).toFixed(1) + '%' } }
            }
        },
        plugins: [crosshairPlugin],
    });
    // 两个图表都创建完成后绑定 tooltip 同步
    bindBenchmarkTooltipSync();
}

/** 渲染基准摘要 */
function renderBenchmarkSummary(benchmark) {
    const container = document.getElementById('benchmarkSummary');
    container.innerHTML = `
        <div class="card"><div class="card-label">基准名称</div><div class="card-value" style="font-size:16px;">${benchmark.benchmarkName}</div></div>
        <div class="card"><div class="card-label">基准总收益</div><div class="card-value positive">${(benchmark.totalReturns * 100).toFixed(2)}%</div></div>
        <div class="card"><div class="card-label">基准年化收益</div><div class="card-value positive">${(benchmark.annualReturns * 100).toFixed(2)}%</div></div>
        <div class="card"><div class="card-label">基准最大回撤</div><div class="card-value negative">${(benchmark.maxDrawdown * 100).toFixed(2)}%</div></div>
    `;
}

// ========== 基准选择器 ==========

// 常用基准指数预设列表（基于数据库实际可用指数）
const COMMON_BENCHMARKS = [
    { code: '000300', name: '沪深300指数' },
    { code: '000001', name: '上证综合指数' },
    { code: '399001', name: '深证成份指数' },
    { code: '000010', name: '上证180指数' },
    { code: '399106', name: '深证综合指数' },
    { code: '399004', name: '深证100指数' },
    { code: '000903', name: '中证A100指数' },
    { code: '000002', name: '上证A股指数' },
];

/** 初始化基准选择器 */
async function initBenchmarkSelector(originalBenchmark) {
    const select = document.getElementById('benchmarkSelect');
    if (!select) return;

    select.innerHTML = '';

    const origCode = (originalBenchmark.benchmarkCode || '').split('.')[0];
    const origOpt = document.createElement('option');
    origOpt.value = `__orig__`;
    origOpt.textContent = `回测原始基准（${originalBenchmark.benchmarkName || origCode}）`;
    origOpt.dataset.code = origCode;
    origOpt.dataset.name = originalBenchmark.benchmarkName || origCode;
    select.appendChild(origOpt);

    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '── 常用指数 ──';
    select.appendChild(sep);

    for (const b of COMMON_BENCHMARKS) {
        const opt = document.createElement('option');
        opt.value = b.code;
        opt.textContent = `${b.code} ${b.name}`;
        opt.dataset.code = b.code;
        opt.dataset.name = b.name;
        select.appendChild(opt);
    }

    // 恢复记忆的基准选择
    const savedBenchmark = loadPref('benchmark');
    if (savedBenchmark && savedBenchmark !== '__orig__') {
        const opt = Array.from(select.options).find(o => o.value === savedBenchmark);
        if (opt) {
            select.value = savedBenchmark;
            onBenchmarkSelectChange(savedBenchmark);
        } else {
            select.value = '__orig__';
            document.getElementById('benchmarkSelectHint').textContent = '当前为回测原始基准';
        }
    } else {
        select.value = '__orig__';
        document.getElementById('benchmarkSelectHint').textContent = '当前为回测原始基准';
    }
}

/** 基准选择器切换事件 */
async function onBenchmarkSelectChange(value) {
    const select = document.getElementById('benchmarkSelect');
    const hint = document.getElementById('benchmarkSelectHint');
    const option = select.selectedOptions[0];
    if (!option || !value) return;

    if (value === '__orig__') {
        const benchmark = window._cachedBenchmark;
        const returns = window._cachedReturns;
        hint.textContent = '当前为回测原始基准';
        redrawBenchmarkCharts(benchmark, returns);
        renderBenchmarkSummary(benchmark);
        savePref('benchmark', '__orig__');
        return;
    }

    const code = option.dataset.code;
    const name = option.dataset.name;
    hint.textContent = `正在加载 ${name} ...`;

    try {
        const returns = window._cachedReturns;
        const startDate = returns.dates[0];
        const endDate = returns.dates[returns.dates.length - 1];

        const indexData = await ApiClient.getIndexDaily(code, startDate, endDate);
        if (!indexData || indexData.length === 0) {
            hint.textContent = `${name} 在该区间无数据`;
            Toast.warning('无数据', `${name} 在该回测区间无数据`);
            return;
        }

        const newBenchmark = computeIndexBenchmark(indexData, name, code, returns);
        hint.textContent = `当前对比: ${name}`;
        redrawBenchmarkCharts(newBenchmark, returns);
        renderBenchmarkSummary(newBenchmark);
        savePref('benchmark', value);
    } catch (err) {
        hint.textContent = `加载失败: ${err.message}`;
        Toast.error('基准切换失败', err.message);
        console.error('基准切换失败:', err);
    }
}

/** 根据指数日线数据计算基准对比数据 */
function computeIndexBenchmark(indexData, name, code, returns) {
    const priceMap = {};
    for (const r of indexData) {
        priceMap[r.trade_date] = r.close_index;
    }

    const dates = returns.dates;
    const cumulativeReturns = [];
    let firstPrice = null;
    let lastPrice = null;

    for (const d of dates) {
        let price = priceMap[d];
        if (price == null) {
            price = lastPrice;
        }
        if (price != null) {
            if (firstPrice == null) firstPrice = price;
            lastPrice = price;
            cumulativeReturns.push(firstPrice > 0 ? (price / firstPrice - 1) : 0);
        } else {
            cumulativeReturns.push(null);
        }
    }

    const dailyReturns = [];
    for (let i = 0; i < cumulativeReturns.length; i++) {
        if (i === 0 || cumulativeReturns[i] == null || cumulativeReturns[i - 1] == null) {
            dailyReturns.push(0);
        } else {
            dailyReturns.push(cumulativeReturns[i] - cumulativeReturns[i - 1]);
        }
    }

    const excessReturns = returns.cumulativeReturns.map((v, i) =>
        (v != null && cumulativeReturns[i] != null) ? v - cumulativeReturns[i] : null
    );

    const totalReturns = lastPrice != null && firstPrice > 0 ? (lastPrice / firstPrice - 1) : 0;

    const tradingDays = dates.length;
    const years = tradingDays > 0 ? tradingDays / 242 : 1;
    const annualReturns = years > 0 && totalReturns > -1 ? Math.pow(1 + totalReturns, 1 / years) - 1 : 0;

    let peak = -Infinity, maxDrawdown = 0;
    for (const v of cumulativeReturns) {
        if (v == null) continue;
        const level = 1 + v;
        if (level > peak) peak = level;
        const dd = (peak - level) / peak;
        if (dd > maxDrawdown) maxDrawdown = dd;
    }

    return {
        benchmarkName: name,
        benchmarkCode: code,
        dates,
        dailyReturns,
        cumulativeReturns,
        excessReturns,
        totalReturns,
        annualReturns,
        maxDrawdown,
        volatility: 0,
    };
}

/** 重绘基准对比图 + 超额收益图 */
function redrawBenchmarkCharts(benchmark, returns) {
    if (window.benchmarkChart) { window.benchmarkChart.destroy(); window.benchmarkChart = null; }
    if (window.excessChart) { window.excessChart.destroy(); window.excessChart = null; }
    renderBenchmarkChart(benchmark, returns);
    renderExcessChart(benchmark);
}

/** 渲染日志 */
function renderLogs(logs) {
    window._logs = logs;
    filterLogs();
}

function filterLogs() {
    const checked = {};
    document.querySelectorAll('.log-filter input:checked').forEach(cb => checked[cb.value] = true);
    
    const container = document.getElementById('logContainer');
    const filtered = (window._logs || []).filter(log => checked[log.level]);
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:40px 0;color:#666;"><div class="empty-icon">📋</div><div class="empty-text">暂无日志</div></div>';
        return;
    }
    container.innerHTML = filtered.map(log => `
            <div class="log-entry">
                <span class="log-time">[${log.date} ${log.time}]</span>
                <span class="log-level-${log.level}">[${log.level.toUpperCase()}]</span>
                <span>${log.message}</span>
            </div>
        `).join('');
    container.scrollTop = container.scrollHeight;
}

/** 渲染代码 */
function renderCode(data) {
    document.getElementById('codeBlock').textContent = data.code;
}

/** 复制代码 */
function copyCode() {
    const code = document.getElementById('codeBlock').textContent;
    navigator.clipboard.writeText(code).then(() => {
        Toast.success('已复制', '策略代码已复制到剪贴板');
    }).catch(() => {
        Toast.error('复制失败', '请手动选择代码复制');
    });
}

/** 导出数据 */
function exportData(type) {
    const url = ApiClient.getExportUrl(BACKTEST_ID, type);
    window.open(url, '_blank');
    Toast.info('导出中', 'CSV 文件即将开始下载');
}

/** 运行回测 */
async function runBacktest() {
    const btn = event?.currentTarget;
    const originalText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = '回测中...'; }

    const overlay = Overlay.show('正在运行回测...', '策略执行中，请稍候');

    try {
        const result = await ApiClient.runBacktest(BACKTEST_ID, {
            shortWindow: 5,
            longWindow: 20,
        });
        Overlay.hide();
        showResultModal(result);
    } catch (err) {
        Overlay.hide();
        Toast.error('回测失败', err.message || '未知错误');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
}

/** 编辑策略 */
function editStrategy() {
    location.href = `/pages/edit.html?id=${BACKTEST_ID}`;
}

/** 模拟交易 */
function simulateTrade() {
    Toast.info('模拟交易', '该功能正在开发中，敬请期待');
}

// ========== 工具函数 ==========

/** 重置图表缩放 */
function resetZoom(canvasId) {
    const map = {
        returnsChart: window.returnsChart,
        dailyReturnsChart: window.dailyChart,
        benchmarkChart: window.benchmarkChart,
        excessChart: window.excessChart,
    };
    const chart = map[canvasId];
    if (!chart) return;
    chart.resetZoom();
    // 策略收益双图同步重置
    if (canvasId === 'returnsChart' && window.dailyChart) {
        window.dailyChart.resetZoom();
    } else if (canvasId === 'dailyReturnsChart' && window.returnsChart) {
        window.returnsChart.resetZoom();
    }
    // 基准收益双图同步重置
    else if (canvasId === 'benchmarkChart' && window.excessChart) {
        window.excessChart.resetZoom();
    } else if (canvasId === 'excessChart' && window.benchmarkChart) {
        window.benchmarkChart.resetZoom();
    }
}

/** 为所有图表 canvas 绑定双击重置 */
document.addEventListener('DOMContentLoaded', () => {
    ['returnsChart', 'dailyReturnsChart', 'benchmarkChart', 'excessChart'].forEach(id => {
        const canvas = document.getElementById(id);
        if (canvas) {
            canvas.addEventListener('dblclick', () => resetZoom(id));
        }
    });
});
