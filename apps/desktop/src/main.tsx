import React from 'react'
import ReactDOM from 'react-dom/client'
import * as echarts from 'echarts'
import App from './App'
import './styles/globals.css'
import './styles/pa.css'

// 暴露 echarts 到 window，便于调试/测试读取图表状态（如 dataZoom start/end）
;(window as unknown as { echarts?: typeof echarts }).echarts = echarts

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
