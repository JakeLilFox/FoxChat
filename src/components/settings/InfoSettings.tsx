import { BUILD_VERSION } from '../../lib/constants'
import { Button, Descriptions, Divider, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import { checkForDesktopUpdate, isDesktopApp } from '../../platform/desktopUpdates'
import { DesktopUpdatePanel } from '../DesktopUpdatePanel'

type CheckStatus =
  | { kind: 'idle' }
  | { kind: 'current'; version: string }
  | { kind: 'error'; message: string }

export function InfoSettings() {
  const desktop = isDesktopApp()
  const updateRef = useRef<Update | null>(null)
  const [update, setUpdate] = useState<Update | null>(null)
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<CheckStatus>({ kind: 'idle' })

  useEffect(
    () => () => {
      const current = updateRef.current
      updateRef.current = null
      if (current) void current.close()
    },
    [],
  )

  const checkNow = async () => {
    if (checking) return
    setChecking(true)
    setStatus({ kind: 'idle' })
    const previous = updateRef.current
    updateRef.current = null
    setUpdate(null)
    if (previous) await previous.close().catch(() => undefined)
    try {
      const result = await checkForDesktopUpdate()
      if (result.update) {
        updateRef.current = result.update
        setUpdate(result.update)
      } else {
        setStatus({ kind: 'current', version: result.currentVersion })
      }
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The update check failed.',
      })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div>
      <h2>Info</h2>
      <Descriptions
        column={1}
        bordered
        size="small"
        items={[
          {
            key: 'build',
            label: 'Build number',
            children: <code>{BUILD_VERSION}</code>,
          },
          {
            key: 'author',
            label: 'Made by',
            children: (
              <>
                <a href="https://jakefox.de" target="_blank" rel="noreferrer">
                  jakefox
                </a>{' '}
                with &lt;3
              </>
            ),
          },
        ]}
      />
      {desktop && (
        <>
          <Divider />
          <h3>Desktop updates</h3>
          <Typography.Paragraph type="secondary">
            Check for a signed FoxChat desktop release and install it without leaving the app.
          </Typography.Paragraph>
          <Button loading={checking} onClick={() => void checkNow()}>
            {checking ? 'Checking for updates…' : 'Check for updates'}
          </Button>
          {status.kind === 'current' && (
            <Typography.Paragraph type="success" style={{ marginTop: 12 }}>
              FoxChat {status.version} is up to date.
            </Typography.Paragraph>
          )}
          {status.kind === 'error' && (
            <Typography.Paragraph type="danger" style={{ marginTop: 12 }}>
              Update check failed: {status.message}
            </Typography.Paragraph>
          )}
          {update && (
            <div style={{ marginTop: 16 }}>
              <DesktopUpdatePanel update={update} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
