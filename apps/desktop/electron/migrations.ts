import type Database from 'better-sqlite3'

/**
 * localstock.db 迁移 runner：按 PRAGMA user_version 递增执行迁移，每步一个事务。
 * 新增迁移在数组末尾追加；升级时从当前 version 开始顺序执行，绝不回滚已建表。
 */

// 迁移数组：索引 i = 版本 i+1
const MIGRATIONS: Array<(db: Database.Database) => void> = [
  // v1：基础表（自选/设置/缓存/画线）—— 历史遗留表结构固化
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS watchlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        secid TEXT UNIQUE NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS kline_cache (
        cache_key TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS drawings (
        secid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS drawing_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        secid TEXT NOT NULL,
        version INTEGER NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_drawing_history_secid ON drawing_history(secid, version);
    `)
  },
  // v2：预警表
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS alert_rules (
        id TEXT PRIMARY KEY,
        secid TEXT NOT NULL,
        name TEXT,
        type TEXT NOT NULL,
        fast INTEGER,
        slow INTEGER,
        threshold REAL,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_alert_rules_secid ON alert_rules(secid);
      CREATE TABLE IF NOT EXISTS alert_events (
        id TEXT PRIMARY KEY,
        rule_id TEXT,
        secid TEXT,
        signal TEXT,
        message TEXT,
        fired_at INTEGER
      );
    `)
  },
  // v3：AI 写操作审计表（每次 AI 写策略/画线/选股记录，可回滚）
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_audit (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        tool TEXT NOT NULL,
        secid TEXT,
        args TEXT,
        summary TEXT,
        status TEXT DEFAULT 'applied',
        snapshot TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ai_audit_ts ON ai_audit(ts DESC);
    `)
  },
  // v4：自动选股（规则 + 扫描结果）
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS selection_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        rule_json TEXT NOT NULL,
        schedule_minutes INTEGER,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS selection_results (
        id TEXT PRIMARY KEY,
        rule_id TEXT,
        rule_name TEXT,
        mode TEXT,
        scanned_at INTEGER,
        total INTEGER,
        hits INTEGER,
        data_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_selection_results_time ON selection_results(scanned_at DESC);
    `)
  },
  // v5：实时监盘（实时行情入库 + 监控列表 + 事件日志 + AI 预测缓存）
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS monitor_list (
        secid TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        added_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS quote_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        secid TEXT NOT NULL,
        code TEXT,
        name TEXT,
        price REAL,
        change_percent REAL,
        volume REAL,
        amount REAL,
        high REAL,
        low REAL,
        ts INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_quote_history_secid_ts ON quote_history(secid, ts);
      CREATE TABLE IF NOT EXISTS monitor_events (
        id TEXT PRIMARY KEY,
        ts INTEGER,
        secid TEXT,
        name TEXT,
        type TEXT,
        content TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_monitor_events_ts ON monitor_events(ts DESC);
      CREATE TABLE IF NOT EXISTS ai_predictions (
        secid TEXT PRIMARY KEY,
        prediction TEXT NOT NULL,
        ts INTEGER
      );
    `)
  },
  // v6：AI 预测历史（命中率统计用，append-only）
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS prediction_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        secid TEXT NOT NULL,
        code TEXT,
        name TEXT,
        direction TEXT NOT NULL,
        confidence REAL,
        target_price REAL,
        support REAL,
        resistance REAL,
        reason TEXT,
        ref_price REAL,
        predicted_at INTEGER NOT NULL,
        resolved_at INTEGER,
        outcome TEXT DEFAULT 'pending',
        actual_price REAL
      );
      CREATE INDEX IF NOT EXISTS idx_prediction_history_time ON prediction_history(predicted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_prediction_history_outcome ON prediction_history(outcome);
    `)
  },
  // v7：监盘状态持久化（预警去重跨重启：lastPct/lastPrice 跨重启不重置，避免重启后重复预警）
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS monitor_state (
        secid TEXT PRIMARY KEY,
        last_pct REAL,
        last_price REAL,
        last_ts INTEGER
      );
    `)
  }
]

/** 从当前 user_version 开始顺序执行迁移 */
export function runMigrations(db: Database.Database): void {
  const current = (db.pragma('user_version', { simple: true }) as number) || 0
  for (let v = current; v < MIGRATIONS.length; v++) {
    const step = db.transaction(() => {
      MIGRATIONS[v](db)
      db.pragma(`user_version = ${v + 1}`)
    })
    step()
  }
}
