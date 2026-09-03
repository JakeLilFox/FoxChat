import './polyfills/promiseWithResolvers.ts'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { matrixService } from './matrix/MatrixClientService.ts'
import { installGlobalErrorLogging, reportClientError } from './platform/errorLogging.ts'

installGlobalErrorLogging()

await matrixService.hydrateNativeAccounts().catch((error) => {
  reportClientError('startup', 'Could not hydrate Android native Matrix accounts', error)
  throw error
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
