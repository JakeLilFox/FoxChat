import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import {
  cleanTestRoom,
  createRoom,
  inviteToRoom,
  joinRoomAs,
  rawLogin,
  removeOtherDevices,
  sendFillerMessages,
  setRoomState,
  storedSessions,
  type StoredSession,
} from './support/matrix-api'
import { addAccount, signIn } from './support/ui'

const live = liveMatrixConfig()
const CHANNEL_COUNT = 5
const MESSAGE_COUNT = 70

type ChannelFixture = {
  id: string
  name: string
  lastMessage: string
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const channelRow = (page: Page, name: string) =>
  page.getByTestId('room-sidebar').getByText(name, { exact: true }).first()
const timelineMessage = (page: Page, body: string) =>
  page.getByTestId('timeline').getByText(body, { exact: true })

async function openSpace(page: Page, name: string) {
  const back = page.getByRole('button', { name: 'arrow-left' })
  if (await back.isVisible()) await back.click()
  const row = page.getByTestId('room-row').filter({ hasText: name })
  await expect(row).toBeVisible({ timeout: 60_000 })
  await row.click()
}

async function expectChannelsPresent(page: Page, channels: ChannelFixture[]) {
  for (const channel of channels)
    await expect(channelRow(page, channel.name)).toBeVisible({ timeout: 60_000 })
}

async function expectSelectedChannel(
  page: Page,
  channel: ChannelFixture,
  otherChannels: ChannelFixture[],
) {
  await expect(
    page
      .getByTestId('room-header')
      .getByRole('heading', { name: new RegExp(`^${escapeRegExp(channel.name)}$`) }),
  ).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => new URL(page.url()).searchParams.get('room')).toBe(channel.id)
  await expect(timelineMessage(page, channel.lastMessage)).toBeVisible({ timeout: 60_000 })
  for (const other of otherChannels)
    await expect(timelineMessage(page, other.lastMessage)).toHaveCount(0)
}

async function exerciseChannelSwitching(page: Page, channels: ChannelFixture[]) {
  await expectChannelsPresent(page, channels)

  for (const channel of channels) {
    await channelRow(page, channel.name).click()
    await expectSelectedChannel(
      page,
      channel,
      channels.filter((candidate) => candidate.id !== channel.id),
    )
    await expectChannelsPresent(page, channels)
  }

  const burst = [0, 3, 1, 4, 2, 0, 4, 1, 3, 2, 4]
  for (const index of burst) await channelRow(page, channels[index].name).dispatchEvent('click')
  const target = channels[burst.at(-1)!]
  await expectSelectedChannel(
    page,
    target,
    channels.filter((candidate) => candidate.id !== target.id),
  )
  await expectChannelsPresent(page, channels)
}

async function switchPrimaryAccount(page: Page, userId: string) {
  await page.getByTestId('account-menu').click()
  await page.getByText('Switch accounts', { exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Accounts' })
  await expect(dialog).toBeVisible()
  const account = dialog.locator('.ant-list-item').filter({ hasText: userId })
  await expect(account).toBeVisible()
  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded' })
  await account.getByRole('button', { name: 'Switch', exact: true }).click()
  await navigation
  await expect(page.getByTestId('room-sidebar').first()).toBeVisible({ timeout: 90_000 })
  await expect(page.getByTestId('account-menu')).toContainText(userId, { timeout: 60_000 })
}

test.describe('live combined-account channel switching', () => {
  test.skip(!live.enabled, live.reason)

  test('space channels remain present and settle on the right timeline during slow and rapid switching, before and after changing the primary account', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(10 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const account3 = live.account3!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const spaceName = `${live.roomPrefix} Combined Channel Switching ${runId}`

    let context: BrowserContext | undefined
    let page: Page | undefined
    let spaceId: string | undefined
    const channels: ChannelFixture[] = []
    const rawSessions: StoredSession[] = []
    let browserSessions: StoredSession[] = []
    let journeyError: unknown

    try {
      await test.step('create the space and five 70-message channels, with only account 3 joined to the channels', async () => {
        let ownerSession = await rawLogin(account3)
        rawSessions.push(ownerSession)
        const via = [ownerSession.userId.slice(ownerSession.userId.indexOf(':') + 1)]

        spaceId = await createRoom(ownerSession, {
          name: spaceName,
          preset: 'private_chat',
          creation_content: { type: 'm.space' },
        })
        const joinSpace = async (account: typeof account1) => {
          let session = await rawLogin(account)
          await inviteToRoom(ownerSession, spaceId!, session.userId)
          try {
            await joinRoomAs(session, spaceId!)
          } catch (error) {
            if (!String(error).includes('M_UNKNOWN_TOKEN')) throw error
            session = await rawLogin(account)
            await joinRoomAs(session, spaceId!)
          }
          rawSessions.push(session)
        }
        await joinSpace(account1)
        await joinSpace(account2)

        for (let index = 0; index < CHANNEL_COUNT; index++) {
          ownerSession = await rawLogin(account3)
          rawSessions.push(ownerSession)
          const name = `${live.roomPrefix} Switch Channel ${index + 1} ${runId}`
          const id = await createRoom(ownerSession, {
            name,
            preset: 'private_chat',
            initial_state: [
              {
                type: 'm.space.parent',
                state_key: spaceId,
                content: { via, canonical: true },
              },
            ],
          })
          await setRoomState(ownerSession, spaceId, 'm.space.child', id, {
            via,
            order: String(index).padStart(2, '0'),
          })
          const label = `Channel ${index + 1} message`
          await sendFillerMessages(ownerSession, id, MESSAGE_COUNT, label, {
            refreshSession: async () => {
              ownerSession = await rawLogin(account3)
              rawSessions.push(ownerSession)
              return ownerSession
            },
          })
          channels.push({ id, name, lastMessage: `${label} ${MESSAGE_COUNT}` })
        }
      })

      await test.step('sign all accounts into one browser client in Combined mode', async () => {
        context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })
        page = await context.newPage()
        await signIn(page, account3)
        await addAccount(page, account1)
        await addAccount(page, account2)
        browserSessions = await storedSessions(page)
        expect(browserSessions.map((session) => session.userId)).toEqual(
          expect.arrayContaining(rawSessions.map((session) => session.userId)),
        )
        await expect
          .poll(() => page!.evaluate(() => localStorage.getItem('foxchat.matrix.combinedAccounts')))
          .not.toBe('false')
        await expect(page.getByTestId('account-menu')).toContainText(rawSessions[2].userId, {
          timeout: 60_000,
        })
      })

      await test.step('slow and rapid channel switching remains correct with account 2 primary', async () => {
        await openSpace(page!, spaceName)
        await exerciseChannelSwitching(page!, channels)
      })

      await test.step('switch account 1 to primary and repeat while account 3 supplies every child room through Combined mode', async () => {
        await switchPrimaryAccount(page!, rawSessions[1].userId)
        await openSpace(page!, spaceName)
        await exerciseChannelSwitching(page!, channels)
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        if (page && !page.isClosed())
          browserSessions = await storedSessions(page).catch(() => browserSessions)
        const cleanupSessions = [...browserSessions, ...rawSessions]
        for (const channel of [...channels].reverse())
          await cleanTestRoom(channel.id, cleanupSessions)
        await cleanTestRoom(spaceId, cleanupSessions)
        for (const [account, session] of [
          [
            account1,
            browserSessions.find((candidate) => candidate.userId === rawSessions[1]?.userId),
          ],
          [
            account2,
            browserSessions.find((candidate) => candidate.userId === rawSessions[2]?.userId),
          ],
          [
            account3,
            browserSessions.find((candidate) => candidate.userId === rawSessions[0]?.userId),
          ],
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
