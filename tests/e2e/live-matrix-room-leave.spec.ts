import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import { cleanTestRoom, storedSessions, type StoredSession } from './support/matrix-api'
import { retryMutatingRequest } from './support/retry'
import { openRoomActions, signIn } from './support/ui'

const live = liveMatrixConfig()

test.describe('live room membership journey', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled, live.reason)

  test('leaving a channel removes it from the left drawer', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(3 * 60_000)
    const account = live.account1!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Leave ${runId}`

    let context: BrowserContext | undefined
    let page: Page | undefined
    let roomId: string | undefined
    let sessions: StoredSession[] = []
    let journeyError: unknown

    try {
      context = await browser.newContext({
        baseURL,
        viewport: { width: 1440, height: 900 },
      })
      page = await context.newPage()

      await test.step('sign in and create a channel', async () => {
        await signIn(page!, account)
        sessions = await storedSessions(page!)
        const accountId = sessions.at(-1)?.userId
        expect(accountId).toMatch(/^@[^:]+:.+/)

        await openRoomActions(page!)
        await page!.getByRole('menu').getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(accountId!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(roomName)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom for leave test' },
        )

        await expect(
          page!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)
      })

      await test.step('leave the channel and remove it from the drawer', async () => {
        const roomRow = page!.getByTestId('room-row').filter({ hasText: roomName })
        await expect(roomRow).toBeVisible()
        await roomRow.click({ button: 'right' })
        const leaveItem = page!.getByRole('menuitem', { name: 'Leave room' })
        await expect(leaveItem).toBeVisible()
        await leaveItem.dispatchEvent('click')

        const confirmation = page!.getByRole('dialog', { name: `Leave ${roomName}?` })
        await expect(confirmation).toBeVisible()
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith(`/rooms/${encodeURIComponent(roomId!)}/leave`),
          () => confirmation.getByRole('button', { name: 'Leave room' }).click(),
          { label: 'Matrix leave room' },
        )

        await expect(confirmation).toBeHidden({ timeout: 30_000 })
        await expect(roomRow).toHaveCount(0, { timeout: 60_000 })
        await expect(page!.getByRole('heading', { name: 'Select a room' })).toBeVisible({
          timeout: 30_000,
        })
        expect(new URL(page!.url()).searchParams.get('room')).toBeNull()
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        if (page && !page.isClosed()) sessions = await storedSessions(page).catch(() => sessions)
        await cleanTestRoom(roomId, sessions)
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
