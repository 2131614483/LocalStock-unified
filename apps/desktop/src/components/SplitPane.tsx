import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 可拖拽分隔容器：两块面板之间一条分隔条，
 * 悬停显示缩放光标（col-resize ↔ / row-resize ↕），拖拽边界动态改尺寸。
 * 用 grid 三列/三行：{size}px 分隔条 1fr。
 *
 * 尺寸分两层：
 * - userSize：用户拖拽值（持久化 localStorage），窗口变大时能恢复；
 * - size：生效值 = clamp(userSize, 容器-保留值)，只防溢出、不回写。
 * 这样小窗口临时钳小、最大化后自动恢复用户设定，不会被小窗值永久卡死。
 */
interface SplitPaneProps {
  direction: 'vertical' | 'horizontal'
  /** 初始分隔大小（px） */
  initial: number
  min: number
  max: number
  /** 持久化 key（localStorage，存用户拖拽值） */
  storageKey?: string
  onChange?: (size: number) => void
  /** 分隔条厚度（px） */
  handleSize?: number
  /** 钳制时给第二格保留的最小尺寸（px） */
  reserveForSecond?: number
  className?: string
  children: [React.ReactNode, React.ReactNode]
}

export default function SplitPane({
  direction,
  initial,
  min,
  max,
  storageKey,
  onChange,
  handleSize = 6,
  reserveForSecond = 120,
  className = '',
  children
}: SplitPaneProps) {
  const [userSize, setUserSize] = useState<number>(() => {
    if (storageKey) {
      const saved = Number(localStorage.getItem(storageKey))
      if (Number.isFinite(saved) && saved >= min && saved <= max) return saved
    }
    return initial
  })
  const drag = useRef<{ start: number; startSize: number; dir: 'vertical' | 'horizontal' } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // 生效值：容器尺寸变化时按容器钳制；拖拽时跟随用户值
  const [size, setSize] = useState<number>(userSize)

  const isVertical = direction === 'vertical'

  // 容器尺寸变化（窗口缩放/初次布局/最大化）时重算生效值：clamp(userSize, cap)。
  // direction='vertical' 是竖分隔条（调列宽）→ 读 clientWidth；'horizontal' 读 clientHeight
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const reclamp = (): void => {
      const total = isVertical ? el.clientWidth : el.clientHeight
      if (total <= 0) return
      const cap = Math.max(min, Math.min(max, total - handleSize - reserveForSecond))
      setSize(Math.min(userSize, cap))
    }
    reclamp()
    const ro = new ResizeObserver(reclamp)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isVertical, userSize, min, max, handleSize, reserveForSecond])

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      drag.current = { start: isVertical ? e.clientX : e.clientY, startSize: size, dir: direction }
      document.body.classList.add(isVertical ? 'resizing-col' : 'resizing-row')
      const onMove = (ev: MouseEvent): void => {
        const d = drag.current
        if (!d) return
        const pos = d.dir === 'vertical' ? ev.clientX : ev.clientY
        const next = Math.max(min, Math.min(max, d.startSize + (pos - d.start)))
        setSize(next)
        setUserSize(next) // 用户拖拽值同步（持久化用它）
        onChange?.(next)
      }
      const onUp = (): void => {
        drag.current = null
        document.body.classList.remove('resizing-col', 'resizing-row')
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [isVertical, size, min, max, onChange, direction]
  )

  // 只持久化用户拖拽值；容器钳制的临时值不写回
  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, String(userSize))
  }, [userSize, storageKey])

  const gridStyle = isVertical
    ? { gridTemplateColumns: `${size}px ${handleSize}px 1fr`, gridTemplateRows: 'minmax(0, 1fr)' }
    : { gridTemplateRows: `${size}px ${handleSize}px 1fr`, gridTemplateColumns: 'minmax(0, 1fr)' }

  return (
    <div
      ref={rootRef}
      className={`splitpane ${isVertical ? 'splitpane-col' : 'splitpane-row'} ${className}`}
      style={gridStyle}
    >
      <div className="splitpane-item splitpane-main">{children[0]}</div>
      <div
        className={`splitter ${isVertical ? 'splitter-col' : 'splitter-row'}`}
        onMouseDown={onMouseDown}
        title={isVertical ? '拖拽调整宽度（↔）' : '拖拽调整高度（↕）'}
      />
      <div className="splitpane-item splitpane-sub">{children[1]}</div>
    </div>
  )
}
