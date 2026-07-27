import { expect, test, type BrowserContext, type Page } from '@playwright/test'
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
import { pace, retryMutatingRequest } from './support/retry'
import {
  addAccount,
  closeDialog,
  openChannelInSpace,
  openRoomActions,
  openRoomSettings,
  scrollBottomDistance,
  signIn,
} from './support/ui'

const live = liveMatrixConfig()

const NEAR_BOTTOM = 60

const FILLER_MESSAGE_COUNT = 90

const roomRow = (page: Page, name: string) => page.getByTestId('room-row').filter({ hasText: name })

const openRoom = async (page: Page, name: string) => {
  await roomRow(page, name).click()
  await expect(page.getByTestId('room-header').getByRole('heading', { name })).toBeVisible({
    timeout: 60_000,
  })
}

const scrollUp = async (page: Page) => {
  await page.getByTestId('timeline').hover()
  await page.mouse.wheel(0, -900)
}

test.describe('live timeline history-pagination journey', () => {
  test.skip(!live.enabled, live.reason)

  test('scrolling up in a plain room loads history beyond the initial sync window, down to the very first message', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} History Pagination ${runId}`
    const firstLabel = 'Genuinely first message ever sent'

    let context
    let remoteContext
    let page: Page | undefined
    let remotePage: Page | undefined
    let roomId: string | undefined
    let account1Session: StoredSession | undefined
    let account2RawSession: StoredSession | undefined
    let account2Session: StoredSession | undefined
    let journeyError: unknown

    try {
      context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
      })
      remoteContext = await browser.newContext({ baseURL })
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
          { label: 'Matrix createRoom (history-pagination)' },
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
          { label: 'Matrix invite (history-pagination)' },
        )
        await joinRoomAs(account2RawSession!, roomId!)
      })

      await test.step("seed the very first message, then bury it under enough filler to fall outside a fresh client's initial window", async () => {
        await sendFillerMessages(account1Session!, roomId!, 1, firstLabel)
        const fillerEventIds = await sendFillerMessages(
          account1Session!,
          roomId!,
          FILLER_MESSAGE_COUNT,
          'Backlog filler',
        )
        await sendReadReceipt(account2RawSession!, roomId!, fillerEventIds.at(-1)!)
      })

      await test.step('account 2 signs in fresh and opens the room at the bottom', async () => {
        await signIn(remotePage!, account2)
        account2Session = (await storedSessions(remotePage!)).at(-1)
        expect(account2Session?.userId).toMatch(/^@[^:]+:.+/)
        await openRoom(remotePage!, roomName)
        await expect
          .poll(() => scrollBottomDistance(remotePage!), { timeout: 30_000 })
          .toBeLessThanOrEqual(NEAR_BOTTOM)
        await expect(remotePage!.getByTestId('timeline').getByText(firstLabel)).toHaveCount(0)
      })

      await test.step('scrolling up repeatedly reaches the very first message', async () => {
        const first = remotePage!.getByTestId('timeline').getByText(firstLabel)
        await expect
          .poll(
            async () => {
              await scrollUp(remotePage!)
              return first.isVisible().catch(() => false)
            },
            { timeout: 90_000, intervals: [500] },
          )
          .toBe(true)
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

  test('scrolling up in a space channel loads history beyond the initial sync window, down to the very first message', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const spaceName = `${live.roomPrefix} History Pagination Space ${runId}`
    const channelName = `history-pagination-channel-${runId}`
    const firstLabel = 'Genuinely first channel message ever sent'

    let context
    let remoteContext
    let page: Page | undefined
    let remotePage: Page | undefined
    let spaceId: string | undefined
    let channelId: string | undefined
    let account1Session: StoredSession | undefined
    let account2RawSession: StoredSession | undefined
    let account2Session: StoredSession | undefined
    let journeyError: unknown

    try {
      context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
      })
      remoteContext = await browser.newContext({ baseURL })
      page = await context.newPage()
      remotePage = await remoteContext.newPage()

      await test.step("sign in account 1; get account 2 a session via the raw API only, so its tab isn't syncing yet", async () => {
        await signIn(page!, account1)
        account1Session = (await storedSessions(page!)).at(-1)
        expect(account1Session?.userId).toMatch(/^@[^:]+:.+/)
        account2RawSession = await rawLogin(account2)
        expect(account2RawSession.userId).toMatch(/^@[^:]+:.+/)
      })

      await test.step('create a space with one channel, invite account 2 to the channel directly (joins via raw API, never auto-visited)', async () => {
        await openRoomActions(page!)
        await page!.getByText('Create Space', { exact: true }).click()
        const spaceDialog = page!.getByRole('dialog', { name: 'Create a Space' })
        await expect(spaceDialog).toBeVisible()
        await spaceDialog.getByLabel('Space name').fill(spaceName)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => spaceDialog.getByRole('button', { name: 'Create Space' }).click(),
          { label: `Matrix createRoom (${spaceName})` },
        )
        await expect(page!.getByRole('heading', { name: spaceName }).first()).toBeVisible({
          timeout: 60_000,
        })
        spaceId = new URL(page!.url()).searchParams.get('space') ?? undefined
        expect(spaceId).toMatch(/^!/)

        const panel = await openRoomSettings(page!, spaceName, 'Channels')
        await panel.getByRole('button', { name: 'plus' }).click()
        const channelDialog = page!.getByRole('dialog', { name: 'Create channel' })
        await expect(channelDialog).toBeVisible()
        await channelDialog.getByRole('textbox').first().fill(channelName)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => channelDialog.getByRole('button', { name: 'Create channel' }).click(),
          { label: `Matrix createRoom (${channelName})` },
        )
        await expect(page!.getByText('Channel created')).toBeVisible({ timeout: 30_000 })
        await closeDialog(page!)
        await pace(page!)
        await openChannelInSpace(page!, spaceName, channelName)
        channelId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(channelId).toMatch(/^!/)

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
          { label: 'Matrix invite (history-pagination space channel)' },
        )
        await joinRoomAs(account2RawSession!, channelId!)
      })

      await test.step("seed the very first message, then bury it under enough filler to fall outside a fresh client's initial window", async () => {
        await sendFillerMessages(account1Session!, channelId!, 1, firstLabel)
        const fillerEventIds = await sendFillerMessages(
          account1Session!,
          channelId!,
          FILLER_MESSAGE_COUNT,
          'Backlog filler',
        )
        await sendReadReceipt(account2RawSession!, channelId!, fillerEventIds.at(-1)!)
      })

      await test.step('account 2 signs in fresh and opens the channel at the bottom', async () => {
        await signIn(remotePage!, account2)
        account2Session = (await storedSessions(remotePage!)).at(-1)
        expect(account2Session?.userId).toMatch(/^@[^:]+:.+/)
        await openRoom(remotePage!, channelName)
        await expect
          .poll(() => scrollBottomDistance(remotePage!), { timeout: 30_000 })
          .toBeLessThanOrEqual(NEAR_BOTTOM)
        await expect(remotePage!.getByTestId('timeline').getByText(firstLabel)).toHaveCount(0)
      })

      await test.step('scrolling up repeatedly reaches the very first message', async () => {
        const first = remotePage!.getByTestId('timeline').getByText(firstLabel)
        await expect
          .poll(
            async () => {
              await scrollUp(remotePage!)
              return first.isVisible().catch(() => false)
            },
            { timeout: 90_000, intervals: [500] },
          )
          .toBe(true)
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
        if (channelId) await cleanTestRoom(channelId, sessions)
        if (spaceId) await cleanTestRoom(spaceId, sessions)
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

  test('revisiting an already-open (cached) room lands at the bottom and can still scroll up for more history', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomAName = `${live.roomPrefix} Cache Revisit A ${runId}`
    const roomBName = `${live.roomPrefix} Cache Revisit B ${runId}`
    const firstLabel = 'Genuinely first cache-revisit message'

    let context
    let remoteContext
    let page: Page | undefined
    let remotePage: Page | undefined
    let roomAId: string | undefined
    let roomBId: string | undefined
    let account1Session: StoredSession | undefined
    let account2RawSession: StoredSession | undefined
    let account2Session: StoredSession | undefined
    let journeyError: unknown

    const createRoom = async (name: string) => {
      await openRoomActions(page!)
      await page!.getByText('Create a room', { exact: true }).click()
      const dialog = page!.getByRole('dialog', { name: 'Create a room' })
      await expect(dialog).toBeVisible()
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
      const detailsTitle = page!.getByText('Channel details', { exact: true })
      if (!(await detailsTitle.isVisible()))
        await page!.getByRole('button', { name: 'Room information' }).click()
      await expect(detailsTitle).toBeVisible()
      await page!.getByText('Invite', { exact: true }).last().click()
      const dialog = page!.getByRole('dialog', { name: 'Invite to room' })
      await dialog.getByLabel('Matrix user ID').fill(account2RawSession!.userId)
      await retryMutatingRequest(
        page!,
        (url) => url.pathname.endsWith('/invite'),
        () => dialog.getByRole('button', { name: 'Send invitation' }).click(),
        { label: `Matrix invite (${name})` },
      )
    }

    try {
      context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
      })
      remoteContext = await browser.newContext({ baseURL })
      page = await context.newPage()
      remotePage = await remoteContext.newPage()

      await test.step("sign in account 1; get account 2 a session via the raw API only, so its tab isn't syncing yet", async () => {
        await signIn(page!, account1)
        account1Session = (await storedSessions(page!)).at(-1)
        expect(account1Session?.userId).toMatch(/^@[^:]+:.+/)
        account2RawSession = await rawLogin(account2)
        expect(account2RawSession.userId).toMatch(/^@[^:]+:.+/)
      })

      await test.step('create both rooms and invite account 2 (joins via raw API, never auto-visited)', async () => {
        roomAId = await createRoom(roomAName)
        await invite(roomAName)
        roomBId = await createRoom(roomBName)
        await invite(roomBName)
        await joinRoomAs(account2RawSession!, roomAId!)
        await joinRoomAs(account2RawSession!, roomBId!)
      })

      await test.step('seed room A with a long, fully-read history and room B with one message', async () => {
        await sendFillerMessages(account1Session!, roomAId!, 1, firstLabel)
        const fillerEventIds = await sendFillerMessages(
          account1Session!,
          roomAId!,
          FILLER_MESSAGE_COUNT,
          'Backlog filler',
        )
        await sendReadReceipt(account2RawSession!, roomAId!, fillerEventIds.at(-1)!)
        const [roomBEventId] = await sendFillerMessages(
          account1Session!,
          roomBId!,
          1,
          'Room B filler',
        )
        await sendReadReceipt(account2RawSession!, roomBId!, roomBEventId)
      })

      await test.step('account 2 signs in fresh, opens room A at the bottom, and scrolls up partway', async () => {
        await signIn(remotePage!, account2)
        account2Session = (await storedSessions(remotePage!)).at(-1)
        expect(account2Session?.userId).toMatch(/^@[^:]+:.+/)
        await openRoom(remotePage!, roomAName)
        await expect
          .poll(() => scrollBottomDistance(remotePage!), { timeout: 30_000 })
          .toBeLessThanOrEqual(NEAR_BOTTOM)
        for (let i = 0; i < 5; i++) {
          await scrollUp(remotePage!)
          await remotePage!.waitForTimeout(500)
        }
        await expect(remotePage!.getByTestId('timeline').getByText(firstLabel)).toHaveCount(0)
      })

      await test.step('switch to room B, then back to room A: it lands at the bottom, not stuck showing older history', async () => {
        await openRoom(remotePage!, roomBName)
        await openRoom(remotePage!, roomAName)
        await expect
          .poll(() => scrollBottomDistance(remotePage!), { timeout: 30_000 })
          .toBeLessThanOrEqual(NEAR_BOTTOM)
      })

      await test.step('scrolling up in the re-opened (cached) room A still reaches the very first message', async () => {
        const first = remotePage!.getByTestId('timeline').getByText(firstLabel)
        await expect
          .poll(
            async () => {
              await scrollUp(remotePage!)
              return first.isVisible().catch(() => false)
            },
            { timeout: 90_000, intervals: [500] },
          )
          .toBe(true)
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

  test('scrolling up in a combined-account room reaches the very first message, even if the read-for-clearest-events room can switch between accounts', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const account3 = live.account3!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Combined History Pagination ${runId}`
    const firstLabel = 'Genuinely first combined-room message'

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

        await signIn(remotePage!, account3)
        account3Session = (await storedSessions(remotePage!)).at(-1)
        expect(account3Session?.userId).toMatch(/^@[^:]+:.+/)
      })

      await test.step('create a shared room, invite both combined accounts, and have both join fresh (never auto-visited)', async () => {
        await openRoomActions(remotePage!)
        await remotePage!.getByText('Create a room', { exact: true }).click()
        const dialog = remotePage!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Room name').fill(roomName)
        await retryMutatingRequest(
          remotePage!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom (combined history-pagination)' },
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
      })

      await test.step('seed the very first message, bury it under filler, and mark both combined accounts fully read', async () => {
        await sendFillerMessages(account3Session!, roomId!, 1, firstLabel)
        const fillerEventIds = await sendFillerMessages(
          account3Session!,
          roomId!,
          FILLER_MESSAGE_COUNT,
          'Combined backlog filler',
        )
        for (const session of [account1Session!, account2Session!])
          await sendReadReceipt(session, roomId!, fillerEventIds.at(-1)!)
      })

      await test.step('the combined room appears and opens at the bottom', async () => {
        const roomRow = page!.getByTestId('room-row').filter({ hasText: roomName })
        await expect(roomRow).toBeVisible({ timeout: 60_000 })
        await roomRow.click()
        await expect(
          page!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        await expect
          .poll(() => scrollBottomDistance(page!), { timeout: 30_000 })
          .toBeLessThanOrEqual(NEAR_BOTTOM)
        await expect(page!.getByTestId('timeline').getByText(firstLabel)).toHaveCount(0)
      })

      await test.step('scrolling up repeatedly reaches the very first message', async () => {
        const first = page!.getByTestId('timeline').getByText(firstLabel)
        await expect
          .poll(
            async () => {
              await scrollUp(page!)
              return first.isVisible().catch(() => false)
            },
            { timeout: 90_000, intervals: [500] },
          )
          .toBe(true)
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

  test('scrolling up in an encrypted, combined-account room that was already open (cached) still loads history and lands at the bottom', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomAName = `${live.roomPrefix} Encrypted Combined Cache A ${runId}`
    const roomBName = `${live.roomPrefix} Encrypted Combined Cache B ${runId}`
    const firstLabel = 'Genuinely first encrypted combined message'
    const lastLabel = 'Genuinely last encrypted combined message'

    let context: BrowserContext | undefined
    let page: Page | undefined
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
      page = await context.newPage()

      await test.step('sign in two combined accounts', async () => {
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

      const createRoom = async (name: string, encrypted: boolean) => {
        await openRoomActions(page!)
        await page!.getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(name)
        if (encrypted) {
          const encryption = dialog.getByRole('switch', {
            name: 'Encrypt this room',
          })
          if ((await encryption.getAttribute('aria-checked')) !== 'true') await encryption.click()
        }
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

      const inviteAccount2 = async (name: string) => {
        const detailsTitle = page!.getByText('Channel details', { exact: true })
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

      await test.step('create both rooms (A encrypted, B plain) and join account 2 to both via raw API', async () => {
        roomAId = await createRoom(roomAName, true)
        await inviteAccount2(roomAName)
        await pace(page!)
        roomBId = await createRoom(roomBName, false)
        await inviteAccount2(roomBName)
        await joinRoomAs(account2Session!, roomAId!)
        await joinRoomAs(account2Session!, roomBId!)
      })

      await test.step('seed room A: real encrypted first/last messages via the UI, filler in between', async () => {
        const roomRow = page!.getByTestId('room-row').filter({ hasText: roomAName })
        await roomRow.click()
        await expect(
          page!.getByTestId('room-header').getByRole('heading', { name: roomAName }),
        ).toBeVisible({ timeout: 60_000 })
        await expect(page!.getByText('Encrypted with Megolm', { exact: true })).toBeVisible()

        const composer = page!.getByTestId('message-composer')
        const send = async (body: string) => {
          await composer.fill(body)
          await page!.getByRole('button', { name: 'Send message' }).click()
          await expect(
            page!.locator('[data-event-id^="$"]').filter({ hasText: body }).last(),
          ).toBeVisible({ timeout: 30_000 })
        }
        await send(firstLabel)
        for (let i = 0; i < 45; i++) await send(`Encrypted filler ${i + 1}`)
        await send(lastLabel)
      })

      await test.step('open room A, confirm at the bottom, then switch away and back to cache it', async () => {
        await expect
          .poll(() => scrollBottomDistance(page!), { timeout: 30_000 })
          .toBeLessThanOrEqual(NEAR_BOTTOM)
        await openRoom(page!, roomBName)
        await openRoom(page!, roomAName)
        await expect
          .poll(() => scrollBottomDistance(page!), { timeout: 30_000 })
          .toBeLessThanOrEqual(NEAR_BOTTOM)
        await expect(page!.getByTestId('timeline').getByText(firstLabel)).toHaveCount(0)
      })

      await test.step('scrolling up in the re-opened (cached), encrypted, combined-account room still reaches the very first message', async () => {
        const first = page!.getByTestId('timeline').getByText(firstLabel)
        await expect
          .poll(
            async () => {
              await scrollUp(page!)
              return first.isVisible().catch(() => false)
            },
            { timeout: 90_000, intervals: [500] },
          )
          .toBe(true)
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        const sessions: StoredSession[] = []
        if (page && !page.isClosed()) sessions.push(...(await storedSessions(page).catch(() => [])))
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
      }
      if (!journeyError && cleanupError) journeyError = cleanupError
    }
    if (journeyError) throw journeyError
  })
})
