import { expect, test, type Locator, type Page } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import {
  cleanTestRoom,
  removeOtherDevices,
  storedSessions,
  type StoredSession,
} from './support/matrix-api'
import { retryMutatingRequest } from './support/retry'
import {
  closeDialog,
  openChannelInSpace,
  openCurrentRoomSettings,
  openRoomActions,
  openRoomRow,
  openRoomSettings,
  sendMessage,
  signIn,
} from './support/ui'

const live = liveMatrixConfig()

const formItem = (scope: Locator, label: string) =>
  scope.locator('.ant-form-item').filter({ hasText: label }).first()

const waitForMemberJoin = (page: Page, roomId: string, userId: string) =>
  page.waitForResponse(
    async (response) => {
      if (!response.ok() || !new URL(response.url()).pathname.endsWith('/sync')) return false
      const sync = (await response.json().catch(() => undefined)) as
        | {
            rooms?: {
              join?: Record<
                string,
                {
                  state?: { events?: Array<Record<string, unknown>> }
                  timeline?: { events?: Array<Record<string, unknown>> }
                }
              >
            }
          }
        | undefined
      const joinedRoom = sync?.rooms?.join?.[roomId]
      return [...(joinedRoom?.state?.events ?? []), ...(joinedRoom?.timeline?.events ?? [])].some(
        (event) =>
          event.type === 'm.room.member' &&
          event.state_key === userId &&
          (event.content as { membership?: unknown } | undefined)?.membership === 'join',
      )
    },
    { timeout: 60_000 },
  )

const restrictHistoryToJoinedMembers = async (page: Page) => {
  const panel = await openCurrentRoomSettings(page, 'General')
  const access = panel.locator('.ant-collapse-item').filter({ hasText: 'Access & visibility' })
  const header = access.locator('.ant-collapse-header')
  await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  await page.waitForTimeout(350)
  const history = formItem(panel, 'Who can read history')
  await history.locator('.ant-select').click()
  const option = page
    .locator('.ant-select-item-option')
    .filter({ hasText: 'Members, only from the moment they joined' })
    .last()
  await option.waitFor({ state: 'visible', timeout: 15_000 })
  await option.click()
  await expect(page.getByText('History visibility updated')).toBeVisible({ timeout: 15_000 })
  await expect(history.locator('.ant-select-content')).toContainText(
    'only from the moment they joined',
  )
  await closeDialog(page)
}

const inviteFromCurrentRoom = async (page: Page, userId: string) => {
  const detailsTitle = page.getByText('Channel details', { exact: true })
  if (!(await detailsTitle.isVisible()))
    await page.getByRole('button', { name: 'Room information' }).click()
  await expect(detailsTitle).toBeVisible()
  await page.getByText('Invite', { exact: true }).last().click()
  const invite = page.getByRole('dialog', { name: 'Invite to room' })
  await invite.getByLabel('Matrix user ID').fill(userId)
  await retryMutatingRequest(
    page,
    (url) => url.pathname.endsWith('/invite'),
    () => invite.getByRole('button', { name: 'Send invitation' }).click(),
    { label: 'Matrix invite (joined-history)' },
  )
}

const expectPreJoinHistoryUnavailable = async (page: Page, eventId: string) => {
  const oldEvent = page.locator(`[data-event-id="${eventId}"]`)
  await expect(page.getByTestId('history-visibility-status')).toHaveText(
    'History before you joined is not available in this room',
    { timeout: 60_000 },
  )
  await expect(oldEvent).toHaveCount(0)
  await expect(page.getByTestId('timeline').getByText(/Unable to decrypt/)).toHaveCount(0)
  await expect(page.getByTestId('timeline').getByText('Loading earlier messages…')).toHaveCount(0)
}

test.describe('live joined-history decryption presentation', () => {
  test.skip(!live.enabled, live.reason)

  for (const target of ['standalone room', 'space channel'] as const)
    test(`explains an undecryptable pre-join message in a ${target} and still decrypts messages sent after joining`, async ({
      browser,
      baseURL,
    }, testInfo) => {
      test.setTimeout(5 * 60_000)
      const account1 = live.account1!
      const account2 = live.account2!
      const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
      const roomName = `${live.roomPrefix} Joined History ${target} ${runId}`
      const spaceName = `${live.roomPrefix} Joined History Space ${runId}`
      const oldMessage = `before account two joined ${runId}`
      const newMessage = `after account two joined ${runId}`

      const senderContext = await browser.newContext({ baseURL })
      const receiverContext = await browser.newContext({ baseURL })
      const senderPage = await senderContext.newPage()
      const receiverPage = await receiverContext.newPage()
      let roomId: string | undefined
      let spaceId: string | undefined
      let senderSession: StoredSession | undefined
      let receiverSession: StoredSession | undefined
      let journeyError: unknown

      try {
        await test.step(`sign both devices in and create the encrypted ${target}`, async () => {
          await signIn(senderPage, account1)
          senderSession = (await storedSessions(senderPage)).at(-1)
          await signIn(receiverPage, account2)
          receiverSession = (await storedSessions(receiverPage)).at(-1)

          if (target === 'standalone room') {
            await openRoomActions(senderPage)
            await senderPage.getByText('Create a room', { exact: true }).click()
            const dialog = senderPage.getByRole('dialog', { name: 'Create a room' })
            await dialog.getByLabel('Room name').fill(roomName)
            const encryption = dialog.getByRole('switch', { name: 'Encrypt this room' })
            if ((await encryption.getAttribute('aria-checked')) !== 'true') await encryption.click()
            await retryMutatingRequest(
              senderPage,
              (url) => url.pathname.endsWith('/createRoom'),
              () => dialog.getByRole('button', { name: 'Create room' }).click(),
              { label: 'Matrix createRoom (joined-history)' },
            )
            await expect(
              senderPage.getByTestId('room-header').getByRole('heading', { name: roomName }),
            ).toBeVisible({ timeout: 60_000 })
          } else {
            await openRoomActions(senderPage)
            await senderPage.getByRole('menu').getByText('Create Space', { exact: true }).click()
            const spaceDialog = senderPage.getByRole('dialog', { name: 'Create a Space' })
            await spaceDialog.getByLabel('Space name').fill(spaceName)
            await retryMutatingRequest(
              senderPage,
              (url) => url.pathname.endsWith('/createRoom'),
              () => spaceDialog.getByRole('button', { name: 'Create Space' }).click(),
              { label: 'Matrix createRoom (joined-history space)' },
            )
            await expect(senderPage.getByRole('heading', { name: spaceName }).first()).toBeVisible({
              timeout: 60_000,
            })
            spaceId = new URL(senderPage.url()).searchParams.get('space') ?? undefined
            expect(spaceId).toMatch(/^!/)

            const channels = await openRoomSettings(senderPage, spaceName, 'Channels')
            await channels.getByRole('button', { name: 'plus' }).click()
            const channelDialog = senderPage.getByRole('dialog', { name: 'Create channel' })
            await channelDialog.getByRole('textbox').first().fill(roomName)
            const encryption = channelDialog
              .getByText('Encrypt this channel')
              .locator('..')
              .getByRole('switch')
            if ((await encryption.getAttribute('aria-checked')) !== 'true') await encryption.click()
            await retryMutatingRequest(
              senderPage,
              (url) => url.pathname.endsWith('/createRoom'),
              () => channelDialog.getByRole('button', { name: 'Create channel' }).click(),
              { label: 'Matrix createRoom (joined-history channel)' },
            )
            await expect(senderPage.getByText('Channel created')).toBeVisible({ timeout: 30_000 })
            await closeDialog(senderPage)
            await openChannelInSpace(senderPage, spaceName, roomName)
          }
          roomId = new URL(senderPage.url()).searchParams.get('room') ?? undefined
          expect(roomId).toMatch(/^!/)
        })

        let oldEventId = ''
        await test.step('send history before inviting, then limit history to joined members', async () => {
          oldEventId = await sendMessage(senderPage, oldMessage)
          await restrictHistoryToJoinedMembers(senderPage)
        })

        await test.step('invite account two and accept without sharing the earlier room key', async () => {
          const senderSawJoin = waitForMemberJoin(senderPage, roomId!, receiverSession!.userId)
          await inviteFromCurrentRoom(senderPage, receiverSession!.userId)
          const invitation = receiverPage.locator('.invitation').filter({ hasText: roomName })
          await expect(invitation).toBeVisible({ timeout: 60_000 })
          await invitation.getByRole('button', { name: 'Accept' }).click()
          await expect(
            receiverPage.getByTestId('room-header').getByRole('heading', { name: roomName }),
          ).toBeVisible({ timeout: 60_000 })
          await senderSawJoin
        })

        await test.step('the old event is identified as unavailable history, not a crypto error', async () => {
          await expectPreJoinHistoryUnavailable(receiverPage, oldEventId)
        })

        await test.step('the explanation survives reload and cached timeline restoration', async () => {
          await receiverPage.reload()
          await openRoomRow(receiverPage, roomName)
          await expect(
            receiverPage.getByTestId('room-header').getByRole('heading', { name: roomName }),
          ).toBeVisible({ timeout: 90_000 })
          await expectPreJoinHistoryUnavailable(receiverPage, oldEventId)
        })

        await test.step('a message encrypted after the join still decrypts normally', async () => {
          await sendMessage(senderPage, newMessage)
          await expect(receiverPage.getByTestId('timeline').getByText(newMessage)).toBeVisible({
            timeout: 60_000,
          })
        })
      } catch (error) {
        journeyError = error
      } finally {
        let cleanupError: unknown
        try {
          await cleanTestRoom(
            roomId,
            [senderSession, receiverSession].filter(
              (session): session is StoredSession => !!session,
            ),
          )
          await cleanTestRoom(
            spaceId,
            [senderSession, receiverSession].filter(
              (session): session is StoredSession => !!session,
            ),
          )
          for (const [account, session] of [
            [account1, senderSession],
            [account2, receiverSession],
          ] as const) {
            if (session) await removeOtherDevices(browser, session, account.password)
          }
        } catch (error) {
          cleanupError = error
        } finally {
          await senderContext.close()
          await receiverContext.close()
        }
        if (!journeyError && cleanupError) journeyError = cleanupError
      }
      if (journeyError) throw journeyError
    })
})
