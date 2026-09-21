import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new Event('recipe-update-ready'))
  },
  onRegisterError(error) {
    console.warn('オフライン用ファイルの準備を再試行してください。', error)
  },
})
window.addEventListener('recipe-apply-update', () => {
  void updateSW(true)
})
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
