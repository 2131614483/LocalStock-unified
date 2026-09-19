/**
 * 进程终止工具。
 *
 * Windows 上 venv 的 `Scripts\python.exe` 是**启动器外壳**，会再派生一个真实
 * 解释器进程来跑脚本（实测：venv python 274KB → 子进程 base python.exe）。
 * 只 kill 外壳会把真实进程留成孤儿 —— 端口不释放、文件句柄不放。
 * 因此这里一律按**进程树**终止。
 */
import { spawnSync, type ChildProcess } from 'node:child_process'

export function killProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (pid && process.platform === 'win32') {
    try {
      const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        encoding: 'utf8'
      })
      if (!r.error && r.status === 0) return
      // taskkill 失败（进程可能已退出）→ 退回单进程 kill
    } catch {
      // 继续走下面的兜底
    }
  }
  try {
    child.kill()
  } catch {
    // 进程可能已退出
  }
}
