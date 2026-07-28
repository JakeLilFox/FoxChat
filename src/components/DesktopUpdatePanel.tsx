import { Button, Progress, Typography } from 'antd'
import { useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'

type DownloadState = {
  downloaded: number
  total?: number
}

export function DesktopUpdatePanel({
  update,
  onSkip,
  popover = false,
}: {
  update: Update
  onSkip?: () => void
  popover?: boolean
}) {
  const [installing, setInstalling] = useState(false)
  const [download, setDownload] = useState<DownloadState>({ downloaded: 0 })
  const [error, setError] = useState<string>()

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

  return (
    <div
      style={
        popover
          ? {
              width: 280,
              maxWidth: 'calc(100vw - 32px)',
            }
          : undefined
      }
    >
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Button type="primary" size="small" loading={installing} onClick={() => void install()}>
          {installing ? 'Installing…' : 'Update and restart'}
        </Button>
        {onSkip && (
          <Button type="text" size="small" disabled={installing} onClick={onSkip}>
            Skip this update
          </Button>
        )}
      </div>
    </div>
  )
}
