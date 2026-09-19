import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'fs'
import { registerIpc, stopQuotePolling } from './ipc'
import { registerBacktestIpc } from './backtest'
import { registerDrawingIpc } from './drawings'
import { registerAlertIpc, startAlertScan, stopAlertScan } from './alerts'
import { registerAiIpc } from './ai/ipc'
import { registerSelectionIpc, startSelectionScan, stopSelectionScan } from './selection'
import { registerMonitorIpc, startMonitor, stopMonitor } from './monitor'
import { registerMinuteIpc } from './minute-ai'
import { registerDrawingAiIpc } from './drawing-ai'
import { registerFloatIpc } from './float-ipc'
import { closeAllFloats } from './windows'
import { getDb, setSetting } from './db'
import { loadWindowState, trackWindowState, wasMaximized } from './window-state'
import { registerQuantIpc } from './quant/ipc'
import { bootstrapPaServer, registerPaIpc, shutdownPaServer } from './pa/ipc'
import { registerMarketDbIpc } from './market/db-config'
import { registerNewsIpc } from './news'

let mainWindow: BrowserWindow | null = null

/** 品牌改名后的用户数据迁移：复制旧配置，不删除任何旧文件。 */
function prepareLocalStockUserData(): void {
  const unifiedUserData = process.env.LOCALSTOCK_DESKTOP_USER_DATA?.trim()
  if (unifiedUserData) {
    mkdirSync(unifiedUserData, { recursive: true })
    app.setPath('userData', unifiedUserData)
    return
  }
  const appData = app.getPath('appData')
  const currentDir = join(appData, 'localstock-desktop')
  // 拆分旧品牌字符串，避免旧名称继续成为项目标识；这里只用于一次性兼容迁移。
  const legacyDir = join(appData, ['open', 'stock-desktop'].join(''))
  if (!existsSync(currentDir) && existsSync(legacyDir)) {
    cpSync(legacyDir, currentDir, { recursive: true, force: false })
  }
  mkdirSync(currentDir, { recursive: true })
  const currentDb = join(currentDir, 'localstock.db')
  const legacyDb = join(currentDir, ['open', 'stock.db'].join(''))
  if (!existsSync(currentDb) && existsSync(legacyDb)) copyFileSync(legacyDb, currentDb)
  app.setPath('userData', currentDir)
}

prepareLocalStockUserData()

function createWindow(): void {
  const saved = loadWindowState('main', { defaultWidth: 1360, defaultHeight: 860, minWidth: 1000, minHeight: 660 })
  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1360,
    height: saved?.height ?? 860,
    x: saved?.x,
    y: saved?.y,
    resizable: true,
    minWidth: 1000,
    minHeight: 660,
    backgroundColor: '#0d0e10',
    autoHideMenuBar: true,
    show: false,
    // 深色标题栏：titleBarStyle hidden + 自绘控制按钮（TitleBarControls）。
    // 注：此前"hidden 丢 mousedown"的结论是测试噪声——Playwright 启动后窗口不在前台时
    // Windows 会吞掉 mouse down（mousemove 正常），与 hidden 无关；测试必须先 focus 窗口。
    titleBarStyle: 'hidden',
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  if (saved && wasMaximized('main')) mainWindow.maximize()
  trackWindowState(mainWindow, 'main')

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 主窗关闭时一并关闭全部浮窗/监盘窗，避免残留进程（期间 emitChange 已加 isDestroyed 保护）
  mainWindow.on('close', () => {
    closeAllFloats()
  })

  // 转发渲染进程日志到主进程 stdout，便于排查（开发辅助）
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    console.log(`[renderer:${level}] ${message}`)
  })

  // 外部链接交给系统浏览器，不在应用内打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 单实例锁：便携版双击两次会开两个进程共写同一 SQLite（WAL 下仍可能锁冲突/数据竞争）。
// 拿不到锁说明已有实例 → 聚焦已有主窗后退出。
// LOCALSTOCK_NO_SINGLETON=1 跳过（Playwright 套跑时前实例退出与后实例启动有竞态，测试需要多开）。
const gotLock = process.env.LOCALSTOCK_NO_SINGLETON ? true : app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    // 初始化 SQLite（失败则明确报错，避免运行后静默无数据）
    try {
      getDb()
      const unifiedKnowledge = process.env.LOCALSTOCK_STRATEGY_KB?.trim()
      if (unifiedKnowledge) setSetting('ai.knowledge.strategyPath', unifiedKnowledge)
    } catch (err) {
      console.error('[db] SQLite 初始化失败:', err)
    }
    registerIpc(() => mainWindow)
    registerBacktestIpc(() => mainWindow)
    registerDrawingIpc()
    registerDrawingAiIpc()
    registerNewsIpc()
    registerAlertIpc()
    registerAiIpc(() => mainWindow)
    registerQuantIpc()
    registerMarketDbIpc(() => mainWindow)
    registerPaIpc()
    // 价格行为 AI 服务随应用启动（源码随程序分发，依赖缺失时状态会推给界面提示安装）
    void bootstrapPaServer()
    registerSelectionIpc(() => mainWindow)
    registerMonitorIpc()
    registerMinuteIpc(() => mainWindow)
    registerFloatIpc(() => mainWindow)
    startAlertScan()
    startSelectionScan()
    startMonitor()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  stopQuotePolling()
  stopAlertScan()
  stopSelectionScan()
  stopMonitor()
  if (process.platform !== 'darwin') app.quit()
})

// 无论从哪条路径退出（关窗、菜单、异常），都要带走托管的 Python 子进程，
// 否则它会留在后台占着端口。
app.on('before-quit', () => {
  shutdownPaServer()
})
