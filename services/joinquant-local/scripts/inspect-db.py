"""检查 stock_data.db 数据"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'stock_data.db')
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

# 总行数
c.execute('SELECT COUNT(*) FROM stock_daily')
print(f'stock_daily 总行数: {c.fetchone()[0]:,}')

# 表清单
c.execute("SELECT name FROM sqlite_master WHERE type='table'")
print(f'\n表清单: {[r[0] for r in c.fetchall()]}')

# 股票样例
c.execute('SELECT stock_code, MIN(trade_date), MAX(trade_date), COUNT(*) FROM stock_daily GROUP BY stock_code ORDER BY stock_code LIMIT 10')
print('\n前10只股票样例:')
for r in c.fetchall():
    print(f'  {r[0]}: {r[1]} ~ {r[2]}, {r[3]} 条')

# 目标股票
print('\n目标股票数据量:')
for code in ['000001', '600519', '000858', '601318', '000333', '000300']:
    c.execute('SELECT MIN(trade_date), MAX(trade_date), COUNT(*) FROM stock_daily WHERE stock_code=?', (code,))
    r = c.fetchone()
    print(f'  {code}: {r[0]} ~ {r[1]}, {r[2]} 条')

# 2023年1-6月数据
print('\n2023年1-6月目标股票数据:')
for code in ['000001', '600519', '000858', '601318', '000333', '000300']:
    c.execute("SELECT COUNT(*), MIN(trade_date), MAX(trade_date) FROM stock_daily WHERE stock_code=? AND trade_date BETWEEN '2023-01-01' AND '2023-06-30'", (code,))
    r = c.fetchone()
    print(f'  {code}: {r[0]} 条, {r[1]} ~ {r[2]}')

# 交易日历
c.execute('SELECT COUNT(*), MIN(trade_date), MAX(trade_date) FROM trade_calendar WHERE is_trading_day=1')
print(f'\n交易日历: {c.fetchone()}')

# 样例数据
c.execute("SELECT * FROM stock_daily WHERE stock_code='000001' AND trade_date BETWEEN '2023-01-03' AND '2023-01-10'")
print('\n000001 在 2023-01-03 ~ 2023-01-10 的样例:')
for r in c.fetchall():
    print(f'  {r}')

conn.close()
