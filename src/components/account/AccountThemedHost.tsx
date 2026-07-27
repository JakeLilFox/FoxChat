import { AccountManagerHost } from './AccountManagerHost'
import { AccountModeSetting } from './AccountModeSetting'
import { RoomActionsHost } from '../rooms'
import { type ThemeMode } from '../../lib/constants'
import { useEffect, useState } from 'react'
import { ConfigProvider, theme } from 'antd'

export function AccountThemedHost() {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem('foxchat-theme') as ThemeMode) || 'light',
  )
  useEffect(() => {
    const refresh = () => setMode((localStorage.getItem('foxchat-theme') as ThemeMode) || 'light')
    window.addEventListener('foxchat-accounts', refresh)
    return () => window.removeEventListener('foxchat-accounts', refresh)
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
      <AccountManagerHost />
      <AccountModeSetting />
      <RoomActionsHost />
    </ConfigProvider>
  )
}
