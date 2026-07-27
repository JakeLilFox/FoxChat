import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ApiSpecs from './ApiSpecs'
import './apiSpecs.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiSpecs />
  </StrictMode>,
)
