/**
 * 股票日线数据库模块
 * 管理 CSMAR 日个股回报率数据
 * 
 * 数据库: SQLite (data/stock_data.db)
 * 驱动: better-sqlite3
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.LOCALSTOCK_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.LOCALSTOCK_MARKET_DB || path.join(DATA_DIR, 'stock_data.db');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ==================== 建表脚本 ====================

const STOCK_DDL = `
PRAGMA foreign_keys = ON;

-- 股票基本信息表
CREATE TABLE IF NOT EXISTS stocks (
    id                INTEGER      PRIMARY KEY AUTOINCREMENT,
    stock_code        VARCHAR(6)   NOT NULL UNIQUE,
    market_type       TINYINT      NOT NULL,
    market_name       VARCHAR(16)  DEFAULT NULL,
    name              VARCHAR(32)  DEFAULT NULL,
    first_trade_date  DATE         DEFAULT NULL,
    last_trade_date   DATE         DEFAULT NULL,
    status            TINYINT      DEFAULT 1,
    created_at        DATETIME     DEFAULT (datetime('now'))
);

-- 日线数据主表（核心表）
CREATE TABLE IF NOT EXISTS stock_daily (
    id                INTEGER      PRIMARY KEY AUTOINCREMENT,
    stock_code        VARCHAR(6)   NOT NULL,
    trade_date        DATE         NOT NULL,
    open_price        DECIMAL(10,3) DEFAULT NULL,
    high_price        DECIMAL(10,3) DEFAULT NULL,
    low_price         DECIMAL(10,3) DEFAULT NULL,
    close_price       DECIMAL(10,3) DEFAULT NULL,
    pre_close_price   DECIMAL(10,3) DEFAULT NULL,
    change_ratio      DECIMAL(8,6)  DEFAULT NULL,
    volume            BIGINT        DEFAULT 0,
    amount            DECIMAL(16,2) DEFAULT 0,
    dretwd            DECIMAL(10,6) DEFAULT NULL,
    dretnd            DECIMAL(10,6) DEFAULT NULL,
    adj_close_wd      DECIMAL(10,3) DEFAULT NULL,
    adj_close_nd      DECIMAL(10,3) DEFAULT NULL,
    mkt_cap_float     DECIMAL(16,2) DEFAULT NULL,
    mkt_cap_total     DECIMAL(16,2) DEFAULT NULL,
    market_type       TINYINT       DEFAULT NULL,
    trade_status      TINYINT       DEFAULT NULL,
    limit_up          DECIMAL(10,3) DEFAULT NULL,
    limit_down        DECIMAL(10,3) DEFAULT NULL,
    limit_status      TINYINT       DEFAULT 0,
    UNIQUE(stock_code, trade_date)
);

-- 核心索引
CREATE INDEX IF NOT EXISTS idx_sd_code_date 
    ON stock_daily(stock_code, trade_date);
CREATE INDEX IF NOT EXISTS idx_sd_date 
    ON stock_daily(trade_date);
CREATE INDEX IF NOT EXISTS idx_sd_code 
    ON stock_daily(stock_code);

-- 交易日历
CREATE TABLE IF NOT EXISTS trade_calendar (
    id              INTEGER   PRIMARY KEY AUTOINCREMENT,
    trade_date      DATE      NOT NULL UNIQUE,
    is_trading_day  TINYINT   NOT NULL DEFAULT 1,
    year            INTEGER   DEFAULT NULL,
    month           INTEGER   DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_tc_year ON trade_calendar(year);
`;

// ==================== 初始化 ====================

let db;

function initStockDb() {
    db = new Database(DB_PATH);
    
    // 性能优化配置
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -16000');
    db.pragma('temp_store = MEMORY');
    db.pragma('mmap_size = 268435456');
    db.pragma('foreign_keys = ON');

    db.exec(STOCK_DDL);
    console.log(`[StockDB] 数据库初始化完成: ${DB_PATH}`);

    return db;
}

// ==================== 数据导入方法 ====================

const importMethods = {
    /**
     * 批量插入日线数据（事务包装）
     * @param {Array} rows - 数据行数组
     */
    insertDailyBatch(rows) {
        if (rows.length === 0) return;
        
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO stock_daily (
                stock_code, trade_date,
                open_price, high_price, low_price, close_price,
                pre_close_price, change_ratio,
                volume, amount,
                dretwd, dretnd,
                adj_close_wd, adj_close_nd,
                mkt_cap_float, mkt_cap_total,
                market_type, trade_status,
                limit_up, limit_down, limit_status
            ) VALUES (
                @stock_code, @trade_date,
                @open_price, @high_price, @low_price, @close_price,
                @pre_close_price, @change_ratio,
                @volume, @amount,
                @dretwd, @dretnd,
                @adj_close_wd, @adj_close_nd,
                @mkt_cap_float, @mkt_cap_total,
                @market_type, @trade_status,
                @limit_up, @limit_down, @limit_status
            )
        `);

        const insertBatch = db.transaction((batch) => {
            for (const row of batch) {
                stmt.run(row);
            }
        });

        insertBatch(rows);
    },

    /**
     * 从 stock_daily 提取股票基本信息
     */
    extractStocks() {
        console.log('[StockDB] 正在提取股票基本信息...');
        db.exec(`
            INSERT OR IGNORE INTO stocks (stock_code, market_type, market_name, first_trade_date, last_trade_date, status)
            SELECT 
                stock_code,
                market_type,
                CASE market_type
                    WHEN 1 THEN '上证A股'
                    WHEN 2 THEN '上证B股'
                    WHEN 4 THEN '深证A股'
                    WHEN 8 THEN '深证B股'
                    WHEN 16 THEN '创业板'
                    WHEN 32 THEN '科创板'
                    WHEN 64 THEN '北证A股'
                    ELSE '其他'
                END AS market_name,
                MIN(trade_date) AS first_trade_date,
                MAX(trade_date) AS last_trade_date,
                1 AS status
            FROM stock_daily
            GROUP BY stock_code, market_type
            ON CONFLICT(stock_code) DO UPDATE SET
                market_type = excluded.market_type,
                market_name = excluded.market_name,
                first_trade_date = excluded.first_trade_date,
                last_trade_date = excluded.last_trade_date
        `);
        const count = db.prepare('SELECT COUNT(*) AS cnt FROM stocks').get();
        console.log(`[StockDB] 股票基本信息提取完成: ${count.cnt} 只`);
    },

    /**
     * 从 stock_daily 提取交易日历
     */
    extractCalendar() {
        console.log('[StockDB] 正在提取交易日历...');
        db.exec(`
            INSERT OR IGNORE INTO trade_calendar (trade_date, is_trading_day, year, month)
            SELECT DISTINCT 
                trade_date,
                1 AS is_trading_day,
                CAST(strftime('%Y', trade_date) AS INTEGER) AS year,
                CAST(strftime('%m', trade_date) AS INTEGER) AS month
            FROM stock_daily
            ORDER BY trade_date
        `);
        const count = db.prepare('SELECT COUNT(*) AS cnt FROM trade_calendar').get();
        console.log(`[StockDB] 交易日历提取完成: ${count.cnt} 个交易日`);
    },

    /**
     * 获取数据统计
     */
    getStats() {
        const stockCount = db.prepare('SELECT COUNT(*) AS cnt FROM stocks').get().cnt;
        const dailyCount = db.prepare('SELECT COUNT(*) AS cnt FROM stock_daily').get().cnt;
        const dateRange = db.prepare(`
            SELECT MIN(trade_date) AS min_date, MAX(trade_date) AS max_date 
            FROM stock_daily
        `).get();
        const calCount = db.prepare('SELECT COUNT(*) AS cnt FROM trade_calendar').get().cnt;
        
        return {
            stocks: stockCount,
            dailyRecords: dailyCount,
            calendarDays: calCount,
            startDate: dateRange.min_date,
            endDate: dateRange.max_date,
            fileSize: fs.statSync(DB_PATH).size,
        };
    },
};

// ==================== 查询方法 ====================

const queries = {
    /**
     * 查询单只股票日线数据
     * @param {string} code - 股票代码
     * @param {string} startDate - 开始日期 YYYY-MM-DD
     * @param {string} endDate - 结束日期 YYYY-MM-DD
     * @param {string[]} fields - 返回字段，默认关键字段
     */
    getDailyData(code, startDate, endDate, fields) {
        startDate = startDate || '1990-01-01';
        endDate = endDate || '2099-12-31';
        const cols = fields ? fields.join(',') : 'stock_code, trade_date, open_price, high_price, low_price, close_price, volume, amount, dretwd, adj_close_wd, mkt_cap_total';
        return db.prepare(`
            SELECT ${cols}
            FROM stock_daily
            WHERE stock_code = ? AND trade_date BETWEEN ? AND ?
            ORDER BY trade_date ASC
        `).all(code, startDate, endDate);
    },

    /**
     * 批量查询多只股票
     * @param {string[]} codes - 股票代码数组
     * @param {string} startDate
     * @param {string} endDate
     */
    getMultiStockData(codes, startDate, endDate) {
        if (!codes.length) return {};
        startDate = startDate || '1990-01-01';
        endDate = endDate || '2099-12-31';
        
        const placeholders = codes.map(() => '?').join(',');
        const rows = db.prepare(`
            SELECT stock_code, trade_date, close_price, dretwd, adj_close_wd, volume, mkt_cap_total
            FROM stock_daily
            WHERE stock_code IN (${placeholders})
              AND trade_date BETWEEN ? AND ?
            ORDER BY stock_code, trade_date ASC
        `).all(...codes, startDate, endDate);

        // 按股票代码分组
        const result = {};
        for (const row of rows) {
            if (!result[row.stock_code]) result[row.stock_code] = [];
            result[row.stock_code].push(row);
        }
        return result;
    },

    /**
     * 查询某日全市场数据
     * @param {string} date
     */
    getMarketDataByDate(date) {
        return db.prepare(`
            SELECT s.*, st.market_name
            FROM stock_daily s
            LEFT JOIN stocks st ON s.stock_code = st.stock_code
            WHERE s.trade_date = ?
            ORDER BY s.mkt_cap_total DESC
        `).all(date);
    },

    /**
     * 计算某只股票的年化收益率
     * @param {string} code
     * @param {string} startDate
     * @param {string} endDate
     */
    calculateReturn(code, startDate, endDate) {
        const first = db.prepare(`
            SELECT trade_date, close_price FROM stock_daily
            WHERE stock_code = ? AND trade_date >= ?
            ORDER BY trade_date ASC LIMIT 1
        `).get(code, startDate);

        const last = db.prepare(`
            SELECT trade_date, close_price FROM stock_daily
            WHERE stock_code = ? AND trade_date <= ?
            ORDER BY trade_date DESC LIMIT 1
        `).get(code, endDate);

        if (!first || !last) return null;

        const days = (new Date(last.trade_date) - new Date(first.trade_date)) / (1000 * 60 * 60 * 24);
        const years = days / 365;
        const totalReturn = last.close_price / first.close_price - 1;
        const annualReturn = Math.pow(1 + totalReturn, 1 / years) - 1;

        return {
            stockCode: code,
            startDate: first.trade_date,
            endDate: last.trade_date,
            startPrice: first.close_price,
            endPrice: last.close_price,
            totalReturn,
            annualReturn,
            years: Math.round(years * 100) / 100,
        };
    },

    /**
     * 获取交易日历
     */
    getTradeCalendar(year) {
        if (year) {
            return db.prepare(`
                SELECT trade_date FROM trade_calendar
                WHERE year = ? AND is_trading_day = 1
                ORDER BY trade_date
            `).all(year).map(r => r.trade_date);
        }
        return db.prepare(`
            SELECT trade_date FROM trade_calendar
            WHERE is_trading_day = 1
            ORDER BY trade_date
        `).all().map(r => r.trade_date);
    },

    /** 获取交易日历范围（最早/最晚交易日） */
    getCalendarRange() {
        return db.prepare(`
            SELECT MIN(trade_date) AS min_date, MAX(trade_date) AS max_date, COUNT(*) AS total
            FROM trade_calendar WHERE is_trading_day = 1
        `).get();
    },

    /** 获取某月的交易日（返回 YYYY-MM-DD 数组） */
    getTradeDaysByMonth(year, month) {
        return db.prepare(`
            SELECT trade_date FROM trade_calendar
            WHERE year = ? AND month = ? AND is_trading_day = 1
            ORDER BY trade_date
        `).all(year, month).map(r => r.trade_date);
    },

    /** 判断某日是否为交易日 */
    isTradeDay(date) {
        const row = db.prepare(`
            SELECT is_trading_day FROM trade_calendar WHERE trade_date = ?
        `).get(date);
        return row ? !!row.is_trading_day : false;
    },

    /**
     * 搜索股票
     */
    searchStocks(keyword) {
        return db.prepare(`
            SELECT stock_code, market_name, first_trade_date, last_trade_date
            FROM stocks
            WHERE stock_code LIKE ? OR name LIKE ?
            ORDER BY stock_code
            LIMIT 50
        `).all(`%${keyword}%`, `%${keyword}%`);
    },

    /**
     * 查询指数日线数据
     */
    getIndexDaily(code, startDate, endDate) {
        return db.prepare(`
            SELECT index_code, trade_date, open_index, high_index, low_index, close_index, return_index
            FROM index_daily
            WHERE index_code = ? AND trade_date >= ? AND trade_date <= ?
            ORDER BY trade_date ASC
        `).all(code, startDate, endDate);
    },

    /**
     * 搜索指数
     */
    searchIndex(keyword) {
        return db.prepare(`
            SELECT i.index_code, i.index_name, i.start_date, i.base_date
            FROM index_info i
            WHERE i.index_code LIKE ? OR i.index_name LIKE ?
            ORDER BY i.index_code
            LIMIT 50
        `).all(`%${keyword}%`, `%${keyword}%`);
    },

    /**
     * 获取无风险利率
     */
    getRiskFreeRate(startDate, endDate) {
        return db.prepare(`
            SELECT nrr_type, end_date, rate, daily_rate, weekly_rate, monthly_rate
            FROM risk_free_rate
            WHERE end_date >= ? AND end_date <= ?
            ORDER BY end_date ASC
        `).all(startDate, endDate);
    },

    /**
     * 获取市场回报率
     */
    getMarketDaily(startDate, endDate) {
        return db.prepare(`
            SELECT market_type, trade_date, ret_wd_tl, ret_md_tl, ret_wd_os, ret_md_os
            FROM market_daily
            WHERE trade_date >= ? AND trade_date <= ?
            ORDER BY trade_date ASC
        `).all(startDate, endDate);
    },
};

// ==================== 导出 ====================

module.exports = {
    initStockDb,
    get db() { return db; },
    importMethods,
    queries,
};
