/**
 * 量化回测平台 API 服务
 * 数据源: SQLite 数据库 (data/backtest.db)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, queries } = require('./db');
const { initStockDb, queries: stockQueries } = require('./stock-db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// ==================== 初始化数据库 ====================

const db = initDatabase();
const stockDb = initStockDb();

// ==================== API 路由 ====================

/** 策略列表 */
app.get('/api/algorithm/list', (req, res) => {
    try {
        const data = queries.getAlgorithmList();
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 创建新策略 */
app.post('/api/algorithm/create', (req, res) => {
    try {
        const crypto = require('crypto');
        const { name, description } = req.body || {};
        const algoId = crypto.randomBytes(16).toString('hex');
        const btId = crypto.randomBytes(16).toString('hex');
        db.prepare('INSERT INTO algorithms (algorithm_id, user_id, name, description) VALUES (?, 1, ?, ?)')
          .run(algoId, name || '新策略', description || '');
        db.prepare('INSERT INTO backtests (backtest_id, algorithm_id, algorithm_name, start_date, end_date, capital_base, frequency, status, progress) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(btId, algoId, name || '新策略', '2023-01-01', '2026-07-31', 1000000, 'day', 'pending', 0);
        db.prepare('INSERT INTO backtest_code (backtest_id, language, code, code_hash) VALUES (?, ?, ?, ?)')
          .run(btId, 'python', '# 在此编写策略代码\ndef initialize(context):\n    set_benchmark("000300.XSHG")\n    log.info("策略初始化完成")\n', 'new');
        res.json({ code: 0, data: { algorithm_id: algoId, backtest_id: btId }, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 获取策略最新回测 */
app.get('/api/algorithm/:id/latest-backtest', (req, res) => {
    try {
        const row = db.prepare('SELECT backtest_id FROM backtests WHERE algorithm_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(req.params.id);
        res.json({ code: 0, data: row || null, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 回测详情概览 */
app.get('/api/backtest/:id/summary', (req, res) => {
    try {
        const data = queries.getBacktestSummary(req.params.id);
        if (!data) return res.status(404).json({ code: -1, message: '回测不存在' });
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 策略收益（含时间序列） */
app.get('/api/backtest/:id/returns', (req, res) => {
    try {
        const data = queries.getBacktestReturns(req.params.id);
        if (!data) return res.status(404).json({ code: -1, message: '回测不存在' });
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 交易详情 */
app.get('/api/backtest/:id/trades', (req, res) => {
    try {
        if (!queries.getBacktestSummary(req.params.id)) {
            return res.status(404).json({ code: -1, message: '回测不存在' });
        }
        const data = queries.getBacktestTrades(req.params.id);
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 每日持仓收益 */
app.get('/api/backtest/:id/positions', (req, res) => {
    try {
        if (!queries.getBacktestSummary(req.params.id)) {
            return res.status(404).json({ code: -1, message: '回测不存在' });
        }
        const data = queries.getBacktestPositions(req.params.id);
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 基准收益 */
app.get('/api/backtest/:id/benchmark', (req, res) => {
    try {
        const data = queries.getBacktestBenchmark(req.params.id);
        if (!data) return res.status(404).json({ code: -1, message: '回测不存在' });
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 基准 K线（沪深300 OHLC，回测结果页蜡烛图用） */
app.get('/api/backtest/:id/kline', (req, res) => {
    try {
        const bt = queries.getBacktestSummary(req.params.id);
        if (!bt) return res.status(404).json({ code: -1, message: '回测不存在' });
        const stockQueries = require('./stock-db').queries;
        const rows = stockQueries.getIndexDaily('000300', bt.startDate, bt.endDate);
        res.json({ code: 0, data: {
            dates: rows.map(r => r.trade_date),
            ohlc: rows.map(r => [r.open_index, r.high_index, r.low_index, r.close_index]),
            close: rows.map(r => r.close_index),
        }, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 日志输出（支持 ?level=info 过滤） */
app.get('/api/backtest/:id/logs', (req, res) => {
    try {
        if (!queries.getBacktestSummary(req.params.id)) {
            return res.status(404).json({ code: -1, message: '回测不存在' });
        }
        const data = queries.getBacktestLogs(req.params.id, req.query.level);
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 策略代码 */
app.get('/api/backtest/:id/code', (req, res) => {
    try {
        const data = queries.getBacktestCode(req.params.id);
        if (!data) return res.status(404).json({ code: -1, message: '策略代码不存在' });
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 保存策略代码 */
app.post('/api/backtest/:id/code', (req, res) => {
    try {
        if (!queries.getBacktestSummary(req.params.id)) {
            return res.status(404).json({ code: -1, message: '回测不存在' });
        }
        const { language = 'python', code, name } = req.body;
        if (code === undefined || code === null) {
            return res.status(400).json({ code: -1, message: '缺少 code 字段' });
        }
        queries.insertCode(req.params.id, language, code);
        // 可选：同步更新策略名称
        if (name !== undefined && name !== null) {
            queries.updateStrategyName(req.params.id, name);
        }
        res.json({ code: 0, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 运行回测（本地真实回测引擎，调用 Python） */
app.post('/api/backtest/:id/run', async (req, res) => {
    try {
        if (!queries.getBacktestSummary(req.params.id)) {
            return res.status(404).json({ code: -1, message: '回测不存在' });
        }
        const params = req.body || {};

        // 校验回测日期
        const stockQueries = require('./stock-db').queries;
        const range = stockQueries.getCalendarRange();
        if (range && range.min_date) {
            const minDate = range.min_date.replace(/"/g, '');
            const maxDate = range.max_date.replace(/"/g, '');
            if (params.startDate && (params.startDate < minDate || params.startDate > maxDate)) {
                return res.status(400).json({ code: -1, message: `开始日期超出数据范围（${minDate} ~ ${maxDate}）` });
            }
            if (params.endDate && (params.endDate < minDate || params.endDate > maxDate)) {
                return res.status(400).json({ code: -1, message: `结束日期超出数据范围（${minDate} ~ ${maxDate}）` });
            }
            if (params.startDate && params.endDate && params.startDate > params.endDate) {
                return res.status(400).json({ code: -1, message: '开始日期不能晚于结束日期' });
            }
        }

        // 获取策略代码
        const codeData = queries.getBacktestCode(req.params.id);
        if (!codeData || !codeData.code) {
            return res.status(400).json({ code: -1, message: '策略代码为空' });
        }

        // 调用 Python 回测引擎
        const { execFile } = require('child_process');
        const enginePath = path.join(__dirname, '..', 'engine', 'backtest_engine.py');
        const startDate = params.startDate || '2023-01-01';
        const endDate = params.endDate || '2023-12-31';
        const capital = params.capitalBase || 1000000;

        const pyArgs = [
            enginePath,
            '--code', codeData.code,
            '--start', startDate,
            '--end', endDate,
            '--capital', String(capital),
        ];

        execFile('python', pyArgs, {
            maxBuffer: 50 * 1024 * 1024,
            timeout: 120000,
            cwd: path.join(__dirname, '..'),
        }, (err, stdout, stderr) => {
            if (err) {
                console.error('[回测引擎] 执行失败:', err.message);
                console.error('[回测引擎] stderr:', stderr);
                return res.status(500).json({
                    code: -1,
                    message: '回测引擎执行失败: ' + (stderr || err.message),
                });
            }

            let result;
            try {
                result = JSON.parse(stdout);
            } catch (parseErr) {
                console.error('[回测引擎] JSON解析失败:', stdout.slice(0, 500));
                return res.status(500).json({
                    code: -1,
                    message: '回测结果解析失败',
                });
            }

            if (result.code !== 0) {
                return res.status(400).json(result);
            }

            // 更新回测元数据（初始资金、日期范围）
            queries.updateBacktestMeta(req.params.id, { capital, startDate, endDate });
            // 将结果写入数据库
            queries.saveBacktestResult(req.params.id, result);

            res.json({
                code: 0,
                data: result.data,
                message: '回测完成',
            });
        });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 导出数据为 CSV（type: transaction | positions | returns） */
app.get('/api/backtest/:id/export', (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.query;
        if (!queries.getBacktestSummary(id)) {
            return res.status(404).json({ code: -1, message: '回测不存在' });
        }

        let header, rows, filename;
        if (type === 'transaction' || type === 'trades') {
            const data = queries.getBacktestTrades(id);
            header = ['日期', '时间', '股票代码', '股票名称', '方向', '成交价', '成交量', '成交金额', '手续费', '印花税', '盈亏'];
            rows = data.map(r => [r.date, r.time, r.stock, r.stockName, r.direction === 'buy' ? '买入' : '卖出', r.price, r.volume, r.amount, r.commission, r.tax, r.profit]);
            filename = `trades_${id}.csv`;
        } else if (type === 'positions') {
            const data = queries.getBacktestPositions(id);
            header = ['日期', '股票代码', '股票名称', '持仓数量', '现价', '成本价', '市值', '盈亏', '盈亏比例', '权重'];
            rows = data.map(r => [r.date, r.stock, r.stockName, r.volume, r.price, r.cost, r.marketValue, r.profit, r.profitRate, r.weight]);
            filename = `positions_${id}.csv`;
        } else if (type === 'returns') {
            const data = queries.getBacktestReturns(id);
            header = ['日期', '日收益率', '累计收益率'];
            rows = data.dates.map((d, i) => [d, data.dailyReturns[i], data.cumulativeReturns[i]]);
            filename = `returns_${id}.csv`;
        } else {
            return res.status(400).json({ code: -1, message: '不支持的导出类型，可选: transaction, positions, returns' });
        }

        const esc = v => {
            if (v === null || v === undefined) return '';
            const s = String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csv = [header.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        // BOM 头，确保 Excel 正确识别 UTF-8
        res.send('\ufeff' + csv);
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

// ==================== 股票日线数据接口 ====================

/** 单只股票日线数据 */
app.get('/api/stock/:code/daily', (req, res) => {
    try {
        const { code } = req.params;
        const { start, end, fields } = req.query;
        const fieldList = fields ? fields.split(',') : null;
        const data = stockQueries.getDailyData(code, start, end, fieldList);
        res.json({ code: 0, data, total: data.length, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 多只股票批量查询 */
app.post('/api/stock/batch/daily', (req, res) => {
    try {
        const { codes, start, end } = req.body;
        if (!codes || !codes.length) {
            return res.json({ code: -1, message: '请提供股票代码列表' });
        }
        const data = stockQueries.getMultiStockData(codes, start, end);
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 按日期查询全市场 */
app.get('/api/stock/market/:date', (req, res) => {
    try {
        const data = stockQueries.getMarketDataByDate(req.params.date);
        res.json({ code: 0, data, total: data.length, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 搜索股票 */
app.get('/api/stock/search', (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json({ code: -1, message: '请输入搜索关键词' });
        const data = stockQueries.searchStocks(q);
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 股票收益率计算 */
app.get('/api/stock/:code/return', (req, res) => {
    try {
        const { code } = req.params;
        const { start, end } = req.query;
        const data = stockQueries.calculateReturn(code, start, end);
        if (!data) return res.json({ code: -1, message: '数据不足' });
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 交易日历 */
app.get('/api/calendar', (req, res) => {
    try {
        const { year } = req.query;
        const data = stockQueries.getTradeCalendar(year ? parseInt(year) : null);
        res.json({ code: 0, data, total: data.length, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 交易日历范围（最早/最晚交易日 + 总数） */
app.get('/api/calendar/range', (req, res) => {
    try {
        const data = stockQueries.getCalendarRange();
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 某月交易日（用于日历组件渲染） */
app.get('/api/calendar/month', (req, res) => {
    try {
        const { year, month } = req.query;
        if (!year || !month) return res.status(400).json({ code: -1, message: '需要 year 和 month 参数' });
        const data = stockQueries.getTradeDaysByMonth(parseInt(year), parseInt(month));
        res.json({ code: 0, data, total: data.length, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 数据库统计 */
app.get('/api/stats', (req, res) => {
    try {
        const { importMethods } = require('./stock-db');
        const stats = importMethods.getStats();
        res.json({ code: 0, data: {
            ...stats,
            fileSizeMB: (stats.fileSize / 1024 / 1024).toFixed(2),
        }, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

// ==================== 指数数据接口 ====================

/** 指数日线数据 */
app.get('/api/index/:code/daily', (req, res) => {
    try {
        const { code } = req.params;
        const { start, end } = req.query;
        const data = stockQueries.getIndexDaily(code, start || '1990-01-01', end || '2099-12-31');
        res.json({ code: 0, data, total: data.length, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 搜索指数 */
app.get('/api/index/search', (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json({ code: -1, message: '请输入搜索关键词' });
        const data = stockQueries.searchIndex(q);
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 无风险利率 */
app.get('/api/risk-free-rate', (req, res) => {
    try {
        const { start, end } = req.query;
        const data = stockQueries.getRiskFreeRate(start || '1990-01-01', end || '2099-12-31');
        res.json({ code: 0, data, total: data.length, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/** 市场回报率 */
app.get('/api/market/daily', (req, res) => {
    try {
        const { start, end } = req.query;
        const data = stockQueries.getMarketDaily(start || '1990-01-01', end || '2099-12-31');
        res.json({ code: 0, data, total: data.length, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

// ==================== AI 自主回测接口（/api/ai/*）====================
// 设计原则：一次调用完成一个意图；错误信息可被 AI 直接理解并自我修正；
// 不改动上方既有路由；Python 引擎与 Web 路由共用同一 engine/backtest_engine.py。

const crypto = require('crypto');

/** 内部工具：同步执行回测引擎（供 /api/ai/* 使用），返回引擎完整结果 JSON */
function runEngineSync(code, startDate, endDate, capital) {
    const { execFile } = require('child_process');
    const enginePath = path.join(__dirname, '..', 'engine', 'backtest_engine.py');
    return new Promise((resolve) => {
        execFile('python', [enginePath, '--code', code, '--start', startDate,
                            '--end', endDate, '--capital', String(capital)],
            { maxBuffer: 200 * 1024 * 1024, timeout: 600000, cwd: path.join(__dirname, '..') },
            (err, stdout, stderr) => {
                if (err && !stdout) {
                    return resolve({ code: -1, message: '回测引擎执行失败: ' + (stderr || err.message).slice(0, 4000), data: null });
                }
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (e) {
                    resolve({ code: -1, message: '策略输出非纯JSON（可能含 print）：' + String(stdout).slice(0, 600), data: null });
                }
            });
    });
}

function isValidDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * POST /api/ai/backtest
 * AI 一步完成「存代码 + 回测 + 持久化 + 返回指标」。body:
 * { code(必填), name?, startDate?, endDate?, capitalBase?, persist?(默认true), saveAlgorithmId? }
 * 响应: { code:0, data:{ backtestId, metrics, dailyRecordsSample } } —— 日线只回传前 N 条防 token 爆炸。
 */
app.post('/api/ai/backtest', async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.code || typeof b.code !== 'string' || !b.code.includes('def initialize')) {
            return res.status(400).json({ code: -1, message: "code 必填且必须定义 initialize(context) 函数。最小骨架：def initialize(context):\\n    set_benchmark('000300.XSHG')\\n    run_daily(handle)\\ndef handle(context):\\n    ..." });
        }
        // 校验日期
        let startDate = isValidDate(b.startDate) ? b.startDate : '2016-01-04';
        let endDate = isValidDate(b.endDate) ? b.endDate : '2026-08-25';
        if (startDate > endDate) return res.status(400).json({ code: -1, message: `startDate(${startDate}) 不能晚于 endDate(${endDate})` });
        const range = stockQueries.getCalendarRange();
        if (range && range.min_date) {
            const mn = String(range.min_date).replace(/"/g, ''), mx = String(range.max_date).replace(/"/g, '');
            if (startDate < mn || endDate > mx) {
                return res.status(400).json({ code: -1, message: `日期超出数据范围，可用区间 ${mn} ~ ${mx}` });
            }
        }
        const capital = Number(b.capitalBase) > 0 ? Number(b.capitalBase) : 1000000;

        // 可选挂到已有算法
        let algoId = b.saveAlgorithmId;
        if (algoId) {
            const row = db.prepare('SELECT algorithm_id FROM algorithms WHERE algorithm_id=?').get(algoId);
            if (!row) algoId = null;
        }

        const result = await runEngineSync(b.code, startDate, endDate, capital);
        if (result.code !== 0 || !result.data) {
            return res.status(400).json({ code: -1, message: result.message || '回测失败', detail: result.message });
        }

        // 持久化（沿用现有表结构）
        let backtestId = null;
        if (b.persist !== false) {
            backtestId = crypto.randomBytes(16).toString('hex');
            const name = b.name || ('AI-' + new Date().toISOString().slice(0, 16));
            if (!algoId) {
                algoId = crypto.randomBytes(16).toString('hex');
                db.prepare('INSERT INTO algorithms (algorithm_id, user_id, name, description) VALUES (?, 1, ?, ?)')
                  .run(algoId, name, 'AI 自动创建');
            }
            db.prepare("INSERT INTO backtests (backtest_id, algorithm_id, algorithm_name, start_date, end_date, capital_base, frequency, status, progress) VALUES (?, ?, ?, ?, ?, ?, 'day', 'done', 100)")
              .run(backtestId, algoId, name, startDate, endDate, capital);
            db.prepare("INSERT INTO backtest_code (backtest_id, language, code, code_hash) VALUES (?, 'python', ?, ?)")
              .run(backtestId, b.code, String(backtestId).slice(0, 64));
            queries.saveBacktestResult(backtestId, result);
        }

        const SAMPLE = b.dailyRecordsLimit != null ? Math.min(Number(b.dailyRecordsLimit), 3000) : 30;
        res.json({
            code: 0,
            data: {
                backtestId,
                metrics: result.data,
                dailyRecords: (result.dailyRecords || []).slice(-SAMPLE),
                tradesRecent: (result.trades || []).slice(-50),
                logsTail: (result.logs || []).slice(-100),
                message: result.message,
            },
            message: '回测完成',
        });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

/**
 * GET /api/ai/engine-docs
 * 机器可读的策略 API 参考（AI 写策略前调用一次即可）。
 */
app.get('/api/ai/engine-docs', (req, res) => {
    res.json({ code: 0, data: getEngineDocsData(), message: 'success' });
});

function getEngineDocsData() {
    return {
        strategyApi: {
            set_benchmark: { sig: "set_benchmark(code)", desc: '设置基准指数，如 000300.XSHG / 000905.XSHG / 399006.XSHE' },
            set_slippage: { sig: "set_slippage(FixedSlippage(v))", desc: '固定滑点比例，常用 0.002 或 0.02' },
            set_order_cost: { sig: "set_order_cost(OrderCost(open_tax=0, close_tax=0.001, open_commission=0.0003, close_commission=0.0003, min_commission=5))", desc: '交易成本；基金自动免印花税' },
            run_daily: { sig: "run_daily(fn)", desc: '注册每日回调 fn(context)' },
            run_weekly: { sig: "run_weekly(fn, weekday=1)", desc: '每周 isoweekday==weekday 的交易日回调（1=周一…5=周五）' },
            run_monthly: { sig: "run_monthly(fn, monthday=1)", desc: '每月 day==monthday 的交易日回调，月末兜底触发' },
            attribute_history: { sig: "attribute_history(stock, count, unit='1d', fields=('close',))", desc: '单股历史K线（截至上一交易日）。fields 支持 close/open/high/low/volume/money，high/low 为真实值。返回 SeriesDict：hist[\"close\"].mean() / hist.close[-1]' },
            get_price: { sig: "get_price([stocks], end_date=None, count=20, fields=['close'])", desc: '批量历史价格 {stock: {close:[], dates:[]}}' },
            get_current_data: { sig: "get_current_data()", desc: 'cd[s].paused/is_st/name/last_price/day_open/high_limit/low_limit（当日快照，含持仓与近期涉及股票）' },
            get_all_stocks: { sig: "get_all_stocks(date=None)", desc: '全A可交易股（已剔 ST/停牌/次新<120日/B股/北交所/金融股）' },
            get_index_stocks: { sig: "get_index_stocks(index_code)", desc: "指数成分近似：000300→市值前300、000905→301~800、000852→801~1800、000016→沪市前50、000001/399106→全市场代理。⚠️ 市值排名近似而非官方成分" },
            get_fundamentals: { sig: "get_fundamentals(query(...).filter(...).order_by(valuation.x.asc()).limit(n), date=None)", desc: '基本面截面 → pandas DataFrame（列名=字段名）。常用：valuation.market_cap/pe_ratio/pb_ratio/circulating_market_cap/capitalization；indicator.roe/inc_net_profit_year_on_year/inc_revenue_year_on_year/gross_profit_margin；income.net_profit/revenue；balance.total_assets/net_assets' },
            query_dsl: { desc: 'query 列对象：valuation/indicator/balance/income/cash_flow。指标类字段为百分数口径（10.47=10.47%）。支持 .in_(list)/比较/order_by(col.asc()/desc())/limit(n)；条件 filter(a>5, b<10) 为 AND' },
            get_factor_values: { sig: "get_factor_values(securities, factors, count=N)", desc: '因子时间序列 {sec: {factor: Series}}，可用因子见 GET /api/factors' },
            history: { sig: "history(count, unit='1d', field='close', security_list=[...])", desc: '多证券历史 DataFrame(index=日期, columns=证券)。field: close/open/high/low/money' },
            order_target_value: { sig: "order_target_value(stock, value)", desc: '调到目标市值(元)。0=清仓。涨停拒买/跌停拒卖由引擎自动执行' },
            order_value: { sig: "order_value(stock, delta_value)", desc: '增量下单（正买负卖，以当前市值为基准增减）' },
            order_target: { sig: "order_target(stock, shares)", desc: '调到目标股数（0=清仓）' },
            order_shares: { sig: "order_shares(stock, delta_shares)", desc: '增量按股数下单' },
            order_target_percent: { sig: "order_target_percent(stock, pct)", desc: '调整到占总资产 pct 比例（等权调仓利器）' },
            record: { sig: "record(**kw)", desc: '空操作（可视化占位）' },
            log_api: { sig: "log.info(msg) / log.warn / log.error", desc: '日志。⚠️ 禁止 print()——会污染 stdout 导致回测解析失败' },
            g_context: { desc: 'g=全局参数容器; context.portfolio.{total_value,cash,positions}; context.current_dt; context.previous_date; positions[s].{price,avg_cost,amount,value,closeable_amount}' },
            tradable_funds: { desc: '基金(ETF/LOF)代码：沪 51xxxx/56xxxx/58xxxx、深 15xxxx/16xxxx（fund_daily 表 195 只已回填）。基金免印花税、涨跌停±10%' },
        },
        conventions: [
            '股票代码格式带后缀：000001.XSHE / 600519.XSHG',
            '价格采用原始不复权价；除息日分红由引擎自动入账（dretwd-dretnd 反推）',
            '涨跌停约束：收盘触板拒单自动执行（主板±10% 创业/科创±20%）',
            '撮合在日线收盘价，无分钟级模拟',
            '基本面字段基于报告期+4个月滞后对齐（防未来函数）',
            '本地无退市股 → 长周期小市值策略收益偏乐观（幸存者偏差），结论需声明',
            '指数成分是市值排名近似（非官方名单）',
        ],
        workflow: [
            'GET /api/factors 看可用因子（可选）',
            "POST /api/ai/backtest 一次调用跑完（body.code 必须含 def initialize(context)）",
            '需完整日线时用返回的 data.backtestId 调 GET /api/backtest/:id/returns',
        ],
    };
}

/**
 * GET /api/factors
 * 可用因子清单（名称/方向/数据源/参数/公式说明），来自 factor_registry.json。
 */
app.get('/api/factors', (req, res) => {
    try {
        const fs = require('fs');
        const regPath = path.join(__dirname, '..', 'scripts', 'factor_registry.json');
        const reg = JSON.parse(fs.readFileSync(regPath, 'utf8')).factors;
        const data = Object.entries(reg).map(([name, spec]) => ({
            name,
            direction: spec.direction,
            source: spec.data_source,
            params: spec.params || {},
            desc: spec.desc,
        }));
        res.json({ code: 0, data, message: 'success' });
    } catch (err) {
        res.status(500).json({ code: -1, message: err.message });
    }
});

// ==================== 启动服务 ====================

app.listen(PORT, () => {
    console.log(`\n  🚀 量化回测平台服务已启动!`);
    console.log(`  📡 服务地址: http://localhost:${PORT}`);
    console.log(`  💾 数据库: data/backtest.db`);
    console.log(`  \n  可用接口:\n`);
    console.log(`    GET  /api/algorithm/list              - 策略列表`);
    console.log(`    GET  /api/backtest/:id/summary         - 回测概要`);
    console.log(`    GET  /api/backtest/:id/returns         - 策略收益`);
    console.log(`    GET  /api/backtest/:id/trades          - 交易详情`);
    console.log(`    GET  /api/backtest/:id/positions       - 每日持仓收益`);
    console.log(`    GET  /api/backtest/:id/benchmark       - 基准收益`);
    console.log(`    GET  /api/backtest/:id/logs            - 日志输出`);
    console.log(`    GET  /api/backtest/:id/code            - 策略代码`);
    console.log(`    GET  /api/backtest/:id/export?type=    - 导出数据`);
    console.log(`  \n  📈 股票日线数据接口:\n`);
    console.log(`    GET  /api/stock/:code/daily?start=&end= - 股票日线`);
    console.log(`    POST /api/stock/batch/daily            - 批量查询`);
    console.log(`    GET  /api/stock/market/:date           - 全市场快照`);
    console.log(`    GET  /api/stock/search?q=              - 搜索股票`);
    console.log(`    GET  /api/stock/:code/return?start=&end=- 收益率计算`);
    console.log(`    GET  /api/calendar?year=               - 交易日历`);
    console.log(`    GET  /api/stats                        - 数据库统计\n`);
});