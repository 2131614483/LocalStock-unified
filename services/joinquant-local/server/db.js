/**
 * 数据库初始化模块
 * 使用 better-sqlite3 管理 SQLite 数据库
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.LOCALSTOCK_RUNTIME_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'backtest.db');

// 确保 data 目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ==================== 建表 DDL ====================

const CREATE_TABLES_SQL = `
-- 开启外键约束
PRAGMA foreign_keys = ON;

-- 5.1 用户表
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        VARCHAR(64)  NOT NULL UNIQUE,
    email           VARCHAR(128) UNIQUE,
    password_hash   VARCHAR(256) NOT NULL,
    avatar          VARCHAR(256) DEFAULT NULL,
    created_at      DATETIME     NOT NULL DEFAULT (datetime('now')),
    updated_at      DATETIME     NOT NULL DEFAULT (datetime('now'))
);

-- 5.2 策略表
CREATE TABLE IF NOT EXISTS algorithms (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    algorithm_id    VARCHAR(64)  NOT NULL UNIQUE,
    user_id         INTEGER      NOT NULL REFERENCES users(id),
    name            VARCHAR(128) NOT NULL,
    description     TEXT         DEFAULT NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive')),
    created_at      DATETIME     NOT NULL DEFAULT (datetime('now')),
    updated_at      DATETIME     NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_algorithms_user_id 
    ON algorithms(user_id);

-- 5.3 回测主表（核心表）
CREATE TABLE IF NOT EXISTS backtests (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    backtest_id                 VARCHAR(64)  NOT NULL UNIQUE,
    algorithm_id                VARCHAR(64)  NOT NULL REFERENCES algorithms(algorithm_id),
    algorithm_name              VARCHAR(128) NOT NULL,
    start_date                  DATE         NOT NULL,
    end_date                    DATE         NOT NULL,
    capital_base                DECIMAL(16,2) NOT NULL,
    frequency                   VARCHAR(8)   NOT NULL DEFAULT 'day'
                                    CHECK (frequency IN ('day', 'minute')),
    status                      VARCHAR(16)  NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'running', 'done', 'failed')),
    progress                    TINYINT      NOT NULL DEFAULT 0
                                    CHECK (progress >= 0 AND progress <= 100),
    -- 风险指标（回测完成后填写）
    total_returns               DECIMAL(10,6) DEFAULT NULL,
    annual_returns              DECIMAL(10,6) DEFAULT NULL,
    max_drawdown                DECIMAL(10,6) DEFAULT NULL,
    sharpe                      DECIMAL(8,4)  DEFAULT NULL,
    volatility                  DECIMAL(10,6) DEFAULT NULL,
    alpha                       DECIMAL(8,4)  DEFAULT NULL,
    beta                        DECIMAL(8,4)  DEFAULT NULL,
    information_ratio           DECIMAL(8,4)  DEFAULT NULL,
    win_rate                    DECIMAL(8,4)  DEFAULT NULL,
    trading_days                INTEGER       DEFAULT 0,
    -- 基准信息
    benchmark_name              VARCHAR(64)   DEFAULT '沪深300指数',
    benchmark_code              VARCHAR(16)   DEFAULT '000300.XSHG',
    benchmark_total_returns     DECIMAL(10,6) DEFAULT NULL,
    benchmark_annual_returns    DECIMAL(10,6) DEFAULT NULL,
    benchmark_max_drawdown      DECIMAL(10,6) DEFAULT NULL,
    benchmark_volatility        DECIMAL(10,6) DEFAULT NULL,
    -- 时间戳
    created_at                  DATETIME     NOT NULL DEFAULT (datetime('now')),
    started_at                  DATETIME     DEFAULT NULL,
    finished_at                 DATETIME     DEFAULT NULL,
    updated_at                  DATETIME     NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_backtests_algorithm_id 
    ON backtests(algorithm_id);
CREATE INDEX IF NOT EXISTS idx_backtests_status 
    ON backtests(status);

-- 5.4 每日收益记录表（数据量最大）
CREATE TABLE IF NOT EXISTS daily_records (
    id                  INTEGER      PRIMARY KEY AUTOINCREMENT,
    backtest_id         VARCHAR(64)  NOT NULL REFERENCES backtests(backtest_id),
    trade_date          DATE         NOT NULL,
    daily_return        DECIMAL(10,6) NOT NULL,
    cumulative_return   DECIMAL(10,6) NOT NULL,
    total_assets        DECIMAL(16,2) DEFAULT NULL,
    available_cash      DECIMAL(16,2) DEFAULT NULL,
    position_value      DECIMAL(16,2) DEFAULT NULL,
    UNIQUE(backtest_id, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_records_backtest_id 
    ON daily_records(backtest_id);
CREATE INDEX IF NOT EXISTS idx_daily_records_trade_date 
    ON daily_records(trade_date);

-- 5.5 交易记录表
CREATE TABLE IF NOT EXISTS trades (
    id              INTEGER      PRIMARY KEY AUTOINCREMENT,
    backtest_id     VARCHAR(64)  NOT NULL REFERENCES backtests(backtest_id),
    trade_date      DATE         NOT NULL,
    trade_time      TIME         DEFAULT NULL,
    stock_code      VARCHAR(16)  NOT NULL,
    stock_name      VARCHAR(32)  NOT NULL,
    direction       VARCHAR(4)   NOT NULL CHECK (direction IN ('buy', 'sell')),
    price           DECIMAL(10,3) NOT NULL,
    volume          INTEGER      NOT NULL,
    amount          DECIMAL(16,2) NOT NULL,
    commission      DECIMAL(10,2) NOT NULL DEFAULT 0,
    tax             DECIMAL(10,2) NOT NULL DEFAULT 0,
    profit          DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at      DATETIME     NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trades_backtest_id 
    ON trades(backtest_id);
CREATE INDEX IF NOT EXISTS idx_trades_trade_date 
    ON trades(trade_date);
CREATE INDEX IF NOT EXISTS idx_trades_stock_code 
    ON trades(stock_code);

-- 5.6 每日持仓表
CREATE TABLE IF NOT EXISTS positions (
    id              INTEGER      PRIMARY KEY AUTOINCREMENT,
    backtest_id     VARCHAR(64)  NOT NULL REFERENCES backtests(backtest_id),
    trade_date      DATE         NOT NULL,
    stock_code      VARCHAR(16)  NOT NULL,
    stock_name      VARCHAR(32)  NOT NULL,
    volume          INTEGER      NOT NULL,
    current_price   DECIMAL(10,3) NOT NULL,
    cost_price      DECIMAL(10,3) NOT NULL,
    market_value    DECIMAL(16,2) NOT NULL,
    profit          DECIMAL(10,2) NOT NULL,
    profit_rate     DECIMAL(10,6) NOT NULL,
    weight          DECIMAL(6,4) NOT NULL,
    UNIQUE(backtest_id, trade_date, stock_code)
);
CREATE INDEX IF NOT EXISTS idx_positions_backtest_id 
    ON positions(backtest_id);

-- 5.7 日志表
CREATE TABLE IF NOT EXISTS logs (
    id              INTEGER      PRIMARY KEY AUTOINCREMENT,
    backtest_id     VARCHAR(64)  NOT NULL REFERENCES backtests(backtest_id),
    log_date        DATE         NOT NULL,
    log_time        TIME         NOT NULL,
    level           VARCHAR(8)   NOT NULL 
                        CHECK (level IN ('info', 'warning', 'error', 'debug')),
    message         TEXT         NOT NULL,
    created_at      DATETIME     NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_backtest_id 
    ON logs(backtest_id);
CREATE INDEX IF NOT EXISTS idx_logs_level 
    ON logs(level);

-- 5.8 策略代码表（1:1 with backtests）
CREATE TABLE IF NOT EXISTS backtest_code (
    id              INTEGER      PRIMARY KEY AUTOINCREMENT,
    backtest_id     VARCHAR(64)  NOT NULL UNIQUE REFERENCES backtests(backtest_id),
    language        VARCHAR(16)  NOT NULL DEFAULT 'python',
    code            TEXT         NOT NULL,
    code_hash       VARCHAR(64)  NOT NULL,
    created_at      DATETIME     NOT NULL DEFAULT (datetime('now')),
    updated_at      DATETIME     NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_code_hash 
    ON backtest_code(code_hash);

-- 5.9 基准每日数据表
CREATE TABLE IF NOT EXISTS benchmark_daily_records (
    id                  INTEGER      PRIMARY KEY AUTOINCREMENT,
    backtest_id         VARCHAR(64)  NOT NULL REFERENCES backtests(backtest_id),
    trade_date          DATE         NOT NULL,
    daily_return        DECIMAL(10,6) NOT NULL,
    cumulative_return   DECIMAL(10,6) NOT NULL,
    excess_return       DECIMAL(10,6) NOT NULL,
    close_price         DECIMAL(10,3) DEFAULT NULL,
    UNIQUE(backtest_id, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_backtest_id 
    ON benchmark_daily_records(backtest_id);
`;

// ==================== 种子数据 ====================

const SEED_DATA_SQL = `
-- 插入示例用户
INSERT OR IGNORE INTO users (id, username, email, password_hash) VALUES
(1, 'trader001', 'trader@example.com', 'hash_placeholder');

-- 插入示例策略
INSERT OR IGNORE INTO algorithms (id, algorithm_id, user_id, name, description) VALUES
(1, '4e5d0fa0f1dc303f9de6377e53c2064d', 1, '价值投资策略',  '低市盈率+高ROE选股'),
(2, '9587ef3ae77e63836b79ddbbb903980c', 1, '动量策略',      '趋势跟踪+动量因子'),
(3, 'cdfabeb2fdbd3e2a4289b70e3818445e', 1, '均值回归策略',  '布林带均值回归');

-- 插入示例回测
INSERT OR IGNORE INTO backtests (
    id, backtest_id, algorithm_id, algorithm_name,
    start_date, end_date, capital_base, frequency, status, progress,
    total_returns, annual_returns, max_drawdown, sharpe, volatility,
    alpha, beta, information_ratio, win_rate, trading_days
) VALUES (
    1,
    '886dc04e9fe1547dac9b4b43d647ae9d',
    '4e5d0fa0f1dc303f9de6377e53c2064d',
    '价值投资策略',
    '2023-01-01', '2023-12-31', 1000000, 'day', 'done', 100,
    0.2568, 0.1234, -0.1532, 1.28, 0.2156,
    0.0645, 0.8923, 0.45, 0.523, 242
);

-- 为演示回测补齐策略代码：双均线交叉策略
INSERT OR IGNORE INTO backtest_code (
    backtest_id, language, code, code_hash
) VALUES (
    '886dc04e9fe1547dac9b4b43d647ae9d',
    'python',
    'def initialize(context):\n    set_benchmark(''000300.XSHG'')\n    set_slippage(FixedSlippage(0.002))\n    set_order_cost(OrderCost(close_tax=0.001, open_commission=0.0003, close_commission=0.0003, min_commission=5), type=''stock'')\n    g.short_window = 5\n    g.long_window = 20\n    g.stocks = [''000001.XSHE'', ''600519.XSHG'', ''000858.XSHE'', ''601318.XSHG'', ''000333.XSHE'']\n    log.info(''双均线交叉策略初始化完成'')\n    run_daily(rebalance, time=''09:30'')\n\ndef rebalance(context):\n    target_weight = 1.0 / len(g.stocks)\n    for stock in g.stocks:\n        hist = attribute_history(stock, g.long_window + 1, ''1d'', (''close'',))\n        short_ma = hist[''close''][-g.short_window:].mean()\n        long_ma = hist[''close''][-g.long_window:].mean()\n        held = stock in context.portfolio.positions\n        if short_ma > long_ma and not held:\n            order_target_value(stock, context.portfolio.total_value * target_weight)\n            log.info(''金叉买入 %s'' % stock)\n        elif short_ma < long_ma and held:\n            order_target(stock, 0)\n            log.info(''死叉卖出 %s'' % stock)\n\ndef after_trading_end(context):\n    log.info(''当日持仓: %s'' % list(context.portfolio.positions.keys()))',
    'demo-seed-code'
);
`;

// ==================== 初始化数据库 ====================

const BACKTEST_ID = '886dc04e9fe1547dac9b4b43d647ae9d';

let db;

function initDatabase() {
    db = new Database(DB_PATH);
    
    // 启用 WAL 模式，提升并发性能
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // 执行建表
    db.exec(CREATE_TABLES_SQL);
    console.log('[DB] 数据库表初始化完成');

    // 插入种子数据
    db.exec(SEED_DATA_SQL);
    console.log('[DB] 种子数据插入完成');

    // 补充明细演示数据（每日收益、交易、持仓、日志、基准）
    seedDetailData();

    return db;
}

// ==================== 演示明细数据生成 ====================

/**
 * 为示例回测生成明细数据，避免"有指标无明细"的自相矛盾。
 * 仅在 daily_records 为空时执行，确保可重复运行。
 */
function seedDetailData() {
    const cnt = db.prepare(
        'SELECT COUNT(*) AS c FROM daily_records WHERE backtest_id = ?'
    ).get(BACKTEST_ID);
    if (cnt.c > 0) return;

    const TRADING_DAYS = 242;
    const TARGET_TOTAL = 0.2568;   // 与 backtests.total_returns 一致
    const BENCH_TOTAL = 0.1050;    // 基准总收益

    // 生成 2023 年交易日（跳过周末），按本地日期格式化避免时区偏移
    const dates = [];
    const cursor = new Date('2023-01-03T00:00:00');
    const fmtDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    while (dates.length < TRADING_DAYS) {
        const dow = cursor.getDay();
        if (dow !== 0 && dow !== 6) dates.push(fmtDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }

    // 确定性伪随机，保证可重复
    let seed = 20230103;
    const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };

    // 策略日收益率：均值 = ln(1+TARGET)/N，叠加噪声
    const meanLog = Math.log(1 + TARGET_TOTAL) / TRADING_DAYS;
    const rawDaily = [];
    for (let i = 0; i < TRADING_DAYS; i++) {
        rawDaily.push(meanLog + (rand() - 0.5) * 0.02);
    }
    // 归一化使最终累计精确等于 TARGET_TOTAL
    const actualLog = rawDaily.reduce((s, r) => s + Math.log(1 + r), 0);
    const adj = (Math.log(1 + TARGET_TOTAL) - actualLog) / TRADING_DAYS;
    const dailyReturns = rawDaily.map(r => Math.exp(Math.log(1 + r) + adj) - 1);

    // 累计收益率
    let cum = 0;
    const cumulativeReturns = dailyReturns.map(r => {
        cum = (1 + cum) * (1 + r) - 1;
        return cum;
    });

    // 基准日收益率
    const benchMeanLog = Math.log(1 + BENCH_TOTAL) / TRADING_DAYS;
    const rawBench = [];
    for (let i = 0; i < TRADING_DAYS; i++) {
        rawBench.push(benchMeanLog + (rand() - 0.5) * 0.012);
    }
    const bActualLog = rawBench.reduce((s, r) => s + Math.log(1 + r), 0);
    const bAdj = (Math.log(1 + BENCH_TOTAL) - bActualLog) / TRADING_DAYS;
    const benchDaily = rawBench.map(r => Math.exp(Math.log(1 + r) + bAdj) - 1);
    let bCum = 0;
    const benchCum = benchDaily.map(r => {
        bCum = (1 + bCum) * (1 + r) - 1;
        return bCum;
    });

    const insertDetail = db.transaction(() => {
        const drStmt = db.prepare(
            `INSERT OR REPLACE INTO daily_records
                (backtest_id, trade_date, daily_return, cumulative_return, total_assets, available_cash, position_value)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        const bmStmt = db.prepare(
            `INSERT OR REPLACE INTO benchmark_daily_records
                (backtest_id, trade_date, daily_return, cumulative_return, excess_return, close_price)
             VALUES (?, ?, ?, ?, ?, ?)`
        );
        let assets = 1000000;
        for (let i = 0; i < TRADING_DAYS; i++) {
            assets = assets * (1 + dailyReturns[i]);
            drStmt.run(
                BACKTEST_ID, dates[i],
                +dailyReturns[i].toFixed(6),
                +cumulativeReturns[i].toFixed(6),
                +assets.toFixed(2),
                +(assets * 0.1).toFixed(2),
                +(assets * 0.9).toFixed(2)
            );
            bmStmt.run(
                BACKTEST_ID, dates[i],
                +benchDaily[i].toFixed(6),
                +benchCum[i].toFixed(6),
                +(dailyReturns[i] - benchDaily[i]).toFixed(6),
                +(3000 * (1 + benchCum[i])).toFixed(3)
            );
        }
    });
    insertDetail();

    // 交易记录：每月调仓，买卖 3 只股票
    const stocks = [
        { code: '000001.XSHE', name: '平安银行' },
        { code: '600519.XSHG', name: '贵州茅台' },
        { code: '000858.XSHE', name: '五粮液' },
        { code: '601318.XSHG', name: '中国平安' },
        { code: '000333.XSHE', name: '美的集团' },
    ];
    const insertTrades = db.transaction(() => {
        const tradeStmt = db.prepare(
            `INSERT INTO trades
                (backtest_id, trade_date, trade_time, stock_code, stock_name, direction,
                 price, volume, amount, commission, tax, profit)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        // 每月首个交易日调仓
        const monthFirst = [];
        dates.forEach(dd => {
            const m = dd.slice(5, 7);
            if (!monthFirst.find(x => x.month === m)) monthFirst.push({ month: m, date: dd });
        });
        monthFirst.forEach((md, idx) => {
            stocks.slice(0, 3).forEach((s, si) => {
                const isBuy = (idx + si) % 2 === 0;
                const price = +(20 + rand() * 30).toFixed(3);
                const volume = Math.floor(1000 / price) * 100;
                tradeStmt.run(
                    BACKTEST_ID, md.date, '09:35:00', s.code, s.name,
                    isBuy ? 'buy' : 'sell', price, volume,
                    +(price * volume).toFixed(2),
                    +(price * volume * 0.0003).toFixed(2),
                    isBuy ? 0 : +(price * volume * 0.001).toFixed(2),
                    +((rand() - 0.4) * 5000).toFixed(2)
                );
            });
        });
    });
    insertTrades();

    // 持仓记录：每季度末快照
    const insertPositions = db.transaction(() => {
        const posStmt = db.prepare(
            `INSERT OR REPLACE INTO positions
                (backtest_id, trade_date, stock_code, stock_name, volume,
                 current_price, cost_price, market_value, profit, profit_rate, weight)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const quarterTargets = ['2023-03-31', '2023-06-30', '2023-09-30', '2023-12-29'];
        quarterTargets.forEach(qt => {
            const target = dates.find(x => x >= qt) || dates[dates.length - 1];
            stocks.forEach((s, si) => {
                const price = +(20 + rand() * 30).toFixed(3);
                const cost = +(price * (0.9 + rand() * 0.2)).toFixed(3);
                const volume = 1000;
                const mv = +(price * volume).toFixed(2);
                const profit = +((price - cost) * volume).toFixed(2);
                posStmt.run(
                    BACKTEST_ID, target, s.code, s.name, volume,
                    price, cost, mv, profit,
                    +(profit / (cost * volume)).toFixed(6),
                    +(0.2 - si * 0.03).toFixed(4)
                );
            });
        });
    });
    insertPositions();

    // 日志记录
    const insertLogs = db.transaction(() => {
        const logStmt = db.prepare(
            `INSERT INTO logs (backtest_id, log_date, log_time, level, message)
             VALUES (?, ?, ?, ?, ?)`
        );
        const samples = [
            { idx: 0, time: '09:30:00', level: 'info', message: '回测启动，初始资金 1,000,000' },
            { idx: 0, time: '09:31:00', level: 'info', message: '加载策略: 价值投资策略' },
            { idx: 5, time: '09:35:00', level: 'info', message: '执行月度调仓' },
            { idx: 20, time: '14:50:00', level: 'warning', message: '持仓集中度超过 30%' },
            { idx: 40, time: '09:32:00', level: 'info', message: '执行月度调仓' },
            { idx: 60, time: '10:15:00', level: 'error', message: '停牌股票跳过: 000333.XSHE' },
            { idx: 100, time: '09:35:00', level: 'info', message: '执行月度调仓' },
            { idx: 150, time: '09:35:00', level: 'info', message: '执行月度调仓' },
            { idx: 200, time: '15:00:00', level: 'info', message: '回测即将结束' },
            { idx: TRADING_DAYS - 1, time: '15:00:00', level: 'info', message: `回测结束，总收益 ${(TARGET_TOTAL * 100).toFixed(2)}%` },
        ];
        samples.forEach(l => logStmt.run(
            BACKTEST_ID, dates[l.idx], l.time, l.level, l.message
        ));
    });
    insertLogs();

    // 回填基准风险指标
    db.prepare(
        `UPDATE backtests SET
            benchmark_total_returns = ?,
            benchmark_annual_returns = ?,
            benchmark_max_drawdown = ?,
            benchmark_volatility = ?
         WHERE backtest_id = ?`
    ).run(+BENCH_TOTAL.toFixed(6), +BENCH_TOTAL.toFixed(6), -0.0820, 0.1650, BACKTEST_ID);

    console.log('[DB] 演示明细数据生成完成');
}

// ==================== 本地模拟回测引擎 ====================

/**
 * 本地模拟回测：基于策略参数生成回测数据。
 * 由于本地无真实行情数据，使用确定性伪随机模拟双均线策略的收益曲线与交易。
 * @param {string} backtestId 回测ID
 * @param {object} params { shortWindow, longWindow, capitalBase, startDate, endDate, volatility }
 * @returns {object} 回测摘要指标
 */
function runBacktestSimulation(backtestId, params = {}) {
    const bt = db.prepare(`SELECT * FROM backtests WHERE backtest_id = ?`).get(backtestId);
    if (!bt) return null;

    const shortWindow = params.shortWindow || 5;
    const longWindow = params.longWindow || 20;
    const capitalBase = params.capitalBase || bt.capital_base || 1000000;
    const startDate = params.startDate || bt.start_date || '2023-01-03';
    const endDate = params.endDate || bt.end_date || '2023-12-29';
    // 策略年化波动率（用户可调）
    const annualVol = params.volatility || 0.22;

    // 生成交易日
    const dates = [];
    const cursor = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    const fmtDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    while (cursor <= end) {
        const dow = cursor.getDay();
        if (dow !== 0 && dow !== 6) dates.push(fmtDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    const N = dates.length;

    // 确定性伪随机（种子含 shortWindow/longWindow，参数变化结果变化）
    let seed = [shortWindow, longWindow, dates.length].reduce((s, v) => s * 31 + v, 7);
    const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };

    // 模拟每只股票的价格路径（几何布朗运动）
    const stocks = [
        { code: '000001.XSHE', name: '平安银行' },
        { code: '600519.XSHG', name: '贵州茅台' },
        { code: '000858.XSHE', name: '五粮液' },
        { code: '601318.XSHG', name: '中国平安' },
        { code: '000333.XSHE', name: '美的集团' },
    ];
    const dailyVol = annualVol / Math.sqrt(N);
    const pricePaths = stocks.map(s => {
        const path = [20 + rand() * 30];
        for (let i = 1; i < N; i++) {
            const drift = 0.0003 + (rand() - 0.5) * 0.001;
            path.push(path[i - 1] * Math.exp(drift + (rand() - 0.5) * 2 * dailyVol));
        }
        return path;
    });

    // 计算每只股票的短期/长期均线，生成金叉/死叉信号
    const signals = stocks.map((_, si) => {
        const sig = new Array(N).fill(0);
        for (let i = longWindow; i < N; i++) {
            let shortSum = 0, longSum = 0;
            for (let j = i - shortWindow + 1; j <= i; j++) shortSum += pricePaths[si][j];
            for (let j = i - longWindow + 1; j <= i; j++) longSum += pricePaths[si][j];
            const shortMa = shortSum / shortWindow;
            const longMa = longSum / longWindow;
            const prevShort = sig[i - 1] >= 0 ? 1 : 0;
            // 持有状态：金叉后持有，死叉后空仓
            sig[i] = shortMa > longMa ? 1 : 0;
        }
        return sig;
    });

    // 模拟组合：等权持有信号为1的股票，每日调仓
    const targetWeight = 1.0 / stocks.length;
    const dailyReturns = new Array(N).fill(0);
    const heldStates = stocks.map(() => false);
    const trades = [];
    const positions = [];
    let assets = capitalBase;

    for (let i = 0; i < N; i++) {
        let portReturn = 0;
        let heldCount = 0;
        signals.forEach((sig, si) => {
            heldCount += sig[i];
        });
        // 当日收益：持有股票等权贡献
        stocks.forEach((s, si) => {
            if (i > 0 && signals[si][i - 1] === 1) {
                const stockRet = pricePaths[si][i] / pricePaths[si][i - 1] - 1;
                portReturn += stockRet * targetWeight;
            }
        });
        // 扣除交易成本（换仓日）
        let turnover = 0;
        stocks.forEach((s, si) => {
            const shouldHold = signals[si][i] === 1;
            if (shouldHold !== heldStates[si]) {
                turnover += targetWeight;
                heldStates[si] = shouldHold;
                const price = +pricePaths[si][i].toFixed(3);
                const value = assets * targetWeight;
                const volume = Math.max(100, Math.floor(value / price / 100) * 100);
                trades.push({
                    date: dates[i], time: '09:30:00', stock: s.code, stockName: s.name,
                    direction: shouldHold ? 'buy' : 'sell', price, volume,
                    amount: +(price * volume).toFixed(2),
                    commission: +(price * volume * 0.0003).toFixed(2),
                    tax: shouldHold ? 0 : +(price * volume * 0.001).toFixed(2),
                    profit: shouldHold ? 0 : +((rand() - 0.45) * value * 0.05).toFixed(2),
                });
            }
        });
        portReturn -= turnover * 0.0015; // 佣金+滑点
        dailyReturns[i] = portReturn;
        assets = assets * (1 + portReturn);

        // 季度末记录持仓快照
        const mmdd = dates[i].slice(5);
        if (mmdd === '03-31' || mmdd === '06-30' || mmdd === '09-30' || i === N - 1) {
            stocks.forEach((s, si) => {
                if (heldStates[si]) {
                    const price = +pricePaths[si][i].toFixed(3);
                    const cost = +(price * (0.97 + rand() * 0.06)).toFixed(3);
                    const volume = 1000;
                    positions.push({
                        date: dates[i], stock: s.code, stockName: s.name, volume,
                        price, cost, marketValue: +(price * volume).toFixed(2),
                        profit: +((price - cost) * volume).toFixed(2),
                        profitRate: +((price - cost) / cost).toFixed(6),
                        weight: +targetWeight.toFixed(4),
                    });
                }
            });
        }
    }

    // 累计收益
    let cum = 0;
    const cumulativeReturns = dailyReturns.map(r => { cum = (1 + cum) * (1 + r) - 1; return cum; });
    const totalReturns = cum;

    // 基准：沪深300模拟
    const benchDaily = new Array(N).fill(0);
    let bCum = 0;
    for (let i = 0; i < N; i++) {
        benchDaily[i] = 0.0002 + (rand() - 0.5) * dailyVol * 1.2;
        bCum = (1 + bCum) * (1 + benchDaily[i]) - 1;
        benchDaily[i] = +benchDaily[i].toFixed(6);
    }
    let bCum2 = 0;
    const benchCum = benchDaily.map(r => { bCum2 = (1 + bCum2) * (1 + r) - 1; return +bCum2.toFixed(6); });

    // 风险指标
    const meanDaily = dailyReturns.reduce((s, r) => s + r, 0) / N;
    const variance = dailyReturns.reduce((s, r) => s + (r - meanDaily) ** 2, 0) / N;
    const volatility = Math.sqrt(variance * N);
    const annualReturns = Math.exp(Math.log(1 + totalReturns) * (252 / N)) - 1;

    // 最大回撤
    let peak = 0, maxDD = 0;
    cumulativeReturns.forEach(v => { peak = Math.max(peak, v); maxDD = Math.min(maxDD, v - peak); });

    // 夏普比率（无风险利率3%）
    const sharpe = (annualReturns - 0.03) / (volatility || 1);

    // 日志
    const logs = [
        { idx: 0, time: '09:30:00', level: 'info', message: `回测启动，初始资金 ${capitalBase.toLocaleString()}` },
        { idx: 0, time: '09:30:01', level: 'info', message: `双均线策略参数: short=${shortWindow}, long=${longWindow}` },
        { idx: Math.floor(N * 0.1), time: '09:30:00', level: 'info', message: '检测到金叉信号: 000001.XSHE' },
        { idx: Math.floor(N * 0.25), time: '14:50:00', level: 'warning', message: '持仓集中度较高' },
        { idx: Math.floor(N * 0.5), time: '09:30:00', level: 'info', message: '检测到死叉信号: 600519.XSHG' },
        { idx: Math.floor(N * 0.7), time: '10:15:00', level: 'error', message: '停牌股票跳过: 000333.XSHE' },
        { idx: N - 1, time: '15:00:00', level: 'info', message: `回测结束，总收益 ${(totalReturns * 100).toFixed(2)}%` },
    ];

    // 写入数据库（先清旧数据）
    const writeTx = db.transaction(() => {
        db.prepare(`DELETE FROM daily_records WHERE backtest_id = ?`).run(backtestId);
        db.prepare(`DELETE FROM trades WHERE backtest_id = ?`).run(backtestId);
        db.prepare(`DELETE FROM positions WHERE backtest_id = ?`).run(backtestId);
        db.prepare(`DELETE FROM logs WHERE backtest_id = ?`).run(backtestId);
        db.prepare(`DELETE FROM benchmark_daily_records WHERE backtest_id = ?`).run(backtestId);

        const drStmt = db.prepare(`INSERT OR REPLACE INTO daily_records (backtest_id, trade_date, daily_return, cumulative_return, total_assets, available_cash, position_value) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const bmStmt = db.prepare(`INSERT OR REPLACE INTO benchmark_daily_records (backtest_id, trade_date, daily_return, cumulative_return, excess_return, close_price) VALUES (?, ?, ?, ?, ?, ?)`);
        let a = capitalBase;
        for (let i = 0; i < N; i++) {
            a = a * (1 + dailyReturns[i]);
            drStmt.run(backtestId, dates[i], +dailyReturns[i].toFixed(6), +cumulativeReturns[i].toFixed(6), +a.toFixed(2), +(a * 0.05).toFixed(2), +(a * 0.95).toFixed(2));
            bmStmt.run(backtestId, dates[i], benchDaily[i], benchCum[i], +(dailyReturns[i] - benchDaily[i]).toFixed(6), +(3000 * (1 + benchCum[i])).toFixed(3));
        }

        const tradeStmt = db.prepare(`INSERT INTO trades (backtest_id, trade_date, trade_time, stock_code, stock_name, direction, price, volume, amount, commission, tax, profit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        trades.forEach(t => tradeStmt.run(backtestId, t.date, t.time, t.stock, t.stockName, t.direction, t.price, t.volume, t.amount, t.commission, t.tax, t.profit));

        const posStmt = db.prepare(`INSERT OR REPLACE INTO positions (backtest_id, trade_date, stock_code, stock_name, volume, current_price, cost_price, market_value, profit, profit_rate, weight) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        positions.forEach(p => posStmt.run(backtestId, p.date, p.stock, p.stockName, p.volume, p.price, p.cost, p.marketValue, p.profit, p.profitRate, p.weight));

        const logStmt = db.prepare(`INSERT INTO logs (backtest_id, log_date, log_time, level, message) VALUES (?, ?, ?, ?, ?)`);
        logs.forEach(l => { const di = Math.min(l.idx, N - 1); logStmt.run(backtestId, dates[di], l.time, l.level, l.message); });

        // 更新回测主表指标
        db.prepare(`UPDATE backtests SET status='done', progress=100, total_returns=?, annual_returns=?, max_drawdown=?, sharpe=?, volatility=?, trading_days=?, finished_at=datetime('now'), updated_at=datetime('now'), benchmark_total_returns=?, benchmark_annual_returns=?, benchmark_max_drawdown=?, benchmark_volatility=? WHERE backtest_id=?`)
            .run(+totalReturns.toFixed(6), +annualReturns.toFixed(6), +maxDD.toFixed(6), +sharpe.toFixed(4), +volatility.toFixed(6), N,
                 +bCum2.toFixed(6), +bCum2.toFixed(6), -0.0820, 0.1650, backtestId);
    });
    writeTx();

    return {
        tradingDays: N,
        totalReturns: +totalReturns.toFixed(6),
        annualReturns: +annualReturns.toFixed(6),
        maxDrawdown: +maxDD.toFixed(6),
        sharpe: +sharpe.toFixed(4),
        volatility: +volatility.toFixed(6),
        tradesCount: trades.length,
        positionsCount: positions.length,
    };
}

// ==================== 数据访问方法 ====================

const queries = {
    /** 查询策略列表 */
    getAlgorithmList() {
        return db.prepare(`
            SELECT a.algorithm_id, a.name, a.description, a.created_at,
                   (SELECT b.backtest_id FROM backtests b WHERE b.algorithm_id = a.algorithm_id ORDER BY b.created_at DESC, b.id DESC LIMIT 1) AS backtest_id,
                   (SELECT b.total_returns FROM backtests b WHERE b.algorithm_id = a.algorithm_id ORDER BY b.created_at DESC, b.id DESC LIMIT 1) AS total_returns,
                   (SELECT b.status FROM backtests b WHERE b.algorithm_id = a.algorithm_id ORDER BY b.created_at DESC, b.id DESC LIMIT 1) AS backtest_status
            FROM algorithms a
            WHERE a.status = 'active'
            ORDER BY a.created_at DESC
        `).all();
    },

    /** 查询回测概要（含风险指标 + 基准指标） */
    getBacktestSummary(backtestId) {
        const row = db.prepare(`
            SELECT * FROM backtests WHERE backtest_id = ?
        `).get(backtestId);
        if (!row) return null;

        return {
            backtestId: row.backtest_id,
            algorithmId: row.algorithm_id,
            algorithmName: row.algorithm_name,
            startDate: row.start_date,
            endDate: row.end_date,
            capitalBase: row.capital_base,
            frequency: row.frequency === 'day' ? '日线' : '分钟',
            status: row.status,
            progress: row.progress,
            totalReturns: row.total_returns,
            annualReturns: row.annual_returns,
            maxDrawdown: row.max_drawdown,
            sharpe: row.sharpe,
            volatility: row.volatility,
            alpha: row.alpha,
            beta: row.beta,
            informationRatio: row.information_ratio,
            winRate: row.win_rate,
            tradingDays: row.trading_days,
            benchmarkName: row.benchmark_name,
            benchmarkCode: row.benchmark_code,
            benchmarkTotalReturns: row.benchmark_total_returns,
            benchmarkAnnualReturns: row.benchmark_annual_returns,
            benchmarkMaxDrawdown: row.benchmark_max_drawdown,
            benchmarkVolatility: row.benchmark_volatility,
        };
    },

    /** 查询策略收益（含时间序列） */
    getBacktestReturns(backtestId) {
        const bt = db.prepare(`SELECT * FROM backtests WHERE backtest_id = ?`).get(backtestId);
        if (!bt) return null;

        const rows = db.prepare(`
            SELECT trade_date, daily_return, cumulative_return
            FROM daily_records
            WHERE backtest_id = ?
            ORDER BY trade_date ASC
        `).all(backtestId);

        return {
            backtestId,
            totalReturns: bt.total_returns,
            annualReturns: bt.annual_returns,
            maxDrawdown: bt.max_drawdown,
            sharpe: bt.sharpe,
            volatility: bt.volatility,
            alpha: bt.alpha,
            beta: bt.beta,
            informationRatio: bt.information_ratio,
            winRate: bt.win_rate,
            tradingDays: bt.trading_days,
            dates: rows.map(r => r.trade_date),
            dailyReturns: rows.map(r => r.daily_return),
            cumulativeReturns: rows.map(r => r.cumulative_return),
        };
    },

    /** 查询交易记录 */
    getBacktestTrades(backtestId) {
        return db.prepare(`
            SELECT 
                trade_date AS date,
                trade_time AS time,
                stock_code AS stock,
                stock_name AS stockName,
                direction,
                price,
                volume,
                amount,
                commission,
                tax,
                profit
            FROM trades
            WHERE backtest_id = ?
            ORDER BY trade_date ASC, trade_time ASC
        `).all(backtestId);
    },

    /** 查询每日持仓 */
    getBacktestPositions(backtestId) {
        return db.prepare(`
            SELECT 
                trade_date AS date,
                stock_code AS stock,
                stock_name AS stockName,
                volume,
                current_price AS price,
                cost_price AS cost,
                market_value AS marketValue,
                profit,
                profit_rate AS profitRate,
                weight
            FROM positions
            WHERE backtest_id = ?
            ORDER BY trade_date ASC, weight DESC
        `).all(backtestId);
    },

    /** 查询基准收益（含时间序列） */
    getBacktestBenchmark(backtestId) {
        const bt = db.prepare(`SELECT * FROM backtests WHERE backtest_id = ?`).get(backtestId);
        if (!bt) return null;

        const drRows = db.prepare(`
            SELECT trade_date, daily_return
            FROM daily_records
            WHERE backtest_id = ?
            ORDER BY trade_date ASC
        `).all(backtestId);

        const bmRows = db.prepare(`
            SELECT trade_date, daily_return, cumulative_return, excess_return, close_price
            FROM benchmark_daily_records
            WHERE backtest_id = ?
            ORDER BY trade_date ASC
        `).all(backtestId);

        return {
            benchmarkName: bt.benchmark_name,
            benchmarkCode: bt.benchmark_code,
            totalReturns: bt.benchmark_total_returns,
            annualReturns: bt.benchmark_annual_returns,
            maxDrawdown: bt.benchmark_max_drawdown,
            volatility: bt.benchmark_volatility,
            dates: bmRows.map(r => r.trade_date),
            dailyReturns: bmRows.map(r => r.daily_return),
            cumulativeReturns: bmRows.map(r => r.cumulative_return),
            excessReturns: bmRows.length > 0
                ? bmRows.map(r => r.excess_return)
                : [],
        };
    },

    /** 查询日志 */
    getBacktestLogs(backtestId, level) {
        let sql = `
            SELECT 
                log_date AS date,
                log_time AS time,
                level,
                message
            FROM logs
            WHERE backtest_id = ?
        `;
        const params = [backtestId];

        if (level) {
            sql += ` AND level = ?`;
            params.push(level);
        }

        sql += ` ORDER BY log_date ASC, log_time ASC`;
        return db.prepare(sql).all(...params);
    },

    /** 查询策略代码 */
    getBacktestCode(backtestId) {
        const row = db.prepare(`
            SELECT language, code
            FROM backtest_code
            WHERE backtest_id = ?
        `).get(backtestId);

        return row || null;
    },

    /** 批量插入每日收益 */
    insertDailyRecords(backtestId, records) {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO daily_records 
                (backtest_id, trade_date, daily_return, cumulative_return, total_assets, available_cash, position_value)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const insertMany = db.transaction((rows) => {
            for (const r of rows) {
                stmt.run(backtestId, r.trade_date, r.daily_return, r.cumulative_return,
                    r.total_assets, r.available_cash, r.position_value);
            }
        });
        insertMany(records);
    },

    /** 批量插入交易记录 */
    insertTrades(backtestId, records) {
        const stmt = db.prepare(`
            INSERT INTO trades 
                (backtest_id, trade_date, trade_time, stock_code, stock_name, direction,
                 price, volume, amount, commission, tax, profit)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertMany = db.transaction((rows) => {
            for (const r of rows) {
                stmt.run(backtestId, r.date, r.time || null, r.stock, r.stockName, r.direction,
                    r.price, r.volume, r.amount, r.commission, r.tax, r.profit);
            }
        });
        insertMany(records);
    },

    /** 批量插入持仓记录 */
    insertPositions(backtestId, records) {
        const stmt = db.prepare(`
            INSERT INTO positions 
                (backtest_id, trade_date, stock_code, stock_name, volume,
                 current_price, cost_price, market_value, profit, profit_rate, weight)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertMany = db.transaction((rows) => {
            for (const r of rows) {
                stmt.run(backtestId, r.date, r.stock, r.stockName, r.volume,
                    r.price, r.cost, r.marketValue, r.profit, r.profitRate, r.weight);
            }
        });
        insertMany(records);
    },

    /** 批量插入日志 */
    insertLogs(backtestId, records) {
        const stmt = db.prepare(`
            INSERT INTO logs (backtest_id, log_date, log_time, level, message)
            VALUES (?, ?, ?, ?, ?)
        `);
        const insertMany = db.transaction((rows) => {
            for (const r of rows) {
                stmt.run(backtestId, r.date, r.time, r.level, r.message);
            }
        });
        insertMany(records);
    },

    /** 插入策略代码 */
    insertCode(backtestId, language, code) {
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(code).digest('hex');
        db.prepare(`
            INSERT OR REPLACE INTO backtest_code (backtest_id, language, code, code_hash)
            VALUES (?, ?, ?, ?)
        `).run(backtestId, language, code, hash);
    },

    /** 更新策略名称（同步更新 backtests.algorithm_name 与关联的 algorithms.name）*/
    updateStrategyName(backtestId, name) {
        if (!name || !name.trim()) return false;
        const cleanName = name.trim();
        const bt = db.prepare('SELECT algorithm_id FROM backtests WHERE backtest_id = ?').get(backtestId);
        if (!bt) return false;
        db.prepare(`UPDATE backtests SET algorithm_name = ?, updated_at = datetime('now') WHERE backtest_id = ?`)
            .run(cleanName, backtestId);
        db.prepare(`UPDATE algorithms SET name = ?, updated_at = datetime('now') WHERE algorithm_id = ?`)
            .run(cleanName, bt.algorithm_id);
        return true;
    },

    /** 更新回测状态和指标 */
    updateBacktestMetrics(backtestId, metrics) {
        db.prepare(`
            UPDATE backtests SET
                status = 'done',
                progress = 100,
                total_returns = ?,
                annual_returns = ?,
                max_drawdown = ?,
                sharpe = ?,
                volatility = ?,
                alpha = ?,
                beta = ?,
                information_ratio = ?,
                win_rate = ?,
                trading_days = ?,
                finished_at = datetime('now'),
                updated_at = datetime('now')
            WHERE backtest_id = ?
        `).run(
            metrics.totalReturns, metrics.annualReturns,
            metrics.maxDrawdown, metrics.sharpe, metrics.volatility,
            metrics.alpha, metrics.beta, metrics.informationRatio,
            metrics.winRate, metrics.tradingDays,
            backtestId
        );
    },

    /** 运行本地模拟回测 */
    runSimulation(backtestId, params) {
        return runBacktestSimulation(backtestId, params);
    },

    /** 保存真实回测引擎的结果到数据库 */
    /** 更新回测元数据（初始资金、日期范围） */
    updateBacktestMeta(backtestId, meta) {
        db.prepare(`UPDATE backtests SET capital_base=?, start_date=?, end_date=?, updated_at=datetime('now') WHERE backtest_id=?`)
            .run(meta.capital, meta.startDate, meta.endDate, backtestId);
    },

    saveBacktestResult(backtestId, result) {
        const writeTx = db.transaction(() => {
            // 清除旧数据
            db.prepare(`DELETE FROM daily_records WHERE backtest_id = ?`).run(backtestId);
            db.prepare(`DELETE FROM trades WHERE backtest_id = ?`).run(backtestId);
            db.prepare(`DELETE FROM positions WHERE backtest_id = ?`).run(backtestId);
            db.prepare(`DELETE FROM logs WHERE backtest_id = ?`).run(backtestId);
            db.prepare(`DELETE FROM benchmark_daily_records WHERE backtest_id = ?`).run(backtestId);

            // 写入每日记录
            const drStmt = db.prepare(`INSERT OR REPLACE INTO daily_records (backtest_id, trade_date, daily_return, cumulative_return, total_assets, available_cash, position_value) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            for (const r of (result.dailyRecords || [])) {
                drStmt.run(backtestId, r.date, r.daily_return, r.cumulative_return, r.total_assets, r.available_cash, r.position_value);
            }

            // 写入交易记录
            const tradeStmt = db.prepare(`INSERT INTO trades (backtest_id, trade_date, trade_time, stock_code, stock_name, direction, price, volume, amount, commission, tax, profit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const t of (result.trades || [])) {
                tradeStmt.run(backtestId, t.date, t.time, t.stock, t.stockName, t.direction, t.price, t.volume, t.amount, t.commission, t.tax, t.profit);
            }

            // 写入持仓快照
            const posStmt = db.prepare(`INSERT OR REPLACE INTO positions (backtest_id, trade_date, stock_code, stock_name, volume, current_price, cost_price, market_value, profit, profit_rate, weight) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const p of (result.positions || [])) {
                posStmt.run(backtestId, p.date, p.stock, p.stockName, p.volume, p.price, p.cost, p.marketValue, p.profit, p.profitRate, p.weight);
            }

            // 写入日志
            const logStmt = db.prepare(`INSERT INTO logs (backtest_id, log_date, log_time, level, message) VALUES (?, ?, ?, ?, ?)`);
            const logs = result.logs || [];
            const allDates = (result.dailyRecords || []).map(r => r.date);
            for (let i = 0; i < logs.length; i++) {
                const logDate = allDates[i % Math.max(allDates.length, 1)] || (result.dailyRecords && result.dailyRecords[0] && result.dailyRecords[0].date) || '2023-01-01';
                logStmt.run(backtestId, logDate, '09:30:00', logs[i].level, logs[i].message);
            }

            // 写入基准数据
            const bmStmt = db.prepare(`INSERT OR REPLACE INTO benchmark_daily_records (backtest_id, trade_date, daily_return, cumulative_return, excess_return, close_price) VALUES (?, ?, ?, ?, ?, ?)`);
            const bench = result.benchmark || {};
            const benchDates = bench.dates || [];
            const benchReturns = bench.dailyReturns || [];
            const excessReturns = bench.excessReturns || [];
            let benchCum = 0;
            let prevBenchRet = 0;
            const dailyRecs = result.dailyRecords || [];
            for (let i = 0; i < benchDates.length; i++) {
                const dr = benchReturns[i] || 0;
                benchCum = (1 + benchCum) * (1 + dr) - 1;
                const excess = excessReturns[i] || 0;
                const stratRet = dailyRecs[i] ? dailyRecs[i].daily_return : 0;
                bmStmt.run(backtestId, benchDates[i], +dr.toFixed(6), +benchCum.toFixed(6), +excess.toFixed(6), 3000 * (1 + benchCum));
            }

            // 更新回测主表指标（全部使用引擎计算的真实值，不再使用种子固定值）
            const d = result.data || {};
            db.prepare(`UPDATE backtests SET status='done', progress=100, total_returns=?, annual_returns=?, max_drawdown=?, sharpe=?, volatility=?, alpha=?, beta=?, information_ratio=?, win_rate=?, trading_days=?, finished_at=datetime('now'), updated_at=datetime('now'), benchmark_total_returns=?, benchmark_annual_returns=?, benchmark_max_drawdown=?, benchmark_volatility=? WHERE backtest_id=?`)
                .run(
                    d.totalReturns || 0, d.annualReturns || 0, d.maxDrawdown || 0,
                    d.sharpe || 0, d.volatility || 0,
                    d.alpha || 0, d.beta || 0, d.informationRatio || 0, d.winRate || 0,
                    d.tradingDays || 0,
                    d.benchmarkTotalReturns || 0, d.benchmarkAnnualReturns || 0,
                    d.benchmarkMaxDrawdown || 0, d.benchmarkVolatility || 0, backtestId
                );
        });
        writeTx();
    },
};

// ==================== 导出 ====================

module.exports = {
    initDatabase,
    get db() { return db; },
    queries,
    BACKTEST_ID,
};
