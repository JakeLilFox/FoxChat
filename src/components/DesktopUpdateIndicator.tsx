import { CloudDownloadOutlined } from '@ant-design/icons'
import { Badge, Button, Popover, Progress, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import { IconBtn } from '../styles'
import { isDesktopApp, isDesktopUpdateSkipped, skipDesktopUpdate } from '../platform/desktopUpdates'

const INITIAL_CHECK_DELAY_MS = 5_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

type DownloadState = {
  downloaded: number
  total?: number
}

export function DesktopUpdateIndicator() {
  const updateRef = useRef<Update | null>(null)
  const checkingRef = useRef(false)
  const [update, setUpdate] = useState<Update | null>(null)
  const [open, setOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [download, setDownload] = useState<DownloadState>({ downloaded: 0 })
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!isDesktopApp()) return
    let disposed = false

    const checkForUpdate = async () => {
      if (checkingRef.current || updateRef.current) return
      checkingRef.current = true
      try {
        const { BundleType, getBundleType } = await import('@tauri-apps/api/app')
        const bundleType = await getBundleType()
        if (
          ![BundleType.Nsis, BundleType.Msi, BundleType.AppImage, BundleType.App].includes(
            bundleType,
          )
        )
          return
        const { check } = await import('@tauri-apps/plugin-updater')
        const available = await check({ timeout: 15_000 })
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
      } catch (checkError) {
        // A failed background check should stay quiet. The next scheduled check
        // will try again without interrupting the user.
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

  const install = async () => {
    setInstalling(true)
    setError(undefined)
    setDownload({ downloaded: 0 })
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          setDownload({ downloaded: 0, total: event.data.contentLength })
        } else if (event.event === 'Progress') {
          setDownload((current) => ({
            ...current,
            downloaded: current.downloaded + event.data.chunkLength,
          }))
        }
      })
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (installError) {
      setError(
        installError instanceof Error ? installError.message : 'The update could not be installed.',
      )
      setInstalling(false)
    }
  }

  const percent = download.total
    ? Math.min(100, Math.round((download.downloaded / download.total) * 100))
    : undefined

  const content = (
    <div style={{ width: 280, maxWidth: 'calc(100vw - 32px)' }}>
      <Typography.Text strong>FoxChat {update.version} is ready</Typography.Text>
      <Typography.Paragraph
        type="secondary"
        style={{ margin: '5px 0 12px', maxHeight: 92, overflow: 'auto', whiteSpace: 'pre-wrap' }}
      >
        {update.body || 'A new desktop version is available.'}
      </Typography.Paragraph>
      {installing && (
        <Progress
          percent={percent}
          status="active"
          showInfo={percent !== undefined}
          size="small"
          style={{ marginBottom: 10 }}
        />
      )}
      {error && (
        <Typography.Paragraph type="danger" style={{ margin: '0 0 10px', fontSize: 12 }}>
          {error}
        </Typography.Paragraph>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Button type="primary" size="small" loading={installing} onClick={() => void install()}>
          {installing ? 'Installing…' : 'Update and restart'}
        </Button>
        <Button type="text" size="small" disabled={installing} onClick={skip}>
          Skip this update
        </Button>
      </div>
    </div>
  )

  return (
    <Popover
      content={content}
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
