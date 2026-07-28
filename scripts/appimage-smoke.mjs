import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const driverUrl = process.env.APPIMAGE_E2E_DRIVER_URL ?? 'http://127.0.0.1:4444'
const application = process.env.APPIMAGE_E2E_APPLICATION
const outputDirectory = resolve(process.env.APPIMAGE_E2E_OUTPUT_DIR ?? 'test-results/appimage')
const homeserver = process.env.MATRIX_E2E_ACCOUNT_1_HOMESERVER?.replace(/\/$/, '')
const userId = process.env.MATRIX_E2E_ACCOUNT_1_USER
const password = process.env.MATRIX_E2E_ACCOUNT_1_PASSWORD
const elementKey = 'element-6066-11e4-a52e-4f735466cecf'

if (!application) throw new Error('APPIMAGE_E2E_APPLICATION is required')
if (!homeserver || !userId || !password)
  throw new Error(
    'MATRIX_E2E_ACCOUNT_1_HOMESERVER, MATRIX_E2E_ACCOUNT_1_USER, and MATRIX_E2E_ACCOUNT_1_PASSWORD are required',
  )

await mkdir(outputDirectory, { recursive: true })

class WebDriverError extends Error {
  constructor(message, status, value) {
    super(message)
    this.status = status
    this.value = value
  }
}

async function command(method, path, body) {
  const response = await fetch(`${driverUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.value?.error) {
    const detail = payload?.value?.message ?? payload?.value?.error ?? response.statusText
    throw new WebDriverError(
      `${method} ${path} failed (${response.status}): ${detail}`,
      response.status,
      payload?.value,
    )
  }
  return payload.value
}

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

async function waitFor(description, operation, timeout = 90_000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await operation()
      if (result) return result
    } catch (error) {
      lastError = error
      if (!(error instanceof WebDriverError) || error.value?.error !== 'no such element')
        throw error
    }
    await delay(500)
  }
  throw new Error(
    `Timed out after ${timeout}ms waiting for ${description}${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }`,
  )
}

let sessionId

const sessionPath = (suffix = '') => `/session/${sessionId}${suffix}`

async function element(selector) {
  const result = await command('POST', sessionPath('/element'), {
    using: 'css selector',
    value: selector,
  })
  const id = result?.[elementKey] ?? result?.ELEMENT
  if (!id) throw new Error(`WebDriver returned no element ID for ${selector}`)
  return id
}

async function fill(selector, value) {
  const id = await element(selector)
  await command('POST', sessionPath('/execute/sync'), {
    script: `
      const input = arguments[0]
      const value = arguments[1]
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    `,
    args: [{ [elementKey]: id }, value],
  })
}

async function screenshot(name) {
  if (!sessionId) return
  const encoded = await command('GET', sessionPath('/screenshot'))
  await writeFile(resolve(outputDirectory, name), Buffer.from(encoded, 'base64'))
}

try {
  const session = await command('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'wry',
        'tauri:options': { application },
      },
    },
  })
  sessionId = session.sessionId
  if (!sessionId) throw new Error('tauri-driver did not return a session ID')

  await waitFor('FoxChat login view', () => element('[data-testid="login-page"]'))
  const title = await command('GET', sessionPath('/title'))
  if (!String(title).includes('FoxChat'))
    throw new Error(`Expected the native app view title to contain FoxChat, received "${title}"`)
  console.log('PASS AppImage opened and rendered the FoxChat login view')

  await fill('input[placeholder="https://matrix.org"]', homeserver)
  await fill('input[placeholder="@you:matrix.org"]', userId)
  await fill('input[placeholder="Your password"]', password)
  const submit = await element('button[type="submit"]')
  await command('POST', sessionPath(`/element/${submit}/click`), {})

  await waitFor(
    'room drawer after Matrix login',
    () => element('[data-testid="room-sidebar"]'),
    120_000,
  )
  await screenshot('appimage-login-success.png')
  console.log(`PASS AppImage logged in as ${userId} and rendered the room drawer`)
} catch (error) {
  await screenshot('appimage-login-failure.png').catch(() => undefined)
  throw error
} finally {
  if (sessionId) await command('DELETE', sessionPath()).catch(() => undefined)
}
