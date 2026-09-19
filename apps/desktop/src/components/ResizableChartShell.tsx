import { useState } from 'react'

/** 可拖拽高度的图表壳：包住任意 ECharts 容器，底部横条 ↕ 改高 */
interface Props {
  chartRef: React.RefObject<HTMLDivElement | null>
  className?: string
  initial?: number
  min?: number
  max?: number
  children?: React.ReactNode
}

export default function ResizableChartShell({
  chartRef,
  className = 'chart-box-sm',
  initial = 260,
  min = 160,
  max = 700,
  children
}: Props) {
  const [h, setH] = useState(initial)

  const onHeightDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = h
    const move = (ev: MouseEvent): void => {
      setH(Math.max(min, Math.min(max, startH + (ev.clientY - startY))))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-row')
    }
    document.body.classList.add('resizing-row')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="resizable-chart-shell">
      <div ref={chartRef} className={className} style={{ height: h }} />
      <div className="chart-v-resize" onMouseDown={onHeightDrag} title="拖拽调整高度（↕）" />
      {children}
    </div>
  )
}
