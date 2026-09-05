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
const ERROR_TOAST_SELECTOR = '.ant-message-error, .ant-message-notice-error'
const pendingPatchedToastReports: Array<{ summary: string; at: number }> = []
let emittingClientError = false

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

function createErrorReport(context: string, summary: string, error?: unknown): ErrorReport {
  return {
    at: new Date().toISOString(),
    context: safeText(context),
    summary: safeText(summary),
    details: safeValue(error),
    callSite: safeText(new Error().stack ?? ''),
  }
}

function persistErrorReport(report: ErrorReport) {
  const invoke = nativeInvoke()
  if (invoke)
    void invoke('plugin:remote-push|native_matrix', {
      action: 'logClientError',
      payload: JSON.stringify(report),
    }).catch(() => undefined)
}

export function reportClientError(context: string, summary: string, error?: unknown) {
  const report = createErrorReport(context, summary, error)
  emittingClientError = true
  try {
    console.error(`[${report.context}] ${report.summary}`, report)
  } finally {
    emittingClientError = false
  }
  persistErrorReport(report)
  return report
}

function consoleErrorSummary(args: unknown[]) {
  const error = args.find((value): value is Error => value instanceof Error)
  if (error?.message) return error.message
  const text = args.find((value): value is string => typeof value === 'string' && !!value.trim())
  return text?.trim() || 'console.error was called'
}

/** Persists errors emitted directly by Matrix SDK internals and other libraries. */
export function installConsoleErrorLogging() {
  const original = console.error
  const patched = (...args: unknown[]) => {
    original(...args)
    if (emittingClientError) return
    persistErrorReport(createErrorReport('console-error', consoleErrorSummary(args), args))
  }
  console.error = patched
  return () => {
    if (console.error === patched) console.error = original
  }
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

function rememberPatchedToast(summary: string) {
  const now = Date.now()
  const firstRecent = pendingPatchedToastReports.findIndex((entry) => now - entry.at <= 5_000)
  if (firstRecent < 0) pendingPatchedToastReports.length = 0
  else if (firstRecent > 0) pendingPatchedToastReports.splice(0, firstRecent)
  pendingPatchedToastReports.push({ summary, at: now })
}

function consumePatchedToast(summary: string) {
  const now = Date.now()
  const index = pendingPatchedToastReports.findIndex(
    (entry) => entry.summary === summary && now - entry.at <= 5_000,
  )
  if (index < 0) return false
  pendingPatchedToastReports.splice(index, 1)
  return true
}

/**
 * Logs what Ant Design actually rendered. This is the final safety net for message APIs captured
 * before ErrorLoggingBridge mounted or supplied by a different nested App provider.
 */
export function installVisibleErrorToastLogging(root: ParentNode = document) {
  const seen = new WeakSet<Element>()
  const record = (candidate: Element) => {
    const toast = candidate.matches('.ant-message-error')
      ? candidate
      : (candidate.querySelector('.ant-message-error') ?? candidate)
    if (seen.has(toast)) return
    seen.add(toast)
    const summary = (toast.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!summary || consumePatchedToast(summary)) return
    reportClientError('user-visible-error', summary)
  }
  const inspect = (node: Node) => {
    if (!(node instanceof Element)) return
    if (node.matches(ERROR_TOAST_SELECTOR)) record(node)
    node.querySelectorAll(ERROR_TOAST_SELECTOR).forEach(record)
  }
  root.querySelectorAll(ERROR_TOAST_SELECTOR).forEach(record)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) mutation.addedNodes.forEach(inspect)
  })
  observer.observe(root, { childList: true, subtree: true })
  return () => observer.disconnect()
}

type ErrorMessageMethod = MessageInstance['error']
type MessageApi = Pick<MessageInstance, 'error'>
const installedMessages = new WeakMap<object, ErrorMessageMethod>()

/** Ensures every Ant Design error toast is represented in console and Android's durable log. */
export function installMessageErrorLogging(message: MessageApi) {
  if (installedMessages.has(message)) return () => undefined
  const original = message.error
  const patched = ((...args: Parameters<ErrorMessageMethod>) => {
    const summary = visibleMessage(args[0])
    reportClientError('user-visible-error', summary)
    rememberPatchedToast(summary)
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
  installConsoleErrorLogging()
  installVisibleErrorToastLogging()
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
