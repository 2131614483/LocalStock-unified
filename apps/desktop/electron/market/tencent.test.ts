import { beforeEach, describe, expect, it, vi } from 'vitest'
import iconv from 'iconv-lite'
import { getOrderBook, num, parseCommon, secidToTencent } from './tencent'

vi.mock('./http', () => ({ fetchText: vi.fn() }))
import { fetchText } from './http'
const mockFetch = fetchText as unknown as ReturnType<typeof vi.fn>

/** 构造真实格式的腾讯行情字段数组（~ 分隔，索引 1-49） */
function tencentFields(overrides: Record<number, string> = {}): string[] {
  const f = new Array(50).fill('')
  f[1] = '贵州茅台'
  f[2] = '600519'
  f[3] = '1346.50'
  f[4] = '1348.86'
  f[5] = '1349.00'
  f[6] = '24157'
  f[9] = '1348.50'
  f[10] = '100'
  f[19] = '1347.00'
  f[20] = '200'
  f[30] = '202608111500'
  f[31] = '-2.36'
  f[32] = '-0.17'
  f[33] = '1355.00'
  f[34] = '1345.00'
  f[35] = '1346.50/24157/3276129134'
  f[37] = '327612'
  f[38] = '2.40'
  f[39] = '12.35'
  f[43] = '43.99'
  f[44] = '15500'
  f[45] = '19800'
  f[46] = '8.40'
  f[47] = '1483.00'
  f[48] = '1212.00'
  f[49] = '0.90'
  return Object.assign(f, overrides)
}

function tencentBuffer(fields: string[]): Buffer {
  return iconv.encode(`v_sh600519="${fields.join('~')}"`, 'gbk')
}

beforeEach(() => mockFetch.mockReset())

describe('腾讯数据源契约（qt.gtimg.cn，GBK，~ 分隔）', () => {
  it('secidToTencent：市场前缀映射', () => {
    expect(secidToTencent('1.600519')).toBe('sh600519')
    expect(secidToTencent('0.000858')).toBe('sz000858')
    expect(secidToTencent('0.920870')).toBe('bj920870')
    expect(secidToTencent('0.430047')).toBe('bj430047')
  })

  it('parseCommon：字段映射契约', () => {
    const c = parseCommon(tencentFields())
    expect(c.name).toBe('贵州茅台')
    expect(c.price).toBe(1346.5)
    expect(c.change).toBe(-2.36)
    expect(c.changePercent).toBe(-0.17)
    expect(c.open).toBe(1349)
    expect(c.high).toBe(1355)
    expect(c.low).toBe(1345)
    expect(c.preClose).toBe(1348.86)
    expect(c.volume).toBe(24157)
    expect(c.amount).toBe(3276129134) // 来自 p[35] "价/量/额" 的额
    expect(c.turnoverRate).toBe(2.4)
    expect(c.pe).toBe(12.35)
    expect(c.pb).toBe(8.4)
    expect(c.amplitude).toBe(43.99)
    expect(c.volumeRatio).toBe(0.9)
    expect(c.totalMv).toBe(19800 * 1e8)
    expect(c.floatMv).toBe(15500 * 1e8)
    expect(c.limitUp).toBe(1483)
    expect(c.limitDown).toBe(1212)
    expect(c.time).toBe('202608111500')
  })

  it('getOrderBook：GBK 解码 + 五档盘口', async () => {
    mockFetch.mockResolvedValue(tencentBuffer(tencentFields()))
    const ob = await getOrderBook('1.600519')
    expect(ob).not.toBeNull()
    expect(ob!.name).toBe('贵州茅台') // GBK 中文解码正确
    expect(ob!.bid[0]).toEqual({ price: 1348.5, volume: 100 })
    expect(ob!.ask[0]).toEqual({ price: 1347, volume: 200 })
    expect(ob!.secid).toBe('1.600519')
  })

  describe('故障注入', () => {
    it('字段不足（<50）→ null', async () => {
      mockFetch.mockResolvedValue(iconv.encode('v_sh600519="a~b~c"', 'gbk'))
      expect(await getOrderBook('1.600519')).toBeNull()
    })

    it('非行情行（无 v_ 匹配）→ null', async () => {
      mockFetch.mockResolvedValue(iconv.encode('no match here', 'gbk'))
      expect(await getOrderBook('1.600519')).toBeNull()
    })

    it('网络异常 → reject 上抛（不吞错）', async () => {
      mockFetch.mockRejectedValueOnce(new Error('socket hang up'))
      const p = getOrderBook('1.600519')
      let msg = ''
      try {
        await p
      } catch (e) {
        msg = String(e)
      }
      expect(msg).toContain('socket hang up')
    })

    it('脏字段不污染：0.0000/空 → undefined → 0', () => {
      const c = parseCommon(tencentFields({ 3: '0.0000', 31: '', 35: '' }))
      expect(c.price).toBe(0)
      expect(c.change).toBe(0)
      // 35 为空时回退用 p[37]（成交额 万 → 元）
      expect(c.amount).toBe(327612 * 1e4)
      expect(num('0.0000')).toBeUndefined()
      expect(num('abc')).toBeUndefined()
    })
  })
})
