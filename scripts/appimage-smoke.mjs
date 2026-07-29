import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const driverUrl = process.env.APPIMAGE_E2E_DRIVER_URL ?? 'http://127.0.0.1:4444'
const application = process.env.APPIMAGE_E2E_APPLICATION
const outputDirectory = resolve(process.env.APPIMAGE_E2E_OUTPUT_DIR ?? 'test-results/appimage')
const platformName = process.env.APPIMAGE_E2E_PLATFORM ?? 'linux'
const rawHomeserver = process.env.MATRIX_E2E_ACCOUNT_1_HOMESERVER?.replace(/\/$/, '')
const userId = process.env.MATRIX_E2E_ACCOUNT_1_USER
const password = process.env.MATRIX_E2E_ACCOUNT_1_PASSWORD
const recoveryKey = process.env.MATRIX_E2E_ACCOUNT_1_RECOVERY_KEY
const skipRecovery = process.env.APPIMAGE_E2E_SKIP_RECOVERY === '1'
const recoveryOnly = process.env.APPIMAGE_E2E_RECOVERY_ONLY === '1'
const elementKey = 'element-6066-11e4-a52e-4f735466cecf'
const openedUrl = 'https://example.com/foxchat-desktop-e2e'
const openedUrlFile = resolve(outputDirectory, 'opened-url.txt')
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
const roomName = `FoxChat Desktop E2E ${platformName} ${runId}`
const sentText = `native desktop message ${platformName} ${runId}`

if (!application) throw new Error('APPIMAGE_E2E_APPLICATION is required')
if (!rawHomeserver || !userId || !password)
  throw new Error('Account homeserver, user, and password are required')
if (!skipRecovery && !recoveryKey)
  throw new Error('The account recovery key is required when recovery testing is enabled')

await mkdir(outputDirectory, { recursive: true })
await unlink(openedUrlFile).catch(() => undefined)

async function discoverHomeserver(value) {
  const normalized = (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/$/, '')
  try {
    const response = await fetch(`${normalized}/.well-known/matrix/client`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (response.ok) {
      const discovered = (await response.json())['m.homeserver']?.base_url
      if (discovered) return new URL(discovered, normalized).toString().replace(/\/$/, '')
    }
  } catch {
    // Direct homeserver URLs do not need discovery.
  }
  return normalized
}

const homeserver = await discoverHomeserver(rawHomeserver)

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
    }
    await delay(500)
  }
  throw new Error(
    `Timed out waiting for ${description}${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }`,
  )
}

async function matrix(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${homeserver}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new Error(
      `Matrix ${method} ${path} failed (${response.status}): ${
        payload.errcode ?? response.statusText
      }`,
    )
  return payload
}

async function fixtureLogin() {
  return matrix('/_matrix/client/v3/login', {
    method: 'POST',
    body: {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: userId },
      password,
      initial_device_display_name: `FoxChat desktop E2E fixture ${platformName}`,
    },
  })
}

async function createFixture(token) {
  const created = await matrix('/_matrix/client/v3/createRoom', {
    method: 'POST',
    token,
    body: { preset: 'private_chat', visibility: 'private', name: roomName },
  })
  if (!created.room_id) throw new Error('Matrix createRoom returned no room_id')
  await matrix(
    `/_matrix/client/v3/rooms/${encodeURIComponent(created.room_id)}/send/m.room.message/${runId}`,
    {
      method: 'PUT',
      token,
      body: { msgtype: 'm.text', body: `[CI browser link](${openedUrl})` },
    },
  )
  return created.room_id
}

async function roomMessages(token, roomId) {
  const payload = await matrix(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=100`,
    { token },
  )
  return payload.chunk ?? []
}

let sessionId
const sessionPath = (suffix = '') => `/session/${sessionId}${suffix}`
const refId = (value) => value?.[elementKey] ?? value?.ELEMENT

async function findCss(selector) {
  const value = await command('POST', sessionPath('/execute/sync'), {
    script: 'return document.querySelector(arguments[0])',
    args: [selector],
  })
  return refId(value)
}

async function findText(selector, text, exact = true) {
  const value = await command('POST', sessionPath('/execute/sync'), {
    script: `
      const clean = value => String(value || '').replace(/\\s+/g, ' ').trim()
      const expected = clean(arguments[1])
      return [...document.querySelectorAll(arguments[0])].find(element => {
        if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden')
          return false
        const actual = clean(element.textContent)
        return arguments[2] ? actual === expected : actual.includes(expected)
      }) || null
    `,
    args: [selector, text, exact],
  })
  return refId(value)
}

async function startSession() {
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
  await waitFor('FoxChat login view', () => findCss('[data-testid="login-page"]'))
}

async function click(id) {
  await command('POST', sessionPath(`/element/${id}/click`), {})
}

async function clickCss(selector) {
  await click(await waitFor(selector, () => findCss(selector)))
}

async function clickText(selector, text, exact = true) {
  await click(await waitFor(text, () => findText(selector, text, exact)))
}

async function fill(selector, value) {
  const id = await waitFor(selector, () => findCss(selector))
  await command('POST', sessionPath('/execute/sync'), {
    script: `
      const input = arguments[0]
      const value = arguments[1]
      const proto = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    `,
    args: [{ [elementKey]: id }, value],
  })
}

async function bodyContains(text) {
  return command('POST', sessionPath('/execute/sync'), {
    script: 'return document.body.innerText.includes(arguments[0])',
    args: [text],
  })
}

async function selectRoom() {
  const room = await waitFor(
    roomName,
    () => findText('[data-testid="room-row"]', roomName, false),
    120_000,
  )
  await click(room)
  await waitFor(
    'fixture room header',
    () => findText('[data-testid="room-header"]', roomName, false),
    60_000,
  )
}

async function sendComposerText(text) {
  const composer = await waitFor('message composer', () =>
    findCss('[data-testid="message-composer"]'),
  )
  await command('POST', sessionPath('/execute/sync'), {
    script: `
      const root = arguments[0]
      root.focus()
      root.replaceChildren(document.createTextNode(arguments[1]))
      root.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: arguments[1],
      }))
    `,
    args: [{ [elementKey]: composer }, text],
  })
  await clickCss('[aria-label="Send message"]')
  await waitFor('sent message in timeline', () => bodyContains(text), 60_000)
}

async function attachPng() {
  const input = await waitFor('file input', () =>
    findCss('[data-testid="composer-bar"] input[type="file"]'),
  )
  await command('POST', sessionPath('/execute/sync'), {
    script: `
      const input = arguments[0]
      const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'desktop-e2e.png', { type: 'image/png' }))
      Object.defineProperty(input, 'files', { configurable: true, value: transfer.files })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    `,
    args: [{ [elementKey]: input }],
  })
  await waitFor('pending image', () => findCss('[aria-label="Remove image"]'), 30_000)
  await clickCss('[aria-label="Send message"]')
  await waitFor(
    'uploaded image in timeline',
    () => findCss('[data-testid="message-image"], [data-testid="message-gallery"]'),
    90_000,
  )
}

async function selectSettingsTab(name) {
  let tab = await findText('[role="tab"]', name)
  if (!tab) {
    await clickCss('[aria-label="Open settings"]')
    tab = await waitFor(`${name} settings tab`, () => findText('[role="tab"]', name))
  }
  await command('POST', sessionPath('/execute/sync'), {
    script: 'arguments[0].click()',
    args: [{ [elementKey]: tab }],
  })
  await waitFor(`${name} settings panel`, () =>
    command('POST', sessionPath('/execute/sync'), {
      script: `
        const clean = value => String(value || '').replace(/\\s+/g, ' ').trim()
        return [...document.querySelectorAll('[role="tab"]')].some(element =>
          element.getClientRects().length &&
          clean(element.textContent) === arguments[0] &&
          element.getAttribute('aria-selected') === 'true'
        )
      `,
      args: [name],
    }),
  )
}

async function restoreRecovery() {
  await selectSettingsTab('Security')
  await clickText('button', 'Restore encrypted history')
  await fill('input[placeholder*="xxxx"], input[placeholder*="Recovery"], textarea', recoveryKey)
  await clickText('button', 'Restore keys')
  // "Restore encrypted history" is also the trigger button's permanent label in the Security
  // tab, so it never leaves the page and can't be used as a completion signal. "Restore keys"
  // is unique to the recovery modal's own OK button and only visible while that modal is open.
  await waitFor('recovery success', async () => !(await bodyContains('Restore keys')), 120_000)
  console.log(`PASS ${platformName}: recovery key restored encrypted history`)
}

async function clickExternalLink() {
  const link = await waitFor(
    'external message link',
    () => findCss(`a[href="${openedUrl}"]`),
    60_000,
  )
  await click(link)
  await waitFor(
    'OS browser handoff',
    async () => {
      const captured = await readFile(openedUrlFile, 'utf8').catch(() => '')
      return captured.trim() === openedUrl
    },
    30_000,
  )
  console.log(`PASS ${platformName}: external link handed to OS browser opener`)
}

async function signOut() {
  await selectSettingsTab('Account')
  await clickText('button', 'Sign out', false)
  // Sign-out reloads the whole SPA (location.reload()), re-initializing the multi-megabyte
  // rust-crypto WASM bundle from scratch. On a software-rendering-only CI worker (no /dev/dri
  // access) and right after the heavy recovery-key import above, that cold reload can run past
  // 60s - match the other generous waits in this script (recovery success, fixture room row).
  await waitFor('login after sign out', () => findCss('[data-testid="login-page"]'), 120_000)
  console.log(`PASS ${platformName}: signed out and revoked the desktop session`)
}

async function screenshot(name) {
  if (!sessionId) return
  const encoded = await command('GET', sessionPath('/screenshot'))
  await writeFile(resolve(outputDirectory, name), Buffer.from(encoded, 'base64'))
}

let fixture
let roomId
let journeyError
try {
  fixture = await fixtureLogin()
  if (!recoveryOnly) roomId = await createFixture(fixture.access_token)

  await startSession()
  const title = await command('GET', sessionPath('/title'))
  if (!String(title).includes('FoxChat')) throw new Error(`Unexpected native title: ${title}`)
  console.log(`PASS ${platformName}: AppImage opened and rendered the login view`)

  await fill('input[placeholder="https://matrix.org"]', homeserver)
  await fill('input[placeholder="@you:matrix.org"]', userId)
  await fill('input[placeholder="Your password"]', password)
  await clickCss('button[type="submit"]')
  await waitFor(
    'room drawer after Matrix login',
    () => findCss('[data-testid="room-sidebar"]'),
    120_000,
  )
  console.log(`PASS ${platformName}: logged in and rendered the room drawer`)

  if (!skipRecovery) await restoreRecovery()

  if (recoveryOnly) {
    await screenshot(`${platformName}-recovery-success.png`)
    await signOut()
  } else {
    await selectRoom()
    await sendComposerText(sentText)
    await waitFor(
      'text event on Matrix server',
      async () =>
        (await roomMessages(fixture.access_token, roomId)).some(
          (event) => event.content?.msgtype === 'm.text' && event.content?.body === sentText,
        ),
      60_000,
    )
    console.log(`PASS ${platformName}: sent text and verified the Matrix event`)

    await attachPng()
    await waitFor(
      'image event on Matrix server',
      async () =>
        (await roomMessages(fixture.access_token, roomId)).some(
          (event) => event.content?.msgtype === 'm.image' && event.content?.url,
        ),
      90_000,
    )
    console.log(`PASS ${platformName}: uploaded a PNG and verified the Matrix image event`)

    await clickExternalLink()
    await screenshot(`${platformName}-success.png`)
    await signOut()
  }
} catch (error) {
  journeyError = error
  await screenshot(`${platformName}-failure.png`).catch(() => undefined)
} finally {
  if (sessionId) await command('DELETE', sessionPath()).catch(() => undefined)
  if (fixture?.access_token && roomId) {
    await matrix(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`, {
      method: 'POST',
      token: fixture.access_token,
      body: {},
    }).catch(() => undefined)
    await matrix(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/forget`, {
      method: 'POST',
      token: fixture.access_token,
      body: {},
    }).catch(() => undefined)
  }
  if (fixture?.access_token)
    await matrix('/_matrix/client/v3/logout', {
      method: 'POST',
      token: fixture.access_token,
      body: {},
    }).catch(() => undefined)
}

if (journeyError) throw journeyError
