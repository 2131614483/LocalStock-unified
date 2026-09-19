/**
 * CSMAR 日个股回报率数据导入脚本
 * 
 * 从 D:\pythonpro\股票日数据 目录读取 CSV 文件
 * 导入到 data/stock_data.db 数据库
 * 
 * 运行: node scripts/import-csmar.js
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { initStockDb, importMethods } = require('../server/stock-db');

// CSMAR 数据目录
const CSMAR_DIR = 'D:\\pythonpro\\股票日数据';
const BATCH_SIZE = 10000;   // 每批插入行数
const TOTAL_EXPECTED = 18517305; // 已知总行数

// ==================== CSV 解析 ====================

/** 将 CSMAR CSV 行解析为 stock_daily 表所需的格式 */
function parseRow(fields, headers) {
    const row = {};
    for (let i = 0; i < headers.length; i++) {
        const val = fields[i] ? fields[i].trim().replace(/^"|"$/g, '') : '';
        const header = headers[i].trim().replace(/^"|"$/g, '');
        row[header] = val;
    }

    // 跳过空行或表头重复行
    if (!row.Stkcd || row.Stkcd === 'Stkcd') return null;

    // 空值处理
    const n = (v) => (v === '' || v === undefined ? null : v);
    const f = (v) => (v === '' || v === undefined ? null : parseFloat(v));
    const i = (v) => (v === '' || v === undefined ? null : parseInt(v, 10));

    return {
        stock_code: row.Stkcd,
        trade_date: row.Trddt,
        open_price: f(row.Opnprc),
        high_price: f(row.Hiprc),
        low_price: f(row.Loprc),
        close_price: f(row.Clsprc),
        pre_close_price: f(row.PreClosePrice),
        change_ratio: f(row.ChangeRatio),
        volume: f(row.Dnshrtrd),
        amount: f(row.Dnvaltrd),
        dretwd: f(row.Dretwd),
        dretnd: f(row.Dretnd),
        adj_close_wd: f(row.Adjprcwd),
        adj_close_nd: f(row.Adjprcnd),
        mkt_cap_float: f(row.Dsmvosd),
        mkt_cap_total: f(row.Dsmvtll),
        market_type: i(row.Markettype),
        trade_status: i(row.Trdsta),
        limit_up: f(row.LimitUp),
        limit_down: f(row.LimitDown),
        limit_status: i(row.LimitStatus),
    };
}

// ==================== 导入器 ====================

class CsmrImporter {
    constructor() {
        this.db = initStockDb();
        this.totalRows = 0;
        this.batchRows = 0;
        this.fileCount = 0;
        this.buffer = [];
        this.startTime = Date.now();
    }

    /** 导入一个 CSV 文件 */
    async importFile(filePath) {
        return new Promise((resolve, reject) => {
            const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
            const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

            let headers = [];
            let lineCount = 0;

            rl.on('line', (line) => {
                if (!line.trim()) return;

                const fields = line.split(',');

                if (headers.length === 0) {
                    headers = fields;
                    return;
                }

                lineCount++;
                const parsed = parseRow(fields, headers);
                if (!parsed) return;

                this.buffer.push(parsed);

                if (this.buffer.length >= BATCH_SIZE) {
                    this.flushBuffer();
                }
            });

            rl.on('close', () => {
                this.fileCount++;
                this.totalRows += lineCount;
                console.log(`  [${this.fileCount}] 完成: ${path.basename(filePath)} (${lineCount.toLocaleString()} 行)`);
                resolve(lineCount);
            });

            rl.on('error', reject);
        });
    }

    /** 将缓冲区写入数据库 */
    flushBuffer() {
        if (this.buffer.length === 0) return;
        this.batchRows += this.buffer.length;
        importMethods.insertDailyBatch(this.buffer);
        
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        const rate = (this.batchRows / (Date.now() - this.startTime) * 1000).toFixed(0);
        process.stdout.write(`\r  已导入: ${this.batchRows.toLocaleString()} 行 | 速率: ${rate} 行/秒 | 耗时: ${elapsed}s`);
        
        this.buffer = [];
    }

    /** 查找所有 CSV 文件 */
    findCsvFiles() {
        const results = [];
        const items = fs.readdirSync(CSMAR_DIR);
        
        for (const item of items) {
            const itemPath = path.join(CSMAR_DIR, item);
            if (fs.statSync(itemPath).isDirectory()) {
                const csvFiles = fs.readdirSync(itemPath)
                    .filter(f => f.match(/^TRD_Dalyr\d*\.csv$/i))
                    .map(f => path.join(itemPath, f));
                results.push(...csvFiles);
            }
        }
        
        return results.sort();
    }

    /** 执行完整导入流程 */
    async run() {
        console.log('========================================');
        console.log('  CSMAR 日个股回报率数据导入工具');
        console.log('========================================\n');
        console.log(`数据目录: ${CSMAR_DIR}`);
        console.log(`目标数据库: ${path.join(__dirname, '..', 'data', 'stock_data.db')}`);
        console.log(`每批写入: ${BATCH_SIZE.toLocaleString()} 行\n`);

        // 1. 查找 CSV 文件
        const csvFiles = this.findCsvFiles();
        console.log(`找到 ${csvFiles.length} 个 CSV 文件\n`);

        // 2. 逐个导入
        for (let i = 0; i < csvFiles.length; i++) {
            await this.importFile(csvFiles[i]);
        }

        // 3. 写入剩余数据
        this.flushBuffer();
        
        const totalElapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        console.log(`\n\n✅ 数据导入完成!`);
        console.log(`   总行数: ${this.totalRows.toLocaleString()}`);
        console.log(`   总文件: ${this.fileCount}`);
        console.log(`   总耗时: ${totalElapsed}s`);
        console.log(`   平均速率: ${(this.totalRows / totalElapsed).toFixed(0)} 行/秒`);

        // 4. 提取股票信息和交易日历
        console.log('\n--- 后续处理 ---');
        importMethods.extractStocks();
        importMethods.extractCalendar();

        // 5. 打印统计
        const stats = importMethods.getStats();
        console.log('\n--- 数据库统计 ---');
        console.log(`   股票数量: ${stats.stocks.toLocaleString()}`);
        console.log(`   日线记录: ${stats.dailyRecords.toLocaleString()}`);
        console.log(`   交易日数: ${stats.calendarDays.toLocaleString()}`);
        console.log(`   日期范围: ${stats.startDate} ~ ${stats.endDate}`);
        console.log(`   数据库大小: ${(stats.fileSize / 1024 / 1024).toFixed(2)} MB\n`);
    }
}

// ==================== 执行 ====================

const importer = new CsmrImporter();
importer.run().catch(err => {
    console.error('\n❌ 导入失败:', err.message);
    process.exit(1);
});