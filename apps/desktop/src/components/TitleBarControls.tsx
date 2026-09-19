import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'

/**
 * 自绘窗口控制按钮（最小化/最大化/关闭）：titleBarStyle:hidden 后系统按钮消失，
 * titleBarOverlay 在 Windows 会使页面丢 mousedown（画线拖拽全挂）故弃用，按钮自绘。
 * 放在 .toolbar 最右（drag 区内，按钮自身 no-drag）。
 */
export default function TitleBarControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const sync = (): void => setMaximized(window.outerWidth >= window.screen.availWidth - 20)
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  return (
    <div className="titlebar-controls">
      <button className="titlebar-btn" title="最小化" onClick={() => void window.api.win.minimize()}>
        <Minus size={12} />
      </button>
      <button
        className="titlebar-btn"
        title={maximized ? '还原' : '最大化'}
        onClick={() => void window.api.win.maximizeToggle()}
      >
        {maximized ? <Copy size={10} /> : <Square size={10} />}
      </button>
      <button className="titlebar-btn titlebar-close" title="关闭" onClick={() => void window.api.win.close()}>
        <X size={12} />
      </button>
    </div>
  )
}
