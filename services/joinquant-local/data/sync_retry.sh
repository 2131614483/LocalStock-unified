#!/bin/bash
# 自动重试驱动：baostock 间歇性挂起（query_trade_dates rs.next() 无超时永久卡死）。
# 每轮带硬超时跑增量同步；挂起则清锁续跑；断点续传（INSERT OR IGNORE + done 集合）。
# 目标：08-10 与 08-11 各 ≥4000 行（daily_stock_pick 的"完整交易日"阈值）。
cd /d/pythonpro/聚宽-local || exit 1
PY="C:/Users/he/AppData/Local/Programs/Python/Python311/python.exe"
TARGET=4000
COUNT() {
  "$PY" -c "import sqlite3;c=sqlite3.connect(r'D:/pythonpro/聚宽-local/data/stock_data.db');print(c.execute('SELECT COUNT(*) FROM stock_daily WHERE trade_date=?',('$1',)).fetchone()[0])" 2>/dev/null
}
for i in $(seq 1 150); do
  n10=$(COUNT 2026-08-10)
  n11=$(COUNT 2026-08-11)
  echo "[$i] 08-10=$n10 08-11=$n11"
  if [ "${n10:-0}" -ge $TARGET ] && [ "${n11:-0}" -ge $TARGET ]; then
    echo "TARGET_REACHED"
    exit 0
  fi
  rm -f data/sync.lock
  timeout 280 "$PY" -u scripts/update-daily-baostock.py --delay 0.02 > /tmp/sync_retry.log 2>&1
  code=$?
  echo "[$i] exit=$code $(grep -av '^login success\|^logout success' /tmp/sync_retry.log | tail -1 | cut -c1-80)"
  # baostock 服务故障（挂起/登录失败/连接失败）：任何失败冷却 240s 再重试，避免打爆服务器
  if [ "$code" -eq 124 ] || [ "$code" -ne 0 ] || grep -qa "login error\|登录失败" /tmp/sync_retry.log; then
    echo "[$i] 冷却 240s..."
    sleep 240
  fi
done
echo "MAX_ITERATIONS_EXCEEDED"
