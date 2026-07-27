import { expect, test, type Page } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import {
  cleanTestRoom,
  inviteToRoom,
  joinRoomAs,
  rawLogin,
  removeOtherDevices,
  sendFillerMessages,
  sendReadReceipt,
  storedSessions,
  type StoredSession,
} from './support/matrix-api'
import { retryMutatingRequest } from './support/retry'
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
const BACKLOG_COUNT = 40

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

test.describe('live combined-account read-state positioning journey', () => {
  test.skip(!live.enabled, live.reason)

  test('opening a room while sending-as a fully-read account lands at the bottom, even though another combined account in the same room has a large unread backlog', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const account3 = live.account3!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Combined Read Positioning ${runId}`

    let context
    let remoteContext
    let page: Page | undefined
    let remotePage: Page | undefined
    let roomId: string | undefined
    let account1Id: string | undefined
    let account2Id: string | undefined
    let account1Session: StoredSession | undefined
    let account2Session: StoredSession | undefined
    let account3Session: StoredSession | undefined
    let journeyError: unknown

    try {
      context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
      })
      remoteContext = await browser.newContext({ baseURL })
      page = await context.newPage()
      remotePage = await remoteContext.newPage()

      await test.step("sign in account 3 (the sender) and get accounts 1/2 raw sessions only, so their tabs aren't syncing yet", async () => {
        await signIn(remotePage!, account3)
        account3Session = (await storedSessions(remotePage!)).at(-1)
        expect(account3Session?.userId).toMatch(/^@[^:]+:.+/)
      })

      await test.step('account 3 creates the room and invites both future-combined accounts', async () => {
        await openRoomActions(remotePage!)
        await remotePage!.getByText('Create a room', { exact: true }).click()
        const dialog = remotePage!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Room name').fill(roomName)
        await retryMutatingRequest(
          remotePage!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom (combined read positioning)' },
        )
        await expect(
          remotePage!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(remotePage!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)
      })

      let account1RawSession: StoredSession | undefined
      let account2RawSession: StoredSession | undefined

      await test.step("both accounts join via the raw API before any backlog exists, so the server attributes it as real unread notifications for whichever one doesn't read it - joining after the fact wouldn't (correctly) count pre-join history as unread at all", async () => {
        await inviteToRoom(account3Session!, roomId!, account1.userId)
        await inviteToRoom(account3Session!, roomId!, account2.userId)
        account1RawSession = await rawLogin(account1)
        account2RawSession = await rawLogin(account2)
        await joinRoomAs(account1RawSession, roomId!)
        await joinRoomAs(account2RawSession, roomId!)
      })

      await test.step('seed a long backlog, then mark it fully read for account 1 only via the raw API - account 2 never reads any of it', async () => {
        const eventIds = await sendFillerMessages(
          account3Session!,
          roomId!,
          BACKLOG_COUNT,
          'Combined read positioning backlog',
        )
        await sendReadReceipt(account1RawSession!, roomId!, eventIds.at(-1)!)
      })

      await test.step('sign in account 1 (already fully read) and combine account 2 (still unread)', async () => {
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
      })

      await test.step('account 2 (not sending-as) genuinely has the whole backlog unread', async () => {
        await openRoom(page!, roomName)
        await selectSendingAs(page!, account2Id!)
        await expect(unreadDivider(page!)).toBeVisible({ timeout: 30_000 })
        await expect
          .poll(() => scrollBottomDistance(page!), { timeout: 15_000 })
          .toBeGreaterThan(AWAY_FROM_BOTTOM)
      })

      await test.step("switching sending-as back to the fully-read account 1 lands at the bottom, unaffected by account 2's backlog", async () => {
        await selectSendingAs(page!, account1Id!)
        await expect(unreadDivider(page!)).toBeHidden({ timeout: 30_000 })
        await expect
          .poll(() => scrollBottomDistance(page!), { timeout: 30_000 })
          .toBeLessThanOrEqual(NEAR_BOTTOM)
        await expect(jumpToLatestButton(page!)).toBeHidden()
      })

      await test.step('a fresh sign-in with both accounts already combined from the start also lands at the bottom while sending-as account 1', async () => {
        const freshContext = await browser.newContext({ baseURL })
        const freshPage = await freshContext.newPage()
        try {
          await signIn(freshPage, account1)
          await addAccount(freshPage, account2)
          await openRoom(freshPage, roomName)
          await selectSendingAs(freshPage, account1Id!)
          await expect(unreadDivider(freshPage)).toBeHidden({ timeout: 30_000 })
          await expect
            .poll(() => scrollBottomDistance(freshPage), { timeout: 30_000 })
            .toBeLessThanOrEqual(NEAR_BOTTOM)
          await expect(jumpToLatestButton(freshPage)).toBeHidden()
        } finally {
          await freshContext.close()
        }
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

  test("in an encrypted room, staying sending-as a fully-read combined account still lands at the bottom despite the other combined account's real unread backlog", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const account3 = live.account3!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Encrypted Combined Read Positioning ${runId}`
    const lastLabel = 'Genuinely last encrypted combined-read message'

    let context
    let remoteContext
    let page: Page | undefined
    let remotePage: Page | undefined
    let roomId: string | undefined
    let account1Id: string | undefined
    let account2Id: string | undefined
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
      page.on('console', (m) => {
        if (m.text().includes('[DEBUG')) console.log(m.text())
      })

      await test.step("sign in two combined accounts plus an independent sender, and disable auto-read-all so account 1 reading doesn't mark account 2 read", async () => {
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
        expect(account3Session?.userId).toMatch(/^@[^:]+:.+/)
      })

      await test.step('create an encrypted room as account 1 and join account 2 plus the independent sender', async () => {
        await openRoomActions(page!)
        await page!.getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(roomName)
        const encryption = dialog.getByRole('switch', {
          name: 'Encrypt this room',
        })
        if ((await encryption.getAttribute('aria-checked')) !== 'true') await encryption.click()
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom (encrypted combined read positioning)' },
        )
        await expect(
          page!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        await expect(page!.getByText('Encrypted with Megolm', { exact: true })).toBeVisible()
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)

        const detailsTitle = page!.getByText('Channel details', { exact: true })
        if (!(await detailsTitle.isVisible()))
          await page!.getByRole('button', { name: 'Room information' }).click()
        await expect(detailsTitle).toBeVisible()
        await page!.getByText('Invite', { exact: true }).last().click()
        const inviteDialog = page!.getByRole('dialog', { name: 'Invite to room' })
        await inviteDialog.getByLabel('Matrix user ID').fill(account2Id!)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/invite'),
          () => inviteDialog.getByRole('button', { name: 'Send invitation' }).click(),
          { label: 'Matrix invite (encrypted combined read positioning)' },
        )
        await joinRoomAs(account2Session!, roomId!)
        await inviteToRoom(account1Session!, roomId!, account3.userId)
        await joinRoomAs(account3Session!, roomId!)
        await expect(roomRow(remotePage!, roomName)).toBeVisible({ timeout: 60_000 })
        await openRoom(remotePage!, roomName)
      })

      await test.step('the independent account sends encrypted messages while account 1 reads them and account 2 never views the room', async () => {
        for (let i = 0; i < BACKLOG_COUNT; i++)
          await sendMessage(remotePage!, `Encrypted combined-read filler ${i + 1}`)
        const lastEventId = await sendMessage(remotePage!, lastLabel)
        await expect(
          page!.locator('[data-event-id^="$"]').filter({ hasText: lastLabel }).last(),
        ).toBeVisible({ timeout: 60_000 })
        await sendReadReceipt(account1Session!, roomId!, lastEventId)
        await expect
          .poll(() => scrollBottomDistance(page!), { timeout: 30_000 })
          .toBeLessThanOrEqual(NEAR_BOTTOM)
      })

      await test.step('account 2 (not sending-as) genuinely has the whole encrypted backlog unread', async () => {
        await selectSendingAs(page!, account2Id!)
        await expect(unreadDivider(page!)).toBeVisible({ timeout: 30_000 })
        await expect
          .poll(() => scrollBottomDistance(page!), { timeout: 15_000 })
          .toBeGreaterThan(AWAY_FROM_BOTTOM)
      })

      await test.step("switching sending-as back to the fully-read account 1 lands at the bottom, unaffected by account 2's encrypted backlog", async () => {
        await selectSendingAs(page!, account1Id!)
        await expect(unreadDivider(page!)).toBeHidden({ timeout: 30_000 })
        await expect
          .poll(() => scrollBottomDistance(page!), { timeout: 30_000 })
          .toBeLessThanOrEqual(NEAR_BOTTOM)
        await expect(jumpToLatestButton(page!)).toBeHidden()
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
