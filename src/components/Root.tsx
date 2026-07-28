import { ClientApp } from './ClientApp'
import { Login } from './Login'
import { SharedAttachmentHost } from './SharedAttachmentHost'
import { type AuthState, type ThemeMode } from '../lib/constants'
import { trackActiveScrollbars } from '../lib/scrollbars'
import { EmptyState, GlobalStyle, themes } from '../styles'
import { useEffect, useState } from 'react'
import { ConfigProvider, Spin, theme, App as AntApp } from 'antd'
import { ThemeProvider } from 'styled-components'
import { matrixService } from '../matrix/MatrixClientService'
import { syncNativeBackground } from '../platform/nativeBackground'
import { startAutomationApiIntegration } from '../platform/automationApi'

export function Root() {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem('foxchat-theme') as ThemeMode) || 'light',
  )
  const [auth, setAuth] = useState<AuthState>('loading')
  const toggle = () =>
    setMode((m) => {
      const n = m === 'light' ? 'dark' : 'light'
      localStorage.setItem('foxchat-theme', n)
      document.documentElement.setAttribute('data-theme', n)
      return n
    })
  useEffect(() => {
    syncNativeBackground(mode)
  }, [mode])
  useEffect(() => trackActiveScrollbars(document), [])
  useEffect(() => {
    void matrixService.listenForNotificationDecryptRequests()
    void startAutomationApiIntegration()
  }, [])
  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (event.dataTransfer && [...event.dataTransfer.types].includes('Files'))
        event.preventDefault()
    }
    window.addEventListener('dragover', preventFileNavigation)
    window.addEventListener('drop', preventFileNavigation)
    return () => {
      window.removeEventListener('dragover', preventFileNavigation)
      window.removeEventListener('drop', preventFileNavigation)
    }
  }, [])
  useEffect(() => {
    const session = matrixService.restoreSession()
    if (!session) {
      setAuth('guest')
      return
    }
    setAuth('syncing')
    matrixService
      .start(session)
      .then(() => setAuth('ready'))
      .catch(() => setAuth('guest'))
  }, [])
  return (
    <ConfigProvider
      theme={{
        algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#7357e8',
          borderRadius: 10,
          fontFamily: 'Inter,system-ui,sans-serif',
        },
      }}
    >
      <AntApp>
        <ThemeProvider theme={themes[mode]}>
          <GlobalStyle />
          {auth === 'loading' || auth === 'syncing' ? (
            <EmptyState>
              <Spin size="large" />
              <p>{auth === 'syncing' ? 'Decrypting and synchronizing your rooms…' : 'Loading…'}</p>
            </EmptyState>
          ) : auth === 'guest' ? (
            <Login onReady={() => setAuth('ready')} />
          ) : (
            <>
              <ClientApp mode={mode} onMode={toggle} />
              <SharedAttachmentHost />
            </>
          )}
        </ThemeProvider>
      </AntApp>
    </ConfigProvider>
  )
}
