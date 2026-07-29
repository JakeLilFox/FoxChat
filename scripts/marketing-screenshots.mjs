#!/usr/bin/env node

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'

const root = process.cwd()
const envFile = resolve(root, 'test.env')
if (existsSync(envFile)) loadEnv({ path: envFile, override: false, quiet: true })

const flags = new Set(process.argv.slice(2))
const flagValue = (name) => {
  const prefix = `${name}=`
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length)
}
const envValue = (name) => process.env[name]?.trim() ?? ''
const enabled = (name) => envValue(name).toLowerCase() === 'true'
const safePath = (path) => relative(root, path).replaceAll('\\', '/')
const sleep = (milliseconds) => new Promise((accept) => setTimeout(accept, milliseconds))

const dryRun = flags.has('--dry-run') || enabled('MARKETING_DRY_RUN')
const audit = flags.has('--audit')
const recoverLegacyRun = flags.has('--recover-interrupted')
const keepRoom = flags.has('--keep-room') || enabled('MARKETING_KEEP_ROOM')
const keepProfiles = flags.has('--keep-profiles') || enabled('MARKETING_KEEP_PROFILES')
const headed = flags.has('--headed') || envValue('MARKETING_HEADLESS').toLowerCase() === 'false'
const delayScale = Math.max(0, Number(envValue('MARKETING_DELAY_SCALE') || '1') || 0)
const baseURL = envValue('E2E_BASE_URL') || 'http://127.0.0.1:4173'
const stamp = new Date()
  .toISOString()
  .replaceAll(':', '-')
  .replace(/\.\d{3}Z$/, 'Z')
const outputDirectory = resolve(
  root,
  flagValue('--output') ||
    envValue('MARKETING_OUTPUT_DIR') ||
    `test-results/marketing-screenshots/${stamp}`,
)
const recoveryDirectory = resolve(root, 'test-results/marketing-screenshots')
const recoveryFile = resolve(recoveryDirectory, 'active-run.json')
const matrixRequestTimeout = Math.max(
  5_000,
  Number(envValue('MARKETING_MATRIX_TIMEOUT_MS') || '30000') || 30_000,
)

const personas = [
  {
    displayName: 'Alex Rivera',
    avatar: resolve(root, 'tests/assets/marketing/alex-rivera.svg'),
    viewport: { width: 1440, height: 960 },
  },
  {
    displayName: 'Nia Okafor',
    avatar: resolve(root, 'tests/assets/marketing/nia-okafor.svg'),
    viewport: { width: 1280, height: 860 },
  },
  {
    displayName: 'Jamie Kim',
    avatar: resolve(root, 'tests/assets/marketing/jamie-kim.svg'),
    viewport: { width: 430, height: 900 },
  },
]
const sharedImage = resolve(root, 'tests/assets/marketing/launch-moodboard.svg')
const roomName = envValue('MARKETING_ROOM_NAME') || 'Launch crew'
const roomTopic =
  envValue('MARKETING_ROOM_TOPIC') || 'Ideas, tiny victories, and everything we need to ship.'

if (flags.has('--help')) {
  console.log(`Create a realistic FoxChat conversation and capture marketing screenshots.

Usage:
  npm run marketing:screenshots
  npm run marketing:screenshots -- --headed
  npm run marketing:screenshots -- --dry-run
  npm run marketing:screenshots -- --output=test-results/my-capture

Options:
  --headed        Show the three browser clients while the script runs
  --dry-run       Validate configuration and assets without touching Matrix
  --audit         Report whether temporary marketing profile names are active
  --recover-interrupted
                  Restore a pre-recovery-marker run from room membership state
  --keep-room     Leave the generated room and messages on the test accounts
  --keep-profiles Keep the generated display names and avatars

The script loads its Matrix accounts from test.env.`)
  process.exit(0)
}

function accountsFromEnvironment() {
  const configured = [2, 3, 4].map((number) => {
    const prefix = `MATRIX_E2E_ACCOUNT_${number}`
    const account = {
      slot: number,
      homeserver: envValue(`${prefix}_HOMESERVER`).replace(/\/$/, ''),
      userId: envValue(`${prefix}_USER`),
      password: envValue(`${prefix}_PASSWORD`),
    }
    if (!account.homeserver || !account.userId || !account.password)
      throw new Error(
        `${prefix}_HOMESERVER, ${prefix}_USER, and ${prefix}_PASSWORD are required in test.env`,
      )
    return account
  })
  const seen = new Set()
  return configured.filter((account) => {
    if (seen.has(account.userId)) return false
    seen.add(account.userId)
    return true
  })
}

function validate(accounts) {
  if (accounts.length < 2)
    throw new Error('Marketing screenshots require two distinct accounts among slots 2, 3, and 4')
  if (!dryRun && !audit && !enabled('MATRIX_E2E_ENABLED'))
    throw new Error('MATRIX_E2E_ENABLED=true is required before using the live test accounts')
  if (!dryRun && !audit && !enabled('MATRIX_E2E_ALLOW_ROOM_MUTATION'))
    throw new Error(
      'MATRIX_E2E_ALLOW_ROOM_MUTATION=true is required because this script creates a room',
    )
  for (const asset of [...personas.map((persona) => persona.avatar), sharedImage])
    if (!existsSync(asset)) throw new Error(`Missing marketing asset: ${safePath(asset)}`)
}

const matrixFetch = (url, options = {}) =>
  fetch(url, {
    ...options,
    signal: AbortSignal.timeout(matrixRequestTimeout),
  })

async function resolveHomeserver(homeserver) {
  const normalize = (value) =>
    (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/$/, '')
  const candidate = normalize(homeserver)
  try {
    const response = await matrixFetch(`${candidate}/.well-known/matrix/client`)
    if (response.ok) {
      const discovery = await response.json()
      if (discovery['m.homeserver']?.base_url) return normalize(discovery['m.homeserver'].base_url)
    }
  } catch {}
  return candidate
}

async function rawLogin(account) {
  const baseUrl = await resolveHomeserver(account.homeserver)
  const response = await matrixFetch(`${baseUrl}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: account.userId },
      password: account.password,
      initial_device_display_name: 'FoxChat marketing setup',
    }),
  })
  if (!response.ok)
    throw new Error(
      `Matrix login failed for ${account.userId}: ${response.status} ${await response.text()}`,
    )
  const login = await response.json()
  return {
    baseUrl,
    accessToken: login.access_token,
    deviceId: login.device_id,
    userId: login.user_id,
  }
}

async function matrixRequest(session, method, path, body, options = {}) {
  const response = await matrixFetch(`${session.baseUrl}/_matrix/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(options.contentType
        ? { 'Content-Type': options.contentType }
        : body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : options.contentType ? body : JSON.stringify(body),
  })
  if (!response.ok && !options.allowedStatuses?.includes(response.status))
    throw new Error(
      `Matrix ${method} /_matrix/${path} failed: ${response.status} ${await response.text()}`,
    )
  if (response.status === 204) return {}
  const text = await response.text()
  return text ? JSON.parse(text) : {}
}

const clientRequest = (session, method, path, body, options) =>
  matrixRequest(session, method, `client/v3${path}`, body, options)

async function uploadMedia(session, file) {
  const body = readFileSync(file)
  const upload = await matrixRequest(
    session,
    'POST',
    `media/v3/upload?filename=${encodeURIComponent(basename(file))}`,
    body,
    { contentType: 'image/svg+xml' },
  )
  if (typeof upload.content_uri !== 'string')
    throw new Error(`Media upload for ${basename(file)} returned no content_uri`)
  return upload.content_uri
}

async function readProfile(session) {
  const encodedUserId = encodeURIComponent(session.userId)
  return clientRequest(session, 'GET', `/profile/${encodedUserId}`)
}

async function prepareProfile(session, persona) {
  const encodedUserId = encodeURIComponent(session.userId)
  const avatarUrl = await uploadMedia(session, persona.avatar)
  await clientRequest(session, 'PUT', `/profile/${encodedUserId}/displayname`, {
    displayname: persona.displayName,
  })
  await clientRequest(session, 'PUT', `/profile/${encodedUserId}/avatar_url`, {
    avatar_url: avatarUrl,
  })
}

async function restoreProfile(session, original) {
  const encodedUserId = encodeURIComponent(session.userId)
  await clientRequest(session, 'PUT', `/profile/${encodedUserId}/displayname`, {
    displayname: typeof original.displayname === 'string' ? original.displayname : '',
  })
  await clientRequest(session, 'PUT', `/profile/${encodedUserId}/avatar_url`, {
    avatar_url: typeof original.avatar_url === 'string' ? original.avatar_url : '',
  })
}

async function createRoom(sessions) {
  const created = await clientRequest(sessions[0], 'POST', '/createRoom', {
    visibility: 'private',
    preset: 'private_chat',
    is_direct: false,
    name: roomName,
    topic: roomTopic,
    invite: sessions.slice(1).map((session) => session.userId),
  })
  if (typeof created.room_id !== 'string') throw new Error('createRoom returned no room_id')
  for (const session of sessions.slice(1))
    await clientRequest(session, 'POST', `/rooms/${encodeURIComponent(created.room_id)}/join`, {})
  return created.room_id
}

async function removeRoom(roomId, sessions) {
  const encodedRoomId = encodeURIComponent(roomId)
  for (const session of [...sessions].reverse()) {
    await clientRequest(
      session,
      'POST',
      `/rooms/${encodedRoomId}/leave`,
      {},
      {
        allowedStatuses: [400, 403, 404],
      },
    )
    await clientRequest(
      session,
      'POST',
      `/rooms/${encodedRoomId}/forget`,
      {},
      {
        allowedStatuses: [400, 403, 404],
      },
    )
  }
}

async function logoutSession(session) {
  await matrixFetch(`${session.baseUrl}/_matrix/client/v3/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}` },
  }).catch(() => undefined)
}

function saveRecoveryState(sessions, originalProfiles, roomId) {
  mkdirSync(recoveryDirectory, { recursive: true })
  writeFileSync(
    recoveryFile,
    `${JSON.stringify(
      {
        userIds: sessions.map((session) => session.userId),
        originalProfiles,
        roomId,
      },
      null,
      2,
    )}\n`,
  )
}

async function recoverInterruptedRun(sessions) {
  if (!existsSync(recoveryFile)) return
  const recovery = JSON.parse(readFileSync(recoveryFile, 'utf8'))
  const expectedUsers = sessions.map((session) => session.userId)
  if (
    !Array.isArray(recovery.userIds) ||
    recovery.userIds.length !== expectedUsers.length ||
    recovery.userIds.some((userId, index) => userId !== expectedUsers[index])
  )
    throw new Error(
      `${safePath(recoveryFile)} belongs to different test accounts; inspect it before removing it`,
    )
  if (!Array.isArray(recovery.originalProfiles))
    throw new Error(`${safePath(recoveryFile)} has no originalProfiles array`)

  console.log('Recovering profiles and room from an interrupted marketing capture…')
  if (typeof recovery.roomId === 'string') await removeRoom(recovery.roomId, sessions)
  for (let index = recovery.originalProfiles.length - 1; index >= 0; index--)
    await restoreProfile(sessions[index], recovery.originalProfiles[index])
  unlinkSync(recoveryFile)
  console.log('Interrupted capture recovered.')
}

async function joinedRooms(session) {
  const joined = await clientRequest(session, 'GET', '/joined_rooms')
  return Array.isArray(joined.joined_rooms) ? joined.joined_rooms : []
}

async function invitedRooms(session) {
  const filter = {
    presence: { types: [] },
    account_data: { types: [] },
    room: {
      account_data: { types: [] },
      ephemeral: { types: [] },
      state: { types: [] },
      timeline: { types: [], limit: 0 },
    },
  }
  const sync = await clientRequest(
    session,
    'GET',
    `/sync?timeout=0&filter=${encodeURIComponent(JSON.stringify(filter))}`,
  )
  return Object.keys(sync.rooms?.invite ?? {})
}

async function cleanupNonAdminRooms(session, protectedRoomIds = []) {
  const protectedRooms = new Set(protectedRoomIds)
  let declined = 0
  for (const roomId of await invitedRooms(session)) {
    const encodedRoomId = encodeURIComponent(roomId)
    await clientRequest(
      session,
      'POST',
      `/rooms/${encodedRoomId}/leave`,
      {},
      {
        allowedStatuses: [400, 403, 404],
      },
    )
    await clientRequest(
      session,
      'POST',
      `/rooms/${encodedRoomId}/forget`,
      {},
      {
        allowedStatuses: [400, 403, 404],
      },
    )
    declined++
  }

  let left = 0
  let preserved = 0
  for (const roomId of await joinedRooms(session)) {
    if (protectedRooms.has(roomId)) {
      preserved++
      continue
    }
    const encodedRoomId = encodeURIComponent(roomId)
    const name = await clientRequest(
      session,
      'GET',
      `/rooms/${encodedRoomId}/state/m.room.name`,
      undefined,
      { allowedStatuses: [403, 404] },
    )
    if (typeof name.name === 'string' && name.name.includes('Admin Room')) {
      preserved++
      continue
    }
    await clientRequest(
      session,
      'POST',
      `/rooms/${encodedRoomId}/leave`,
      {},
      {
        allowedStatuses: [400, 403, 404],
      },
    )
    await clientRequest(
      session,
      'POST',
      `/rooms/${encodedRoomId}/forget`,
      {},
      {
        allowedStatuses: [400, 403, 404],
      },
    )
    left++
  }
  return { declined, left, preserved }
}

async function auditRoomCleanup(session) {
  let nonAdminRooms = 0
  let adminRooms = 0
  for (const roomId of await joinedRooms(session)) {
    const name = await clientRequest(
      session,
      'GET',
      `/rooms/${encodeURIComponent(roomId)}/state/m.room.name`,
      undefined,
      { allowedStatuses: [403, 404] },
    )
    if (typeof name.name === 'string' && name.name.includes('Admin Room')) adminRooms++
    else nonAdminRooms++
  }
  return {
    adminRooms,
    nonAdminRooms,
    pendingInvites: (await invitedRooms(session)).length,
  }
}

async function inferOriginalProfile(session, persona) {
  const candidates = new Map()
  const addCandidate = (membership) => {
    if (
      !membership ||
      membership.membership === undefined ||
      membership.displayname === persona.displayName
    )
      return
    const profile = {
      displayname: typeof membership.displayname === 'string' ? membership.displayname : '',
      avatar_url: typeof membership.avatar_url === 'string' ? membership.avatar_url : '',
    }
    const key = JSON.stringify(profile)
    const current = candidates.get(key)
    candidates.set(key, { profile, count: (current?.count ?? 0) + 1 })
  }
  for (const roomId of await joinedRooms(session)) {
    const membership = await clientRequest(
      session,
      'GET',
      `/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(
        session.userId,
      )}`,
      undefined,
      { allowedStatuses: [403, 404] },
    )
    addCandidate(membership)
  }

  if (!candidates.size) {
    const filter = {
      presence: { types: [] },
      account_data: { types: [] },
      room: {
        account_data: { types: [] },
        ephemeral: { types: [] },
        state: { types: ['m.room.member'] },
        timeline: { types: ['m.room.member'], limit: 20 },
      },
    }
    const sync = await clientRequest(
      session,
      'GET',
      `/sync?timeout=0&full_state=true&filter=${encodeURIComponent(JSON.stringify(filter))}`,
    )
    for (const section of ['join', 'leave', 'invite']) {
      for (const room of Object.values(sync.rooms?.[section] ?? {})) {
        const events = [...(room.state?.events ?? []), ...(room.timeline?.events ?? [])]
        for (const event of events)
          if (event.type === 'm.room.member' && event.state_key === session.userId)
            addCandidate(event.content)
      }
    }
  }
  return [...candidates.values()].sort((first, second) => second.count - first.count)[0]
}

async function legacyMarketingRooms(session) {
  const matches = []
  for (const roomId of await joinedRooms(session)) {
    const encodedRoomId = encodeURIComponent(roomId)
    const [name, topic] = await Promise.all([
      clientRequest(session, 'GET', `/rooms/${encodedRoomId}/state/m.room.name`, undefined, {
        allowedStatuses: [403, 404],
      }),
      clientRequest(session, 'GET', `/rooms/${encodedRoomId}/state/m.room.topic`, undefined, {
        allowedStatuses: [403, 404],
      }),
    ])
    if (name.name === roomName && topic.topic === roomTopic) matches.push(roomId)
  }
  return matches
}

async function recoverLegacyInterruptedRun(accounts) {
  const sessions = []
  try {
    for (const account of accounts) sessions.push(await rawLogin(account))
    for (let index = 0; index < sessions.length; index++) {
      const current = await readProfile(sessions[index])
      if (current.displayname !== personas[index].displayName) {
        console.log(`Account ${accounts[index].slot}: no temporary marketing name to recover.`)
        continue
      }
      const candidate = await inferOriginalProfile(sessions[index], personas[index])
      if (!candidate)
        throw new Error(
          `Could not infer account ${accounts[index].slot}'s original profile from its joined rooms`,
        )
      await restoreProfile(sessions[index], candidate.profile)
      console.log(
        `Account ${accounts[index].slot}: restored the profile found in ${candidate.count} room membership(s).`,
      )
    }
    const rooms = await legacyMarketingRooms(sessions[0])
    for (const roomId of rooms) await removeRoom(roomId, sessions)
    console.log(`Removed ${rooms.length} interrupted “${roomName}” room(s).`)
  } finally {
    for (const session of sessions) await logoutSession(session)
  }
}

async function serverIsReady(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
    return response.ok
  } catch {
    return false
  }
}

async function startWebServer() {
  if (await serverIsReady(baseURL)) {
    console.log(`Using the existing FoxChat server at ${baseURL}`)
    return undefined
  }
  if (enabled('E2E_SKIP_WEBSERVER'))
    throw new Error(`E2E_SKIP_WEBSERVER=true, but ${baseURL} is not reachable`)

  const url = new URL(baseURL)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error(
      `Cannot automatically start the dev server for ${baseURL}; start it yourself and set E2E_SKIP_WEBSERVER=true`,
    )
  const vite = resolve(root, 'node_modules/vite/bin/vite.js')
  if (!existsSync(vite)) throw new Error('Vite is not installed; run npm install first')
  const output = []
  const server = spawn(
    process.execPath,
    [vite, '--host', url.hostname, '--port', url.port || '4173'],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  const remember = (chunk) => {
    output.push(...String(chunk).split(/\r?\n/).filter(Boolean))
    if (output.length > 20) output.splice(0, output.length - 20)
  }
  server.stdout.on('data', remember)
  server.stderr.on('data', remember)

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`Vite exited with ${server.exitCode}:\n${output.join('\n')}`)
    if (await serverIsReady(baseURL)) {
      console.log(`Started FoxChat at ${baseURL}`)
      return server
    }
    await sleep(500)
  }
  server.kill()
  throw new Error(`Timed out starting FoxChat at ${baseURL}:\n${output.join('\n')}`)
}

async function signIn(page, account) {
  await page.goto('/')
  await page.getByTestId('login-page').waitFor({ state: 'visible' })
  await page.getByLabel('Homeserver').fill(account.homeserver)
  await page.getByLabel('Matrix ID or username').fill(account.userId)
  const password = page.getByLabel('Password')
  const button = page.getByRole('button', { name: 'Sign in' })

  for (let attempt = 0; attempt < 3; attempt++) {
    await password.fill(account.password)
    const loginResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/login'),
      { timeout: 90_000 },
    )
    await button.click()
    const response = await loginResponse
    if (response.ok()) break
    const failure = await response.json().catch(() => ({}))
    if (response.status() === 429 && attempt < 2 && Number(failure.retry_after_ms) <= 120_000) {
      await sleep(Number(failure.retry_after_ms) + 250)
      continue
    }
    throw new Error(
      `Browser login failed for ${account.userId}: ${response.status} ${JSON.stringify(failure)}`,
    )
  }
  if ((page.viewportSize()?.width ?? 1_000) <= 760)
    await page.getByRole('button', { name: 'Open room list' }).waitFor({
      state: 'visible',
      timeout: 90_000,
    })
  else
    await page.getByTestId('room-sidebar').first().waitFor({
      state: 'visible',
      timeout: 90_000,
    })
}

async function openRoom(page, roomId) {
  if ((page.viewportSize()?.width ?? 1_000) <= 760)
    await page.getByRole('button', { name: 'Open room list' }).click()
  const room = page.locator(
    `[data-testid="room-row"][data-room-id="${roomId.replaceAll('"', '\\"')}"]`,
  )
  await room.waitFor({ state: 'visible', timeout: 90_000 })
  await room.click()
  await page
    .getByTestId('room-header')
    .getByRole('heading', { name: roomName })
    .waitFor({ state: 'visible', timeout: 60_000 })
}

async function humanPause(page, milliseconds) {
  if (delayScale) await page.waitForTimeout(Math.round(milliseconds * delayScale))
}

async function sendText(page, text) {
  const composer = page.getByTestId('message-composer')
  await composer.waitFor({ state: 'visible' })
  await composer.click()
  await composer.pressSequentially(text, {
    delay: Math.max(0, Math.round(16 * delayScale)),
  })
  await humanPause(page, 450)
  const sent = page.waitForResponse(
    (response) =>
      response.ok() &&
      response.request().method() === 'PUT' &&
      /\/send\/m\.room\.(?:message|encrypted)\//.test(new URL(response.url()).pathname),
    { timeout: 90_000 },
  )
  await page.getByRole('button', { name: 'Send message' }).click()
  const result = await (await sent).json()
  if (typeof result.event_id !== 'string') throw new Error('Message send returned no event_id')
  return result.event_id
}

async function sendImage(page) {
  await page.locator('input[type="file"]').setInputFiles(sharedImage)
  await page.getByRole('button', { name: 'Remove image' }).waitFor({
    state: 'visible',
    timeout: 30_000,
  })
  await humanPause(page, 700)
  const sent = page.waitForResponse(
    (response) => {
      if (
        !response.ok() ||
        response.request().method() !== 'PUT' ||
        !new URL(response.url()).pathname.includes('/send/m.room.message/')
      )
        return false
      const content = response.request().postDataJSON()
      return content?.msgtype === 'm.image'
    },
    { timeout: 90_000 },
  )
  await page.getByRole('button', { name: 'Send message' }).click()
  await sent
  await page.getByTestId('message-image').last().waitFor({
    state: 'visible',
    timeout: 60_000,
  })
}

async function react(session, roomId, eventId, reaction) {
  const transactionId = `marketing-${Date.now()}-${Math.random().toString(16).slice(2)}`
  await clientRequest(
    session,
    'PUT',
    `/rooms/${encodeURIComponent(roomId)}/send/m.reaction/${transactionId}`,
    {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: eventId,
        key: reaction,
      },
    },
  )
}

async function browserSession(page) {
  return page.evaluate(() => {
    try {
      const sessions = JSON.parse(localStorage.getItem('foxchat.matrix.accounts') ?? '[]')
      return sessions.at(-1)
    } catch {
      return undefined
    }
  })
}

async function enableDarkMode(page) {
  await page
    .getByTestId('account-menu')
    .getByRole('button', { name: 'Open settings', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByRole('tab', { name: 'Appearance' }).click()
  const toggle = dialog.getByRole('tabpanel', { name: 'Appearance' }).getByRole('switch').first()
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click()
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await toggle.getAttribute('aria-checked')) === 'true') break
    await page.waitForTimeout(100)
  }
  if ((await toggle.getAttribute('aria-checked')) !== 'true')
    throw new Error('The Appearance dark-mode switch did not turn on')
  await dialog.locator('.ant-modal-close').click()
  await dialog.waitFor({ state: 'hidden' })
}

async function captureScreenshots(pages) {
  for (const page of pages) {
    await page.getByTestId('timeline').evaluate((timeline) => {
      timeline.scrollTop = timeline.scrollHeight
    })
    await page
      .getByTestId('timeline')
      .getByText('Deal. Shipping the tiny details today 🚀', { exact: true })
      .last()
      .waitFor({
        state: 'visible',
        timeout: 60_000,
      })
  }
  await humanPause(pages[0], 1_200)

  const desktop = resolve(outputDirectory, '01-desktop-conversation.png')
  const media = resolve(outputDirectory, '02-shared-media.png')
  const mobile = resolve(outputDirectory, '03-mobile-conversation.png')
  const dark = resolve(outputDirectory, '04-dark-conversation.png')
  await pages[0].screenshot({ path: desktop, caret: 'hide' })

  const image = pages[1].getByTestId('message-image').locator('img').last()
  await image.waitFor({ state: 'visible', timeout: 60_000 })
  await image.click()
  await pages[1]
    .getByRole('dialog', { name: 'Image viewer' })
    .waitFor({ state: 'visible', timeout: 30_000 })
  await pages[1].screenshot({ path: media, caret: 'hide' })
  await pages[1].getByRole('button', { name: 'Close image' }).click()

  const mobilePage = pages.at(-1)
  if ((mobilePage.viewportSize()?.width ?? 1_000) > 760) {
    await mobilePage.setViewportSize({ width: 430, height: 900 })
    await mobilePage.waitForTimeout(500)
    await mobilePage.getByTestId('timeline').evaluate((timeline) => {
      timeline.scrollTop = timeline.scrollHeight
    })
  }
  await mobilePage.screenshot({ path: mobile, caret: 'hide' })

  await enableDarkMode(pages[0])
  await pages[0].getByTestId('timeline').evaluate((timeline) => {
    timeline.scrollTop = timeline.scrollHeight
  })
  await pages[0].screenshot({ path: dark, caret: 'hide' })
  return [desktop, media, mobile, dark]
}

async function main() {
  const accounts = accountsFromEnvironment()
  validate(accounts)
  console.log(
    `Marketing capture: ${personas
      .slice(0, accounts.length)
      .map((persona) => persona.displayName)
      .join(', ')} in “${roomName}”`,
  )
  console.log(`Assets: ${safePath(resolve(root, 'tests/assets/marketing'))}`)
  if (dryRun) {
    console.log('Dry run passed: no Matrix accounts, rooms, profiles, or browsers were changed.')
    return
  }
  if (audit) {
    const sessions = []
    try {
      for (let index = 0; index < accounts.length; index++) {
        const session = await rawLogin(accounts[index])
        sessions.push(session)
        const profile = await readProfile(session)
        const roomAudit = await auditRoomCleanup(session)
        console.log(
          `Account ${accounts[index].slot}: temporary marketing name active = ${
            profile.displayname === personas[index].displayName
          }; non-Admin rooms = ${roomAudit.nonAdminRooms}; pending invites = ${
            roomAudit.pendingInvites
          }; Admin Rooms = ${roomAudit.adminRooms}`,
        )
      }
    } finally {
      for (const session of sessions) await logoutSession(session)
    }
    return
  }
  if (recoverLegacyRun) {
    await recoverLegacyInterruptedRun(accounts)
    return
  }

  mkdirSync(outputDirectory, { recursive: true })
  let server
  let browser
  let roomId
  let journeyError
  let recoveryCleanupFailed = false
  const rawSessions = []
  const originalProfiles = []
  const contexts = []
  const pages = []
  const browserSessions = []

  try {
    server = await startWebServer()
    console.log(`Signing in setup sessions and applying ${accounts.length} temporary profiles…`)
    for (let index = 0; index < accounts.length; index++) {
      const session = await rawLogin(accounts[index])
      rawSessions.push(session)
    }
    await recoverInterruptedRun(rawSessions)
    for (const session of rawSessions) originalProfiles.push(await readProfile(session))
    saveRecoveryState(rawSessions, originalProfiles)
    for (let index = 0; index < accounts.length; index++) {
      await prepareProfile(rawSessions[index], personas[index])
    }

    roomId = await createRoom(rawSessions)
    saveRecoveryState(rawSessions, originalProfiles, roomId)
    console.log(`Created “${roomName}” and joined ${accounts.length} clients.`)
    browser = await chromium.launch({ headless: !headed })
    for (let index = 0; index < accounts.length; index++) {
      const context = await browser.newContext({
        baseURL,
        viewport: personas[index].viewport,
        colorScheme: 'light',
        reducedMotion: 'reduce',
        locale: 'en-US',
      })
      contexts.push(context)
      const page = await context.newPage()
      pages.push(page)
      await signIn(page, accounts[index])
      await openRoom(page, roomId)
      const stored = await browserSession(page)
      if (stored) browserSessions.push(stored)
      console.log(`Browser client ready: ${personas[index].displayName}`)
    }

    await sendText(pages[0], 'Okay, I finally put the launch plan in one place ✨')
    await humanPause(pages[1], 550)
    await sendText(pages[1], 'Perfect timing — I just finished the onboarding pass.')
    const thirdClient = pages[2] ?? pages[0]
    const thirdSession = rawSessions[2] ?? rawSessions[0]
    await humanPause(thirdClient, 650)
    await sendText(thirdClient, 'The new room switcher feels really quick now.')
    await humanPause(pages[0], 500)
    await sendText(pages[0], 'Here’s the direction I was thinking for launch week:')
    await sendImage(pages[0])
    await humanPause(pages[1], 750)
    const designMessage = await sendText(
      pages[1],
      'Love this direction. The colors feel warm without getting noisy.',
    )
    await humanPause(thirdClient, 500)
    await sendText(thirdClient, 'I can take the final screenshots before lunch 👍')
    await react(thirdSession, roomId, designMessage, '❤️')
    await humanPause(pages[0], 650)
    await sendText(
      pages.length > 2 ? pages[0] : pages[1],
      'Deal. Shipping the tiny details today 🚀',
    )

    const screenshots = await captureScreenshots(pages)
    const manifest = {
      createdAt: new Date().toISOString(),
      room: { name: roomName, topic: roomTopic },
      personas: accounts.map((account, index) => ({
        accountSlot: accounts[index].slot,
        displayName: personas[index].displayName,
      })),
      screenshots: screenshots.map(safePath),
      cleanup: {
        roomKept: keepRoom,
        profilesKept: keepProfiles,
      },
    }
    writeFileSync(
      resolve(outputDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    console.log(`Captured ${screenshots.length} screenshots in ${safePath(outputDirectory)}`)
    for (const screenshot of screenshots) console.log(`  - ${safePath(screenshot)}`)
  } catch (error) {
    journeyError = error
    if (pages[0] && !pages[0].isClosed())
      await pages[0]
        .screenshot({
          path: resolve(outputDirectory, 'failure.png'),
          fullPage: true,
          caret: 'hide',
        })
        .catch(() => undefined)
  } finally {
    const cleanupErrors = []
    for (const session of browserSessions)
      await logoutSession(session).catch((error) => cleanupErrors.push(error))
    for (const context of contexts)
      await context.close().catch((error) => cleanupErrors.push(error))
    await browser?.close().catch((error) => cleanupErrors.push(error))

    if (roomId && !keepRoom)
      await removeRoom(roomId, rawSessions).catch((error) => {
        recoveryCleanupFailed = true
        cleanupErrors.push(error)
      })
    if (!keepProfiles)
      for (let index = originalProfiles.length - 1; index >= 0; index--)
        await restoreProfile(rawSessions[index], originalProfiles[index]).catch((error) => {
          recoveryCleanupFailed = true
          cleanupErrors.push(error)
        })
    for (let index = 0; index < rawSessions.length; index++)
      await cleanupNonAdminRooms(rawSessions[index], keepRoom && roomId ? [roomId] : [])
        .then(({ declined, left, preserved }) => {
          console.log(
            `Cleanup account ${accounts[index].slot}: left ${left}, declined ${declined}, preserved ${preserved}.`,
          )
        })
        .catch((error) => {
          cleanupErrors.push(error)
        })
    for (const session of rawSessions)
      await logoutSession(session).catch((error) => cleanupErrors.push(error))
    if (!recoveryCleanupFailed && existsSync(recoveryFile)) unlinkSync(recoveryFile)
    server?.kill()

    for (const error of cleanupErrors)
      console.warn(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`)
    if (!journeyError && cleanupErrors.length) journeyError = cleanupErrors[0]
  }
  if (journeyError) throw journeyError
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
