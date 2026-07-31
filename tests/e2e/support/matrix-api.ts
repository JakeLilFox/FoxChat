import { expect, type Browser, type Page } from '@playwright/test'
import type { MatrixTestAccount } from './env'

export type StoredSession = {
  baseUrl: string
  accessToken: string
  userId: string
  deviceId: string
}

export async function storedSessions(page: Page): Promise<StoredSession[]> {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('foxchat.matrix.accounts') ?? '[]') as StoredSession[]
    } catch {
      return []
    }
  })
}

export async function rawLogin(account: MatrixTestAccount): Promise<StoredSession> {
  const baseUrl = await resolveBaseUrl(account.homeserver)
  const response = await fetch(`${baseUrl}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: account.userId },
      password: account.password,
    }),
  })
  if (!response.ok)
    throw new Error(
      `Could not sign in ${account.userId} via the raw API: ${response.status} ${await response.text()}`,
    )
  const login = (await response.json()) as {
    access_token: string
    device_id: string
    user_id: string
  }
  return {
    baseUrl,
    accessToken: login.access_token,
    userId: login.user_id,
    deviceId: login.device_id,
  }
}

export async function resolveBaseUrl(homeserver: string): Promise<string> {
  const normalize = (value: string) =>
    (/^https?:\/\//i.test(value)
      ? value
      : value.startsWith('//')
        ? `https:${value}`
        : `https://${value}`
    ).replace(/\/$/, '')
  const withProtocol = normalize(homeserver)
  try {
    const response = await fetch(`${withProtocol}/.well-known/matrix/client`)
    if (response.ok) {
      const data = (await response.json()) as {
        'm.homeserver'?: { base_url?: string }
      }
      const baseUrl = data['m.homeserver']?.base_url
      if (baseUrl) return normalize(baseUrl)
    }
  } catch {}
  return withProtocol
}

export async function wipeAllDevices(browser: Browser, account: MatrixTestAccount) {
  const baseUrl = await resolveBaseUrl(account.homeserver)
  const loginResponse = await fetch(`${baseUrl}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: account.userId },
      password: account.password,
    }),
  })
  if (!loginResponse.ok)
    throw new Error(
      `Could not sign in ${account.userId} to wipe its devices: ${loginResponse.status} ${await loginResponse.text()}`,
    )
  const login = (await loginResponse.json()) as {
    access_token: string
    device_id: string
    user_id: string
  }
  const session: StoredSession = {
    baseUrl,
    accessToken: login.access_token,
    userId: login.user_id,
    deviceId: login.device_id,
  }
  await removeOtherDevices(browser, session, account.password)
  await fetch(`${baseUrl}/_matrix/client/v3/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${login.access_token}` },
  }).catch(() => undefined)
}

async function matrixRequest(session: StoredSession, method: 'POST' | 'DELETE', path: string) {
  const response = await fetch(`${session.baseUrl}/_matrix/client/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  if (
    !response.ok &&
    response.status !== 400 &&
    response.status !== 403 &&
    response.status !== 404
  ) {
    throw new Error(
      `Matrix cleanup ${method} ${path} failed with ${response.status}: ${await response.text()}`,
    )
  }
}

export async function cleanTestRoom(roomId: string | undefined, sessions: StoredSession[]) {
  if (!roomId) return
  const encoded = encodeURIComponent(roomId)
  for (const session of [...sessions].reverse()) {
    await matrixRequest(session, 'POST', `/rooms/${encoded}/leave`)
    await matrixRequest(session, 'POST', `/rooms/${encoded}/forget`)
  }
}

export async function cleanStaleTestRooms(
  prefix: string,
  sessions: StoredSession[],
): Promise<number> {
  let cleaned = 0
  for (const session of sessions) {
    const headers = { Authorization: `Bearer ${session.accessToken}` }
    const joinedResponse = await fetch(`${session.baseUrl}/_matrix/client/v3/joined_rooms`, {
      headers,
    })
    if (!joinedResponse.ok) continue
    const joined = (await joinedResponse.json()) as { joined_rooms?: string[] }
    for (const roomId of joined.joined_rooms ?? []) {
      const nameResponse = await fetch(
        `${session.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name`,
        { headers },
      )
      if (!nameResponse.ok) continue
      const content = (await nameResponse.json()) as { name?: unknown }
      if (typeof content.name !== 'string' || !content.name.startsWith(`${prefix} `)) continue
      await cleanTestRoom(roomId, [session])
      cleaned++
    }
  }
  return cleaned
}

export async function removeOtherDevices(
  browser: Browser,
  current: StoredSession,
  password: string,
) {
  const headers = {
    Authorization: `Bearer ${current.accessToken}`,
    'Content-Type': 'application/json',
  }
  const list = async () => {
    const response = await fetch(`${current.baseUrl}/_matrix/client/v3/devices`, { headers })
    if (!response.ok)
      throw new Error(
        `Could not load the device list for ${current.userId}: ${response.status} ${await response.text()}`,
      )
    return (await response.json()) as {
      devices?: Array<{ device_id: string }>
    }
  }
  const devices = (await list()).devices ?? []
  const otherDeviceIds = devices
    .map((device) => device.device_id)
    .filter((deviceId) => deviceId !== current.deviceId)
  if (otherDeviceIds.length) {
    const url = `${current.baseUrl}/_matrix/client/v3/delete_devices`
    let response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ devices: otherDeviceIds }),
    })
    if (response.status === 401) {
      const challenge = (await response.json()) as { session?: string }
      if (!challenge.session)
        throw new Error(`Device deletion for ${current.userId} requires unsupported authentication`)
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          devices: otherDeviceIds,
          auth: {
            type: 'm.login.password',
            identifier: { type: 'm.id.user', user: current.userId },
            password,
            session: challenge.session,
          },
        }),
      })
    }
    if (response.status === 404) {
      const metadataResponse = await fetch(`${current.baseUrl}/_matrix/client/v1/auth_metadata`, {
        headers,
      })
      if (!metadataResponse.ok)
        throw new Error(
          `Could not discover account management for ${current.userId}: ${metadataResponse.status} ${await metadataResponse.text()}`,
        )
      const metadata = (await metadataResponse.json()) as {
        account_management_uri?: string
        account_management_actions_supported?: string[]
      }
      if (
        !metadata.account_management_uri ||
        !metadata.account_management_actions_supported?.includes('org.matrix.device_delete')
      )
        throw new Error(`The homeserver does not expose device deletion for ${current.userId}`)

      const context = await browser.newContext()
      const page = await context.newPage()
      try {
        for (const [index, deviceId] of otherDeviceIds.entries()) {
          const target = new URL(metadata.account_management_uri)
          target.searchParams.set('action', 'org.matrix.device_delete')
          target.searchParams.set('device_id', deviceId)
          await page.goto(target.toString())
          if (index === 0) {
            const username = page.getByLabel('Username or Email')
            if (await username.isVisible()) {
              await username.fill(current.userId.replace(/^@/, '').replace(/:.*$/, ''))
              const passwordInput = page.getByLabel('Password')
              await passwordInput.fill(password)
              await page.getByRole('button', { name: 'Continue' }).click()
            }
          }
          const remove = page.getByRole('button', {
            name: 'Remove device',
            exact: true,
          })
          try {
            await expect(remove).toBeVisible({ timeout: 30_000 })
          } catch (error) {
            await page
              .getByLabel('Password')
              .fill('')
              .catch(() => undefined)
            throw error
          }
          await remove.click()
          const confirmation = page.getByRole('dialog')
          await expect(confirmation).toBeVisible()
          await confirmation.getByRole('button', { name: 'Remove device', exact: true }).click()
          await expect(confirmation).toBeHidden({ timeout: 30_000 })
        }
      } finally {
        await context.close()
      }
    } else if (!response.ok) {
      throw new Error(
        `Could not sign out non-current devices for ${current.userId}: ${response.status} ${await response.text()}`,
      )
    }
  }
  const remaining = (await list()).devices ?? []
  if (remaining.length !== 1 || remaining[0]?.device_id !== current.deviceId)
    throw new Error(
      `Expected only current device ${current.deviceId} for ${current.userId}, found ${remaining.map((device) => device.device_id).join(', ')}`,
    )
}

async function withRetry<T>(
  label: string,
  action: () => Promise<Response>,
  parseOk: (response: Response) => Promise<T>,
  { maxRetryAfterMs = 120_000, maxAttempts = 3 } = {},
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await action()
    if (response.ok) return parseOk(response)
    const body = await response.text()
    if (response.status === 429) {
      const failure = (() => {
        try {
          return JSON.parse(body) as { retry_after_ms?: number }
        } catch {
          return {}
        }
      })()
      if (
        attempt < maxAttempts - 1 &&
        typeof failure.retry_after_ms === 'number' &&
        failure.retry_after_ms <= maxRetryAfterMs
      ) {
        await new Promise((resolve) => setTimeout(resolve, failure.retry_after_ms! + 250))
        continue
      }
    }
    throw new Error(`${label} failed with ${response.status}: ${body}`)
  }
  throw new Error(`${label} did not succeed after ${maxAttempts} attempts`)
}

export async function uploadMedia(
  session: StoredSession,
  data: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  return withRetry(
    `Matrix media upload ${filename}`,
    () =>
      fetch(`${session.baseUrl}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': mimeType,
        },
        body: new Uint8Array(data),
      }),
    async (response) => ((await response.json()) as { content_uri: string }).content_uri,
  )
}

export async function setAccountData(
  session: StoredSession,
  eventType: string,
  content: Record<string, unknown>,
) {
  await withRetry(
    `Matrix set account data ${eventType} for ${session.userId}`,
    () =>
      fetch(
        `${session.baseUrl}/_matrix/client/v3/user/${encodeURIComponent(session.userId)}/account_data/${encodeURIComponent(eventType)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(content),
        },
      ),
    async () => undefined,
  )
}

export async function setRoomState(
  session: StoredSession,
  roomId: string,
  eventType: string,
  stateKey: string,
  content: Record<string, unknown>,
) {
  await withRetry(
    `Matrix set state ${eventType}/${stateKey} in ${roomId}`,
    () =>
      fetch(
        `${session.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(eventType)}/${encodeURIComponent(stateKey)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(content),
        },
      ),
    async () => undefined,
  )
}

export async function getRoomState(
  session: StoredSession,
  roomId: string,
  eventType: string,
  stateKey: string,
): Promise<unknown> {
  const response = await fetch(
    `${session.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(eventType)}/${encodeURIComponent(stateKey)}`,
    { headers: { Authorization: `Bearer ${session.accessToken}` } },
  )
  if (response.status === 404) return undefined
  if (!response.ok)
    throw new Error(
      `Matrix get state ${eventType}/${stateKey} in ${roomId} failed with ${response.status}: ${await response.text()}`,
    )
  return response.json()
}

export async function createRoom(
  session: StoredSession,
  options: Record<string, unknown>,
): Promise<string> {
  return withRetry(
    `Matrix create room for ${session.userId}`,
    () =>
      fetch(`${session.baseUrl}/_matrix/client/v3/createRoom`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options),
      }),
    async (response) => ((await response.json()) as { room_id: string }).room_id,
  )
}

export async function joinRoomAs(session: StoredSession, roomId: string) {
  await withRetry(
    `Matrix join ${roomId}`,
    () =>
      fetch(`${session.baseUrl}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
    async () => undefined,
  )
}

export async function inviteToRoom(session: StoredSession, roomId: string, userId: string) {
  await withRetry(
    `Matrix invite ${userId} to ${roomId}`,
    () =>
      fetch(`${session.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: userId }),
      }),
    async () => undefined,
  )
}

export async function kickFromRoom(
  session: StoredSession,
  roomId: string,
  userId: string,
  reason?: string,
) {
  await withRetry(
    `Matrix kick ${userId} from ${roomId}`,
    () =>
      fetch(`${session.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/kick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: userId, ...(reason ? { reason } : {}) }),
      }),
    async () => undefined,
  )
}

export async function setEventTypeNotifyRule(
  session: StoredSession,
  eventType: string,
  ruleId = `foxchat_e2e_notify_${eventType}`,
) {
  await withRetry(
    `Matrix push rule for ${eventType}`,
    () =>
      fetch(
        `${session.baseUrl}/_matrix/client/v3/pushrules/global/override/${encodeURIComponent(ruleId)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            conditions: [{ kind: 'event_match', key: 'type', pattern: eventType }],
            actions: ['notify'],
          }),
        },
      ),
    async () => undefined,
  )
  return ruleId
}

export async function sendReadReceipt(session: StoredSession, roomId: string, eventId: string) {
  await withRetry(
    `Matrix read receipt ${roomId}/${eventId}`,
    () =>
      fetch(
        `${session.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        },
      ),
    async () => undefined,
  )
}

export async function roomUnreadCount(session: StoredSession, roomId: string): Promise<number> {
  const filter = JSON.stringify({
    room: {
      rooms: [roomId],
      timeline: { limit: 1 },
      state: { types: [] },
      ephemeral: { types: [] },
      account_data: { types: [] },
    },
  })
  const response = await fetch(
    `${session.baseUrl}/_matrix/client/v3/sync?timeout=0&filter=${encodeURIComponent(filter)}`,
    { headers: { Authorization: `Bearer ${session.accessToken}` } },
  )
  if (!response.ok)
    throw new Error(
      `Could not read unread count for ${roomId}: ${response.status} ${await response.text()}`,
    )
  const sync = (await response.json()) as {
    rooms?: {
      join?: Record<string, { unread_notifications?: { notification_count?: number } }>
    }
  }
  return sync.rooms?.join?.[roomId]?.unread_notifications?.notification_count ?? 0
}

export async function sendFillerMessages(
  session: StoredSession,
  roomId: string,
  count: number,
  label: string,
  options: { refreshSession?: () => Promise<StoredSession> } = {},
): Promise<string[]> {
  const eventIds: string[] = []
  let activeSession = session
  for (let index = 0; index < count; index++) {
    const txnId = `foxchat-e2e-filler-${Date.now()}-${index}`
    const send = () =>
      withRetry(
        `Matrix send filler message ${index + 1}/${count} to ${roomId}`,
        () =>
          fetch(
            `${activeSession.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
            {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${activeSession.accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                msgtype: 'm.text',
                body: `${label} ${index + 1}`,
              }),
            },
          ),
        async (response) => ((await response.json()) as { event_id: string }).event_id,
      )
    let eventId: string
    try {
      eventId = await send()
    } catch (error) {
      if (!options.refreshSession || !String(error).includes('M_UNKNOWN_TOKEN')) throw error
      activeSession = await options.refreshSession()
      eventId = await send()
    }
    eventIds.push(eventId)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return eventIds
}

export async function sendReplyMessage(
  session: StoredSession,
  roomId: string,
  body: string,
  replyToEventId: string,
): Promise<string> {
  const txnId = `foxchat-e2e-reply-${Date.now()}`
  return withRetry(
    `Matrix send reply message to ${roomId}`,
    () =>
      fetch(
        `${session.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            msgtype: 'm.text',
            body,
            'm.relates_to': {
              'm.in_reply_to': { event_id: replyToEventId },
            },
          }),
        },
      ),
    async (response) => ((await response.json()) as { event_id: string }).event_id,
  )
}
