import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import {
  cleanTestRoom,
  inviteToRoom,
  joinRoomAs,
  kickFromRoom,
  removeOtherDevices,
  setEventTypeNotifyRule,
  setRoomState,
  storedSessions,
  type StoredSession,
} from './support/matrix-api'
import { pace, retryMutatingRequest } from './support/retry'
import {
  addAccount,
  openRoomActions,
  openRoomRow,
  sendMessage,
  setAutoReadAllAccounts,
  signIn,
} from './support/ui'

const live = liveMatrixConfig()

const CALL_MEMBER_EVENT_TYPE = 'org.matrix.msc3401.call.member'

const roomRow = (page: Page, name: string) => page.getByTestId('room-row').filter({ hasText: name })

const unreadBadge = (page: Page, name: string) => roomRow(page, name).getByTestId('unread-badge')

const sendingAsButton = (page: Page) =>
  page.getByRole('button', { name: /Sending as|Change sending account/ })

const selectSendingAs = async (page: Page, userId: string) => {
  const button = sendingAsButton(page)
  const current = await button.getAttribute('aria-label')
  if (current?.includes(userId)) return
  await button.click()
  await page.getByText(userId, { exact: true }).last().click()
  await expect(button).toHaveAttribute(
    'aria-label',
    new RegExp(userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  )
}

const settleRead = async (page: Page, name: string) => {
  await openRoomRow(page, name)
  await page.waitForTimeout(1_000)
  await page.bringToFront()
  await page.waitForTimeout(1_000)
}

const leaveRoom = async (page: Page) => {
  await page.evaluate(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete('room')
    url.searchParams.delete('space')
    url.searchParams.delete('roomModal')
    history.pushState(
      {
        ...history.state,
        foxchatRoom: undefined,
        foxchatSpace: undefined,
        foxchatRoomModal: undefined,
      },
      '',
      `${url.pathname}${url.search}${url.hash}`,
    )
    window.dispatchEvent(
      new CustomEvent('foxchat-room-navigated', {
        detail: { roomId: undefined, spaceId: undefined },
      }),
    )
  })
  await expect(page.getByRole('heading', { name: 'Select a room' })).toBeVisible()
}

test.describe('live multi-account notification journey', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled, live.reason)

  test('fixes room-event read, multi-account dedup/pref, own-account filtering, and sending-as self-healing', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(8 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const account3 = live.account3!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Notifications ${runId}`

    let context: BrowserContext | undefined
    let remoteContext: BrowserContext | undefined
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

      await test.step('sign in two combined accounts and one independent (room admin) account', async () => {
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
        await signIn(remotePage!, account3)
        account3Session = (await storedSessions(remotePage!)).at(-1)
        account3Id = account3Session?.userId
        expect(account3Id).toMatch(/^@[^:]+:.+/)
      })

      await test.step('account 3 (admin) creates the room and invites both combined accounts via the raw API', async () => {
        await openRoomActions(remotePage!)
        await remotePage!.getByText('Create a room', { exact: true }).click()
        const dialog = remotePage!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Room name').fill(roomName)
        await retryMutatingRequest(
          remotePage!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom' },
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
        await expect(roomRow(page!, roomName)).toBeVisible({ timeout: 60_000 })
      })

      await test.step('bug 1: a room event (not a message) that notifies still clears the unread badge once read', async () => {
        await setEventTypeNotifyRule(account1Session!, CALL_MEMBER_EVENT_TYPE)
        await setEventTypeNotifyRule(account2Session!, CALL_MEMBER_EVENT_TYPE)
        await setRoomState(account3Session!, roomId!, CALL_MEMBER_EVENT_TYPE, account3Id!, {
          calls: [],
          'm.expires_ts': Date.now() + 3_600_000,
        })
        await expect(unreadBadge(page!, roomName)).toBeVisible({ timeout: 30_000 })
        await settleRead(page!, roomName)
        await expect(unreadBadge(page!, roomName)).toBeHidden({ timeout: 30_000 })
      })

      await test.step('bug 2: with the default preference, one message lights up a single badge that reading clears for both accounts', async () => {
        await leaveRoom(page!)
        await pace(remotePage!)
        await sendMessage(remotePage!, `Combined dedup message ${runId}`)
        await expect(unreadBadge(page!, roomName)).toBeVisible({ timeout: 30_000 })
        await settleRead(page!, roomName)
        await expect(unreadBadge(page!, roomName)).toBeHidden({ timeout: 30_000 })
      })

      await test.step('bug 2: turning the preference off ties reading to the currently selected sending-as account only', async () => {
        await setAutoReadAllAccounts(page!, false)
        await selectSendingAs(page!, account1Id!)
        await leaveRoom(page!)
        await pace(remotePage!)
        await sendMessage(remotePage!, `Per-account message ${runId}`)
        await expect(unreadBadge(page!, roomName)).toBeVisible({ timeout: 30_000 })

        await settleRead(page!, roomName)
        await expect(unreadBadge(page!, roomName)).toBeHidden({ timeout: 30_000 })

        await selectSendingAs(page!, account2Id!)
        await expect(unreadBadge(page!, roomName)).toBeVisible({ timeout: 30_000 })

        await leaveRoom(page!)
        await settleRead(page!, roomName)
        await expect(unreadBadge(page!, roomName)).toBeHidden({ timeout: 30_000 })

        await selectSendingAs(page!, account1Id!)
        await expect(unreadBadge(page!, roomName)).toBeHidden()

        await setAutoReadAllAccounts(page!, true)
      })

      await test.step("bug 3: a message from the user's own other account never counts as unread", async () => {
        await selectSendingAs(page!, account1Id!)
        await pace(page!)
        await sendMessage(page!, `Own-account message ${runId}`)
        await expect(unreadBadge(page!, roomName)).toBeHidden()

        await leaveRoom(page!)
        await pace(remotePage!)
        await sendMessage(remotePage!, `Genuine third-party message ${runId}`)
        await expect(unreadBadge(page!, roomName)).toBeVisible({ timeout: 30_000 })
        await settleRead(page!, roomName)
        await expect(unreadBadge(page!, roomName)).toBeHidden({ timeout: 30_000 })
      })

      await test.step('bonus: kicking the current sending-as account moves sending-as to the remaining joined account', async () => {
        const button = sendingAsButton(page!)
        const label = await button.getAttribute('aria-label')
        const kicked = label?.includes(account1Id!) ? account1Id! : account2Id!
        const remaining = kicked === account1Id ? account2Id! : account1Id!

        await kickFromRoom(account3Session!, roomId!, kicked)

        await expect(button).toHaveAttribute(
          'aria-label',
          new RegExp(`^Sending as ${remaining!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
          { timeout: 60_000 },
        )
        await pace(page!)
        const postKickMessage = `Post-kick message ${runId}`
        const composer = page!.getByTestId('message-composer')
        await expect(composer).toBeEditable()
        await composer.fill(postKickMessage)
        await page!.getByRole('button', { name: 'Send message' }).click()
        await expect(roomRow(page!, roomName)).toContainText(postKickMessage, {
          timeout: 60_000,
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
