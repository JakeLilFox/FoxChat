import { expect, test, type Page } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import {
  cleanTestRoom,
  joinRoomAs,
  rawLogin,
  removeOtherDevices,
  sendFillerMessages,
  setRoomState,
  storedSessions,
  type StoredSession,
} from './support/matrix-api'
import { retryMutatingRequest } from './support/retry'
import { openRoomActions, signIn } from './support/ui'

const live = liveMatrixConfig()

const FILLER_MESSAGE_COUNT = 50

const jumpToPinnedButton = (page: Page) => page.locator('button[title="Jump to pinned message"]')

const jumpToLatestButton = (page: Page) =>
  page.getByRole('button', { name: 'Jump to latest messages' })

test.describe('live timeline jump-to-pinned-message journey', () => {
  test.skip(!live.enabled, live.reason)

  test('jumping to an old pinned message loads it and stays there instead of snapping back to the live bottom', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Jump To Pinned Message ${runId}`
    const targetLabel = `Pinned target message ${runId}`

    let context
    let remoteContext
    let page: Page | undefined
    let remotePage: Page | undefined
    let roomId: string | undefined
    let account1Session: StoredSession | undefined
    let account2RawSession: StoredSession | undefined
    let account2Session: StoredSession | undefined
    let targetEventId: string | undefined
    let journeyError: unknown

    try {
      context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
      })
      remoteContext = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
      })
      page = await context.newPage()
      remotePage = await remoteContext.newPage()

      await test.step("sign in account 1; get account 2 a session via the raw API only, so its tab isn't syncing yet", async () => {
        await signIn(page!, account1)
        account1Session = (await storedSessions(page!)).at(-1)
        expect(account1Session?.userId).toMatch(/^@[^:]+:.+/)
        account2RawSession = await rawLogin(account2)
        expect(account2RawSession.userId).toMatch(/^@[^:]+:.+/)
      })

      await test.step('create the room and invite account 2 (joins via raw API, never auto-visited)', async () => {
        await openRoomActions(page!)
        await page!.getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Room name').fill(roomName)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom (jump-to-pinned-message)' },
        )
        await expect(
          page!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)

        const detailsTitle = page!.getByText('Channel details', { exact: true })
        if (!(await detailsTitle.isVisible()))
          await page!.getByRole('button', { name: 'Room information' }).click()
        await expect(detailsTitle).toBeVisible()
        await page!.getByText('Invite', { exact: true }).last().click()
        const inviteDialog = page!.getByRole('dialog', { name: 'Invite to room' })
        await inviteDialog.getByLabel('Matrix user ID').fill(account2RawSession!.userId)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/invite'),
          () => inviteDialog.getByRole('button', { name: 'Send invitation' }).click(),
          { label: 'Matrix invite (jump-to-pinned-message)' },
        )
        await joinRoomAs(account2RawSession!, roomId!)
      })

      await test.step('seed and pin an old target message, then bury it under 50 filler messages', async () => {
        const [eventId] = await sendFillerMessages(account1Session!, roomId!, 1, targetLabel)
        targetEventId = eventId
        await setRoomState(account1Session!, roomId!, 'm.room.pinned_events', '', {
          pinned: [targetEventId],
        })
        await sendFillerMessages(account1Session!, roomId!, FILLER_MESSAGE_COUNT, 'Backlog filler')
      })

      await test.step('account 2 signs in and opens the room for the first time: at the live bottom, the pinned target is not loaded locally', async () => {
        await signIn(remotePage!, account2)
        account2Session = (await storedSessions(remotePage!)).at(-1)
        expect(account2Session?.userId).toMatch(/^@[^:]+:.+/)
        await remotePage!.getByTestId('room-row').filter({ hasText: roomName }).click()
        await expect(
          remotePage!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        await expect(
          remotePage!
            .locator('[data-event-id^="$"]')
            .filter({ hasText: `Backlog filler ${FILLER_MESSAGE_COUNT}` }),
        ).toBeVisible({ timeout: 30_000 })
        await expect(remotePage!.locator(`[data-event-id="${targetEventId}"]`)).toHaveCount(0)
      })

      await test.step('clicking the pinned bar jumps to and loads the old target message', async () => {
        const pinnedButton = jumpToPinnedButton(remotePage!)
        await expect(pinnedButton).toBeVisible({ timeout: 30_000 })
        await pinnedButton.click()
        await expect(remotePage!.locator(`[data-event-id="${targetEventId}"]`)).toBeVisible({
          timeout: 30_000,
        })
        await expect(remotePage!.locator(`[data-event-id="${targetEventId}"]`)).toContainText(
          targetLabel,
        )
      })

      await test.step('the jumped-to message stays put instead of the view snapping back to the live bottom', async () => {
        const target = remotePage!.locator(`[data-event-id="${targetEventId}"]`)
        for (const waitMs of [500, 1000, 1500, 2000]) {
          await remotePage!.waitForTimeout(waitMs)
          await expect(target).toBeVisible()
        }
        await expect(jumpToLatestButton(remotePage!)).toBeVisible()
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        const sessions: StoredSession[] = []
        if (page && !page.isClosed()) sessions.push(...(await storedSessions(page).catch(() => [])))
        if (remotePage && !remotePage.isClosed())
          sessions.push(...(await storedSessions(remotePage).catch(() => [])))
        if (roomId) await cleanTestRoom(roomId, sessions)
        for (const [account, session] of [
          [account1, account1Session],
          [account2, account2Session],
        ] as const) {
          if (session) await removeOtherDevices(browser, session, account.password)
        }
      } catch (error) {
        cleanupError = error
      } finally {
        await context?.close()
        await remoteContext?.close()
      }
      if (!journeyError && cleanupError) journeyError = cleanupError
    }
    if (journeyError) throw journeyError
  })
})
