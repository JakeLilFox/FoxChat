import { expect, test, type Page } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import {
  cleanTestRoom,
  inviteToRoom,
  joinRoomAs,
  removeOtherDevices,
  sendFillerMessages,
  sendReadReceipt,
  storedSessions,
  type StoredSession,
} from './support/matrix-api'
import { pace, retryMutatingRequest } from './support/retry'
import {
  addAccount,
  openRoomActions,
  scrollBottomDistance,
  sendMessage,
  setAutoReadAllAccounts,
  signIn,
} from './support/ui'

const live = liveMatrixConfig()

const NEAR_BOTTOM = 60
const AWAY_FROM_BOTTOM = 150
const FILLER_MESSAGE_COUNT = 30

const EXTRA_BATCH_COUNT = 20
const MULTI_ACCOUNT_BACKLOG_COUNT = 80

const roomRow = (page: Page, name: string) => page.getByTestId('room-row').filter({ hasText: name })

const openRoom = async (page: Page, name: string) => {
  await roomRow(page, name).click()
  await expect(page.getByTestId('room-header').getByRole('heading', { name })).toBeVisible({
    timeout: 60_000,
  })
}

const unreadDivider = (page: Page) =>
  page.getByTestId('timeline').getByText('Unread messages', { exact: true })

const jumpToLatestButton = (page: Page) =>
  page.getByRole('button', { name: 'Jump to latest messages' })

const sendingAsButton = (page: Page) =>
  page.getByRole('button', { name: /Sending as|Change sending account/ })

const selectSendingAs = async (page: Page, userId: string) => {
  const button = sendingAsButton(page)
  const current = await button.getAttribute('aria-label')
  if (current?.includes(userId)) return
  await button.click()
  const account = page.getByRole('menuitem', { name: userId })
  await expect(account).toBeVisible()

  await account.dispatchEvent('click')
  await expect(button).toHaveAttribute(
    'aria-label',
    new RegExp(userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  )
}

const expectAtBottom = (page: Page) =>
  expect
    .poll(() => scrollBottomDistance(page), { timeout: 15_000 })
    .toBeLessThanOrEqual(NEAR_BOTTOM)

const expectAwayFromBottom = (page: Page) =>
  expect
    .poll(() => scrollBottomDistance(page), { timeout: 15_000 })
    .toBeGreaterThan(AWAY_FROM_BOTTOM)

test.describe('live timeline scroll-position journey', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled, live.reason)

  test('scrolls to unread on open, to the bottom when caught up, follows new messages at the bottom, and shows the jump-to-latest button otherwise - fresh and cached', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(8 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomAName = `${live.roomPrefix} Scroll Unread ${runId}`
    const roomBName = `${live.roomPrefix} Scroll Bottom ${runId}`

    let context
    let remoteContext
    let page: Page | undefined
    let remotePage: Page | undefined
    let roomAId: string | undefined
    let roomBId: string | undefined
    let account1Id: string | undefined
    let account2Id: string | undefined
    let account1Session: StoredSession | undefined
    let account2Session: StoredSession | undefined
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

      await test.step('sign in both accounts', async () => {
        await signIn(page!, account1)
        account1Session = (await storedSessions(page!)).at(-1)
        account1Id = account1Session?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)
        await signIn(remotePage!, account2)
        account2Session = (await storedSessions(remotePage!)).at(-1)
        account2Id = account2Session?.userId
        expect(account2Id).toMatch(/^@[^:]+:.+/)
      })

      const createRoom = async (name: string) => {
        await openRoomActions(page!)
        await page!.getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(name)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: `Matrix createRoom (${name})` },
        )
        await expect(page!.getByTestId('room-header').getByRole('heading', { name })).toBeVisible({
          timeout: 60_000,
        })
        const id = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(id).toMatch(/^!/)
        return id!
      }

      const invite = async (name: string) => {
        const detailsTitle = page!.getByText('Channel details', {
          exact: true,
        })
        if (!(await detailsTitle.isVisible()))
          await page!.getByRole('button', { name: 'Room information' }).click()
        await expect(detailsTitle).toBeVisible()
        await page!.getByText('Invite', { exact: true }).last().click()
        const dialog = page!.getByRole('dialog', { name: 'Invite to room' })
        await dialog.getByLabel('Matrix user ID').fill(account2Id!)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/invite'),
          () => dialog.getByRole('button', { name: 'Send invitation' }).click(),
          { label: `Matrix invite (${name})` },
        )
      }

      await test.step('create both rooms and invite account 2 (joins via raw API, never auto-visited)', async () => {
        roomAId = await createRoom(roomAName)
        await invite(roomAName)
        await pace(page!)
        roomBId = await createRoom(roomBName)
        await invite(roomBName)
        await joinRoomAs(account2Session!, roomAId)
        await joinRoomAs(account2Session!, roomBId)
      })

      await test.step('seed room A with unread history and room B with fully-read history', async () => {
        await sendFillerMessages(account1Session!, roomAId!, FILLER_MESSAGE_COUNT, 'Unread filler')
        const roomBEventIds = await sendFillerMessages(
          account1Session!,
          roomBId!,
          FILLER_MESSAGE_COUNT,
          'Bottom filler',
        )
        await sendReadReceipt(account2Session!, roomBId!, roomBEventIds.at(-1)!)
      })

      await test.step('room A: fresh open scrolls to unread, shows jump-to-latest', async () => {
        await openRoom(remotePage!, roomAName)
        await expect(unreadDivider(remotePage!)).toBeVisible({
          timeout: 30_000,
        })
        await expectAwayFromBottom(remotePage!)
        await expect(jumpToLatestButton(remotePage!)).toBeVisible()
      })

      await test.step('room A: jump-to-latest scrolls to the bottom', async () => {
        await jumpToLatestButton(remotePage!).click()
        await expectAtBottom(remotePage!)
        await expect(jumpToLatestButton(remotePage!)).toBeHidden()
      })

      await test.step('room B: fresh open with nothing unread lands at the bottom', async () => {
        await openRoom(remotePage!, roomBName)
        await expect(unreadDivider(remotePage!)).toBeHidden()
        await expectAtBottom(remotePage!)
        await expect(jumpToLatestButton(remotePage!)).toBeHidden()
      })

      const expectFollowsWhileAtBottom = async () => {
        await openRoom(page!, roomBName)
        const marker = `Bottom-follow live ${Date.now()}`
        await sendMessage(page!, marker)
        await expect(
          remotePage!.locator('[data-event-id^="$"]').filter({ hasText: marker }).last(),
        ).toBeVisible({ timeout: 30_000 })
        await expectAtBottom(remotePage!)
        await expect(jumpToLatestButton(remotePage!)).toBeHidden()
      }

      const expectButtonWhenScrolledUp = async () => {
        await remotePage!.getByTestId('timeline').hover()
        await remotePage!.mouse.wheel(0, -10_000)
        await expectAwayFromBottom(remotePage!)
        await openRoom(page!, roomBName)
        const marker = `Scrolled-up live ${Date.now()}`
        await sendMessage(page!, marker)
        await expect(jumpToLatestButton(remotePage!)).toBeVisible({
          timeout: 30_000,
        })
        await expectAwayFromBottom(remotePage!)
        await jumpToLatestButton(remotePage!).click()
        await expectAtBottom(remotePage!)
        await expect(
          remotePage!.locator('[data-event-id^="$"]').filter({ hasText: marker }).last(),
        ).toBeVisible()
      }

      await test.step('room B: a new message while at the bottom follows it down (fresh)', async () => {
        await expectFollowsWhileAtBottom()
      })

      await test.step('room B: a new message while scrolled up does not jump, and the button works (fresh)', async () => {
        await expectButtonWhenScrolledUp()
      })

      await test.step('room A: cached re-open after a new batch shows unread again', async () => {
        await openRoom(remotePage!, roomBName)
        await sendFillerMessages(
          account1Session!,
          roomAId!,
          EXTRA_BATCH_COUNT,
          'Cached unread batch',
        )
        await remotePage!.waitForTimeout(2_000)
        await openRoom(remotePage!, roomAName)
        await expect(unreadDivider(remotePage!)).toBeVisible({
          timeout: 30_000,
        })
        await expectAwayFromBottom(remotePage!)
        await expect(jumpToLatestButton(remotePage!)).toBeVisible()
        await jumpToLatestButton(remotePage!).click()
        await expectAtBottom(remotePage!)
      })

      await test.step('room B: cached re-open still lands at the bottom, and repeats both behaviors', async () => {
        await openRoom(remotePage!, roomAName)
        await openRoom(remotePage!, roomBName)
        await expect(unreadDivider(remotePage!)).toBeHidden()
        await expectAtBottom(remotePage!)
        await expectFollowsWhileAtBottom()
        await expectButtonWhenScrolledUp()
      })

      await test.step('fully-read rooms stay read after refresh, while a genuinely new unread survives refresh', async () => {
        await remotePage!.waitForTimeout(1_000)
        await remotePage!.reload()
        await expect(roomRow(remotePage!, roomAName)).toBeVisible({ timeout: 60_000 })
        await expect(roomRow(remotePage!, roomAName).getByTestId('unread-badge')).toHaveCount(0, {
          timeout: 30_000,
        })
        await expect(roomRow(remotePage!, roomBName).getByTestId('unread-badge')).toHaveCount(0, {
          timeout: 30_000,
        })
        await expect(unreadDivider(remotePage!)).toBeHidden({ timeout: 30_000 })

        const marker = `Refresh genuine unread ${runId}`
        await openRoom(page!, roomAName)
        await sendMessage(page!, marker)
        await expect(roomRow(remotePage!, roomAName)).toContainText(marker, { timeout: 30_000 })
        await expect(roomRow(remotePage!, roomAName).getByTestId('unread-badge')).toBeVisible({
          timeout: 30_000,
        })

        await remotePage!.reload()
        await expect(roomRow(remotePage!, roomAName).getByTestId('unread-badge')).toBeVisible({
          timeout: 60_000,
        })
        await openRoom(remotePage!, roomAName)
        await expect(unreadDivider(remotePage!)).toBeVisible({ timeout: 30_000 })
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
        if (roomAId) await cleanTestRoom(roomAId, sessions)
        if (roomBId) await cleanTestRoom(roomBId, sessions)
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

  test('isolates sending-as scrolling and keeps combined-account unread badges cleared', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(8 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const account3 = live.account3!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Multi Account Scroll ${runId}`

    let context
    let remoteContext
    let page: Page | undefined
    let remotePage: Page | undefined
    let roomId: string | undefined
    let account1Id: string | undefined
    let account2Id: string | undefined
    let account3Id: string | undefined
    let account1Session: StoredSession | undefined
    let account2Session: StoredSession | undefined
    let account3Session: StoredSession | undefined
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

      await test.step('sign in two combined accounts and an independent sender', async () => {
        await signIn(page!, account1)
        account1Session = (await storedSessions(page!)).at(-1)
        account1Id = account1Session?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)

        await addAccount(page!, account2)
        account2Session = (await storedSessions(page!))
          .filter((session) => session.userId !== account1Id)
          .at(-1)
        account2Id = account2Session?.userId
        expect(account2Id).toMatch(/^@[^:]+:.+/)
        await setAutoReadAllAccounts(page!, false)

        await signIn(remotePage!, account3)
        account3Session = (await storedSessions(remotePage!)).at(-1)
        account3Id = account3Session?.userId
        expect(account3Id).toMatch(/^@[^:]+:.+/)
      })

      await test.step('create a shared room and keep read receipts account-specific', async () => {
        await openRoomActions(remotePage!)
        await remotePage!.getByText('Create a room', { exact: true }).click()
        const dialog = remotePage!.getByRole('dialog', {
          name: 'Create a room',
        })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Room name').fill(roomName)
        await retryMutatingRequest(
          remotePage!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom (multi-account scroll)' },
        )
        await expect(
          remotePage!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(remotePage!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)

        await inviteToRoom(account3Session!, roomId!, account1Id!)
        await inviteToRoom(account3Session!, roomId!, account2Id!)
        await joinRoomAs(account1Session!, roomId!)
        await joinRoomAs(account2Session!, roomId!)
        await expect(roomRow(page!, roomName)).toBeVisible({
          timeout: 60_000,
        })
      })

      await test.step(`seed ${MULTI_ACCOUNT_BACKLOG_COUNT} messages, read by account 1 but not account 2`, async () => {
        const eventIds = await sendFillerMessages(
          account3Session!,
          roomId!,
          MULTI_ACCOUNT_BACKLOG_COUNT,
          'Multi-account unread backlog',
        )
        await sendReadReceipt(account1Session!, roomId!, eventIds.at(-1)!)
        await expect(roomRow(page!, roomName)).toContainText(
          `Multi-account unread backlog ${MULTI_ACCOUNT_BACKLOG_COUNT}`,
          { timeout: 60_000 },
        )
      })

      await test.step('combined view follows the read sending account badge despite the other account backlog', async () => {
        await openRoom(page!, roomName)
        await selectSendingAs(page!, account1Id!)
        await expect(unreadDivider(page!)).toBeHidden({ timeout: 30_000 })
        await expect(roomRow(page!, roomName).getByTestId('unread-badge')).toHaveCount(0, {
          timeout: 30_000,
        })
        await expectAtBottom(page!)
        await expect(jumpToLatestButton(page!)).toBeHidden()
        expect(
          await page!.getByTestId('timeline').locator('[data-message-box]').count(),
        ).toBeLessThanOrEqual(40)
      })

      await test.step('switching to the unread account positions at its own unread marker', async () => {
        await selectSendingAs(page!, account2Id!)
        await expect(unreadDivider(page!)).toBeVisible({ timeout: 30_000 })
        await expect(roomRow(page!, roomName).getByTestId('unread-badge')).toBeVisible({
          timeout: 30_000,
        })
        await expectAwayFromBottom(page!)
        await expect(jumpToLatestButton(page!)).toBeVisible()
      })

      await test.step('switching back isolates live auto-scroll from the unread account', async () => {
        await selectSendingAs(page!, account1Id!)
        await expect(unreadDivider(page!)).toBeHidden({ timeout: 30_000 })
        await expect(roomRow(page!, roomName).getByTestId('unread-badge')).toHaveCount(0, {
          timeout: 30_000,
        })
        await expectAtBottom(page!)

        const marker = `Selected-account live message ${runId}`
        const [markerEventId] = await sendFillerMessages(account3Session!, roomId!, 1, marker)
        await expect(
          page!
            .locator('[data-event-id^="$"]')
            .filter({ hasText: `${marker} 1` })
            .last(),
        ).toBeVisible({ timeout: 30_000 })
        await expectAtBottom(page!)
        await expect(jumpToLatestButton(page!)).toBeHidden()

        await sendReadReceipt(account2Session!, roomId!, markerEventId)
        await sendFillerMessages(
          account3Session!,
          roomId!,
          EXTRA_BATCH_COUNT,
          'Selected-account unread batch',
        )
        await expect(roomRow(page!, roomName)).toContainText(
          `Selected-account unread batch ${EXTRA_BATCH_COUNT}`,
          { timeout: 30_000 },
        )

        await selectSendingAs(page!, account2Id!)
        await expect(unreadDivider(page!)).toBeVisible({ timeout: 30_000 })
        await expectAwayFromBottom(page!)
      })

      await test.step('app settings expose read synchronization', async () => {
        await setAutoReadAllAccounts(page!, true)
      })

      await test.step('reading at the bottom clears the badge for both accounts and it stays cleared', async () => {
        await jumpToLatestButton(page!).click()
        await expectAtBottom(page!)
        const badge = roomRow(page!, roomName).locator('.ant-badge-count')
        await expect(badge).toHaveCount(0, { timeout: 30_000 })

        const marker = `Read-all live message ${runId}`
        await sendFillerMessages(account3Session!, roomId!, 1, marker)
        await expect(
          page!
            .locator('[data-event-id^="$"]')
            .filter({ hasText: `${marker} 1` })
            .last(),
        ).toBeVisible({ timeout: 30_000 })
        await expectAtBottom(page!)
        await expect(badge).toHaveCount(0, { timeout: 30_000 })

        await page!.waitForTimeout(2_000)
        await page!.reload()
        await expect(roomRow(page!, roomName)).toBeVisible({
          timeout: 60_000,
        })
        await expect(roomRow(page!, roomName).locator('.ant-badge-count')).toHaveCount(0, {
          timeout: 30_000,
        })
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
          [account3, account3Session],
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
