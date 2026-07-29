import type { Update } from '@tauri-apps/plugin-updater'
import { createContext, useContext } from 'react'

export type DesktopUpdateContextValue = {
  update: Update | null
  autoOpenPending: boolean
  consumeAutoOpen: () => void
  skipUpdate: () => void
}

export const DesktopUpdateContext = createContext<DesktopUpdateContextValue | undefined>(undefined)

export function useDesktopUpdate() {
  const value = useContext(DesktopUpdateContext)
  if (!value) throw new Error('useDesktopUpdate must be used inside DesktopUpdateProvider')
  return value
}
