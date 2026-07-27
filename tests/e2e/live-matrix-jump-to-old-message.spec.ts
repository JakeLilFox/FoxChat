import { expect, test, type Page } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import {
  cleanTestRoom,
  joinRoomAs,
  rawLogin,
  removeOtherDevices,
  sendFillerMessages,
  sendReadReceipt,
  sendReplyMessage,
  storedSessions,
  type StoredSession,
} from './support/matrix-api'
import { retryMutatingRequest } from './support/retry'
import { openRoomActions, scrollBottomDistance, signIn } from './support/ui'

const live = liveMatrixConfig()

const NEAR_BOTTOM = 60

const FILLER_MESSAGE_COUNT = 60

const roomRow = (page: Page, name: string) => page.getByTestId('room-row').filter({ hasText: name })

const openRoom = async (page: Page, name: string) => {
  await roomRow(page, name).click()
  await expect(page.getByTestId('room-header').getByRole('heading', { name })).toBeVisible({
    timeout: 60_000,
  })
}

const jumpToLatestButton = (page: Page) =>
  page.getByRole('button', { name: 'Jump to latest messages' })

const scrollDown = async (page: Page) => {
  await page.getByTestId('timeline').hover()
  await page.mouse.wheel(0, 900)
}

test.describe('live timeline jump-to-old-message journey', () => {
  test.skip(!live.enabled, live.reason)

  test("jumping to a reply's old target loads it, and scrolling down afterward reaches the live edge again", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Jump To Old Message ${runId}`
    const targetLabel = 'Original old message'
    const replyLabel = `Reply pointing at the old message ${runId}`
    const liveMarkerLabel = `Live message sent after the jump ${runId}`

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
          { label: 'Matrix createRoom (jump-to-old-message)' },
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
          { label: 'Matrix invite (jump-to-old-message)' },
        )
        await joinRoomAs(account2RawSession!, roomId!)
      })

      await test.step('seed an old target message, bury it under filler, then reply to it as the newest event', async () => {
        const [eventId] = await sendFillerMessages(account1Session!, roomId!, 1, targetLabel)
        targetEventId = eventId
        await sendFillerMessages(account1Session!, roomId!, FILLER_MESSAGE_COUNT, 'Backlog filler')
        const replyEventId = await sendReplyMessage(
          account1Session!,
          roomId!,
          replyLabel,
          targetEventId!,
        )
        await sendReadReceipt(account2RawSession!, roomId!, replyEventId)
      })

      await test.step('account 2 signs in and opens the room for the first time: the reply is visible, its old target is not loaded locally', async () => {
        await signIn(remotePage!, account2)
        account2Session = (await storedSessions(remotePage!)).at(-1)
        expect(account2Session?.userId).toMatch(/^@[^:]+:.+/)
        await openRoom(remotePage!, roomName)
        await expect(
          remotePage!.locator('[data-event-id^="$"]').filter({ hasText: replyLabel }),
        ).toBeVisible({ timeout: 30_000 })
        await expect(remotePage!.locator(`[data-event-id="${targetEventId}"]`)).toHaveCount(0)
      })

      await test.step("clicking the reply's quote preview jumps to and loads the old target message", async () => {
        const replyQuote = remotePage!.locator('button[title="Jump to replied message"]')
        await expect(replyQuote).toBeVisible({ timeout: 30_000 })
        await replyQuote.click()
        await expect(remotePage!.locator(`[data-event-id="${targetEventId}"]`)).toBeVisible({
          timeout: 30_000,
        })
        await expect(remotePage!.locator(`[data-event-id="${targetEventId}"]`)).toContainText(
          targetLabel,
        )
      })

      await test.step('a message sent while account 2 is viewing the old jump target arrives once account 2 catches back up', async () => {
        await sendFillerMessages(account1Session!, roomId!, 1, liveMarkerLabel)
      })

      await test.step('scrolling down from the old target reaches the live edge again, without using the jump-to-latest button', async () => {
        const marker = remotePage!
          .locator('[data-event-id^="$"]')
          .filter({ hasText: `${liveMarkerLabel} 1` })
          .last()
        await expect
          .poll(
            async () => {
              await scrollDown(remotePage!)
              if (!(await marker.isVisible().catch(() => false))) return false
              return (await scrollBottomDistance(remotePage!)) <= NEAR_BOTTOM
            },
            { timeout: 30_000, intervals: [500] },
          )
          .toBe(true)
        await expect(marker).toBeVisible()
        await expect(jumpToLatestButton(remotePage!)).toBeHidden()
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
