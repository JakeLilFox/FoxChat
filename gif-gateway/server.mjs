import { createServer } from 'node:http'

const port = numberEnv('PORT', 3987)
const apiKey = requiredEnv('KLIPY_API_KEY')
const contentFilter = process.env.KLIPY_CONTENT_FILTER || 'medium'
const maxBodyBytes = numberEnv('MAX_BODY_BYTES', 16 * 1024)
const rateLimitPerMinute = numberEnv('RATE_LIMIT_PER_MINUTE', 60)
const upstreamBase = `https://api.klipy.com/api/v1/${encodeURIComponent(apiKey)}/gifs`

function log(level, message, details = {}) {
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    JSON.stringify({ level, message, ...details }),
  )
}

const buckets = new Map()
function rateLimited(ip) {
  const now = Date.now()
  const bucket = buckets.get(ip) ?? { tokens: rateLimitPerMinute, updatedAt: now }
  const elapsedMinutes = (now - bucket.updatedAt) / 60_000
  bucket.tokens = Math.min(rateLimitPerMinute, bucket.tokens + elapsedMinutes * rateLimitPerMinute)
  bucket.updatedAt = now
  if (bucket.tokens < 1) {
    buckets.set(ip, bucket)
    return true
  }
  bucket.tokens -= 1
  buckets.set(ip, bucket)
  return false
}
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000
  for (const [ip, bucket] of buckets) if (bucket.updatedAt < cutoff) buckets.delete(ip)
}, 5 * 60_000).unref()

function clientIp(request) {
  return (
    (request.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    request.socket.remoteAddress ||
    ''
  )
}

function forwardedParams(url, allowed) {
  const params = new URLSearchParams()
  for (const key of allowed) {
    const value = url.searchParams.get(key)
    if (value) params.set(key, value)
  }
  return params
}

async function proxyJson(response, upstreamUrl, requestId, init) {
  const upstreamResponse = await fetch(upstreamUrl, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  })
  const body = await upstreamResponse.text()
  log(upstreamResponse.ok ? 'info' : 'warn', 'Klipy upstream response', {
    requestId,
    status: upstreamResponse.status,
    ok: upstreamResponse.ok,
  })
  response.writeHead(upstreamResponse.status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(body)
}

const server = createServer(async (request, response) => {
  const requestId = ++server.requestSequence || 1
  server.requestSequence = requestId
  const startedAt = Date.now()
  setSecurityHeaders(response)
  const url = new URL(request.url, 'http://localhost')
  const pathname = url.pathname
  log('info', 'HTTP request received', { requestId, method: request.method, pathname })

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    return response.end()
  }
  if (request.method === 'GET' && (pathname === '/healthz' || pathname === '/health'))
    return json(response, 200, { ok: true })

  const ip = clientIp(request)
  if (rateLimited(ip)) {
    log('warn', 'Rate limit exceeded', { requestId, ip })
    return json(response, 429, { error: 'Too many requests' })
  }

  try {
    if (request.method === 'GET' && pathname === '/gifs/trending') {
      const params = forwardedParams(url, ['page', 'per_page', 'customer_id', 'locale'])
      params.set('content_filter', contentFilter)
      await proxyJson(response, `${upstreamBase}/trending?${params}`, requestId)
      return
    }
    if (request.method === 'GET' && pathname === '/gifs/search') {
      const q = url.searchParams.get('q')
      if (!q) return json(response, 400, { error: 'q is required' })
      const params = forwardedParams(url, ['page', 'per_page', 'customer_id', 'locale'])
      params.set('q', q)
      params.set('content_filter', contentFilter)
      await proxyJson(response, `${upstreamBase}/search?${params}`, requestId)
      return
    }
    if (request.method === 'GET' && pathname === '/gifs/categories') {
      const params = forwardedParams(url, ['locale'])
      await proxyJson(response, `${upstreamBase}/categories?${params}`, requestId)
      return
    }
    if (request.method === 'GET' && pathname === '/gifs/items') {
      const slugs = url.searchParams.get('slugs')
      if (!slugs) return json(response, 400, { error: 'slugs is required' })
      const params = new URLSearchParams({ slugs })
      await proxyJson(response, `${upstreamBase}/items?${params}`, requestId)
      return
    }
    const shareMatch = pathname.match(/^\/gifs\/share\/([^/]+)$/)
    if (request.method === 'POST' && shareMatch) {
      const body = await readJson(request)
      const params = new URLSearchParams()
      if (body?.customer_id) params.set('customer_id', String(body.customer_id))
      if (typeof body?.q === 'string') params.set('q', body.q)
      await proxyJson(
        response,
        `${upstreamBase}/share/${encodeURIComponent(shareMatch[1])}`,
        requestId,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: params,
        },
      )
      return
    }
    log('warn', 'Unknown gateway request', { requestId, method: request.method, pathname })
    return json(response, 404, { error: 'Not found' })
  } catch (error) {
    const status = error?.statusCode || 500
    log('error', 'Gif gateway request failed', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    })
    return json(response, status, { error: status < 500 ? error.message : 'Internal server error' })
  }
})

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBodyBytes)
      throw Object.assign(new Error('Request body too large'), { statusCode: 413 })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 })
  }
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function setSecurityHeaders(response) {
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
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
  log('warn', 'Gif gateway client connection failed', { error: error.message }),
)
server.listen(port, '0.0.0.0', () =>
  log('info', 'FoxChat gif gateway listening', { port, contentFilter, rateLimitPerMinute }),
)
