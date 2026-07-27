import './polyfills/promiseWithResolvers.ts'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { matrixService } from './matrix/MatrixClientService.ts'

await matrixService.hydrateNativeAccounts()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
