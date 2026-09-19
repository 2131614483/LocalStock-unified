import React from 'react'
import ReactDOM from 'react-dom/client'
import MonitorApp from './monitor'
import './styles/globals.css'
import InputMemoryManager from './components/InputMemoryManager'

ReactDOM.createRoot(document.getElementById('root')!).render(<><MonitorApp /><InputMemoryManager /></>)
