import { useMemo } from 'react'
import { useBacktest } from '../../store/backtest'

export default function DataDownloadPanel() {
  const dataStatus = useBacktest((s) => s.dataStatus)
  const downloading = useBacktest((s) => s.downloading)
  const downloadMsg = useBacktest((s) => s.downloadMsg)
  const startDownload = useBacktest((s) => s.startDownload)
  const startSync = useBacktest((s) => s.startSync)

  const percent = useMemo(() => {
    if (downloadMsg?.type === 'progress' && downloadMsg.total > 0) {
      return Math.min(100, Math.round((downloadMsg.done / downloadMsg.total) * 100))
    }
    return 0
  }, [downloadMsg])

  if (dataStatus?.exists) {
    return (
      <div className="data-bar ok">
        <span className="data-bar-title">✓ 行情库已就绪</span>
        <span className="data-bar-item">{dataStatus.stocksCount ?? 0} 只股票</span>
        <span className="data-bar-item">{(dataStatus.dailyRows ?? 0).toLocaleString()} 行日线</span>
        <span className="data-bar-item">
          {dataStatus.dateFrom} ~ {dataStatus.dateTo}
        </span>
        {dataStatus.dbVersion && (
          <span className="data-bar-item">版本 {dataStatus.dbVersion}</span>
        )}
        {dataStatus.lastSync && (
          <span className="data-bar-item">同步于 {dataStatus.lastSync}</span>
        )}
        <span className="data-bar-spacer" />
        {!downloading ? (
          <>
            <button className="btn primary" onClick={() => void startSync()}>
              增量同步并校验修复
            </button>
            <button className="btn" onClick={() => void startDownload()}>
              全量补齐
            </button>
          </>
        ) : (
          <div className="download-progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.max(3, percent)}%` }} />
            </div>
            <span className="progress-text">
              {downloadMsg?.type === 'progress'
                ? `${downloadMsg.done}/${downloadMsg.total} 只 · ${downloadMsg.rows.toLocaleString()} 行`
                : downloadMsg?.type === 'log' ? downloadMsg.message : '正在准备同步…'}
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="data-bar warn">
      <span className="data-bar-title">回测行情库未就绪</span>
      <span className="data-bar-item">
        未检测到数据。方式一：点"下载数据"（AkShare 新浪源，全量约 1-2 小时，可断点续传）；
        方式二：把数据文件 stock_data.db 放入本软件目录下的 data\ 文件夹后重启应用
      </span>
      <span className="data-bar-spacer" />
      {!downloading ? (
        <button className="btn primary" onClick={() => void startDownload()}>
          下载数据
        </button>
      ) : (
        <div className="download-progress">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.max(3, percent)}%` }} />
          </div>
          <span className="progress-text">
            {downloadMsg?.type === 'progress'
              ? `${downloadMsg.done}/${downloadMsg.total} 只 · ${downloadMsg.rows.toLocaleString()} 行`
              : '正在启动下载…'}
          </span>
        </div>
      )}
    </div>
  )
}
