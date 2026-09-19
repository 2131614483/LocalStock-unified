/**
 * 量化回测平台 API 客户端 - 前端接口封装
 * 统一管理和调用后端 API
 */

const API_BASE = window.location.origin;

const ApiClient = {
    /** 通用请求方法 */
    async request(url, options = {}) {
        const { method = 'GET', params = {}, body = null } = options;
        
        let queryString = '';
        const queryParams = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== null) queryParams.append(k, v);
        });
        const qs = queryParams.toString();
        if (qs) queryString = '?' + qs;

        const fetchOpts = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (body && method === 'POST') fetchOpts.body = JSON.stringify(body);

        try {
            const resp = await fetch(`${API_BASE}${url}${queryString}`, fetchOpts);
            const data = await resp.json();
            if (data.code !== 0) throw new Error(data.message || '请求失败');
            return data.data;
        } catch (err) {
            console.error(`API Error [${method} ${url}]:`, err);
            throw err;
        }
    },

    // ---- 策略管理 ----
    getAlgorithmList() {
        return this.request('/api/algorithm/list');
    },
    createAlgorithm(name, description) {
        return this.request('/api/algorithm/create', { method: 'POST', body: { name, description } });
    },
    getLatestBacktest(algorithmId) {
        return this.request(`/api/algorithm/${algorithmId}/latest-backtest`);
    },

    // ---- 回测数据 ----
    getBacktestSummary(backtestId) {
        return this.request(`/api/backtest/${backtestId}/summary`);
    },
    getBacktestReturns(backtestId) {
        return this.request(`/api/backtest/${backtestId}/returns`);
    },
    getBacktestTrades(backtestId) {
        return this.request(`/api/backtest/${backtestId}/trades`);
    },
    getBacktestPositions(backtestId) {
        return this.request(`/api/backtest/${backtestId}/positions`);
    },
    getBacktestBenchmark(backtestId) {
        return this.request(`/api/backtest/${backtestId}/benchmark`);
    },
    getBacktestKline(backtestId) {
        return this.request(`/api/backtest/${backtestId}/kline`);
    },
    getBacktestLogs(backtestId) {
        return this.request(`/api/backtest/${backtestId}/logs`);
    },
    getBacktestCode(backtestId) {
        return this.request(`/api/backtest/${backtestId}/code`);
    },
    saveBacktestCode(backtestId, language, code, name) {
        const body = { language, code };
        if (name !== undefined && name !== null) body.name = name;
        return this.request(`/api/backtest/${backtestId}/code`, {
            method: 'POST',
            body,
        });
    },
    runBacktest(backtestId, params = {}) {
        return this.request(`/api/backtest/${backtestId}/run`, {
            method: 'POST',
            body: params,
        });
    },
    getCalendarRange() {
        return this.request('/api/calendar/range');
    },
    getMonthTradeDays(year, month) {
        return this.request(`/api/calendar/month?year=${year}&month=${month}`);
    },

    // ---- 导出 ----
    getExportUrl(backtestId, type) {
        return `${API_BASE}/api/backtest/${backtestId}/export?type=${type}`;
    },

    // ---- 指数数据 ----
    getIndexDaily(code, start, end) {
        return this.request(`/api/index/${code}/daily`, { params: { start, end } });
    },
    searchIndex(q) {
        return this.request('/api/index/search', { params: { q } });
    },
};