import { expect, test, type Page } from '@playwright/test'
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

const editMessage = async (page: Page, eventId: string, currentBody: string, nextBody: string) => {
  const event = page.locator(`[data-event-id="${eventId}"]`)
  await expect(event).toContainText(currentBody, { timeout: 30_000 })
  await event.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit' }).click()

  const composer = page.getByTestId('message-composer')
  await expect(composer).toHaveText(currentBody)
  await expect(page.getByText('Editing message', { exact: true })).toBeVisible()
  await composer.fill(nextBody)
  await sendMessage(page, nextBody)

  await expect(event).toContainText(nextBody, { timeout: 30_000 })
  await expect(event).not.toContainText(currentBody)
  await expect(event.getByText('(edited)', { exact: true })).toBeVisible()
}

test.describe('live repeated-message-editing journey', () => {
  test.skip(!live.enabled, live.reason)

  test('editing the same message repeatedly preserves every replacement and survives reload', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(4 * 60_000)
    const account = live.account1!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Repeated Editing ${runId}`
    const bodies = [
      `Original edit regression ${runId}`,
      `First replacement ${runId}`,
      `Second replacement with more content ${runId}`,
      `Third and final replacement ${runId}`,
    ]

    let context
    let page: Page | undefined
    let roomId: string | undefined
    let session: StoredSession | undefined
    let journeyError: unknown

    try {
      context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
      })
      page = await context.newPage()

      await test.step('sign in and create a regression room', async () => {
        await signIn(page!, account)
        session = (await storedSessions(page!)).at(-1)
        expect(session?.userId).toMatch(/^@[^:]+:.+/)

        await openRoomActions(page!)
        await page!.getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Room name').fill(roomName)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom (repeated-message-editing)' },
        )
        await expect(
          page!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)
      })

      const eventId = await test.step('send the original message', () =>
        sendMessage(page!, bodies[0]))

      await test.step('edit the original event three consecutive times', async () => {
        for (let index = 1; index < bodies.length; index++)
          await editMessage(page!, eventId, bodies[index - 1], bodies[index])
      })

      await test.step('reload and retain only the final non-empty message body', async () => {
        await page!.reload()
        await expect(page!.getByTestId('room-sidebar').first()).toBeVisible({
          timeout: 90_000,
        })
        await openRoomRow(page!, roomName)
        const event = page!.locator(`[data-event-id="${eventId}"]`)
        await expect(event).toContainText(bodies.at(-1)!, { timeout: 60_000 })
        for (const staleBody of bodies.slice(0, -1))
          await expect(event).not.toContainText(staleBody)
        await expect(event.getByText('(edited)', { exact: true })).toBeVisible()
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        const sessions: StoredSession[] = []
        if (page && !page.isClosed()) sessions.push(...(await storedSessions(page).catch(() => [])))
        if (roomId) await cleanTestRoom(roomId, sessions)
        if (session) await removeOtherDevices(browser, session, account.password)
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
