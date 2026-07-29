import type { Update } from '@tauri-apps/plugin-updater'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  checkForDesktopUpdate,
  isDesktopApp,
  isDesktopUpdateSkipped,
  skipDesktopUpdate,
} from '../platform/desktopUpdates'
import { DesktopUpdateContext } from './desktopUpdateContext'

const INITIAL_CHECK_DELAY_MS = 5_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

export function DesktopUpdateProvider({ children }: { children: ReactNode }) {
  const updateRef = useRef<Update | null>(null)
  const checkingRef = useRef(false)
  const autoPopupQueuedRef = useRef(false)
  const [update, setUpdate] = useState<Update | null>(null)
  const [autoOpenPending, setAutoOpenPending] = useState(false)

  useEffect(() => {
    if (!isDesktopApp()) return
    let disposed = false

    const checkForUpdate = async () => {
      if (checkingRef.current || updateRef.current) return
      checkingRef.current = true
      try {
        const { update: available } = await checkForDesktopUpdate()
        if (disposed) {
          await available?.close()
          return
        }
        if (!available) return
        if (isDesktopUpdateSkipped(available.version)) {
          await available.close()
          return
        }
        updateRef.current = available
        setUpdate(available)
        if (!autoPopupQueuedRef.current) {
          autoPopupQueuedRef.current = true
          setAutoOpenPending(true)
        }
      } catch (checkError) {
        // A failed background check should stay quiet. The manual check in
        // Settings > Info exposes the error when the user asks for details.
        console.info('FoxChat update check did not complete', checkError)
      } finally {
        checkingRef.current = false
      }
    }

    const initialCheck = window.setTimeout(() => void checkForUpdate(), INITIAL_CHECK_DELAY_MS)
    const interval = window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS)
    return () => {
      disposed = true
      window.clearTimeout(initialCheck)
      window.clearInterval(interval)
      const current = updateRef.current
      updateRef.current = null
      if (current) void current.close()
    }
  }, [])

  const consumeAutoOpen = useCallback(() => setAutoOpenPending(false), [])
  const skipUpdate = useCallback(() => {
    const current = updateRef.current
    if (!current) return
    skipDesktopUpdate(current.version)
    updateRef.current = null
    setAutoOpenPending(false)
    setUpdate(null)
    void current.close()
  }, [])

  const value = useMemo(
    () => ({ update, autoOpenPending, consumeAutoOpen, skipUpdate }),
    [autoOpenPending, consumeAutoOpen, skipUpdate, update],
  )

  return <DesktopUpdateContext value={value}>{children}</DesktopUpdateContext>
}
