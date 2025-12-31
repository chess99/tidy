/**
 * input: 浏览器 DOM + React 运行时
 * output: 挂载应用到页面根节点
 * pos: 客户端入口：渲染 App 并加载全局样式（变更需同步更新本头注释与所属目录 README）
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
