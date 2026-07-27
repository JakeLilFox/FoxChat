import { expect, test, type Page } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import {
  cleanTestRoom,
  removeOtherDevices,
  sendFillerMessages,
  sendReplyMessage,
  storedSessions,
  type StoredSession,
} from './support/matrix-api'
import { retryMutatingRequest } from './support/retry'
import { openRoomActions, signIn } from './support/ui'

const live = liveMatrixConfig()

test.describe('live reply-chain preview journey', () => {
  test.skip(!live.enabled, live.reason)

  test("a reply's preview shows its direct parent's text, not the grandparent's", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(4 * 60_000)
    const account1 = live.account1!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Reply Chain ${runId}`
    const rootMessage = `Root message ${runId}`
    const middleMessage = `Middle reply message ${runId}`
    const leafMessage = `Leaf message replying to the middle one ${runId}`

    let context
    let page: Page | undefined
    let roomId: string | undefined
    let account1Session: StoredSession | undefined
    let journeyError: unknown

    try {
      context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
      })
      page = await context.newPage()

      await test.step('sign in and create the room', async () => {
        await signIn(page!, account1)
        account1Session = (await storedSessions(page!)).at(-1)
        expect(account1Session?.userId).toMatch(/^@[^:]+:.+/)

        await openRoomActions(page!)
        await page!.getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Room name').fill(roomName)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom (reply-chain)' },
        )
        await expect(
          page!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)
      })

      await test.step('seed a 3-message reply chain via the raw API', async () => {
        const [rootEventId] = await sendFillerMessages(account1Session!, roomId!, 1, rootMessage)
        const middleEventId = await sendReplyMessage(
          account1Session!,
          roomId!,
          `> <${account1.userId}> ${rootMessage} 1\n\n${middleMessage}`,
          rootEventId!,
        )
        await sendReplyMessage(account1Session!, roomId!, leafMessage, middleEventId)
      })

      await test.step("the leaf message's reply preview shows the middle message, not the root", async () => {
        const leafEvent = page!
          .locator('[data-event-id^="$"]')
          .filter({ hasText: leafMessage })
          .last()
        await expect(leafEvent).toBeVisible({ timeout: 30_000 })
        const replyQuote = leafEvent.locator('button[title="Jump to replied message"]')
        await expect(replyQuote).toBeVisible({ timeout: 30_000 })
        await expect(replyQuote).toContainText(middleMessage)
        await expect(replyQuote).not.toContainText(rootMessage)
        await expect(replyQuote).not.toContainText('>')
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        const sessions: StoredSession[] = []
        if (page && !page.isClosed()) sessions.push(...(await storedSessions(page).catch(() => [])))
        if (roomId) await cleanTestRoom(roomId, sessions)
        if (account1Session) await removeOtherDevices(browser, account1Session, account1.password)
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
