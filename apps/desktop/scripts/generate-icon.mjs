// 生成应用图标 build/icon.png（512x512，K线风格，红涨绿跌）
// 零依赖：手写 PNG 编码（zlib deflate + CRC32）
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 512
const img = Buffer.alloc(SIZE * SIZE * 4) // RGBA，初始透明

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4))
  for (let y = 0; y < SIZE; y++) {
    raw[y * (1 + SIZE * 4)] = 0 // filter none
    img.copy(raw, y * (1 + SIZE * 4) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---------- 绘制原语 ----------
function setPx(x, y, r, g, b, a = 255) {
  x = Math.round(x)
  y = Math.round(y)
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  img[i] = r
  img[i + 1] = g
  img[i + 2] = b
  img[i + 3] = a
}

function fillCircle(cx, cy, radius, color) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        setPx(cx + dx, cy + dy, ...color)
      }
    }
  }
}

function drawLine(x0, y0, x1, y1, width, color) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    fillCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width / 2, color)
  }
}

function fillRect(x0, y0, x1, y1, color) {
  for (let y = Math.round(y0); y <= Math.round(y1); y++) {
    for (let x = Math.round(x0); x <= Math.round(x1); x++) setPx(x, y, ...color)
  }
}

function drawVLine(x, y0, y1, width, color) {
  drawLine(x, y0, x, y1, width, color)
}

function inRoundedRect(x, y, w, h, r) {
  if (x < r && y < r) return (x - r) ** 2 + (y - r) ** 2 <= r * r
  if (x >= w - r && y < r) return (x - (w - r)) ** 2 + (y - r) ** 2 <= r * r
  if (x < r && y >= h - r) return (x - r) ** 2 + (y - (h - r)) ** 2 <= r * r
  if (x >= w - r && y >= h - r) return (x - (w - r)) ** 2 + (y - (h - r)) ** 2 <= r * r
  return x >= 0 && x < w && y >= 0 && y < h
}

// ---------- 绘制 ----------
const BG = [20, 22, 26, 255]
const RED = [245, 34, 45, 255]
const GREEN = [20, 177, 67, 255]
const LINE = [232, 234, 237, 255]

// 深色圆角背景（全图）
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (inRoundedRect(x, y, SIZE, SIZE, 96)) {
      const i = (y * SIZE + x) * 4
      img[i] = BG[0]
      img[i + 1] = BG[1]
      img[i + 2] = BG[2]
      img[i + 3] = BG[3]
    }
  }
}

// K线蜡烛（三根：红涨 绿跌 红涨）
const candle = (cx, bodyTop, bodyBottom, wickTop, wickBottom, bodyW, color) => {
  drawVLine(cx, wickTop, wickBottom, 10, color)
  fillRect(cx - bodyW / 2, bodyTop, cx + bodyW / 2, bodyBottom, color)
}

// 蜡烛1：红涨（收>开）
candle(150, 330, 300, 352, 282, 60, RED)
// 蜡烛2：绿跌（收<开）
candle(256, 388, 350, 408, 330, 60, GREEN)
// 蜡烛3：红涨
candle(362, 312, 268, 334, 250, 60, RED)

// 白色走势折线（穿行蜡烛上方）
const poly = [
  [100, 396],
  [150, 288],
  [256, 368],
  [362, 240],
  [416, 180]
]
for (let i = 0; i < poly.length - 1; i++) {
  drawLine(poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1], 16, LINE)
}

// ---------- 输出 ----------
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'build')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'icon.png'), encodePng())
console.log('icon.png generated:', join(outDir, 'icon.png'))
