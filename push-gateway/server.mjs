import { createServer } from 'node:http'
import { GoogleAuth } from 'google-auth-library'

const port = numberEnv('PORT', 3985)
const projectId = requiredEnv('GOOGLE_CLOUD_PROJECT')
const allowedAppIds = new Set(
  (process.env.ALLOWED_APP_IDS || 'foxchat.jakefox.de')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)
const maxBodyBytes = numberEnv('MAX_BODY_BYTES', 256 * 1024)
const maxParallel = numberEnv('MAX_PARALLEL_SENDS', 10)
const dedupeTtlMs = numberEnv('DEDUPE_TTL_SECONDS', 3600) * 1000
const includeMessageContent = process.env.INCLUDE_MESSAGE_CONTENT !== 'false'
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase.messaging'] })
const delivered = new Map()
const unreadRooms = new Map()
let requestSequence = 0

function log(level, message, details = {}) {
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    JSON.stringify({ level, message, ...details }),
  )
}

const server = createServer(async (request, response) => {
  const requestId = ++requestSequence
  const startedAt = Date.now()
  setSecurityHeaders(response)
  const pathname = new URL(request.url, 'http://localhost').pathname
  log('info', 'HTTP request received', {
    requestId,
    method: request.method,
    pathname,
    userAgent: request.headers['user-agent'] || null,
  })
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    return response.end()
  }
  if (request.method === 'GET' && (pathname === '/healthz' || pathname === '/health')) {
    log('info', 'Health check completed', { requestId, durationMs: Date.now() - startedAt })
    return json(response, 200, { ok: true })
  }
  if (request.method === 'POST' && pathname === '/_foxchat/push/v1/read') {
    try {
      const body = await readJson(request)
      const key = roomKey(body?.pushkey, body?.room_id)
      const unread = unreadRooms.get(key)
      if (
        unread?.clearToken &&
        typeof body?.clear_token === 'string' &&
        body.clear_token === unread.clearToken
      )
        unreadRooms.delete(key)
      const cleared = !unreadRooms.has(key)
      log('info', 'Push room read state received', {
        requestId,
        roomId: body.room_id,
        cleared,
        durationMs: Date.now() - startedAt,
      })
      return json(response, 200, { cleared })
    } catch (error) {
      log('warn', 'Invalid push read request', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      })
      return json(response, error?.statusCode || 400, {
        error: error instanceof Error ? error.message : 'Invalid request',
      })
    }
  }
  if (request.method !== 'POST' || pathname !== '/_matrix/push/v1/notify') {
    log('warn', 'Unknown gateway request', { requestId, method: request.method, pathname })
    return json(response, 404, { error: 'Not found' })
  }

  try {
    const body = await readJson(request)
    const notification = body?.notification
    if (!notification || !Array.isArray(notification.devices)) {
      log('warn', 'Invalid Matrix push payload', {
        requestId,
        reason: 'notification.devices must be an array',
      })
      return json(response, 400, { error: 'notification.devices must be an array' })
    }
    if (notification.devices.length > 1000) {
      log('warn', 'Matrix push payload rejected', {
        requestId,
        reason: 'Too many devices',
        deviceCount: notification.devices.length,
      })
      return json(response, 413, { error: 'Too many devices' })
    }
    log('info', 'Matrix push notification received', {
      requestId,
      eventId: notification.event_id,
      roomId: notification.room_id,
      type: notification.type,
      priority: notification.prio,
      deviceCount: notification.devices.length,
    })

    cleanupDedupeCache()
    const rejected = []
    let transientFailure = false
    let sent = 0
    let deduplicated = 0
    let disallowed = 0
    await mapLimited(notification.devices, maxParallel, async (device) => {
      const pushkey = typeof device?.pushkey === 'string' ? device.pushkey : ''
      if (!pushkey || !allowedAppIds.has(device?.app_id)) {
        if (pushkey) rejected.push(pushkey)
        disallowed++
        log('warn', 'Matrix push device rejected before FCM', {
          requestId,
          appId: device?.app_id || null,
          hasPushkey: !!pushkey,
        })
        return
      }
      const deliveryKey = notification.event_id ? `${notification.event_id}\0${pushkey}` : undefined
      if (deliveryKey && delivered.has(deliveryKey)) {
        deduplicated++
        return
      }
      const key = notification.room_id ? roomKey(pushkey, notification.room_id) : ''
      const silent = !!notification.room_id && unreadRooms.has(key)
      const result = await sendToFcm(pushkey, notification, device, silent)
      if (result === 'rejected') rejected.push(pushkey)
      else if (result === 'transient') transientFailure = true
      else {
        sent++
        if (deliveryKey) delivered.set(deliveryKey, Date.now() + dedupeTtlMs)
        if (notification.room_id)
          unreadRooms.set(key, {
            clearToken: String(device?.data?.clear_token || ''),
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
          })
      }
    })

    log(transientFailure ? 'error' : 'info', 'Matrix push notification processed', {
      requestId,
      eventId: notification.event_id,
      roomId: notification.room_id,
      sent,
      rejected: rejected.length,
      disallowed,
      deduplicated,
      transientFailure,
      durationMs: Date.now() - startedAt,
    })
    if (transientFailure) return json(response, 502, { error: 'FCM temporarily unavailable' })
    return json(response, 200, { rejected })
  } catch (error) {
    const status = error?.statusCode || 500
    log('error', 'Push gateway request failed', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    })
    return json(response, status, { error: status < 500 ? error.message : 'Internal server error' })
  }
})

async function sendToFcm(pushkey, notification, device, silent) {
  const client = await auth.getClient()
  const access = await client.getAccessToken()
  const accessToken = typeof access === 'string' ? access : access?.token
  if (!accessToken) throw new Error('Google did not return an access token')
  const title = notification.room_name || notification.sender_display_name || 'FoxChat'
  const body = includeMessageContent ? messageBody(notification) : 'New message'
  const unread = String(notification.counts?.unread || 0)
  const payload = {
    message: {
      token: pushkey,
      data: stringData({
        room_id: notification.room_id,
        event_id: notification.event_id,
        type: notification.type,
        sender: notification.sender,
        sender_name: notification.sender_display_name || notification.sender,
        room_name: notification.room_name || title,
        timestamp: Date.now(),
        unread,
        title,
        body,
        channel_id: silent ? 'messages_silent' : 'messages',
        silent: silent ? 'true' : 'false',
      }),
      android: {
        priority: notification.prio === 'low' ? 'normal' : 'high',
      },
    },
  }
  const fcmResponse = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    },
  )
  if (fcmResponse.ok) {
    log('info', 'FCM accepted push delivery', {
      eventId: notification.event_id,
      roomId: notification.room_id,
      status: fcmResponse.status,
      silent,
    })
    return 'sent'
  }
  const error = await fcmResponse.json().catch(() => ({}))
  const errorCode = error?.error?.details?.find((detail) => detail?.errorCode)?.errorCode
  if (
    errorCode === 'UNREGISTERED' ||
    (fcmResponse.status === 400 && errorCode === 'INVALID_ARGUMENT')
  ) {
    log('warn', 'FCM rejected invalid registration', {
      eventId: notification.event_id,
      roomId: notification.room_id,
      status: fcmResponse.status,
      errorCode,
    })
    return 'rejected'
  }
  log('error', 'FCM send failed', {
    status: fcmResponse.status,
    errorCode,
    response: error?.error?.message,
  })
  return 'transient'
}

function messageBody(notification) {
  const content = notification.content || {}
  if (typeof content.body === 'string' && content.body.trim()) return content.body.slice(0, 240)
  if (notification.sender_display_name) return `${notification.sender_display_name} sent a message`
  return 'New message'
}

function stringData(values) {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  )
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBodyBytes)
      throw Object.assign(new Error('Request body too large'), { statusCode: 413 })
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 })
  }
}

async function mapLimited(items, limit, worker) {
  let index = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) await worker(items[index++])
    }),
  )
}

function cleanupDedupeCache() {
  const now = Date.now()
  for (const [key, expires] of delivered) if (expires <= now) delivered.delete(key)
  for (const [key, value] of unreadRooms) if (value.expires <= now) unreadRooms.delete(key)
}

function roomKey(pushkey, roomId) {
  if (typeof pushkey !== 'string' || !pushkey || typeof roomId !== 'string' || !roomId)
    throw Object.assign(new Error('pushkey and room_id are required'), { statusCode: 400 })
  return `${pushkey}\0${roomId}`
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function setSecurityHeaders(response) {
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type')
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
  return value
}

server.on('clientError', (error) =>
  log('warn', 'Push gateway client connection failed', { error: error.message }),
)
server.listen(port, '0.0.0.0', () =>
  log('info', 'FoxChat push gateway listening', {
    port,
    projectId,
    allowedAppIds: [...allowedAppIds],
    includeMessageContent,
  }),
)
