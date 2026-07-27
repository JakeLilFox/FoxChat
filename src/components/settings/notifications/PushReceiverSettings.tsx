import { DevJson, devJson } from '../../../styles'
import { useCallback, useEffect, useState } from 'react'
import {
  Avatar,
  Button,
  Collapse,
  Popconfirm,
  Spin,
  Tag,
  App as AntApp,
  List as AntList,
} from 'antd'
import { BellOutlined } from '@ant-design/icons'
import { matrixService } from '../../../matrix/MatrixClientService'
import {
  registerMatrixPush,
  syncNativeCryptoNow,
  testNativeCryptoWithLoadedEvent,
} from '../../../platform/push'
import { roomIdFromUrl } from '../../../lib/urlState'
import { RoomType } from 'matrix-js-sdk'

type NativeCryptoAccountStatus = {
  userId: string
  deviceId: string
  lastSyncAt: number
  exportedSessions: number
  importedSessions: number
  importTotal: number
  lastDecryptAt: number
  lastSyncError?: string | null
  lastDecryptError?: string | null
  backupConfigured?: boolean
  setupState?: string
  setupStartedAt?: number
  setupHeartbeatAt?: number
  setupPhase?: string
  setupError?: string | null
  setupErrorDetails?: string | null
}
type NotificationDiagnostic = {
  at: number
  outcome: string
  roomId?: string
  roomRef?: string
  eventId: string
  error?: string | null
  errorDetails?: string | null
  requestStage?: string | null
  httpStatus?: number | null
  matrixErrorCode?: string | null
  matrixErrorMessage?: string | null
  likelyCause?: string | null
}
type NativeCryptoStatus = {
  available: boolean
  enabled: boolean
  bootStage?: string
  bootStageAt?: number
  notificationDiagnostics?: NotificationDiagnostic[]
  accounts: NativeCryptoAccountStatus[]
}
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const details = error as Record<string, unknown>
    const message = ['message', 'error', 'reason', 'cause']
      .map((key) => details[key])
      .find((value) => typeof value === 'string' && value.trim())
    if (typeof message === 'string') {
      const code =
        typeof details.errcode === 'string'
          ? details.errcode
          : typeof details.code === 'string'
            ? details.code
            : undefined
      return code && !message.includes(code) ? `${code}: ${message}` : message
    }
    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') return serialized
    } catch {}
  }
  return fallback
}

const nativeInvoke = <T,>(command: string, args?: Record<string, unknown>) =>
  (
    window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
      }
    }
  ).__TAURI_INTERNALS__?.invoke<T>(command, args)

export type PushReceiver = {
  accountId: string
  userId: string
  appId: string
  pushkey: string
  kind: string | null
  appName: string
  deviceName: string
  profileTag?: string
  url?: string
  data: Record<string, unknown>
}
export function PushReceiverSettings() {
  const { message } = AntApp.useApp()
  const [receivers, setReceivers] = useState<PushReceiver[]>([])
  const [loading, setLoading] = useState(false)
  const [cryptoStatus, setCryptoStatus] = useState<NativeCryptoStatus>()
  const [cryptoTesting, setCryptoTesting] = useState(false)
  const [autoTesting, setAutoTesting] = useState(false)
  const loadCryptoStatus = useCallback(async () => {
    const result = await nativeInvoke<NativeCryptoStatus>('plugin:remote-push|native_crypto_status')
    setCryptoStatus(result)
  }, [])
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.all(
        matrixService.availableAccounts().map(async (account) => {
          const pushers = (await account.client.getPushers()).pushers
          return pushers.map((pusher) => ({
            accountId: account.id,
            userId: account.userId,
            appId: pusher.app_id,
            pushkey: pusher.pushkey,
            kind: pusher.kind,
            appName: pusher.app_display_name,
            deviceName: pusher.device_display_name,
            profileTag: pusher.profile_tag,
            url: typeof pusher.data?.url === 'string' ? pusher.data.url : undefined,
            data: pusher.data as Record<string, unknown>,
          }))
        }),
      )
      setReceivers(results.flat())
      await loadCryptoStatus().catch(() => setCryptoStatus(undefined))
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not load push receivers')
    } finally {
      setLoading(false)
    }
  }, [message, loadCryptoStatus])
  useEffect(() => {
    void load()
  }, [load])
  const remove = async (receiver: PushReceiver) => {
    const account = matrixService.availableAccounts().find((item) => item.id === receiver.accountId)
    if (!account) return
    try {
      await account.client.removePusher(receiver.pushkey, receiver.appId)
      await load()
      message.success('Push receiver removed')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not remove push receiver')
    }
  }
  const reconcile = async () => {
    setLoading(true)
    try {
      const accounts = matrixService.availableAccounts()
      if (!accounts.length) throw new Error('No signed-in Matrix account is available')
      const results = await Promise.allSettled(
        accounts.map((account) => registerMatrixPush(account.client)),
      )
      await load()
      const failures = results.flatMap((result, index) =>
        result.status === 'rejected'
          ? [
              `${accounts[index].userId}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
            ]
          : [],
      )
      if (failures.length) throw new Error(failures.join('\n'))
      message.success(
        `Push registration verified for ${accounts.length} account${accounts.length === 1 ? '' : 's'}`,
      )
    } catch (error) {
      message.error({
        content: error instanceof Error ? error.message : 'Could not refresh push registration',
        duration: 8,
      })
    } finally {
      setLoading(false)
    }
  }
  const testNativeDecryption = async () => {
    setCryptoTesting(true)
    try {
      const accounts = matrixService.availableAccounts()
      if (!accounts.length) throw new Error('No signed-in Matrix account is available')
      await Promise.all(accounts.map((account) => syncNativeCryptoNow(account.client)))
      await loadCryptoStatus()
      const tests = await Promise.allSettled(
        accounts.map((account) => testNativeCryptoWithLoadedEvent(account.client, true)),
      )
      const successfulTest = tests.find((test) => test.status === 'fulfilled' && test.value?.ok)
      const result = successfulTest?.status === 'fulfilled' ? successfulTest.value : undefined
      if (!result) {
        const failure = tests.find((test) => test.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
        throw new Error(
          'No decrypted encrypted event is currently loaded. Open an encrypted room with messages and try again.',
        )
      }
      message.success({
        content: `Native decryption worked: ${result.senderId || 'Someone'}: ${result.body}`,
        duration: 10,
      })
    } catch (error) {
      message.error({
        content: errorMessage(error, 'Could not sync keys or test native decryption'),
        duration: 12,
      })
    } finally {
      await loadCryptoStatus().catch(() => undefined)
      setCryptoTesting(false)
    }
  }
  const copyCryptoDiagnostics = async () => {
    if (!cryptoStatus) return
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            userAgent: navigator.userAgent,
            nativeCrypto: cryptoStatus,
          },
          null,
          2,
        ),
      )
      message.success('Native crypto diagnostics copied')
    } catch (error) {
      message.error(errorMessage(error, 'Could not copy native crypto diagnostics'))
    }
  }
  const testAndroidAuto = async () => {
    setAutoTesting(true)
    try {
      const selectedRoomId = roomIdFromUrl()
      const room =
        (selectedRoomId ? matrixService.room(selectedRoomId) : undefined) ??
        matrixService
          .rooms()
          .find(
            (candidate) =>
              candidate.getMyMembership() === 'join' && candidate.getType() !== RoomType.Space,
          )
      if (!room) throw new Error('Open or join a chat before posting a test notification')
      await nativeInvoke<void>('plugin:remote-push|test_android_auto_notification', {
        roomId: room.roomId,
        roomName: room.name,
        senderName: 'FoxChat Android Auto test',
        body: 'Reply to this message from Android Auto to test FoxChat.',
      })
      await loadCryptoStatus()
      message.success({
        content: `Android Auto test notification posted for ${room.name}. Replies are sent to this real room.`,
        duration: 10,
      })
    } catch (error) {
      message.error({
        content: errorMessage(error, 'Could not post Android Auto test notification'),
        duration: 10,
      })
    } finally {
      setAutoTesting(false)
    }
  }
  return (
    <div>
      <h2>Push notification receivers</h2>
      <p>
        These HTTP pushers are registered on your Matrix accounts. The homeserver sends matching
        notifications to their gateway URLs.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Button type="primary" loading={loading} onClick={() => void reconcile()}>
          Re-register this device
        </Button>
        <Button loading={loading} onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      <Spin spinning={loading}>
        <AntList
          bordered
          dataSource={receivers}
          locale={{ emptyText: 'No push receivers registered' }}
          renderItem={(receiver) => (
            <AntList.Item
              actions={[
                <Popconfirm
                  key="remove"
                  title="Remove this push receiver?"
                  description="Notifications will stop for that receiver until it is registered again."
                  onConfirm={() => void remove(receiver)}
                >
                  <Button danger size="small">
                    Remove
                  </Button>
                </Popconfirm>,
              ]}
            >
              <AntList.Item.Meta
                avatar={
                  <Avatar
                    style={{
                      background: receiver.kind === 'http' ? '#7357e8' : '#697386',
                    }}
                  >
                    <BellOutlined />
                  </Avatar>
                }
                title={
                  <>
                    {receiver.appName || receiver.appId}{' '}
                    <Tag color={receiver.kind === 'http' ? 'processing' : 'default'}>
                      {receiver.kind || 'disabled'}
                    </Tag>
                  </>
                }
                description={
                  <div style={{ overflowWrap: 'anywhere' }}>
                    <b>{receiver.userId}</b>
                    <br />
                    {receiver.deviceName || 'Unknown device'} ·{' '}
                    <code>{receiver.profileTag || 'no profile tag'}</code>
                    <br />
                    <span>{receiver.url || 'No gateway URL'}</span>
                    <br />
                    <small>App ID: {receiver.appId}</small>
                    <br />
                    <small>
                      Push key: <code>{receiver.pushkey}</code>
                    </small>
                    <Collapse
                      size="small"
                      ghost
                      items={[
                        {
                          key: 'data',
                          label: 'Pusher data',
                          children: <DevJson>{devJson(receiver.data)}</DevJson>,
                        },
                      ]}
                    />
                  </div>
                }
              />
            </AntList.Item>
          )}
        />
      </Spin>
      <h3 style={{ marginTop: 20 }}>Native notification decryption</h3>
      <p>
        Setup runs automatically after sign-in. Room keys are copied from the WebView crypto store
        into the encrypted Android notification store and FoxChat validates decryption when an
        encrypted event is available. A synced key store means the copy completed; it does not claim
        that every individual message session is already present in key backup.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Button loading={cryptoTesting} onClick={() => void testNativeDecryption()}>
          Run decryption diagnostic
        </Button>
        <Button disabled={cryptoTesting} onClick={() => void loadCryptoStatus()}>
          Refresh crypto status
        </Button>
        <Button disabled={!cryptoStatus} onClick={() => void copyCryptoDiagnostics()}>
          Copy diagnostics
        </Button>
        <Button loading={autoTesting} onClick={() => void testAndroidAuto()}>
          Post Android Auto test
        </Button>
      </div>
      {!cryptoStatus ? (
        <Tag color="default">Native crypto status unavailable</Tag>
      ) : (
        <>
          <div style={{ marginBottom: 10 }}>
            <Tag color={cryptoStatus.enabled ? 'success' : 'default'}>
              Native background decrypt{' '}
              {cryptoStatus.enabled
                ? 'enabled'
                : cryptoStatus.accounts.some((account) => account.setupState === 'pending')
                  ? 'setting up'
                  : 'not ready'}
            </Tag>
            {cryptoStatus.bootStage && <small>Last boot stage: {cryptoStatus.bootStage}</small>}
          </div>
          {cryptoStatus.accounts.length === 0 ? (
            <Tag color="warning">No keys have reached Android yet</Tag>
          ) : (
            <AntList
              bordered
              dataSource={cryptoStatus.accounts}
              renderItem={(account) => (
                <AntList.Item>
                  <div style={{ overflowWrap: 'anywhere', width: '100%' }}>
                    <b>{account.userId}</b>{' '}
                    <Tag
                      color={
                        account.setupError || account.lastSyncError || account.lastDecryptError
                          ? 'error'
                          : account.setupState === 'pending'
                            ? 'processing'
                            : account.exportedSessions > 0
                              ? 'success'
                              : 'warning'
                      }
                    >
                      {account.setupError
                        ? 'setup error'
                        : account.lastDecryptError
                          ? 'last decrypt failed'
                          : account.lastSyncError
                            ? 'key sync failed'
                            : account.setupState === 'pending'
                              ? 'setting up'
                              : account.exportedSessions > 0
                                ? 'key store synced'
                                : 'no room keys synced'}
                    </Tag>
                    <br />
                    <small>
                      Device: <code>{account.deviceId}</code>
                    </small>
                    <br />
                    <small>
                      Last key sync:{' '}
                      {account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : 'never'}
                    </small>
                    <br />
                    <small>
                      Latest sync: {account.importTotal || account.exportedSessions} sessions
                      checked · {account.importedSessions} newly imported
                    </small>
                    <br />
                    <small>
                      Key backup recovery:{' '}
                      {account.backupConfigured ? 'configured' : 'not available'}
                    </small>
                    <br />
                    <small>
                      Last native decrypt:{' '}
                      {account.lastDecryptAt
                        ? new Date(account.lastDecryptAt).toLocaleString()
                        : 'never'}
                    </small>
                    {account.setupPhase && (
                      <>
                        <br />
                        <small>
                          Setup phase: <code>{account.setupPhase}</code>
                        </small>
                      </>
                    )}
                    {!!account.setupHeartbeatAt && (
                      <>
                        <br />
                        <small>
                          Last setup activity: {new Date(account.setupHeartbeatAt).toLocaleString()}
                        </small>
                      </>
                    )}
                    {account.setupError && (
                      <>
                        <br />
                        <Tag color="error">{account.setupError}</Tag>
                      </>
                    )}
                    {account.lastSyncError && (
                      <>
                        <br />
                        <Tag color="error">{account.lastSyncError}</Tag>
                      </>
                    )}
                    {account.lastDecryptError && (
                      <>
                        <br />
                        <Tag color="error">{account.lastDecryptError}</Tag>
                      </>
                    )}
                    {account.setupErrorDetails && (
                      <Collapse
                        size="small"
                        ghost
                        items={[
                          {
                            key: 'setup-error-details',
                            label: 'Setup error details',
                            children: <DevJson>{account.setupErrorDetails}</DevJson>,
                          },
                        ]}
                      />
                    )}
                  </div>
                </AntList.Item>
              )}
            />
          )}
          {!!cryptoStatus.notificationDiagnostics?.length && (
            <Collapse
              style={{ marginTop: 12 }}
              items={[
                {
                  key: 'notification-diagnostics',
                  label: `Recent background decrypt attempts (${cryptoStatus.notificationDiagnostics.length})`,
                  children: (
                    <AntList
                      size="small"
                      dataSource={[...cryptoStatus.notificationDiagnostics].reverse()}
                      renderItem={(entry) => (
                        <AntList.Item>
                          <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                            <Tag
                              color={
                                entry.outcome.endsWith('decrypted') ||
                                entry.outcome.includes('succeeded')
                                  ? 'success'
                                  : entry.outcome.includes('failed') ||
                                      entry.outcome === 'timed-out'
                                    ? 'error'
                                    : 'default'
                              }
                            >
                              {entry.outcome}
                            </Tag>
                            <small>{new Date(entry.at).toLocaleString()}</small>
                            <br />
                            <small>
                              Room: <code>{entry.roomRef || entry.roomId || 'unknown'}</code>
                            </small>
                            <br />
                            <small>
                              Event: <code>{entry.eventId}</code>
                            </small>
                            {entry.requestStage && (
                              <>
                                <br />
                                <small>
                                  Request stage: <code>{entry.requestStage}</code>
                                  {entry.httpStatus ? ` · HTTP ${entry.httpStatus}` : ''}
                                </small>
                              </>
                            )}
                            {entry.matrixErrorCode && (
                              <>
                                <br />
                                <small>
                                  Matrix error: <code>{entry.matrixErrorCode}</code>
                                  {entry.matrixErrorMessage ? ` · ${entry.matrixErrorMessage}` : ''}
                                </small>
                              </>
                            )}
                            {entry.likelyCause && (
                              <>
                                <br />
                                <Tag color="warning">{entry.likelyCause}</Tag>
                              </>
                            )}
                            {entry.error && (
                              <>
                                <br />
                                <Tag color="error">{entry.error}</Tag>
                              </>
                            )}
                            {entry.errorDetails && <DevJson>{entry.errorDetails}</DevJson>}
                          </div>
                        </AntList.Item>
                      )}
                    />
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </div>
  )
}
