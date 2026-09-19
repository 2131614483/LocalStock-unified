"""
CSMAR 全量数据导入脚本（扩展版）
导入指数、市场回报率、无风险利率、周/月个股回报率、三大财务报表到 stock_data.db

运行: python scripts/import-csmar-full.py
"""
import os
import sqlite3
import csv
import time
from glob import glob

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'stock_data.db')
# CSMAR 数据根目录
CSMAR_ROOT = r'C:\Users\he\Downloads\数据下载解压'
BATCH_SIZE = 50000


def find_csv(keyword):
    """在 CSMAR_ROOT 下查找文件名包含 keyword 的 CSV 文件"""
    results = []
    for root, dirs, files in os.walk(CSMAR_ROOT):
        for f in files:
            if f.lower().endswith('.csv') and keyword.lower() in f.lower():
                results.append(os.path.join(root, f))
    results.sort()
    return results


def clean_val(v):
    """空字符串转 None，去除首尾空格"""
    if v is None:
        return None
    v = v.strip()
    if v == '':
        return None
    return v


def get_reader(filepath):
    """打开 CSV 文件，处理 BOM，返回 (reader, header)"""
    f = open(filepath, 'r', encoding='utf-8-sig', newline='')
    reader = csv.reader(f)
    header = next(reader)
    header = [h.strip() for h in header]
    return f, reader, header


def import_index_data(conn):
    """导入指数日线数据 TRD_Index"""
    print('\n=== 导入指数日线数据 ===')
    files = find_csv('TRD_Index')
    if not files:
        print('  未找到 TRD_Index.csv')
        return

    conn.execute('''
        CREATE TABLE IF NOT EXISTS index_daily (
            index_code      VARCHAR(8)   NOT NULL,
            trade_date      DATE         NOT NULL,
            day_of_week     INTEGER,
            open_index      DECIMAL(12,3),
            high_index      DECIMAL(12,3),
            low_index       DECIMAL(12,3),
            close_index     DECIMAL(12,3),
            return_index    DECIMAL(10,6),
            PRIMARY KEY (index_code, trade_date)
        )
    ''')
    conn.execute('DELETE FROM index_daily')
    conn.commit()

    total = 0
    for fp in files:
        f, reader, header = get_reader(fp)
        batch = []
        for row in reader:
            if len(row) < 8:
                continue
            batch.append((
                clean_val(row[0]), clean_val(row[1]), clean_val(row[2]),
                clean_val(row[3]), clean_val(row[4]), clean_val(row[5]),
                clean_val(row[6]), clean_val(row[7]),
            ))
            if len(batch) >= BATCH_SIZE:
                conn.executemany('INSERT OR REPLACE INTO index_daily VALUES (?,?,?,?,?,?,?,?)', batch)
                conn.commit()
                total += len(batch)
                batch = []
        if batch:
            conn.executemany('INSERT OR REPLACE INTO index_daily VALUES (?,?,?,?,?,?,?,?)', batch)
            conn.commit()
            total += len(batch)
        f.close()
        print(f'  {os.path.basename(fp)}: 累计 {total} 行')

    conn.execute('CREATE INDEX IF NOT EXISTS idx_index_date ON index_daily(trade_date)')
    conn.commit()
    print(f'  完成，共 {total} 行')


def import_index_info(conn):
    """导入指数基本信息 IDX_Idxinfo"""
    print('\n=== 导入指数基本信息 ===')
    files = find_csv('IDX_Idxinfo')
    if not files:
        print('  未找到 IDX_Idxinfo.csv')
        return

    conn.execute('''
        CREATE TABLE IF NOT EXISTS index_info (
            index_code      VARCHAR(8)   PRIMARY KEY,
            index_name      VARCHAR(64),
            start_date      DATE,
            base_date       DATE,
            base_value      DECIMAL(12,3),
            sample_range    TEXT,
            weight_method   INTEGER,
            publish_org     INTEGER,
            index_category  INTEGER,
            index_type      INTEGER,
            market          INTEGER,
            formula         TEXT
        )
    ''')
    conn.execute('DELETE FROM index_info')
    conn.commit()

    total = 0
    for fp in files:
        f, reader, header = get_reader(fp)
        batch = []
        for row in reader:
            if len(row) < 12:
                continue
            batch.append(tuple(clean_val(v) for v in row[:12]))
            if len(batch) >= BATCH_SIZE:
                conn.executemany('INSERT OR REPLACE INTO index_info VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', batch)
                conn.commit()
                total += len(batch)
                batch = []
        if batch:
            conn.executemany('INSERT OR REPLACE INTO index_info VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', batch)
            conn.commit()
            total += len(batch)
        f.close()
    print(f'  完成，共 {total} 行')


def import_market_daily(conn):
    """导入日市场回报率 TRD_Dalym"""
    print('\n=== 导入日市场回报率 ===')
    files = find_csv('TRD_Dalym')
    if not files:
        print('  未找到 TRD_Dalym.csv')
        return

    conn.execute('''
        CREATE TABLE IF NOT EXISTS market_daily (
            market_type     INTEGER      NOT NULL,
            trade_date      DATE         NOT NULL,
            total_shares    BIGINT,
            total_amount    DECIMAL(16,2),
            ret_wd_eq       DECIMAL(10,6),
            ret_md_eq       DECIMAL(10,6),
            ret_wd_os       DECIMAL(10,6),
            ret_md_os       DECIMAL(10,6),
            ret_wd_tl       DECIMAL(10,6),
            ret_md_tl       DECIMAL(10,6),
            stk_count       INTEGER,
            PRIMARY KEY (market_type, trade_date)
        )
    ''')
    conn.execute('DELETE FROM market_daily')
    conn.commit()

    total = 0
    for fp in files:
        f, reader, header = get_reader(fp)
        batch = []
        for row in reader:
            if len(row) < 11:
                continue
            batch.append(tuple(clean_val(v) for v in row[:11]))
            if len(batch) >= BATCH_SIZE:
                conn.executemany('INSERT OR REPLACE INTO market_daily VALUES (?,?,?,?,?,?,?,?,?,?,?)', batch)
                conn.commit()
                total += len(batch)
                batch = []
        if batch:
            conn.executemany('INSERT OR REPLACE INTO market_daily VALUES (?,?,?,?,?,?,?,?,?,?,?)', batch)
            conn.commit()
            total += len(batch)
        f.close()
    conn.execute('CREATE INDEX IF NOT EXISTS idx_market_date ON market_daily(trade_date)')
    conn.commit()
    print(f'  完成，共 {total} 行')


def import_risk_free_rate(conn):
    """导入无风险利率 TRD_Nrrate"""
    print('\n=== 导入无风险利率 ===')
    files = find_csv('TRD_Nrrate')
    if not files:
        print('  未找到 TRD_Nrrate.csv')
        return

    conn.execute('''
        CREATE TABLE IF NOT EXISTS risk_free_rate (
            nrr_type        VARCHAR(8)   NOT NULL,
            end_date        DATE         NOT NULL,
            rate            DECIMAL(10,6),
            daily_rate      DECIMAL(10,6),
            weekly_rate     DECIMAL(10,6),
            monthly_rate    DECIMAL(10,6),
            PRIMARY KEY (nrr_type, end_date)
        )
    ''')
    conn.execute('DELETE FROM risk_free_rate')
    conn.commit()

    total = 0
    for fp in files:
        f, reader, header = get_reader(fp)
        batch = []
        for row in reader:
            if len(row) < 6:
                continue
            batch.append(tuple(clean_val(v) for v in row[:6]))
            if len(batch) >= BATCH_SIZE:
                conn.executemany('INSERT OR REPLACE INTO risk_free_rate VALUES (?,?,?,?,?,?)', batch)
                conn.commit()
                total += len(batch)
                batch = []
        if batch:
            conn.executemany('INSERT OR REPLACE INTO risk_free_rate VALUES (?,?,?,?,?,?)', batch)
            conn.commit()
            total += len(batch)
        f.close()
    print(f'  完成，共 {total} 行')


def import_weekly_stock(conn):
    """导入周个股回报率 TRD_Week（含分卷文件）"""
    print('\n=== 导入周个股回报率 ===')
    files = find_csv('TRD_Week')
    if not files:
        print('  未找到 TRD_Week 文件')
        return

    conn.execute('''
        CREATE TABLE IF NOT EXISTS stock_weekly (
            stock_code      VARCHAR(6)   NOT NULL,
            trade_week      VARCHAR(8)   NOT NULL,
            open_date       DATE,
            week_open       DECIMAL(10,3),
            close_date      DATE,
            week_close      DECIMAL(10,3),
            week_shares     BIGINT,
            week_amount     DECIMAL(16,2),
            float_mv        DECIMAL(16,2),
            total_mv        DECIMAL(16,2),
            trade_days      INTEGER,
            ret_wd          DECIMAL(10,6),
            ret_nd          DECIMAL(10,6),
            market_type     INTEGER,
            capchg_date     DATE,
            ah_shares       BIGINT,
            ah_amount       DECIMAL(16,2),
            PRIMARY KEY (stock_code, trade_week)
        )
    ''')
    conn.execute('DELETE FROM stock_weekly')
    conn.commit()

    total = 0
    for fp in files:
        f, reader, header = get_reader(fp)
        batch = []
        for row in reader:
            if len(row) < 17:
                continue
            batch.append(tuple(clean_val(v) for v in row[:17]))
            if len(batch) >= BATCH_SIZE:
                conn.executemany('INSERT OR REPLACE INTO stock_weekly VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', batch)
                conn.commit()
                total += len(batch)
                batch = []
        if batch:
            conn.executemany('INSERT OR REPLACE INTO stock_weekly VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', batch)
            conn.commit()
            total += len(batch)
        f.close()
        print(f'  {os.path.basename(fp)}: 累计 {total} 行')

    conn.execute('CREATE INDEX IF NOT EXISTS idx_week_code ON stock_weekly(stock_code)')
    conn.commit()
    print(f'  完成，共 {total} 行')


def import_monthly_stock(conn):
    """导入月个股回报率 TRD_Mnth"""
    print('\n=== 导入月个股回报率 ===')
    files = find_csv('TRD_Mnth')
    if not files:
        print('  未找到 TRD_Mnth.csv')
        return

    conn.execute('''
        CREATE TABLE IF NOT EXISTS stock_monthly (
            stock_code      VARCHAR(6)   NOT NULL,
            trade_month     VARCHAR(8)   NOT NULL,
            open_day        VARCHAR(4),
            month_open      DECIMAL(10,3),
            close_day       VARCHAR(4),
            month_close     DECIMAL(10,3),
            month_shares    BIGINT,
            month_amount    DECIMAL(16,2),
            float_mv        DECIMAL(16,2),
            total_mv        DECIMAL(16,2),
            trade_days      INTEGER,
            ret_wd          DECIMAL(10,6),
            ret_nd          DECIMAL(10,6),
            market_type     INTEGER,
            capchg_date     DATE,
            ah_shares       BIGINT,
            ah_amount       DECIMAL(16,2),
            PRIMARY KEY (stock_code, trade_month)
        )
    ''')
    conn.execute('DELETE FROM stock_monthly')
    conn.commit()

    total = 0
    for fp in files:
        f, reader, header = get_reader(fp)
        batch = []
        for row in reader:
            if len(row) < 17:
                continue
            batch.append(tuple(clean_val(v) for v in row[:17]))
            if len(batch) >= BATCH_SIZE:
                conn.executemany('INSERT OR REPLACE INTO stock_monthly VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', batch)
                conn.commit()
                total += len(batch)
                batch = []
        if batch:
            conn.executemany('INSERT OR REPLACE INTO stock_monthly VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', batch)
            conn.commit()
            total += len(batch)
        f.close()
    conn.execute('CREATE INDEX IF NOT EXISTS idx_month_code ON stock_monthly(stock_code)')
    conn.commit()
    print(f'  完成，共 {total} 行')


def import_financial_statement(conn, table_name, file_keyword, num_cols):
    """通用财务报表导入（动态列）"""
    print(f'\n=== 导入{table_name} ===')
    files = find_csv(file_keyword)
    if not files:
        print(f'  未找到 {file_keyword} 文件')
        return

    # 读取第一个文件获取表头
    f0, reader0, header = get_reader(files[0])
    f0.close()

    # 动态建表：前6列固定，其余为科目代码列
    fixed_cols = ['stock_code', 'short_name', 'acc_period', 'report_type', 'if_correct', 'declare_date']
    dyn_cols = header[6:]
    all_cols = fixed_cols + dyn_cols
    col_defs = ', '.join([f'"{c}" TEXT' for c in all_cols])
    pk_cols = ', '.join([f'"{c}"' for c in all_cols[:4]])  # 前4列做联合主键

    conn.execute(f'DROP TABLE IF EXISTS {table_name}')
    conn.execute(f'CREATE TABLE {table_name} ({col_defs}, PRIMARY KEY ({pk_cols}))')

    total = 0
    for fp in files:
        f, reader, hdr = get_reader(fp)
        # 用当前文件的表头（可能不同文件列顺序一致）
        placeholders = ', '.join(['?' for _ in all_cols])
        batch = []
        for row in reader:
            # 补齐或截断到 all_cols 长度
            row_padded = list(row) + [None] * (len(all_cols) - len(row))
            batch.append(tuple(clean_val(v) for v in row_padded[:len(all_cols)]))
            if len(batch) >= BATCH_SIZE:
                conn.executemany(f'INSERT OR REPLACE INTO {table_name} VALUES ({placeholders})', batch)
                conn.commit()
                total += len(batch)
                batch = []
        if batch:
            conn.executemany(f'INSERT OR REPLACE INTO {table_name} VALUES ({placeholders})', batch)
            conn.commit()
            total += len(batch)
        f.close()
        print(f'  {os.path.basename(fp)}: 累计 {total} 行')

    # 索引
    conn.execute(f'CREATE INDEX IF NOT EXISTS idx_{table_name}_code ON {table_name}("{all_cols[0]}")')
    conn.execute(f'CREATE INDEX IF NOT EXISTS idx_{table_name}_period ON {table_name}("{all_cols[2]}")')
    conn.commit()
    print(f'  完成，共 {total} 行，{len(all_cols)} 列')


def main():
    start = time.time()
    conn = sqlite3.connect(DB_PATH)
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('PRAGMA synchronous = OFF')
    conn.execute('PRAGMA cache_size = -64000')
    conn.execute('PRAGMA temp_store = MEMORY')

    print(f'数据库: {DB_PATH}')
    print(f'数据源: {CSMAR_ROOT}')

    # 1. 指数数据（解决基准收益为空的问题）
    import_index_data(conn)
    import_index_info(conn)

    # 2. 市场回报率
    import_market_daily(conn)

    # 3. 无风险利率
    import_risk_free_rate(conn)

    # 4. 周个股回报率
    import_weekly_stock(conn)

    # 5. 月个股回报率
    import_monthly_stock(conn)

    # 6. 三大财务报表
    import_financial_statement(conn, 'fs_combas', 'FS_Combas', 154)
    import_financial_statement(conn, 'fs_comins', 'FS_Comins', 81)
    import_financial_statement(conn, 'fs_comscfd', 'FS_Comscfd', 72)

    # 统计
    print('\n=== 导入完成，各表行数 ===')
    tables = ['index_daily', 'index_info', 'market_daily', 'risk_free_rate',
              'stock_weekly', 'stock_monthly', 'fs_combas', 'fs_comins', 'fs_comscfd']
    for t in tables:
        cnt = conn.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
        print(f'  {t}: {cnt:,} 行')

    conn.close()
    elapsed = time.time() - start
    print(f'\n总耗时: {elapsed:.1f} 秒')


if __name__ == '__main__':
    main()
