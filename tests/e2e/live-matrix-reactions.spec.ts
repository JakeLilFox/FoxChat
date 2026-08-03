import { expect, test, type Page } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import { cleanTestRoom, removeOtherDevices, storedSessions } from './support/matrix-api'
import { openRoomActions, sendMessage, signIn } from './support/ui'

const live = liveMatrixConfig()

test.describe('live message reactions journey', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled, live.reason)

  test('reacts via the message context menu and via its custom reaction window', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(4 * 60_000)
    const account1 = live.account1!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Reactions ${runId}`
    const message = `react to me ${runId}`
    const customReactionText = `e2e-custom-${runId}`

    let context
    let page: Page | undefined
    let roomId: string | undefined
    let account1Id: string | undefined
    let journeyError: unknown

    try {
      context = await browser.newContext({ baseURL })
      page = await context.newPage()

      await test.step('sign in', async () => {
        await signIn(page!, account1)
        account1Id = (await storedSessions(page!)).at(-1)?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)
      })

      await test.step('create a room to react in', async () => {
        await openRoomActions(page!)
        await page!.getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(roomName)
        await dialog.getByRole('button', { name: 'Create room' }).click()
        await expect(
          page!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)
      })

      await test.step('send a message to react to', async () => {
        await sendMessage(page!, message)
      })

      await test.step('react via the right-click context menu', async () => {
        const event = page!.locator('[data-event-id^="$"]').filter({ hasText: message }).last()
        await event.click({ button: 'right' })
        const reactMenuItem = page!.getByRole('menuitem', { name: 'React' })
        await expect(reactMenuItem).toBeVisible()
        await reactMenuItem.hover()
        await reactMenuItem.press('ArrowRight')
        const quickEmoji = page!.getByRole('menuitem', { name: '🎉', exact: true })
        await expect(quickEmoji).toBeVisible({ timeout: 10_000 })
        await quickEmoji.click()
        await expect(event.getByRole('button', { name: /🎉\s*1/ })).toBeVisible({
          timeout: 30_000,
        })
      })

      await test.step("react with custom text via the context menu's custom reaction window", async () => {
        const event = page!.locator('[data-event-id^="$"]').filter({ hasText: message }).last()
        await event.click({ button: 'right' })
        const reactMenuItem = page!.getByRole('menuitem', { name: 'React' })
        await expect(reactMenuItem).toBeVisible()
        await reactMenuItem.hover()
        await reactMenuItem.press('ArrowRight')
        const customReactionMenuItem = page!.getByRole('menuitem', { name: 'Custom reaction…' })
        await expect(customReactionMenuItem).toBeVisible({ timeout: 10_000 })
        await customReactionMenuItem.click()

        const modal = page!.getByRole('dialog', { name: 'React with custom emoji' })
        await expect(modal).toBeVisible()
        const customInput = modal.getByLabel('Custom reaction')
        await customInput.fill(customReactionText)
        await modal.getByRole('button', { name: 'Add', exact: true }).click()
        await expect(modal).toBeHidden()

        await expect(
          event.getByRole('button', { name: new RegExp(`${customReactionText}\\s*1`) }),
        ).toBeVisible({ timeout: 30_000 })
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        const sessions = page && !page.isClosed() ? await storedSessions(page).catch(() => []) : []
        if (roomId) await cleanTestRoom(roomId, sessions)
        if (account1Id) {
          const current = sessions.filter((session) => session.userId === account1Id).at(-1)
          if (current) await removeOtherDevices(browser, current, account1.password)
        }
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
