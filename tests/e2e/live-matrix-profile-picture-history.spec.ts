import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { liveMatrixConfig } from './support/env'
import {
  cleanTestRoom,
  removeOtherDevices,
  storedSessions,
  type StoredSession,
} from './support/matrix-api'
import { retryMutatingRequest } from './support/retry'
import { openRoomActions, openRoomRow, sendMessage, signIn } from './support/ui'

const live = liveMatrixConfig()
const PROFILE_PICTURE_PATH = resolve(process.cwd(), 'public/favicon.png')
const MESSAGE_COUNT = 20

const profileAvatarUrl = async (session: StoredSession) => {
  const response = await fetch(
    `${session.baseUrl}/_matrix/client/v3/profile/${encodeURIComponent(session.userId)}/avatar_url`,
    { headers: { Authorization: `Bearer ${session.accessToken}` } },
  )
  if (response.status === 404) return ''
  if (!response.ok)
    throw new Error(
      `Could not read the original profile picture: ${response.status} ${await response.text()}`,
    )
  return ((await response.json()) as { avatar_url?: string }).avatar_url ?? ''
}

const setProfileAvatarUrl = async (session: StoredSession, avatarUrl: string) => {
  const response = await fetch(
    `${session.baseUrl}/_matrix/client/v3/profile/${encodeURIComponent(session.userId)}/avatar_url`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ avatar_url: avatarUrl }),
    },
  )
  if (!response.ok)
    throw new Error(
      `Could not update the profile picture: ${response.status} ${await response.text()}`,
    )
}

const uploadProfilePicture = async (session: StoredSession) => {
  const file = await readFile(PROFILE_PICTURE_PATH)
  const body = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
  const response = await fetch(
    `${session.baseUrl}/_matrix/media/v3/upload?filename=${encodeURIComponent('foxchat-e2e-profile.png')}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'image/png',
      },
      body,
    },
  )
  if (!response.ok)
    throw new Error(
      `Could not upload the profile picture fixture: ${response.status} ${await response.text()}`,
    )
  const contentUri = ((await response.json()) as { content_uri?: string }).content_uri
  expect(contentUri).toMatch(/^mxc:\/\//)
  return contentUri!
}

test.describe('live profile picture history regression', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled, live.reason)

  test('keeps existing room messages after changing the profile picture and reloading', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    const account1 = live.account1!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Profile history ${runId}`
    const messageLabel = `Profile history message ${runId}`

    let context
    let page: Page | undefined
    let roomId: string | undefined
    let account1Id: string | undefined
    let account1Session: StoredSession | undefined
    let originalAvatarUrl: string | undefined
    let profilePictureChanged = false
    let journeyError: unknown

    const historyEvents = () =>
      page!.getByTestId('timeline').locator('[data-event-id]').filter({ hasText: messageLabel })

    try {
      context = await browser.newContext({
        baseURL,
        viewport: { width: 1440, height: 900 },
      })
      page = await context.newPage()

      await test.step('sign in and remember the current profile picture', async () => {
        await signIn(page!, account1)
        account1Session = (await storedSessions(page!)).at(-1)
        account1Id = account1Session?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)
        originalAvatarUrl = await profileAvatarUrl(account1Session!)
      })

      await test.step('create a room and send a batch of messages', async () => {
        await openRoomActions(page!)
        await page!.getByRole('menu').getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(roomName)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom (profile-picture-history)' },
        )
        await expect(
          page!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)

        for (let index = 1; index <= MESSAGE_COUNT; index++)
          await sendMessage(page!, `${messageLabel} ${index}`)
        await expect(historyEvents()).toHaveCount(MESSAGE_COUNT, { timeout: 60_000 })
      })

      await test.step('upload and apply a new account profile picture', async () => {
        account1Session = (await storedSessions(page!)).at(-1) ?? account1Session
        const contentUri = await uploadProfilePicture(account1Session!)
        await setProfileAvatarUrl(account1Session!, contentUri)
        profilePictureChanged = true
      })

      await test.step('receive the profile membership event without losing history', async () => {
        const timeline = page!.getByTestId('timeline')
        await expect(timeline.getByText(/updated their profile picture$/)).toBeVisible({
          timeout: 60_000,
        })
        await expect(historyEvents()).toHaveCount(MESSAGE_COUNT)
      })

      await test.step('reload the room and keep every message visible', async () => {
        await page!.reload()
        await expect(page!.getByTestId('room-sidebar').first()).toBeVisible({ timeout: 90_000 })
        await openRoomRow(page!, roomName)
        await expect(
          page!.getByTestId('timeline').getByText(/updated their profile picture$/),
        ).toBeVisible({ timeout: 60_000 })
        await expect(historyEvents()).toHaveCount(MESSAGE_COUNT, { timeout: 60_000 })
        await expect(
          page!.getByTestId('timeline').getByText(`${messageLabel} 1`, { exact: true }),
        ).toBeVisible()
        await expect(
          page!
            .getByTestId('timeline')
            .getByText(`${messageLabel} ${MESSAGE_COUNT}`, { exact: true }),
        ).toBeVisible()
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        const sessions = page && !page.isClosed() ? await storedSessions(page).catch(() => []) : []
        const currentSession = account1Id
          ? (sessions.filter((session) => session.userId === account1Id).at(-1) ?? account1Session)
          : account1Session
        if (profilePictureChanged && currentSession && originalAvatarUrl !== undefined)
          await setProfileAvatarUrl(currentSession, originalAvatarUrl)
        if (roomId) await cleanTestRoom(roomId, sessions)
        if (currentSession) await removeOtherDevices(browser, currentSession, account1.password)
      } catch (error) {
        cleanupError = error
      } finally {
        await context?.close()
      }
      if (!journeyError && cleanupError) journeyError = cleanupError
    }
    if (journeyError) throw journeyError
  })
})
