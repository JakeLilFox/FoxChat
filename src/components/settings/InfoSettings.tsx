import { BUILD_VERSION } from '../../lib/constants'
import { formatFileSize } from '../../lib/format'
import {
  clearMediaCache,
  mediaCacheUsage,
  type MediaCacheCategory,
} from '../../lib/mediaCache'
import { Button, Descriptions, Divider, List as AntList, Typography, App as AntApp } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import { checkForDesktopUpdate, isDesktopApp } from '../../platform/desktopUpdates'
import { DesktopUpdatePanel } from '../DesktopUpdatePanel'

type CheckStatus =
  | { kind: 'idle' }
  | { kind: 'current'; version: string }
  | { kind: 'error'; message: string }

const CACHE_CATEGORY_LABELS: Record<MediaCacheCategory, string> = {
  'my-stickers': 'Your stickers and emoji',
  'other-stickers': 'Other stickers and emoji',
  'message-image': 'Message images',
  'message-media': 'Videos, voice messages and files',
  opengraph: 'Link preview images',
  avatar: 'Profile pictures',
}

function MediaCacheSettings() {
  const { message } = AntApp.useApp()
  const [usage, setUsage] = useState<Record<MediaCacheCategory, { count: number; bytes: number }>>()
  const [clearing, setClearing] = useState<MediaCacheCategory | 'all'>()

  const refresh = () => void mediaCacheUsage().then(setUsage)
  useEffect(refresh, [])

  const clear = async (category?: MediaCacheCategory) => {
    setClearing(category ?? 'all')
    try {
      await clearMediaCache(category)
      refresh()
      message.success(category ? `${CACHE_CATEGORY_LABELS[category]} cache cleared` : 'Image cache cleared')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not clear the cache')
    } finally {
      setClearing(undefined)
    }
  }

  const rows = usage
    ? (Object.keys(CACHE_CATEGORY_LABELS) as MediaCacheCategory[]).map((category) => ({
        category,
        ...usage[category],
      }))
    : []
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0)

  return (
    <>
      <Divider />
      <h3>Image cache</h3>
      <Typography.Paragraph type="secondary">
        Stickers, message images, link previews, and profile pictures are cached on this device so
        rooms load without re-downloading everything on every restart. Each kind is kept and
        cleaned up separately.
      </Typography.Paragraph>
      <AntList
        bordered
        loading={!usage}
        dataSource={rows}
        renderItem={(row) => (
          <AntList.Item
            actions={[
              <Button
                key="clear"
                size="small"
                danger
                type="text"
                icon={<DeleteOutlined />}
                loading={clearing === row.category}
                disabled={!row.count}
                onClick={() => void clear(row.category)}
              >
                Clear
              </Button>,
            ]}
          >
            <AntList.Item.Meta
              title={CACHE_CATEGORY_LABELS[row.category]}
              description={`${row.count} image${row.count === 1 ? '' : 's'} · ${formatFileSize(row.bytes)}`}
            />
          </AntList.Item>
        )}
      />
      <Button
        danger
        style={{ marginTop: 12 }}
        loading={clearing === 'all'}
        disabled={!usage || !totalBytes}
        onClick={() => void clear()}
      >
        Clear all image cache ({formatFileSize(totalBytes)})
      </Button>
    </>
  )
}

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
      <MediaCacheSettings />
    </div>
  )
}
