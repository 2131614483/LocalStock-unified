/**
 * 轻量提取交易日历：只读取 CSMAR CSV 的 Trddt 列，写入 trade_calendar
 * 远快于完整导入（跳过所有行情字段）
 *
 * 运行: node scripts/extract-calendar.js
 */
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { initStockDb, db: getDb } = require('../server/stock-db');

const CSMAR_DIR = 'D:\\pythonpro\\股票日数据';

async function run() {
    const db = initStockDb();
    console.log('=== 轻量提取交易日历 ===\n');

    // 清空旧数据
    db.prepare('DELETE FROM trade_calendar').run();
    console.log('已清空旧日历数据\n');

    // 查找所有 CSV
    const csvFiles = [];
    for (const dir of fs.readdirSync(CSMAR_DIR)) {
        const dirPath = path.join(CSMAR_DIR, dir);
        if (fs.statSync(dirPath).isDirectory()) {
            for (const f of fs.readdirSync(dirPath)) {
                if (/^TRD_Dalyr\d*\.csv$/i.test(f)) csvFiles.push(path.join(dirPath, f));
            }
        }
    }
    csvFiles.sort();
    console.log(`找到 ${csvFiles.length} 个 CSV 文件\n`);

    // 收集所有日期
    const dateSet = new Set();
    let fileIdx = 0;
    for (const csv of csvFiles) {
        fileIdx++;
        await new Promise((resolve) => {
            const rl = readline.createInterface({
                input: fs.createReadStream(csv, { encoding: 'utf-8' }),
                crlfDelay: Infinity,
            });
            let headers = [];
            let dateCol = -1;
            let count = 0;
            rl.on('line', (line) => {
                if (!line.trim()) return;
                const fields = line.split(',');
                if (headers.length === 0) {
                    headers = fields.map(h => h.trim().replace(/^"|"$/g, ''));
                    dateCol = headers.indexOf('Trddt');
                    return;
                }
                if (dateCol >= 0 && fields[dateCol]) {
                    const d = fields[dateCol].trim().replace(/^"|"$/g, '');
                    if (d) dateSet.add(d);
                    count++;
                }
            });
            rl.on('close', () => {
                console.log(`  [${fileIdx}/${csvFiles.length}] ${path.basename(csv)} -> ${count.toLocaleString()} 行`);
                resolve();
            });
        });
    }

    console.log(`\n共 ${dateSet.size} 个不同交易日`);

    // 批量写入 trade_calendar
    const insert = db.prepare(
        `INSERT OR IGNORE INTO trade_calendar (trade_date, is_trading_day, year, month) VALUES (?, 1, ?, ?)`
    );
    const insertBatch = db.transaction((dates) => {
        for (const d of dates) {
            insert.run(d, parseInt(d.slice(0, 4)), parseInt(d.slice(5, 7)));
        }
    });
    const sortedDates = [...dateSet].sort();
    insertBatch(sortedDates);

    const range = db.prepare(`SELECT MIN(trade_date) min, MAX(trade_date) max, COUNT(*) cnt FROM trade_calendar`).get();
    console.log(`\n✅ 交易日历写入完成: ${range.cnt} 个交易日`);
    console.log(`   范围: ${range.min} ~ ${range.max}`);
}

run().catch(err => { console.error(err); process.exit(1); });
