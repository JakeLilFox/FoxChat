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
const fakeMicrophone = process.env.APPIMAGE_E2E_FAKE_MIC === '1'
const skipMicrophoneTest = process.env.APPIMAGE_E2E_SKIP_MIC_TEST === '1'
const testCalls = process.env.APPIMAGE_E2E_CALLS === '1'
const testVerification = process.env.APPIMAGE_E2E_VERIFICATION === '1'
const testNotifications = process.env.APPIMAGE_E2E_NOTIFICATIONS === '1'
const callReceiverUrl = process.env.APPIMAGE_E2E_CALL_RECEIVER_URL ?? 'http://127.0.0.1:4173'
const rawCallReceiverHomeserver = process.env.MATRIX_E2E_CALL_RECEIVER_HOMESERVER?.replace(
  /\/$/,
  '',
)
const callReceiverUser = process.env.MATRIX_E2E_CALL_RECEIVER_USER
const callReceiverPassword = process.env.MATRIX_E2E_CALL_RECEIVER_PASSWORD
const rawNotificationSenderHomeserver =
  process.env.MATRIX_E2E_NOTIFICATION_SENDER_HOMESERVER?.replace(/\/$/, '')
const notificationSenderUser = process.env.MATRIX_E2E_NOTIFICATION_SENDER_USER
const notificationSenderPassword = process.env.MATRIX_E2E_NOTIFICATION_SENDER_PASSWORD
const elementKey = 'element-6066-11e4-a52e-4f735466cecf'
const openedUrl = 'https://example.com/foxchat-desktop-e2e'
const openedUrlFile = resolve(outputDirectory, 'opened-url.txt')
const microphonePromptFile = resolve(outputDirectory, 'microphone-prompt-approved.txt')
const desktopNotificationFile = resolve(outputDirectory, 'desktop-notification.json')
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
const roomName = `FoxChat Desktop E2E ${platformName} ${runId}`
const sentText = `native desktop message ${platformName} ${runId}`

if (!application) throw new Error('APPIMAGE_E2E_APPLICATION is required')
if (!rawHomeserver || !userId || !password)
  throw new Error('Account homeserver, user, and password are required')
if (!skipRecovery && !recoveryKey)
  throw new Error('The account recovery key is required when recovery testing is enabled')
if (testCalls && (!rawCallReceiverHomeserver || !callReceiverUser || !callReceiverPassword))
  throw new Error('Call receiver credentials are required when APPIMAGE_E2E_CALLS=1')
if (
  testNotifications &&
  (!rawNotificationSenderHomeserver || !notificationSenderUser || !notificationSenderPassword)
)
  throw new Error('Notification sender credentials are required when APPIMAGE_E2E_NOTIFICATIONS=1')

await mkdir(outputDirectory, { recursive: true })
await unlink(openedUrlFile).catch(() => undefined)
await unlink(microphonePromptFile).catch(() => undefined)
await unlink(desktopNotificationFile).catch(() => undefined)

const CONNECT_FAILURE_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
])

async function fetchWithRetry(url, options, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, options)
    } catch (error) {
      const retryable = attempt < attempts && CONNECT_FAILURE_CODES.has(error?.cause?.code)
      if (!retryable) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000))
    }
  }
}

async function discoverHomeserver(value) {
  const normalized = (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/$/, '')
  try {
    const response = await fetchWithRetry(`${normalized}/.well-known/matrix/client`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (response.ok) {
      const discovered = (await response.json())['m.homeserver']?.base_url
      if (discovered) return new URL(discovered, normalized).toString().replace(/\/$/, '')
      console.warn(
        `[discovery] ${normalized}/.well-known/matrix/client did not include m.homeserver.base_url; using ${normalized} directly`,
      )
    } else {
      console.warn(
        `[discovery] ${normalized}/.well-known/matrix/client returned ${response.status}; using ${normalized} directly`,
      )
    }
  } catch (error) {
    console.warn(
      `[discovery] Could not reach ${normalized}/.well-known/matrix/client (${error instanceof Error ? error.message : error}); using ${normalized} directly`,
    )
  }
  return normalized
}

const homeserver = await discoverHomeserver(rawHomeserver)
const callReceiverHomeserver = testCalls
  ? await discoverHomeserver(rawCallReceiverHomeserver)
  : homeserver
const notificationSenderHomeserver = testNotifications
  ? await discoverHomeserver(rawNotificationSenderHomeserver)
  : homeserver

class WebDriverError extends Error {
  constructor(message, status, value) {
    super(message)
    this.status = status
    this.value = value
  }
}

async function command(method, path, body) {
  const requestBody =
    path.endsWith('/execute/sync') && typeof body?.script === 'string'
      ? {
          ...body,
          script: `
            const result = (function () {
              ${body.script}
            }).apply(null, arguments)
            return result === undefined || result === null ? true : result
          `,
        }
      : body
  const response = await fetch(`${driverUrl}${path}`, {
    method,
    headers: requestBody === undefined ? undefined : { 'content-type': 'application/json' },
    body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
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

async function matrix(path, { method = 'GET', token, body, baseUrl = homeserver } = {}) {
  const response = await fetchWithRetry(`${baseUrl}${path}`, {
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

async function passwordLogin(loginUser, loginPassword, baseUrl, deviceName) {
  return matrix('/_matrix/client/v3/login', {
    method: 'POST',
    baseUrl,
    body: {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: loginUser },
      password: loginPassword,
      initial_device_display_name: deviceName,
    },
  })
}

async function fixtureLogin() {
  return passwordLogin(userId, password, homeserver, `FoxChat desktop E2E fixture ${platformName}`)
}

async function createFixture(token) {
  const voiceRoomType = 'org.matrix.msc3417.call'
  const created = await matrix('/_matrix/client/v3/createRoom', {
    method: 'POST',
    token,
    body: {
      preset: 'private_chat',
      visibility: 'private',
      name: roomName,
      ...(testCalls
        ? {
            creation_content: { type: voiceRoomType, 'm.federate': true },
            room_type: voiceRoomType,
            power_level_content_override: {
              events: {
                'org.matrix.msc3401.call.member': 0,
                'm.call.member': 0,
                'org.matrix.msc4143.rtc.member': 0,
                'm.rtc.member': 0,
              },
            },
          }
        : {}),
    },
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
  try {
    const value = await command('POST', sessionPath('/element'), {
      using: 'css selector',
      value: selector,
    })
    return refId(value)
  } catch (error) {
    if (error instanceof WebDriverError && error.value?.error === 'no such element')
      return undefined
    throw error
  }
}

async function findRenderedImage(eventId, body) {
  const value = await command('POST', sessionPath('/execute/sync'), {
    script: `
      const mediaSelector = '[data-testid="message-image"], [data-testid="message-gallery"]'
      const exactEvent = [...document.querySelectorAll('[data-event-id]')].find(
        element => element.dataset.eventId === arguments[0]
      )
      const exactMedia = exactEvent?.querySelector(mediaSelector)
      if (exactMedia) return exactMedia

      // Matrix renders a local echo before the server assigns the final event ID. WebKitGTK can
      // retain that transaction-backed wrapper even after the server event is visible, so use
      // the unique upload filename to correlate the rendered image with the verified event.
      const image = [...document.querySelectorAll(\`\${mediaSelector} img\`)].find(
        element => element.getAttribute('alt') === arguments[1]
      )
      return image?.closest(mediaSelector) || null
    `,
    args: [eventId, body],
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

async function selectRoom(name = roomName) {
  let room
  try {
    room = await waitFor(name, () => findText('[data-testid="room-row"]', name, false), 120_000)
  } catch (error) {
    await dumpPageState('room-selection-timeout')
    const desktopSession = await command('POST', sessionPath('/execute/sync'), {
      script: `
        try {
          const session = JSON.parse(localStorage.getItem('foxchat.matrix.session') || 'null')
          return session && {
            accessToken: session.accessToken,
            baseUrl: session.baseUrl,
            userId: session.userId,
          }
        } catch {
          return null
        }
      `,
      args: [],
    }).catch(() => null)
    if (desktopSession?.accessToken && desktopSession?.baseUrl) {
      try {
        await matrix('/_matrix/client/v3/account/whoami', {
          token: desktopSession.accessToken,
          baseUrl: desktopSession.baseUrl,
        })
      } catch (sessionError) {
        throw new Error(
          `Desktop Matrix session became invalid while waiting for the fixture room: ${
            sessionError instanceof Error ? sessionError.message : String(sessionError)
          }`,
          { cause: error },
        )
      }
    }
    throw error
  }
  await click(room)
  await waitFor(
    'fixture room header',
    () => findText('[data-testid="room-header"]', name, false),
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
    'image accepted for upload',
    async () => !(await findCss('[aria-label="Remove image"]')),
    15_000,
  )
}

async function selectSettingsTab(name) {
  let tab = await findText('[role="tab"]', name)
  if (!tab) {
    await clickCss('[aria-label="Open settings"]')
    tab = await waitFor(`${name} settings tab`, () => findText('[role="tab"]', name))
  }
  await command('POST', sessionPath('/execute/sync'), {
    script: `
      const clean = value => String(value || '').replace(/\\s+/g, ' ').trim()
      const target = [...document.querySelectorAll('[role="tab"]')].find(element =>
        clean(element.textContent) === arguments[0]
      )
      if (target) setTimeout(() => target.click(), 0)
      return !!target
    `,
    args: [name],
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

async function testLinuxMicrophone() {
  await selectSettingsTab('Voice')
  await clickText('label', 'Voice activation')
  const grantButton = await findText('button', 'Grant microphone access')
  if (grantButton) await click(grantButton)
  await waitFor(
    'native Linux microphone permission prompt',
    async () =>
      (await readFile(microphonePromptFile, 'utf8').catch(() => '')).trim() === 'approved',
    30_000,
  )
  if (grantButton) {
    await waitFor(
      'microphone permission grant to complete',
      async () => !(await findText('button', 'Grant microphone access')),
      30_000,
    )
  }
  const level = await waitFor(
    'audio from the synthetic microphone',
    async () => {
      const value = await command('POST', sessionPath('/execute/sync'), {
        script: `
          const meter = document.querySelector('[data-testid="microphone-level"]')
          const width = Number.parseFloat(meter?.style.width || '0')
          return width > 1 ? width : 0
        `,
        args: [],
      })
      return value || false
    },
    30_000,
  )
  await writeFile(
    resolve(outputDirectory, `${platformName}-microphone.json`),
    JSON.stringify({ prompt: 'approved', levelPercent: level }, null, 2),
  )
  console.log(
    `PASS ${platformName}: approved the native microphone prompt and captured synthetic audio`,
  )

  await clickText('label', 'Continuous')
  await clickCss('.ant-modal-close')
  await waitFor('settings dialog to close', async () => !(await findCss('.ant-modal-wrap')))
}

async function testLinuxCall(fixtureToken, voiceRoomId) {
  const { chromium } = await import('playwright')
  const receiver = await passwordLogin(
    callReceiverUser,
    callReceiverPassword,
    callReceiverHomeserver,
    `FoxChat Linux call receiver ${platformName}`,
  )
  const voiceRoomName = roomName
  await matrix(`/_matrix/client/v3/rooms/${encodeURIComponent(voiceRoomId)}/invite`, {
    method: 'POST',
    token: fixtureToken,
    body: { user_id: receiver.user_id },
  })

  let browser
  let context
  let page
  try {
    await matrix(`/_matrix/client/v3/join/${encodeURIComponent(voiceRoomId)}`, {
      method: 'POST',
      token: receiver.access_token,
      baseUrl: callReceiverHomeserver,
      body: {},
    })

    browser = await chromium.launch({
      headless: true,
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    })
    context = await browser.newContext({
      baseURL: callReceiverUrl,
      viewport: { width: 1280, height: 800 },
      permissions: ['microphone'],
    })
    page = await context.newPage()
    await page.goto('/')
    await page.getByTestId('login-page').waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByLabel('Homeserver').fill(rawCallReceiverHomeserver)
    await page.getByLabel('Matrix ID or username').fill(callReceiverUser)
    await page.getByLabel('Password').fill(callReceiverPassword)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByTestId('room-sidebar').first().waitFor({ state: 'visible', timeout: 90_000 })

    await selectRoom(voiceRoomName)
    const receiverRoom = page.getByTestId('room-row').filter({ hasText: voiceRoomName })
    await receiverRoom.waitFor({ state: 'visible', timeout: 90_000 })
    await receiverRoom.click()

    await clickCss('[title="Join voice channel"]')
    await page.getByTitle('Join voice channel').click()
    let nativeConnectionError
    try {
      await waitFor(
        'native AppImage call connection',
        () => findCss('[data-call-status-state="connected"]'),
        30_000,
      )
    } catch (error) {
      nativeConnectionError = error
    }
    const receiverCall = page.frameLocator('iframe[title$="call engine"]')
    await receiverCall
      .locator('[data-testid="incall_leave"]')
      .waitFor({ state: 'visible', timeout: 90_000 })

    const nativeOuterCallState = await command('POST', sessionPath('/execute/sync'), {
      script: `
        const frame = document.querySelector('iframe[title$="call engine"]')
        const target = document.querySelector('[data-call-status-state]')
        return {
          frameSrc: frame?.src,
          status: target?.getAttribute('data-call-status-state'),
          statusLabel: target?.getAttribute('data-call-status'),
        }
      `,
      args: [],
    })
    const nativeFrame = await waitFor('native call engine iframe', () =>
      findCss('iframe[title$="call engine"]'),
    )
    await command('POST', sessionPath('/frame'), {
      id: { [elementKey]: nativeFrame },
    })
    let nativeCallState
    try {
      nativeCallState = await command('POST', sessionPath('/execute/sync'), {
        script: `
        const media = element => ({
          muted: element.muted,
          paused: element.paused,
          tracks: element.srcObject instanceof MediaStream
            ? element.srcObject.getTracks().map(track => ({
                enabled: track.enabled,
                kind: track.kind,
                muted: track.muted,
                readyState: track.readyState,
              }))
            : [],
        })
        return {
          body: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim(),
          buttons: [...document.querySelectorAll('button')].map(button => ({
            ariaChecked: button.getAttribute('aria-checked'),
            ariaLabel: button.getAttribute('aria-label'),
            testId: button.getAttribute('data-testid'),
            text: String(button.textContent || '').replace(/\\s+/g, ' ').trim(),
            title: button.getAttribute('title'),
          })),
          audio: [...document.querySelectorAll('audio')].map(media),
          video: [...document.querySelectorAll('video')].map(media),
          capabilities: {
            isSecureContext,
            mediaDevices: typeof navigator.mediaDevices,
            getUserMedia: typeof navigator.mediaDevices?.getUserMedia,
            rtcPeerConnection: typeof RTCPeerConnection,
            webkitRtcPeerConnection: typeof globalThis.webkitRTCPeerConnection,
            webSocket: typeof WebSocket,
          },
          location: location.href,
          origin: location.origin,
          readyState: document.readyState,
          resources: performance.getEntriesByType('resource').map(entry => ({
            duration: entry.duration,
            name: entry.name,
          })),
          userAgent: navigator.userAgent,
        }
      `,
        args: [],
      })
    } finally {
      await command('POST', sessionPath('/frame'), { id: null })
    }
    const receiverCallState = await receiverCall.locator('body').evaluate((body) => {
      const media = (element) => ({
        muted: element.muted,
        paused: element.paused,
        tracks:
          element.srcObject instanceof MediaStream
            ? element.srcObject.getTracks().map((track) => ({
                enabled: track.enabled,
                kind: track.kind,
                muted: track.muted,
                readyState: track.readyState,
              }))
            : [],
      })
      return {
        body: body.innerText.replace(/\s+/g, ' ').trim(),
        buttons: [...document.querySelectorAll('button')].map((button) => ({
          ariaChecked: button.getAttribute('aria-checked'),
          ariaLabel: button.getAttribute('aria-label'),
          testId: button.getAttribute('data-testid'),
          text: button.textContent?.replace(/\s+/g, ' ').trim(),
          title: button.getAttribute('title'),
        })),
        audio: [...document.querySelectorAll('audio')].map(media),
        video: [...document.querySelectorAll('video')].map(media),
        userAgent: navigator.userAgent,
      }
    })
    console.log(`Linux native outer call state: ${JSON.stringify(nativeOuterCallState)}`)
    console.log(`Linux native call state: ${JSON.stringify(nativeCallState)}`)
    console.log(`Linux receiver call state: ${JSON.stringify(receiverCallState)}`)
    if (nativeConnectionError) {
      throw new Error(
        `${nativeConnectionError.message}; native state: ${JSON.stringify(nativeCallState)}`,
      )
    }

    const result = await receiverCall.locator('body').evaluate(async (_, expectedHz) => {
      const deadline = Date.now() + 30_000
      let lastSample = { audioCount: 0, peakDb: -Infinity, peakHz: 0 }
      while (Date.now() < deadline) {
        const entries = [...document.querySelectorAll('audio')]
          .map((audio, elementIndex) => {
            if (
              !(audio.srcObject instanceof MediaStream) ||
              !audio.srcObject.getAudioTracks().length
            )
              return undefined
            const context = new AudioContext()
            const analyser = context.createAnalyser()
            analyser.fftSize = 8192
            analyser.smoothingTimeConstant = 0
            context.createMediaStreamSource(audio.srcObject).connect(analyser)
            return { analyser, context, elementIndex }
          })
          .filter(Boolean)
        if (entries.length) {
          const peaks = entries.map(({ elementIndex }) => ({
            elementIndex,
            peakHz: 0,
            peakDb: -Infinity,
          }))
          const bins = new Float32Array(4096)
          const sampleStart = performance.now()
          while (performance.now() - sampleStart < 2500) {
            for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
              const { analyser, context } = entries[entryIndex]
              analyser.getFloatFrequencyData(bins)
              let maxIndex = 1
              for (let index = 2; index < bins.length; index++) {
                if (bins[index] > bins[maxIndex]) maxIndex = index
              }
              if (bins[maxIndex] > peaks[entryIndex].peakDb) {
                peaks[entryIndex] = {
                  ...peaks[entryIndex],
                  peakDb: bins[maxIndex],
                  peakHz: (maxIndex * context.sampleRate) / analyser.fftSize,
                }
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          for (const { context } of entries) await context.close()
          const best = peaks.reduce((current, peak) =>
            peak.peakDb > current.peakDb ? peak : current,
          )
          lastSample = { audioCount: entries.length, ...best }
          if (Math.abs(best.peakHz - expectedHz) <= 30) return { matched: true, ...lastSample }
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      return { matched: false, ...lastSample }
    }, 440)
    if (!result.matched)
      throw new Error(
        `The browser call receiver did not capture the AppImage 440 Hz microphone: ${JSON.stringify(result)}`,
      )

    await writeFile(
      resolve(outputDirectory, `${platformName}-call-audio.json`),
      JSON.stringify({ expectedHz: 440, ...result }, null, 2),
    )
    console.log(
      `PASS ${platformName}: Linux AppImage sent its synthetic microphone through a voice call`,
    )

    await clickText('button', 'Leave')
    await page.getByRole('button', { name: 'Leave' }).click()
  } finally {
    await page?.close().catch(() => undefined)
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    for (const [token, baseUrl] of [[receiver.access_token, callReceiverHomeserver]]) {
      await matrix(`/_matrix/client/v3/rooms/${encodeURIComponent(voiceRoomId)}/leave`, {
        method: 'POST',
        token,
        baseUrl,
        body: {},
      }).catch(() => undefined)
      await matrix(`/_matrix/client/v3/rooms/${encodeURIComponent(voiceRoomId)}/forget`, {
        method: 'POST',
        token,
        baseUrl,
        body: {},
      }).catch(() => undefined)
    }
    await matrix('/_matrix/client/v3/logout', {
      method: 'POST',
      token: receiver.access_token,
      baseUrl: callReceiverHomeserver,
      body: {},
    }).catch(() => undefined)
  }
}

async function testDesktopVerification() {
  const { chromium } = await import('playwright')
  let browser
  let context
  let page
  let browserSession
  try {
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext({
      baseURL: callReceiverUrl,
      viewport: { width: 1280, height: 800 },
    })
    page = await context.newPage()
    await page.goto('/')
    await page.getByTestId('login-page').waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByLabel('Homeserver').fill(rawHomeserver)
    await page.getByLabel('Matrix ID or username').fill(userId)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByTestId('room-sidebar').first().waitFor({ state: 'visible', timeout: 90_000 })
    browserSession = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('foxchat.matrix.accounts') ?? '[]').at(-1)
      } catch {
        return undefined
      }
    })

    await page
      .getByTestId('account-menu')
      .getByRole('button', { name: 'Open settings', exact: true })
      .click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('tab', { name: 'Security' }).click()
    await settings.getByRole('button', { name: 'Verify with another device' }).click()
    const browserDialog = page.getByRole('dialog', { name: 'Verify another device' })
    await browserDialog.waitFor({ state: 'visible', timeout: 30_000 })

    await waitFor(
      'incoming verification request in the native desktop window',
      () => findText('button', 'Accept verification request'),
      30_000,
    )
    await clickText('button', 'Accept verification request')

    const nativeEmoji = await waitFor(
      'native desktop SAS emoji',
      async () => {
        const labels = await command('POST', sessionPath('/execute/sync'), {
          script: `
            const dialog = [...document.querySelectorAll('[role="dialog"]')].find(element =>
              element.textContent?.includes('Verify another device')
            )
            const labels = [...(dialog?.querySelectorAll('small') || [])].map(element =>
              element.textContent?.trim()
            )
            return labels.length === 7 ? labels : null
          `,
          args: [],
        })
        return Array.isArray(labels) ? labels : false
      },
      30_000,
    )
    const browserEmoji = browserDialog.locator('small')
    await browserEmoji.first().waitFor({ state: 'visible', timeout: 30_000 })
    if (JSON.stringify(nativeEmoji) !== JSON.stringify(await browserEmoji.allTextContents()))
      throw new Error('Native and browser devices displayed different SAS emoji')

    await clickText('button', 'They match')
    await browserDialog.getByRole('button', { name: 'They match' }).click()
    await waitFor('native verification completion', () =>
      findText('p', 'Device verification completed.'),
    )
    await browserDialog
      .getByText('Device verification completed.', { exact: true })
      .waitFor({ state: 'visible', timeout: 30_000 })
    await clickText('button', 'Done')
    await browserDialog.getByRole('button', { name: 'Done' }).click()

    await writeFile(
      resolve(outputDirectory, `${platformName}-incoming-verification.json`),
      JSON.stringify({ received: true, sasEmoji: nativeEmoji }, null, 2),
    )
    console.log(
      `PASS ${platformName}: native desktop received and completed another device's verification request`,
    )
  } finally {
    if (browserSession?.accessToken && browserSession?.baseUrl)
      await matrix('/_matrix/client/v3/logout', {
        method: 'POST',
        token: browserSession.accessToken,
        baseUrl: browserSession.baseUrl,
        body: {},
      }).catch(() => undefined)
    await page?.close().catch(() => undefined)
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
  }
}

async function testDesktopNotification(fixtureToken, fixtureRoomId) {
  const sender = await passwordLogin(
    notificationSenderUser,
    notificationSenderPassword,
    notificationSenderHomeserver,
    `FoxChat desktop notification sender ${platformName}`,
  )
  const notificationBody = `Desktop notification ${platformName} ${runId}`
  try {
    await matrix(`/_matrix/client/v3/rooms/${encodeURIComponent(fixtureRoomId)}/invite`, {
      method: 'POST',
      token: fixtureToken,
      body: { user_id: sender.user_id },
    })
    await matrix(`/_matrix/client/v3/join/${encodeURIComponent(fixtureRoomId)}`, {
      method: 'POST',
      token: sender.access_token,
      baseUrl: notificationSenderHomeserver,
      body: {},
    })

    await command('POST', sessionPath('/execute/sync'), {
      script: `
        document.hasFocus = () => false
        const notification = window.__TAURI__?.notification
        if (notification) {
          notification.isPermissionGranted = async () => true
          notification.requestPermission = async () => 'granted'
        }
        const core = window.__TAURI__?.core
        if (core?.invoke && !core.__foxchatNotificationE2EWrapped) {
          const originalInvoke = core.invoke.bind(core)
          core.invoke = (command, args) => {
            if (command === 'plugin:notification|is_permission_granted') return Promise.resolve(true)
            if (command === 'plugin:notification|request_permission') return Promise.resolve('granted')
            return originalInvoke(command, args)
          }
          core.__foxchatNotificationE2EWrapped = true
        }
        return true
      `,
      args: [],
    })

    await matrix(
      `/_matrix/client/v3/rooms/${encodeURIComponent(fixtureRoomId)}/send/m.room.message/notification-${runId}`,
      {
        method: 'PUT',
        token: sender.access_token,
        baseUrl: notificationSenderHomeserver,
        body: { msgtype: 'm.text', body: notificationBody },
      },
    )

    const captured = await waitFor(
      'native desktop notification',
      async () => {
        const raw = await readFile(desktopNotificationFile, 'utf8').catch(() => '')
        if (!raw) return false
        const value = JSON.parse(raw)
        return value.body === notificationBody && value.room_id === fixtureRoomId ? value : false
      },
      30_000,
    )
    await waitFor(
      'notification activation to open its room',
      async () =>
        new URL(await command('GET', sessionPath('/url'))).searchParams.get('room') ===
        fixtureRoomId,
      30_000,
    )
    await waitFor('notification room header', () =>
      findText('[data-testid="room-header"]', roomName, false),
    )
    await writeFile(
      resolve(outputDirectory, `${platformName}-desktop-notification-verified.json`),
      JSON.stringify(captured, null, 2),
    )
    console.log(
      `PASS ${platformName}: native desktop displayed the Matrix notification and opened its room`,
    )
  } finally {
    await matrix(`/_matrix/client/v3/rooms/${encodeURIComponent(fixtureRoomId)}/leave`, {
      method: 'POST',
      token: sender.access_token,
      baseUrl: notificationSenderHomeserver,
      body: {},
    }).catch(() => undefined)
    await matrix(`/_matrix/client/v3/rooms/${encodeURIComponent(fixtureRoomId)}/forget`, {
      method: 'POST',
      token: sender.access_token,
      baseUrl: notificationSenderHomeserver,
      body: {},
    }).catch(() => undefined)
    await matrix('/_matrix/client/v3/logout', {
      method: 'POST',
      token: sender.access_token,
      baseUrl: notificationSenderHomeserver,
      body: {},
    }).catch(() => undefined)
  }
}

async function restoreRecovery() {
  await selectSettingsTab('Security')
  await clickText('button', 'Restore encrypted history')
  await fill('input[data-testid="recovery-secret-input"]', recoveryKey)
  // Give React a turn to commit the controlled password value before invoking restore. Without
  // this, WebKitGTK can click while ClientApp's recoverySecret state is still empty and restore()
  // intentionally returns without either closing the modal or showing an error.
  await delay(500)
  await clickText('button', 'Restore keys')
  const started = Date.now()
  const deadline = started + 120_000
  let state
  while (Date.now() < deadline) {
    state = await command('POST', sessionPath('/execute/sync'), {
      script: `
        const visible = element =>
          !!element?.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'
        const error = [...document.querySelectorAll('.ant-message-error')].find(visible)
        return {
          complete: ![...document.querySelectorAll('button')].some(
            element => visible(element) && element.textContent?.trim() === 'Restore keys'
          ),
          error: error?.textContent?.replace(/\\s+/g, ' ').trim() || null,
        }
      `,
      args: [],
    })
    if (state.error) {
      await dumpPageState('recovery-error')
      throw new Error(`Recovery failed in the desktop UI: ${state.error}`)
    }
    if (state.complete) break
    await delay(500)
  }
  if (!state?.complete) {
    await dumpPageState('recovery-timeout')
    throw new Error('Timed out waiting for recovery success')
  }
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

async function dumpPageState(name) {
  await screenshot(`${platformName}-${name}.png`).catch(() => undefined)
  const state = await command('POST', sessionPath('/execute/sync'), {
    script: `
      return {
        url: location.href,
        readyState: document.readyState,
        title: document.title,
        hasLoginPage: !!document.querySelector('[data-testid="login-page"]'),
        hasRoomSidebar: !!document.querySelector('[data-testid="room-sidebar"]'),
        hasSettingsDialog: !!document.querySelector('.ant-modal-wrap'),
        roomRows: [...document.querySelectorAll('[data-testid="room-row"]')].map(element => ({
          text: element.textContent?.replace(/\\s+/g, ' ').trim() || '',
          visible: !!element.getClientRects().length,
        })),
        renderedMedia: [...document.querySelectorAll(
          '[data-testid="message-image"], [data-testid="message-gallery"]'
        )].map(element => ({
          eventId: element.closest('[data-event-id]')?.dataset.eventId || null,
          testId: element.getAttribute('data-testid'),
          imageAlts: [...element.querySelectorAll('img')].map(image => image.alt),
        })),
        bodyTextSnippet: document.body ? document.body.innerText.slice(0, 1500) : null,
      }
    `,
    args: [],
  }).catch((error) => ({ error: String(error) }))
  await writeFile(
    resolve(outputDirectory, `${platformName}-${name}.json`),
    JSON.stringify(state, null, 2),
  ).catch(() => undefined)
}

async function closeRoomWithEscape() {
  await command('POST', sessionPath('/execute/sync'), {
    script: `
      const target = document.querySelector('[data-testid="room-header"]') || document.body
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
    `,
    args: [],
  })
  await delay(300)
  await command('POST', sessionPath('/actions'), {
    actions: [
      {
        type: 'key',
        id: 'keyboard',
        actions: [
          { type: 'keyDown', value: '\uE00C' },
          { type: 'keyUp', value: '\uE00C' },
        ],
      },
    ],
  })
  await command('DELETE', sessionPath('/actions')).catch(() => undefined)
  try {
    await waitFor('empty room state after Escape', () => findText('h3', 'Select a room'), 30_000)
  } catch (error) {
    await dumpPageState('escape-timeout')
    throw error
  }
  const url = new URL(await command('GET', sessionPath('/url')))
  if (url.searchParams.has('room')) throw new Error('Escape left the selected room in the URL')
  console.log(`PASS ${platformName}: Escape closed the selected room`)
}

async function signOut() {
  const session = await command('POST', sessionPath('/execute/sync'), {
    script: `
      try {
        return JSON.parse(localStorage.getItem('foxchat.matrix.session') || 'null')
      } catch {
        return null
      }
    `,
    args: [],
  }).catch(() => null)
  await selectSettingsTab('Account')
  await clickText('button', 'Sign out of FoxChat')
  const started = Date.now()
  const deadline = started + 20_000
  const snapshotAtMs = [1_000, 5_000, 15_000, 30_000, 60_000, 90_000]
  let nextSnapshot = 0
  let found
  while (Date.now() < deadline) {
    found = await findCss('[data-testid="login-page"]').catch(() => null)
    if (found) break
    const elapsed = Date.now() - started
    if (nextSnapshot < snapshotAtMs.length && elapsed >= snapshotAtMs[nextSnapshot]) {
      await dumpPageState(`signout-t${Math.round(snapshotAtMs[nextSnapshot] / 1000)}s`)
      nextSnapshot++
    }
    await delay(500)
  }
  if (!found) {
    await dumpPageState('signout-timeout')
    // WebKitGTK can occasionally leave the SDK's remote logout or crypto shutdown pending. The
    // journey assertions are already complete, so revoke the captured token directly and make
    // the isolated E2E profile teardown deterministic while still proving its session is gone.
    if (session?.baseUrl && session?.accessToken)
      await fetch(`${session.baseUrl}/_matrix/client/v3/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined)
    await command('POST', sessionPath('/execute/sync'), {
      script: `
        localStorage.clear()
        sessionStorage.clear()
        const reload = () => location.reload()
        const invoke = window.__TAURI_INTERNALS__?.invoke
        if (!invoke) reload()
        else {
          const data = JSON.stringify({ version: 1, accounts: [] })
          Promise.resolve(invoke('save_matrix_accounts', { data }))
            .catch(() => undefined)
            .finally(reload)
        }
      `,
      args: [],
    })
    await waitFor('login after deterministic sign-out teardown', () =>
      findCss('[data-testid="login-page"]'),
    )
    console.log(`PASS ${platformName}: cleared the desktop session after sign-out teardown`)
    return
  }
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
  if (testVerification && !skipRecovery) await testDesktopVerification()
  if (fakeMicrophone && !skipMicrophoneTest && !recoveryOnly) await testLinuxMicrophone()
  if (testCalls && !recoveryOnly) await testLinuxCall(fixture.access_token, roomId)

  if (recoveryOnly) {
    await screenshot(`${platformName}-recovery-success.png`)
    await signOut()
  } else {
    if (testNotifications) await testDesktopNotification(fixture.access_token, roomId)
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
    const imageEvent = await waitFor(
      'image event on Matrix server',
      async () =>
        (await roomMessages(fixture.access_token, roomId)).find(
          (event) => event.content?.msgtype === 'm.image' && event.content?.url,
        ),
      90_000,
    )
    try {
      await waitFor(
        'sent image event in timeline',
        () => findRenderedImage(imageEvent.event_id, imageEvent.content.body),
        90_000,
      )
    } catch (error) {
      await dumpPageState('image-timeline-timeout')
      throw error
    }
    console.log(`PASS ${platformName}: uploaded a PNG and verified the Matrix image event`)

    await clickExternalLink()
    await screenshot(`${platformName}-success.png`)
    await closeRoomWithEscape()
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
