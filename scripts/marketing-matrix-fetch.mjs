const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const retryStatuses = new Set([429, 502, 503, 504])

// Finish outstanding mutations before the caller starts restoring profiles/leaving rooms.
export async function settleMatrixRequests(requests) {
  const results = await Promise.allSettled(requests)
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
  return results.map((result) => result.value)
}

function errorDetail(error) {
  const details = []
  const visit = (value, depth = 0) => {
    if (!value || depth > 4) return
    if (value.code || value.message)
      details.push([value.code, value.message].filter(Boolean).join(': '))
    visit(value.cause, depth + 1)
    for (const nested of value.errors ?? []) visit(nested, depth + 1)
  }
  visit(error)
  return [...new Set(details)].join('; ') || String(error)
}

function retryDelay(response, text, attempt) {
  const header = response.headers.get('retry-after')
  let delay = header === null ? NaN : Number(header) * 1_000
  if (!Number.isFinite(delay) && header) delay = Date.parse(header) - Date.now()
  try {
    const bodyDelay = JSON.parse(text).retry_after_ms
    if (typeof bodyDelay === 'number' && Number.isFinite(bodyDelay))
      delay = Number.isFinite(delay) ? Math.max(delay, bodyDelay) : bodyDelay
  } catch {}
  return Number.isFinite(delay) ? Math.max(0, delay) : 1_000 * 2 ** attempt
}

/** Buffer responses inside the retry boundary so dropped response bodies also recover. */
export async function marketingMatrixFetch(url, options = {}, config = {}) {
  const { timeout = 30_000, fetchImpl = fetch, wait = sleep, warn = console.warn } = config
  const method = (options.method ?? 'GET').toUpperCase()
  const repeatable = ['GET', 'HEAD', 'PUT', 'DELETE'].includes(method)
  const endpoint = new URL(url)
  const label = `Matrix ${method} ${endpoint.origin}${endpoint.pathname}`
  const attempts = 4
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response
    let text
    try {
      response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeout) })
      text = await response.text()
    } catch (error) {
      const detail = errorDetail(error)
      if (!repeatable || attempt === attempts - 1)
        throw new Error(`${label} failed after ${attempt + 1} attempt(s): ${detail}`, {
          cause: error,
        })
      const delay = 1_000 * 2 ** attempt
      warn(`${label}: ${detail}; retry ${attempt + 1}/${attempts - 1} in ${delay}ms`)
      await wait(delay)
      continue
    }
    // A rate-limit rejection can also safely be retried for non-idempotent POSTs.
    if (
      retryStatuses.has(response.status) &&
      (repeatable || response.status === 429) &&
      attempt < attempts - 1
    ) {
      const delay = retryDelay(response, text, attempt)
      if (delay <= 120_000) {
        warn(
          `${label}: HTTP ${response.status}; retry ${attempt + 1}/${attempts - 1} in ${delay}ms`,
        )
        await wait(delay)
        continue
      }
    }
    return new Response(
      [204, 205, 304].includes(response.status) || method === 'HEAD' ? null : text,
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    )
  }
}
