import { useEffect, useState } from 'react'
import type { PaKlineBar } from '../../../shared/types'
import { usePa } from '../../store/pa'

type Pack = { path: string; text: string } | null

/** 对齐原 PA Agent 工作流：粘贴/文件 → 解析预览 → 自动存档 → 显示与图表还原。 */
export default function PaImportResultDialog({ onClose }: { onClose(): void }) {
  const [text, setText] = useState('')
  const [pack, setPack] = useState<Pack>(null)
  const [report, setReport] = useState('点击「解析预览」后可在此查看校验结果。')
  const [checked, setChecked] = useState(false)
  const [message, setMessage] = useState('')
  const importJson = usePa((s) => s.importJson)
  const setImportedKline = usePa((s) => s.setImportedKline)

  useEffect(() => { void window.api.pa.latestOfflinePack().then(setPack).catch(() => {}) }, [])
  const change = (next: string): void => { setText(next); setChecked(false); setMessage('') }
  const preview = (): void => { const result = inspect(text); setChecked(result.ok); setReport(result.message) }
  const archiveAndRender = async (): Promise<void> => {
    const result = importJson(text)
    if (!result.ok) { setMessage(result.error ?? '解析失败'); return }
    const bars = pack ? parsePackBars(pack.text) : []
    if (bars.length) setImportedKline(bars)
    try {
      const record = usePa.getState().record
      if (record) await window.api.pa.archiveImportedRecord(record)
      onClose()
    } catch (error) { setMessage(`已渲染，但存档失败：${error instanceof Error ? error.message : String(error)}`) }
  }
  const useClipboard = (): void => { void window.api.pa.readClipboardText().then(change).catch((error: unknown) => setMessage(String(error))) }
  const readReply = (): void => { void window.api.pa.pickImportText().then((file) => { if (file) change(file.text) }).catch((error: unknown) => setMessage(String(error))) }
  const choosePack = (): void => { void window.api.pa.pickOfflinePack().then(setPack).catch((error: unknown) => setMessage(String(error))) }
  const newestPack = (): void => { void window.api.pa.latestOfflinePack().then((next) => { setPack(next); if (!next) setMessage('当前激进版尚未找到离线包，请先导出本地 TXT。') }) }

  return <div className="pa-modal-mask" role="dialog" aria-modal="true" aria-label="导入分析结果">
    <section className="pa-import-dialog">
      <header><strong>导入分析结果</strong><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
      <p className="pa-import-hint">粘贴大模型返回的 JSON。确认后会：<b>校验 → 自动存档 → 在界面上显示</b>（决策面板 / 决策树 / 图表叠加线）。</p>
      <fieldset><legend>模型返回内容</legend><textarea autoFocus value={text} onChange={(e) => change(e.target.value)} placeholder={'把大模型返回的内容整段粘贴到这里：\n\n· 可以是纯 JSON\n· 也可以带前后说明文字和 ```json 围栏（会自动提取）\n· 阶段一和阶段二都贴进来也可以，会自动分别识别'} />
        <div className="pa-import-actions"><button type="button" className="pa-btn" onClick={useClipboard}>从剪贴板粘贴</button><button type="button" className="pa-btn" onClick={readReply}>从文件读取…</button><button type="button" className="pa-btn" onClick={() => change('')}>清空</button></div>
      </fieldset>
      <fieldset><legend>K 线数据来源（用于还原图表，可留空）</legend><div className="pa-import-pack"><output title={pack?.path}>{pack?.path ?? '（不关联 — 图表将使用当前页面行情）'}</output><button type="button" className="pa-btn" onClick={choosePack}>选择离线包…</button><button type="button" className="pa-btn" onClick={newestPack}>用最新</button><button type="button" className="pa-btn" onClick={() => setPack(null)}>不关联</button></div></fieldset>
      <fieldset className="pa-import-report"><legend>解析结果</legend><pre>{report}</pre></fieldset>
      {message && <div className="pa-error">{message}</div>}
      <footer><span /><button type="button" className="pa-btn" onClick={onClose}>取消</button><button type="button" className="pa-btn" disabled={!text.trim()} onClick={preview}>解析预览</button><button type="button" className="pa-btn pa-btn-primary" disabled={!checked} onClick={() => void archiveAndRender()}>存档并显示</button></footer>
    </section>
  </div>
}

function inspect(text: string): { ok: boolean; message: string } {
  if (!text.trim()) return { ok: false, message: '请先粘贴模型返回内容。' }
  const blocks = jsonBlocks(text)
  const stage1 = blocks.filter((item) => 'stage1_diagnosis' in item || 'cycle_position' in item || 'market_phase' in item).length
  const stage2 = blocks.filter((item) => 'stage2_decision' in item || 'decision' in item).length
  if (!blocks.length) return { ok: false, message: '❌ 未找到可解析的 JSON 对象。请检查是否完整粘贴。' }
  if (!stage1 && !stage2) return { ok: false, message: `找到 ${blocks.length} 个 JSON 对象，但未识别到阶段一诊断或阶段二决策字段。` }
  return { ok: true, message: `✓ 找到 JSON：${blocks.length} 个\n✓ 阶段一诊断：${stage1 ? '已识别' : '未提供'}\n✓ 阶段二决策：${stage2 ? '已识别' : '未提供'}\n\n点击「存档并显示」后会保存到当前版本的本地运行目录。` }
}

function jsonBlocks(text: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = []; let start = -1; let depth = 0; let quote = false; let escaped = false
  for (let index = 0; index < text.length; index++) { const char = text[index]
    if (quote) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quote = false; continue }
    if (char === '"') { quote = true; continue }
    if (char === '{') { if (depth++ === 0) start = index }
    if (char === '}' && depth && --depth === 0 && start >= 0) { try { const parsed = JSON.parse(text.slice(start, index + 1)); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) found.push(parsed as Record<string, unknown>) } catch {} start = -1 }
  }
  return found
}

/** 兼容本项目导出的 01 阶段离线包；不合法行会被安全忽略。 */
function parsePackBars(text: string): PaKlineBar[] {
  const start = text.lastIndexOf('【K线数据】')
  if (start < 0) return []
  return text.slice(start).split(/\r?\n/).slice(2).map((line) => line.split('\t')).filter((row) => row.length >= 7 && row.slice(1, 7).every((value) => Number.isFinite(Number(value)))).map((row) => ({ time: row[0], open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]), amount: Number(row[6]) }))
}
