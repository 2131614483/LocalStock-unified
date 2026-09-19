import { useMemo, useState } from 'react'
import { usePa } from '../../store/pa'

/** 「原始」面板：展示发送给模型的 prompt 与原始分析记录 JSON */
export default function PaRawPanel() {
  const promptText = usePa((s) => s.promptText)
  const record = usePa((s) => s.record)
  const [tab, setTab] = useState<'prompt' | 'record'>('prompt')

  const recordJson = useMemo(
    () => (record ? JSON.stringify(record, null, 2) : ''),
    [record]
  )

  const text = tab === 'prompt' ? promptText : recordJson

  return (
    <div className="pa-panel">
      <div className="pa-tabs-inline">
        <button
          type="button"
          className={tab === 'prompt' ? 'active' : ''}
          onClick={() => setTab('prompt')}
        >
          发送的 Prompt{promptText ? ` (${promptText.length.toLocaleString()} 字)` : ''}
        </button>
        <button
          type="button"
          className={tab === 'record' ? 'active' : ''}
          onClick={() => setTab('record')}
        >
          分析记录{recordJson ? ` (${(recordJson.length / 1024).toFixed(0)} KB)` : ''}
        </button>
      </div>
      {text ? (
        <pre className="pa-raw">{text}</pre>
      ) : (
        <div className="pa-empty">
          {tab === 'prompt' ? '分析开始后会在此显示实际发送的提示词。' : '尚无分析记录。'}
        </div>
      )}
    </div>
  )
}
