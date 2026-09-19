import { useEffect, useState } from 'react'
import type { PaKnowledgeLibrary } from '../../../shared/types'
import { usePa } from '../../store/pa'

/** 两个版本的策略库并列展示；文件来自各自随程序分发的只读目录。 */
export default function PaStrategyLibraryPanel() {
  const [libraries, setLibraries] = useState<PaKnowledgeLibrary[]>([])
  const [error, setError] = useState('')
  const profile = usePa((s) => s.config?.profile ?? 'stable')

  useEffect(() => {
    void window.api.pa.listKnowledgeLibraries()
      .then(setLibraries)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  if (error) return <div className="pa-empty">无法读取策略库：{error}</div>
  if (!libraries.length) return <div className="pa-empty">正在读取两套策略知识库…</div>

  return (
    <div className="pa-library-grid">
      {libraries.map((library) => (
        <section key={library.profile} className={`pa-library-card ${profile === library.profile ? 'current' : ''}`}>
          <header>
            <div>
              <strong>{library.label}</strong>
              <span>{library.files.length} 个策略文件</span>
            </div>
            {profile === library.profile && <em>当前使用</em>}
          </header>
          <p>{library.profile === 'stable'
            ? '原稳定价格行为策略库：偏重可验证的二阶段诊断与决策。'
            : '激进价格行为策略库：含连续性校验、双止盈与未来走势预期。'}</p>
          <div className="pa-library-files">
            {library.files.map((file) => <code key={file.path}>{file.path}</code>)}
          </div>
        </section>
      ))}
    </div>
  )
}
