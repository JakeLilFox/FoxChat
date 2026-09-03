import type { MessageInstance } from 'antd/es/message/interface'

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

type ErrorReport = {
  at: string
  context: string
  summary: string
  details: unknown
  callSite?: string
}

const SECRET_KEY =
  /access.?token|refresh.?token|authorization|cookie|password|passphrase|recovery.?key|secret|private.?key/i
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi
const MATRIX_TOKEN = /\bsyt_[A-Za-z0-9._~-]+/gi
const SECRET_QUERY_VALUE = /([?&](?:access_token|refresh_token|password|key)=)[^&\s]+/gi
const MAX_DEPTH = 5
const MAX_ARRAY = 30
const MAX_TEXT = 12_000

function safeText(value: string) {
  return value
    .replace(BEARER_TOKEN, 'Bearer [redacted]')
    .replace(MATRIX_TOKEN, '[redacted Matrix token]')
    .replace(SECRET_QUERY_VALUE, '$1[redacted]')
    .slice(0, MAX_TEXT)
}

function safeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return safeText(value)
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function')
    return String(value)
  if (depth >= MAX_DEPTH) return '[maximum depth reached]'
  if (value instanceof Error) {
    const extra: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value))
      if (!['name', 'message', 'stack', 'cause'].includes(key))
        extra[key] = SECRET_KEY.test(key) ? '[redacted]' : safeValue(item, depth + 1, seen)
    return {
      name: value.name,
      message: safeText(value.message),
      stack: value.stack ? safeText(value.stack) : undefined,
      cause: safeValue(value.cause, depth + 1, seen),
      ...extra,
    }
  }
  if (typeof value !== 'object') return safeText(String(value))
  if (seen.has(value)) return '[circular reference]'
  seen.add(value)
  if (Array.isArray(value))
    return value.slice(0, MAX_ARRAY).map((item) => safeValue(item, depth + 1, seen))
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>))
    result[key] = SECRET_KEY.test(key) ? '[redacted]' : safeValue(item, depth + 1, seen)
  return result
}

function nativeInvoke(): TauriInvoke | undefined {
  if (typeof window === 'undefined' || !/Android/i.test(window.navigator.userAgent))
    return undefined
  return (
    window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: TauriInvoke }
    }
  ).__TAURI_INTERNALS__?.invoke
}

export function reportClientError(context: string, summary: string, error?: unknown) {
  const report: ErrorReport = {
    at: new Date().toISOString(),
    context: safeText(context),
    summary: safeText(summary),
    details: safeValue(error),
    callSite: safeText(new Error().stack ?? ''),
  }
  console.error(`[${report.context}] ${report.summary}`, report)
  const invoke = nativeInvoke()
  if (invoke)
    void invoke('plugin:remote-push|native_matrix', {
      action: 'logClientError',
      payload: JSON.stringify(report),
    }).catch(() => undefined)
  return report
}

function visibleMessage(value: unknown): string {
  const content =
    value && typeof value === 'object' && 'content' in value
      ? (value as { content?: unknown }).content
      : value
  if (typeof content === 'string') return content
  if (typeof content === 'number') return String(content)
  return 'A user-visible error was shown'
}

type ErrorMessageMethod = MessageInstance['error']
type MessageApi = Pick<MessageInstance, 'error'>
const installedMessages = new WeakMap<object, ErrorMessageMethod>()

/** Ensures every Ant Design error toast is represented in console and Android's durable log. */
export function installMessageErrorLogging(message: MessageApi) {
  if (installedMessages.has(message)) return () => undefined
  const original = message.error
  const patched = ((...args: Parameters<ErrorMessageMethod>) => {
    reportClientError('user-visible-error', visibleMessage(args[0]))
    return original(...args)
  }) as ErrorMessageMethod
  installedMessages.set(message, original)
  message.error = patched
  return () => {
    if (message.error === patched) message.error = original
    installedMessages.delete(message)
  }
}

let globalLoggingInstalled = false

export function installGlobalErrorLogging() {
  if (globalLoggingInstalled || typeof window === 'undefined') return
  globalLoggingInstalled = true
  window.addEventListener('error', (event) => {
    reportClientError('uncaught-error', event.message || 'Uncaught JavaScript error', event.error)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const summary =
      event.reason instanceof Error && event.reason.message
        ? event.reason.message
        : 'Unhandled promise rejection'
    reportClientError('unhandled-rejection', summary, event.reason)
  })
}
