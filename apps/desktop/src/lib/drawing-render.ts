import type { Drawing, DrawingPoint } from '../../shared/types'

function hexToRgba(hex: string, alpha: number): string {
  const match = hex.match(/^#?([0-9a-f]{6})$/i)
  if (!match) return hex
  const value = parseInt(match[1], 16)
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`
}

function indexOfTime(times: string[], time: string): number {
  const exact = times.indexOf(time)
  if (exact >= 0) return exact
  const date = time.slice(0, 10)
  return times.findIndex((item) => item.slice(0, 10) === date)
}

/** 为 K 线和分时图生成统一的 ECharts custom-series 画线渲染器。 */
export function makeDrawingRenderItem(times: string[], drawings: Drawing[]) {
  return function renderDrawingItem(params: unknown, api: unknown): unknown {
    const dataIndex = (params as { dataIndex?: number }).dataIndex ?? 0
    const drawing = drawings[dataIndex]
    const chartApi = api as {
      coord(point: (string | number)[]): number[]
      getWidth(): number
    }
    if (!drawing || !drawing.points.length) return null

    const pixel = (point: DrawingPoint): number[] => {
      const index = point.t !== undefined ? indexOfTime(times, point.t) : Math.round(point.x)
      const category = index >= 0 ? times[index] : String(point.x)
      return chartApi.coord([category, point.y])
    }
    const points = drawing.points

    try {
      const style = { stroke: drawing.color, lineWidth: 2, fill: 'transparent' }
      switch (drawing.type) {
        case 'hline': {
          const y = pixel(points[0])[1]
          return { type: 'line', shape: { x1: 0, y1: y, x2: chartApi.getWidth(), y2: y }, style }
        }
        case 'segment': {
          const first = pixel(points[0])
          const second = pixel(points[1])
          return { type: 'polyline', shape: { points: [first, second] }, style }
        }
        case 'ray': {
          const first = pixel(points[0])
          const second = pixel(points[1])
          const dx = second[0] - first[0]
          const dy = second[1] - first[1]
          const length = Math.sqrt(dx * dx + dy * dy)
          if (length < 0.001) return { type: 'polyline', shape: { points: [first, second] }, style }
          const extension = 5000 / length
          return {
            type: 'polyline',
            shape: { points: [first, [first[0] + dx * extension, first[1] + dy * extension]] },
            style
          }
        }
        case 'rect': {
          const first = pixel(points[0])
          const second = pixel(points[1])
          return {
            type: 'rect',
            shape: {
              x: Math.min(first[0], second[0]),
              y: Math.min(first[1], second[1]),
              width: Math.abs(second[0] - first[0]),
              height: Math.abs(second[1] - first[1])
            },
            style: { ...style, fill: hexToRgba(drawing.color, 0.5) }
          }
        }
        case 'fib': {
          const first = pixel(points[0])
          const second = pixel(points[1])
          const children = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((level) => {
            const y = first[1] + (second[1] - first[1]) * level
            return {
              type: 'line',
              shape: { x1: Math.min(first[0], second[0]), y1: y, x2: Math.max(first[0], second[0]), y2: y },
              style
            }
          })
          return { type: 'group', children }
        }
        case 'channel': {
          const first = pixel(points[0])
          const second = pixel(points[1])
          const dx = second[0] - first[0]
          const dy = second[1] - first[1]
          const length = Math.sqrt(dx * dx + dy * dy) || 1
          const nx = (-dy / length) * 24
          const ny = (dx / length) * 24
          return {
            type: 'group',
            children: [
              { type: 'polyline', shape: { points: [[first[0] + nx, first[1] + ny], [second[0] + nx, second[1] + ny]] }, style },
              { type: 'polyline', shape: { points: [[first[0] - nx, first[1] - ny], [second[0] - nx, second[1] - ny]] }, style }
            ]
          }
        }
      }
    } catch (error) {
      console.log('[DRAW-RENDER-ERR]', String(error))
      return null
    }
  }
}
