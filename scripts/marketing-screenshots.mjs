#!/usr/bin/env node

import { chromium } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, relative, resolve, sep } from 'node:path'
import { config as loadEnv } from 'dotenv'
import ffmpegPath from 'ffmpeg-static'

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
const spaceBanner = resolve(root, 'tests/assets/marketing/space-banner.jpg')
const workspacePhoto = resolve(root, 'tests/assets/marketing/workspace-coffee.jpg')
const cityPhoto = resolve(root, 'tests/assets/marketing/city-night.jpg')
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
  for (const asset of [
    ...personas.map((persona) => persona.avatar),
    sharedImage,
    spaceBanner,
    workspacePhoto,
    cityPhoto,
  ])
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
    account,
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
  if (response.status === 401 && session.account && !options.retriedAuthentication) {
    const replacement = await rawLogin(session.account)
    session.baseUrl = replacement.baseUrl
    session.accessToken = replacement.accessToken
    session.deviceId = replacement.deviceId
    session.userId = replacement.userId
    return matrixRequest(session, method, path, body, {
      ...options,
      retriedAuthentication: true,
    })
  }
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
  const contentType =
    extname(file).toLowerCase() === '.svg'
      ? 'image/svg+xml'
      : extname(file).toLowerCase() === '.png'
        ? 'image/png'
        : 'image/jpeg'
  const upload = await matrixRequest(
    session,
    'POST',
    `media/v3/upload?filename=${encodeURIComponent(basename(file))}`,
    body,
    { contentType },
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

async function createSharedRoom(sessions, name, topic, extra = {}) {
  const created = await clientRequest(sessions[0], 'POST', '/createRoom', {
    visibility: 'private',
    preset: 'private_chat',
    is_direct: false,
    name,
    topic,
    invite: sessions.slice(1).map((session) => session.userId),
    ...extra,
  })
  if (typeof created.room_id !== 'string') throw new Error(`createRoom returned no ID for ${name}`)
  for (const session of sessions.slice(1))
    await clientRequest(session, 'POST', `/rooms/${encodeURIComponent(created.room_id)}/join`, {})
  return created.room_id
}

async function sendState(session, roomId, type, stateKey, content) {
  return clientRequest(
    session,
    'PUT',
    `/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(type)}/${encodeURIComponent(
      stateKey,
    )}`,
    content,
  )
}

async function sendRawMessage(session, roomId, content) {
  const transactionId = `marketing-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const sent = await clientRequest(
    session,
    'PUT',
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${transactionId}`,
    content,
  )
  if (typeof sent.event_id !== 'string') throw new Error('Raw message send returned no event_id')
  return sent.event_id
}

const sendRawText = (session, roomId, body) =>
  sendRawMessage(session, roomId, { msgtype: 'm.text', body })

async function sendRawImage(session, roomId, file, contentUri, caption) {
  const bytes = readFileSync(file)
  return sendRawMessage(session, roomId, {
    msgtype: 'm.image',
    body: basename(file),
    url: contentUri,
    info: {
      mimetype: extname(file).toLowerCase() === '.svg' ? 'image/svg+xml' : 'image/jpeg',
      size: bytes.byteLength,
    },
    ...(caption ? { 'foxchat.caption': caption } : {}),
  })
}

async function createMarketingScene(sessions, launchRoomId) {
  const [bannerMxc, workspaceMxc, cityMxc, moodboardMxc] = await Promise.all([
    uploadMedia(sessions[0], spaceBanner),
    uploadMedia(sessions[0], workspacePhoto),
    uploadMedia(sessions[0], cityPhoto),
    uploadMedia(sessions[0], sharedImage),
  ])
  const weekendRoomId = await createSharedRoom(
    sessions,
    'Weekend escape',
    'Trail ideas, train times, and the best coffee on the way.',
  )
  const spaceId = await createSharedRoom(
    sessions,
    'Studio North',
    'A home for product craft, launch stories, and the people making them.',
    { creation_content: { type: 'm.space' } },
  )
  const designRoomId = await createSharedRoom(
    sessions,
    'Design lab',
    'Fresh explorations, thoughtful critique, and tiny delightful details.',
  )
  const photosRoomId = await createSharedRoom(
    sessions,
    'Photo drops',
    'Inspiration from desks, streets, and everywhere in between.',
  )
  const via = sessions[0].userId.split(':').slice(1).join(':')
  for (const [childId, order] of [
    [designRoomId, 'a'],
    [photosRoomId, 'b'],
  ])
    await Promise.all([
      sendState(sessions[0], spaceId, 'm.space.child', childId, {
        via: [via],
        suggested: true,
        order,
      }),
      sendState(sessions[0], childId, 'm.space.parent', spaceId, {
        via: [via],
        canonical: true,
      }),
    ])
  await sendState(sessions[0], spaceId, 'page.codeberg.everypizza.room.banner', '', {
    url: bannerMxc,
    name: basename(spaceBanner),
    info: { mimetype: 'image/jpeg', size: readFileSync(spaceBanner).byteLength },
  })
  await Promise.all([
    sendState(sessions[0], launchRoomId, 'm.room.avatar', '', {
      url: moodboardMxc,
      info: { mimetype: 'image/svg+xml', size: readFileSync(sharedImage).byteLength },
    }),
    sendState(sessions[0], weekendRoomId, 'm.room.avatar', '', {
      url: bannerMxc,
      info: { mimetype: 'image/jpeg', size: readFileSync(spaceBanner).byteLength },
    }),
    sendState(sessions[0], spaceId, 'm.room.avatar', '', {
      url: bannerMxc,
      info: { mimetype: 'image/jpeg', size: readFileSync(spaceBanner).byteLength },
    }),
    sendState(sessions[0], designRoomId, 'm.room.avatar', '', {
      url: workspaceMxc,
      info: { mimetype: 'image/jpeg', size: readFileSync(workspacePhoto).byteLength },
    }),
    sendState(sessions[0], photosRoomId, 'm.room.avatar', '', {
      url: cityMxc,
      info: { mimetype: 'image/jpeg', size: readFileSync(cityPhoto).byteLength },
    }),
  ])

  await sendRawText(sessions[0], weekendRoomId, 'What if we take the early train on Saturday?')
  await sendRawText(
    sessions[1],
    weekendRoomId,
    'Yes — window seats and coffee are non-negotiable ☕',
  )
  await sendRawImage(
    sessions[0],
    weekendRoomId,
    cityPhoto,
    cityMxc,
    'A little night-walk inspiration for the itinerary.',
  )
  await sendRawText(sessions[1], weekendRoomId, 'Adding this exact mood to the plan.')

  await sendRawText(sessions[0], designRoomId, 'The calmer navigation is starting to click.')
  await sendRawText(sessions[1], designRoomId, 'Especially once every project has a proper home.')
  await sendRawImage(
    sessions[0],
    designRoomId,
    workspacePhoto,
    workspaceMxc,
    'Today’s tiny studio setup.',
  )
  await sendRawText(sessions[1], designRoomId, 'Strong coffee, strong release candidate.')

  await sendRawImage(
    sessions[1],
    photosRoomId,
    cityPhoto,
    cityMxc,
    'Saving this palette for the next dark theme pass.',
  )
  await sendRawText(sessions[0], photosRoomId, 'Those reflections are perfect.')

  return {
    launchRoomId,
    weekendRoomId,
    spaceId,
    designRoomId,
    photosRoomId,
    moodboardMxc,
  }
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
      if (candidate) {
        await restoreProfile(sessions[index], candidate.profile)
        console.log(
          `Account ${accounts[index].slot}: restored the profile found in ${candidate.count} room membership(s).`,
        )
      } else {
        const localpart = sessions[index].userId.replace(/^@/, '').split(':')[0]
        await restoreProfile(sessions[index], {
          displayname: localpart,
          avatar_url: '',
        })
        console.log(
          `Account ${accounts[index].slot}: no membership profile remained; reset to its Matrix localpart without an avatar.`,
        )
      }
    }
    const rooms = await legacyMarketingRooms(sessions[0])
    for (const roomId of rooms) await removeRoom(roomId, sessions)
    console.log(`Removed ${rooms.length} interrupted “${roomName}” room(s).`)
    for (let index = 0; index < sessions.length; index++) {
      const cleanup = await cleanupNonAdminRooms(sessions[index])
      console.log(
        `Cleanup account ${accounts[index].slot}: left ${cleanup.left}, declined ${cleanup.declined}, preserved ${cleanup.preserved}.`,
      )
    }
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

async function openNamedRoom(page, name) {
  const mobile = (page.viewportSize()?.width ?? 1_000) <= 760
  if (mobile) await page.getByRole('button', { name: 'Open room list' }).click()
  else {
    const back = page.getByRole('button', { name: 'arrow-left' })
    if (await back.isVisible()) await back.click()
  }
  const row = page.getByTestId('room-row').filter({ hasText: name })
  await row.waitFor({ state: 'visible', timeout: 60_000 })
  await row.click()
  const heading = page.getByRole('heading', { name, exact: true }).last()
  const openedDirectly = await heading
    .waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => true)
    .catch(() => false)
  if (!openedDirectly) {
    const browseChannels = page
      .getByTestId('room-sidebar')
      .getByText('Browse channels', { exact: true })
      .first()
    if (await browseChannels.isVisible()) await browseChannels.click()
  }
  await heading.waitFor({ state: 'visible', timeout: 60_000 })
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
  const mobile = (page.viewportSize()?.width ?? 1_000) <= 760
  if (mobile) {
    await page.getByRole('button', { name: 'Open room list' }).click()
    await page.getByTestId('room-sidebar').waitFor({ state: 'visible' })
  }
  const sidebar = page.locator('[data-testid="room-sidebar"]:visible').first()
  const enable = sidebar.locator('button[aria-label="Enable dark mode"]')
  if (await enable.isVisible()) await enable.click()
  await sidebar.locator('button[aria-label="Enable light mode"]').waitFor({
    state: 'visible',
    timeout: 10_000,
  })
  if (mobile) {
    const drawer = sidebar.locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ant-drawer ")][1]',
    )
    await drawer.locator('.ant-drawer-mask').dispatchEvent('click')
    await drawer.waitFor({ state: 'hidden' })
  }
}

async function settleVisuals(page) {
  await page
    .waitForFunction(
      () =>
        [...document.images]
          .filter((image) => {
            const rect = image.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          })
          .every((image) => image.complete && image.naturalWidth > 0),
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => undefined)
  await page.waitForTimeout(1_500)
}

async function capturePng(page, path) {
  await settleVisuals(page)
  await page.screenshot({ path, caret: 'hide' })
}

function encodeFramesToGif(frameDirectory, output, { framerate = 3 } = {}) {
  if (!ffmpegPath) throw new Error('ffmpeg-static did not provide an executable')
  const encoded = spawnSync(
    ffmpegPath,
    [
      '-y',
      '-framerate',
      String(framerate),
      '-i',
      resolve(frameDirectory, 'frame-%03d.png'),
      '-vf',
      'scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=192[p];[s1][p]paletteuse=dither=bayer',
      '-loop',
      '0',
      output,
    ],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  )
  if (encoded.status !== 0)
    throw new Error(`Could not encode GIF ${safePath(output)}: ${encoded.stderr || encoded.stdout}`)
}

async function createTourGif(page, roomNames, output, label) {
  const frameDirectory = resolve(outputDirectory, `.frames-${label}`)
  const expectedPrefix = `${resolve(outputDirectory)}${sep}`
  if (!resolve(frameDirectory).startsWith(expectedPrefix))
    throw new Error(`Refusing to use unexpected frame directory: ${frameDirectory}`)
  mkdirSync(frameDirectory, { recursive: true })
  let frame = 0
  try {
    for (const name of roomNames) {
      await openNamedRoom(page, name)
      await settleVisuals(page)
      for (let hold = 0; hold < 4; hold++) {
        const filename = `frame-${String(frame++).padStart(3, '0')}.png`
        await page.screenshot({ path: resolve(frameDirectory, filename), caret: 'hide' })
      }
    }
    encodeFramesToGif(frameDirectory, output)
  } finally {
    rmSync(frameDirectory, { recursive: true, force: true })
  }
}

async function compositeDiagonalSplit(topLeftImage, bottomRightImage, output) {
  if (!ffmpegPath) throw new Error('ffmpeg-static did not provide an executable')
  // scale2ref matches the overlay image to the base image's size in case the two captures
  // (e.g. a mobile viewport vs. a resized one) don't come out pixel-identical; the blend
  // expression then keeps input A wherever X/W + Y/H < 1, i.e. the triangle around the
  // top-left corner bounded by the line from (W,0) to (0,H), and input B elsewhere.
  const result = spawnSync(
    ffmpegPath,
    [
      '-y',
      '-i',
      topLeftImage,
      '-i',
      bottomRightImage,
      '-filter_complex',
      "[1:v][0:v]scale2ref[ovl][base];[base][ovl]blend=all_expr='if(lt(X/W+Y/H,1),A,B)'",
      '-frames:v',
      '1',
      output,
    ],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  )
  if (result.status !== 0)
    throw new Error(
      `Could not composite diagonal split ${safePath(output)}: ${result.stderr || result.stdout}`,
    )
}

function writeToneWav(path, frequencyHz, durationSeconds = 60) {
  const sampleRate = 48_000
  const amplitude = 0.6
  const tremoloHz = 4
  const sampleCount = Math.floor(durationSeconds * sampleRate)
  const dataSize = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate
    const tremolo = 1 - 0.18 * (0.5 + 0.5 * Math.sin(2 * Math.PI * tremoloHz * t))
    const sample = amplitude * tremolo * Math.sin(2 * Math.PI * frequencyHz * t)
    const clamped = Math.max(-1, Math.min(1, sample))
    buffer.writeInt16LE(Math.round(clamped * 32_767), 44 + i * 2)
  }
  writeFileSync(path, buffer)
}

async function launchFakeAudioBrowser(fakeAudioWavPath) {
  return chromium.launch({
    headless: !headed,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${fakeAudioWavPath}`,
    ],
  })
}

async function setMicrophone(page, unmuted) {
  const button = page.getByRole('button', {
    name: unmuted ? 'Unmute microphone' : 'Mute microphone',
  })
  if (await button.isVisible().catch(() => false)) await button.click()
}

async function captureVoiceCallGif(accounts, rawSessions) {
  const output = resolve(outputDirectory, '16-voice-call.gif')
  const tone1Path = resolve(outputDirectory, '.voice-tone-1.wav')
  const tone2Path = resolve(outputDirectory, '.voice-tone-2.wav')
  const frameDirectory = resolve(outputDirectory, '.frames-voice-call')
  writeToneWav(tone1Path, 220)
  writeToneWav(tone2Path, 300)

  await createSharedRoom(
    rawSessions.slice(0, 2),
    'Voice hangout',
    'Hop on when you have a minute.',
    {
      creation_content: { type: 'org.matrix.msc3417.call', 'm.federate': true },
      room_type: 'org.matrix.msc3417.call',
      power_level_content_override: {
        events: {
          'org.matrix.msc3401.call.member': 0,
          'm.call.member': 0,
          'org.matrix.msc4143.rtc.member': 0,
          'm.rtc.member': 0,
        },
      },
    },
  )

  let browser1
  let browser2
  try {
    browser1 = await launchFakeAudioBrowser(tone1Path)
    browser2 = await launchFakeAudioBrowser(tone2Path)
    const context1 = await browser1.newContext({
      baseURL,
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce',
      locale: 'en-US',
    })
    const context2 = await browser2.newContext({
      baseURL,
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce',
      locale: 'en-US',
    })
    const page1 = await context1.newPage()
    const page2 = await context2.newPage()
    await signIn(page1, accounts[0])
    await signIn(page2, accounts[1])
    await openNamedRoom(page1, 'Voice hangout')
    await openNamedRoom(page2, 'Voice hangout')
    await page1.getByTitle('Join voice channel').click()
    await page2.getByTitle('Join voice channel').click()
    for (const page of [page1, page2])
      await page
        .frameLocator('iframe[title$="call engine"]')
        .locator('[data-testid="incall_leave"]')
        .waitFor({ state: 'visible', timeout: 90_000 })
    await settleVisuals(page1)

    mkdirSync(frameDirectory, { recursive: true })
    let frame = 0
    // Alternates who appears to be talking so the loop reads as a natural back-and-forth
    // rather than two people talking over each other the whole time.
    const cycles = [
      [true, false],
      [false, true],
      [true, false],
      [false, true],
    ]
    for (const [speaker1, speaker2] of cycles) {
      await setMicrophone(page1, speaker1)
      await setMicrophone(page2, speaker2)
      await page1.waitForTimeout(900)
      for (let hold = 0; hold < 3; hold++) {
        await page1.screenshot({
          path: resolve(frameDirectory, `frame-${String(frame++).padStart(3, '0')}.png`),
          caret: 'hide',
        })
        await page1.waitForTimeout(250)
      }
    }
    encodeFramesToGif(frameDirectory, output)
  } finally {
    rmSync(frameDirectory, { recursive: true, force: true })
    rmSync(tone1Path, { force: true })
    rmSync(tone2Path, { force: true })
    await browser1?.close().catch(() => undefined)
    await browser2?.close().catch(() => undefined)
  }
  return output
}

async function openSpaceChannel(page, spaceName, channelName) {
  await openNamedRoom(page, spaceName)
  const channel = page.getByTestId('room-sidebar').getByText(channelName, { exact: true }).first()
  await channel.waitFor({ state: 'visible', timeout: 60_000 })
  await channel.click()
  await page
    .getByTestId('room-header')
    .getByRole('heading', { name: channelName, exact: true })
    .waitFor({ state: 'visible', timeout: 60_000 })
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
  const darkMobile = resolve(outputDirectory, '05-dark-mobile-conversation.png')
  const spaceLight = resolve(outputDirectory, '06-space-overview-light.png')
  const spaceChatLight = resolve(outputDirectory, '07-space-chat-light.png')
  const spaceDark = resolve(outputDirectory, '08-space-overview-dark.png')
  const spaceChatDark = resolve(outputDirectory, '09-space-chat-dark.png')
  const tourLight = resolve(outputDirectory, '10-chat-tour-light.gif')
  const tourDark = resolve(outputDirectory, '11-chat-tour-dark.gif')
  await capturePng(pages[0], desktop)

  const image = pages[1].getByTestId('message-image').locator('img').last()
  await image.waitFor({ state: 'visible', timeout: 60_000 })
  await image.click()
  await pages[1]
    .getByRole('dialog', { name: 'Image viewer' })
    .waitFor({ state: 'visible', timeout: 30_000 })
  await capturePng(pages[1], media)
  await pages[1].getByRole('button', { name: 'Close image' }).click()

  const mobilePage = pages.at(-1)
  if ((mobilePage.viewportSize()?.width ?? 1_000) > 760) {
    await mobilePage.setViewportSize({ width: 430, height: 900 })
    await mobilePage.waitForTimeout(500)
    await mobilePage.getByTestId('timeline').evaluate((timeline) => {
      timeline.scrollTop = timeline.scrollHeight
    })
  }
  await capturePng(mobilePage, mobile)

  await openNamedRoom(pages[0], 'Studio North')
  await capturePng(pages[0], spaceLight)
  await openSpaceChannel(pages[0], 'Studio North', 'Design lab')
  await pages[0].getByTestId('message-image').locator('img').last().waitFor({
    state: 'visible',
    timeout: 60_000,
  })
  await capturePng(pages[0], spaceChatLight)
  await createTourGif(
    pages[0],
    ['Launch crew', 'Weekend escape', 'Launch crew'],
    tourLight,
    'light',
  )

  await enableDarkMode(pages[0])
  await openNamedRoom(pages[0], 'Launch crew')
  await pages[0].getByTestId('timeline').evaluate((timeline) => {
    timeline.scrollTop = timeline.scrollHeight
  })
  await capturePng(pages[0], dark)

  await openNamedRoom(pages[0], 'Studio North')
  await capturePng(pages[0], spaceDark)
  await openSpaceChannel(pages[0], 'Studio North', 'Photo drops')
  await pages[0].getByTestId('message-image').locator('img').last().waitFor({
    state: 'visible',
    timeout: 60_000,
  })
  await capturePng(pages[0], spaceChatDark)
  await createTourGif(pages[0], ['Launch crew', 'Weekend escape', 'Launch crew'], tourDark, 'dark')

  await enableDarkMode(mobilePage)
  await openNamedRoom(mobilePage, 'Launch crew')
  await mobilePage.getByTestId('timeline').evaluate((timeline) => {
    timeline.scrollTop = timeline.scrollHeight
  })
  await capturePng(mobilePage, darkMobile)

  // Diagonal dark/light showcase images: each pairs a light and dark capture of the same
  // view, split by the diagonal from the top-right corner to the bottom-left corner so the
  // triangle around the top-left corner shows one theme and the triangle around the
  // bottom-right corner shows the other. Which theme lands top-left alternates from one
  // composite to the next so the set doesn't read as one-sided.
  const diagonalConversation = resolve(outputDirectory, '12-diagonal-conversation.png')
  const diagonalMobile = resolve(outputDirectory, '13-diagonal-mobile.png')
  const diagonalSpace = resolve(outputDirectory, '14-diagonal-space.png')
  const diagonalSpaceChat = resolve(outputDirectory, '15-diagonal-space-chat.png')
  await compositeDiagonalSplit(dark, desktop, diagonalConversation)
  await compositeDiagonalSplit(mobile, darkMobile, diagonalMobile)
  await compositeDiagonalSplit(spaceDark, spaceLight, diagonalSpace)
  await compositeDiagonalSplit(spaceChatLight, spaceChatDark, diagonalSpaceChat)

  return [
    desktop,
    media,
    mobile,
    dark,
    darkMobile,
    spaceLight,
    spaceChatLight,
    spaceDark,
    spaceChatDark,
    tourLight,
    tourDark,
    diagonalConversation,
    diagonalMobile,
    diagonalSpace,
    diagonalSpaceChat,
  ]
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
  let scene
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
    scene = await createMarketingScene(rawSessions, roomId)
    console.log(
      `Created the launch room, Studio North Space, two channels, and Weekend escape for ${accounts.length} clients.`,
    )
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
    const thirdSession = rawSessions[2] ?? rawSessions[0]
    await sendRawText(thirdSession, roomId, 'The new room switcher feels really quick now.')
    await sendRawText(
      rawSessions[0],
      roomId,
      'Here’s the direction I was thinking for launch week:',
    )
    await sendRawImage(
      rawSessions[0],
      roomId,
      sharedImage,
      scene.moodboardMxc,
      'Launch week direction',
    )
    const designMessage = await sendRawText(
      rawSessions[1],
      roomId,
      'Love this direction. The colors feel warm without getting noisy.',
    )
    await sendRawText(thirdSession, roomId, 'I can take the final screenshots before lunch 👍')
    await react(thirdSession, roomId, designMessage, '❤️')
    await sendRawText(
      pages.length > 2 ? rawSessions[0] : rawSessions[1],
      roomId,
      'Deal. Shipping the tiny details today 🚀',
    )

    const screenshots = await captureScreenshots(pages)
    const voiceCallGif = await captureVoiceCallGif(accounts, rawSessions).catch((error) => {
      console.warn(
        `Voice call GIF capture failed, continuing without it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return undefined
    })
    if (voiceCallGif) screenshots.push(voiceCallGif)
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
