// 行情库路径注入：主进程解析后注入（worker 线程不访问 electron），查询模块只读此路径
let dbPath: string | null = null

export function setDbPath(p: string | null): void {
  dbPath = p
}

export function getDbPath(): string | null {
  return dbPath
}
