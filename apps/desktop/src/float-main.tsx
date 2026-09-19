import React from 'react'
import ReactDOM from 'react-dom/client'
import FloatApp from './float'
import './styles/globals.css'
import InputMemoryManager from './components/InputMemoryManager'

ReactDOM.createRoot(document.getElementById('root')!).render(<><FloatApp /><InputMemoryManager /></>)
