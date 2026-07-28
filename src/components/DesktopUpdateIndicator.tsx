import { CloudDownloadOutlined } from '@ant-design/icons'
import { Badge, Popover } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import { IconBtn } from '../styles'
import {
  checkForDesktopUpdate,
  isDesktopApp,
  isDesktopUpdateSkipped,
  skipDesktopUpdate,
} from '../platform/desktopUpdates'
import { DesktopUpdatePanel } from './DesktopUpdatePanel'

const INITIAL_CHECK_DELAY_MS = 5_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

export function DesktopUpdateIndicator() {
  const updateRef = useRef<Update | null>(null)
  const checkingRef = useRef(false)
  const [update, setUpdate] = useState<Update | null>(null)
  const [open, setOpen] = useState(false)

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
        setOpen(true)
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

  if (!update) return null

  const skip = () => {
    skipDesktopUpdate(update.version)
    setOpen(false)
    setUpdate(null)
    updateRef.current = null
    void update.close()
  }

  return (
    <Popover
      content={<DesktopUpdatePanel update={update} onSkip={skip} popover />}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
    >
      <Badge dot color="#7357e8" offset={[-5, 5]}>
        <IconBtn
          aria-label={`FoxChat ${update.version} update available`}
          shape="circle"
          icon={<CloudDownloadOutlined />}
        />
      </Badge>
    </Popover>
  )
}
