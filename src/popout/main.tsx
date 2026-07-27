import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PopoutApp } from './PopoutApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PopoutApp />
  </StrictMode>,
)
