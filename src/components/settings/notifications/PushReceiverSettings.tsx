import { DevJson, devJson } from '../../../styles'
import { useCallback, useEffect, useState } from 'react'
import {
  Avatar,
  Alert,
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
import { registerMatrixPush } from '../../../platform/push'
import { roomIdFromUrl } from '../../../lib/urlState'
import { RoomType } from 'matrix-js-sdk'
import {
  isAndroidMigrationRetryAvailable,
  isAndroidNativeMatrix,
} from '../../../platform/nativeMatrix'
import { reportClientError } from '../../../platform/errorLogging'

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
  matrixClient?: {
    available: boolean
    owner: 'matrix-rust-sdk'
    accounts: Array<{
      userId: string
      deviceId?: string
      state: 'legacy' | 'staged' | 'adopting' | 'validating' | 'ready' | 'error'
      startedAt?: number
      completedAt?: number
      error?: string | null
      migrationVersion?: number
      retryAvailable?: boolean
      runtimeActive?: boolean
      syncState?: 'idle' | 'running' | 'terminated' | 'error' | 'offline' | null
      watchedRooms?: number
    }>
  }
  clientErrors?: Array<{
    at: string | number
    context: string
    summary: string
    details?: unknown
    callSite?: string
  }>
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
  const [healthChecking, setHealthChecking] = useState(false)
  const [autoTesting, setAutoTesting] = useState(false)
  const [retryingMigration, setRetryingMigration] = useState<string>()
  const loadCryptoStatus = useCallback(async () => {
    const result = await nativeInvoke<NativeCryptoStatus>('plugin:remote-push|native_crypto_status')
    setCryptoStatus(result)
    return result
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
  const checkNativeHealth = async () => {
    setHealthChecking(true)
    try {
      const status = await loadCryptoStatus()
      const native = status?.matrixClient
      if (!native?.available) throw new Error('The Android Matrix Rust client is unavailable')
      if (!native.accounts.length)
        throw new Error('No account has been migrated to the Rust client')
      const unhealthy = native.accounts.filter(
        (account) =>
          account.state !== 'ready' ||
          account.runtimeActive === false ||
          (account.syncState != null && account.syncState !== 'running'),
      )
      if (unhealthy.length)
        throw new Error(
          unhealthy
            .map(
              (account) =>
                `${account.userId}: ${account.error || account.syncState || account.state || 'not running'}`,
            )
            .join('\n'),
        )
      message.success(
        `Rust client is running for ${native.accounts.length} account${native.accounts.length === 1 ? '' : 's'}`,
      )
    } catch (error) {
      reportClientError('native-matrix-health-check', 'Android Matrix health check failed', error)
      message.error({
        content: errorMessage(error, 'Could not read Android Matrix health'),
        duration: 12,
      })
    } finally {
      setHealthChecking(false)
    }
  }
  const retryMigration = async (userId: string) => {
    setRetryingMigration(userId)
    try {
      await matrixService.retryNativeMigration(userId)
      await loadCryptoStatus()
      message.success(`Migration retry started for ${userId}`)
    } catch (error) {
      reportClientError(
        'native-matrix-migration-retry',
        `Could not retry Android Matrix migration for ${userId}`,
        error,
      )
      message.error({
        content: errorMessage(error, `Could not retry migration for ${userId}`),
        duration: 12,
      })
    } finally {
      setRetryingMigration(undefined)
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
            androidMatrix: cryptoStatus.matrixClient,
            notificationFallback: {
              available: cryptoStatus.available,
              enabled: cryptoStatus.enabled,
              bootStage: cryptoStatus.bootStage,
              bootStageAt: cryptoStatus.bootStageAt,
              accounts: cryptoStatus.accounts,
              notificationDiagnostics: cryptoStatus.notificationDiagnostics,
            },
            clientErrors: cryptoStatus.clientErrors,
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
      {isAndroidNativeMatrix() && (
        <>
          <h3 style={{ marginTop: 20 }}>Android Matrix client and notifications</h3>
          <p>
            On Android, the Matrix Rust SDK owns the existing Matrix device, encrypted store, live
            sync, sending, and notification decryption. It keeps running independently of the
            WebView, so killing the WebView does not hand crypto ownership back to the browser
            client. The health check below only reads status; it does not send, decrypt, or change
            account data.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <Button loading={healthChecking} onClick={() => void checkNativeHealth()}>
              Check Rust client health
            </Button>
            <Button disabled={healthChecking} onClick={() => void loadCryptoStatus()}>
              Refresh status
            </Button>
            <Button disabled={!cryptoStatus} onClick={() => void copyCryptoDiagnostics()}>
              Copy diagnostics
            </Button>
            <Button loading={autoTesting} onClick={() => void testAndroidAuto()}>
              Post Android Auto test
            </Button>
          </div>
          {!cryptoStatus ? (
            <Alert type="warning" showIcon message="Android Matrix status is unavailable" />
          ) : (
            <>
              {!cryptoStatus.matrixClient ? (
                <Alert type="error" showIcon message="Matrix Rust client status is missing" />
              ) : cryptoStatus.matrixClient.accounts.length === 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message="No account has been migrated to the Android Matrix client"
                />
              ) : (
                <AntList
                  bordered
                  dataSource={cryptoStatus.matrixClient.accounts}
                  renderItem={(account) => {
                    const healthy =
                      account.state === 'ready' &&
                      account.runtimeActive !== false &&
                      (account.syncState == null || account.syncState === 'running')
                    return (
                      <AntList.Item
                        actions={
                          isAndroidMigrationRetryAvailable(account)
                            ? [
                                <Button
                                  key="retry-migration"
                                  type="primary"
                                  size="small"
                                  loading={retryingMigration === account.userId}
                                  disabled={
                                    retryingMigration !== undefined &&
                                    retryingMigration !== account.userId
                                  }
                                  onClick={() => void retryMigration(account.userId)}
                                >
                                  Retry migration
                                </Button>,
                              ]
                            : undefined
                        }
                      >
                        <div style={{ overflowWrap: 'anywhere', width: '100%' }}>
                          <b>{account.userId}</b>{' '}
                          <Tag
                            color={
                              healthy
                                ? 'success'
                                : account.state === 'error'
                                  ? 'error'
                                  : 'processing'
                            }
                          >
                            {account.state === 'ready'
                              ? account.syncState === 'running'
                                ? 'Rust sync running'
                                : account.runtimeActive === false
                                  ? 'Rust client stopped'
                                  : `Rust client ${account.syncState || 'starting'}`
                              : `migration ${account.state}`}
                          </Tag>
                          <br />
                          <small>
                            Device: <code>{account.deviceId || 'unknown'}</code> · owner:{' '}
                            <code>{cryptoStatus.matrixClient?.owner}</code>
                          </small>
                          <br />
                          <small>
                            Runtime: {account.runtimeActive ? 'active' : 'not active'} · sync:{' '}
                            {account.syncState || 'not started'} · watched rooms:{' '}
                            {account.watchedRooms ?? 0}
                          </small>
                          {account.completedAt ? (
                            <>
                              <br />
                              <small>
                                Device migration completed:{' '}
                                {new Date(account.completedAt).toLocaleString()}
                              </small>
                            </>
                          ) : null}
                          {account.error ? (
                            <>
                              <br />
                              <Tag color="error">{account.error}</Tag>
                            </>
                          ) : null}
                        </div>
                      </AntList.Item>
                    )
                  }}
                />
              )}

              <h4 style={{ marginTop: 18 }}>Legacy notification fallback</h4>
              <p>
                This store is retained for migration recovery and notification retry diagnostics. It
                is not the Android Matrix device owner once the Rust account is ready.
              </p>
              <div style={{ marginBottom: 10 }}>
                <Tag color={cryptoStatus.enabled ? 'success' : 'default'}>
                  Fallback decrypt {cryptoStatus.enabled ? 'available' : 'not ready'}
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
                          {account.lastSyncAt
                            ? new Date(account.lastSyncAt).toLocaleString()
                            : 'never'}
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
                              Last setup activity:{' '}
                              {new Date(account.setupHeartbeatAt).toLocaleString()}
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
                                      {entry.matrixErrorMessage
                                        ? ` · ${entry.matrixErrorMessage}`
                                        : ''}
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
              {!!cryptoStatus.clientErrors?.length && (
                <Collapse
                  style={{ marginTop: 12 }}
                  items={[
                    {
                      key: 'client-errors',
                      label: `Recent app errors (${cryptoStatus.clientErrors.length})`,
                      children: (
                        <AntList
                          size="small"
                          dataSource={[...cryptoStatus.clientErrors].reverse()}
                          renderItem={(entry) => (
                            <AntList.Item>
                              <div style={{ minWidth: 0, overflowWrap: 'anywhere', width: '100%' }}>
                                <Tag color="error">{entry.context || 'app error'}</Tag>
                                <small>{new Date(entry.at).toLocaleString()}</small>
                                <br />
                                <b>{entry.summary}</b>
                                {entry.details != null && (
                                  <DevJson>{devJson(entry.details)}</DevJson>
                                )}
                                {entry.callSite && <DevJson>{entry.callSite}</DevJson>}
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
        </>
      )}
    </div>
  )
}
