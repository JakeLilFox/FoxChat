import { expect, test, type Page } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import { cleanTestRoom, removeOtherDevices, storedSessions } from './support/matrix-api'
import {
  closeActiveSpace,
  openChannelInSpace,
  openRoomActions,
  openRoomSettings,
  signIn,
} from './support/ui'

const live = liveMatrixConfig()

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const participantRow = (page: Page, userId: string) =>
  page.getByRole('button', { name: new RegExp(escapeRegExp(userId)) }).last()

const openParticipants = async (page: Page) => {
  const detailsTitle = page.getByText(/^(Channel|Space) details$/)
  if (!(await detailsTitle.isVisible()))
    await page.getByRole('button', { name: 'Room information' }).click()
  await expect(detailsTitle).toBeVisible()
  await expect(page.getByText(new RegExp(`^Participants`))).toBeVisible({ timeout: 30_000 })
}

const moderateViaContextMenu = async (
  page: Page,
  userId: string,
  action: 'Kick from room' | 'Ban from room' | 'Kick from Space' | 'Ban from Space',
) => {
  await participantRow(page, userId).click({ button: 'right' })
  const menuItem = page.getByRole('menuitem', { name: action, exact: true })
  await expect(menuItem).toBeVisible({ timeout: 10_000 })
  await menuItem.click()
  const okText = action.startsWith('Ban') ? 'Ban member' : 'Kick member'
  await page.getByRole('button', { name: okText, exact: true }).click()
}

const joinRoomById = async (page: Page, roomId: string) => {
  await openRoomActions(page)
  const joinAction = page.getByRole('menu').getByText('Join a room', { exact: true })
  await expect(joinAction).toBeVisible()
  await joinAction.click()
  const dialog = page.getByRole('dialog', { name: 'Join a room' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Room ID or alias').fill(roomId)
  await dialog.getByRole('button', { name: 'Join room' }).click()
  return dialog
}

const expectJoinSucceeds = async (page: Page, roomId: string) => {
  const dialog = await joinRoomById(page, roomId)
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

const expectJoinIsBlocked = async (page: Page, roomId: string) => {
  const dialog = await joinRoomById(page, roomId)
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/banned/i).last()).toBeVisible({ timeout: 15_000 })
  await dialog
    .getByRole('button', { name: /^Close$|^Cancel$/ })
    .click()
    .catch(() => undefined)
}

const unbanViaSettings = async (page: Page, roomName: string, userId: string) => {
  const panel = await openRoomSettings(page, roomName, 'Banned members')
  const row = panel.locator('.item').filter({ hasText: userId })
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.getByRole('button', { name: 'Unban' }).click()
  await page.getByRole('button', { name: 'Unban member', exact: true }).click()
  await expect(row).toBeHidden({ timeout: 30_000 })
}

test.describe('live moderation journey', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled, live.reason)

  test('kicks, bans, and unbans a room member; a ban blocks rejoining until unbanned', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Moderation Room ${runId}`

    let ownerContext
    let memberContext
    let owner: Page | undefined
    let member: Page | undefined
    let roomId: string | undefined
    let account1Id: string | undefined
    let account2Id: string | undefined
    let journeyError: unknown

    try {
      ownerContext = await browser.newContext({ baseURL })
      memberContext = await browser.newContext({ baseURL })
      owner = await ownerContext.newPage()
      member = await memberContext.newPage()

      await test.step('sign in both accounts', async () => {
        await signIn(owner!, account1)
        account1Id = (await storedSessions(owner!)).at(-1)?.userId
        await signIn(member!, account2)
        account2Id = (await storedSessions(member!)).at(-1)?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)
        expect(account2Id).toMatch(/^@[^:]+:.+/)
      })

      await test.step('create a public room', async () => {
        await openRoomActions(owner!)
        await owner!.getByText('Create a room', { exact: true }).click()
        const dialog = owner!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await owner!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(roomName)
        await dialog
          .locator('.ant-form-item')
          .filter({ hasText: 'Public room' })
          .getByRole('switch')
          .click()
        await dialog.getByRole('button', { name: 'Create room' }).click()
        await expect(
          owner!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(owner!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)
      })

      await test.step('the second account joins the public room directly by ID', async () => {
        await expectJoinSucceeds(member!, roomId!)
        await expect(
          member!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
      })

      await test.step('kick the member from the room', async () => {
        await openParticipants(owner!)
        await moderateViaContextMenu(owner!, account2Id!, 'Kick from room')
        await expect(participantRow(owner!, account2Id!)).toHaveCount(0, { timeout: 30_000 })
        await expect(member!.getByTestId('room-row').filter({ hasText: roomName })).toHaveCount(0, {
          timeout: 60_000,
        })
      })

      await test.step('a kick does not block rejoining a public room', async () => {
        await expectJoinSucceeds(member!, roomId!)
        await expect(
          member!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
      })

      await test.step('ban the member from the room', async () => {
        await openParticipants(owner!)
        await moderateViaContextMenu(owner!, account2Id!, 'Ban from room')
        await expect(participantRow(owner!, account2Id!)).toHaveCount(0, { timeout: 30_000 })
        await expect(member!.getByTestId('room-row').filter({ hasText: roomName })).toHaveCount(0, {
          timeout: 60_000,
        })
      })

      await test.step('a ban blocks rejoining the public room', async () => {
        await expectJoinIsBlocked(member!, roomId!)
      })

      await test.step('unbanning restores the ability to rejoin', async () => {
        await unbanViaSettings(owner!, roomName, account2Id!)
        await expectJoinSucceeds(member!, roomId!)
        await expect(
          member!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        const sessions = [
          ...(owner && !owner.isClosed() ? await storedSessions(owner).catch(() => []) : []),
          ...(member && !member.isClosed() ? await storedSessions(member).catch(() => []) : []),
        ]
        if (roomId) await cleanTestRoom(roomId, sessions)
        for (const [userId, password] of [
          [account1Id, account1.password],
          [account2Id, account2.password],
        ] as const) {
          const current = sessions.filter((session) => session.userId === userId).at(-1)
          if (current) await removeOtherDevices(browser, current, password)
        }
      } catch (error) {
        cleanupError = error
      } finally {
        await ownerContext?.close()
        await memberContext?.close()
      }
      if (!journeyError && cleanupError) journeyError = cleanupError
    }
    if (journeyError) throw journeyError
  })

  test('kicks, bans, and unbans a space member; a ban blocks rejoining until unbanned', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const spaceName = `${live.roomPrefix} Moderation Space ${runId}`
    const channelName = `${live.roomPrefix} Moderation Channel ${runId}`

    let ownerContext
    let memberContext
    let owner: Page | undefined
    let member: Page | undefined
    let spaceId: string | undefined
    let channelId: string | undefined
    let account1Id: string | undefined
    let account2Id: string | undefined
    let journeyError: unknown

    try {
      ownerContext = await browser.newContext({ baseURL })
      memberContext = await browser.newContext({ baseURL })
      owner = await ownerContext.newPage()
      member = await memberContext.newPage()

      await test.step('sign in both accounts', async () => {
        await signIn(owner!, account1)
        account1Id = (await storedSessions(owner!)).at(-1)?.userId
        await signIn(member!, account2)
        account2Id = (await storedSessions(member!)).at(-1)?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)
        expect(account2Id).toMatch(/^@[^:]+:.+/)
      })

      await test.step('create a public space with a public channel', async () => {
        await openRoomActions(owner!)
        await owner!.getByText('Create Space', { exact: true }).click()
        const dialog = owner!.getByRole('dialog', { name: 'Create a Space' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await owner!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Space name').fill(spaceName)
        await dialog
          .locator('.ant-form-item')
          .filter({ hasText: 'Public Space' })
          .getByRole('switch')
          .click()
        await dialog.getByRole('button', { name: 'Create Space' }).click()
        await expect(owner!.getByText(spaceName, { exact: true }).first()).toBeVisible({
          timeout: 60_000,
        })
        await expect
          .poll(() => new URL(owner!.url()).searchParams.get('space'), { timeout: 60_000 })
          .toMatch(/^!/)
        spaceId = new URL(owner!.url()).searchParams.get('space') ?? undefined

        const spaceDialog = await openRoomSettings(owner!, spaceName, 'Channels')
        await spaceDialog.getByRole('button', { name: 'plus' }).click()
        const channelDialog = owner!.getByRole('dialog', { name: 'Create channel' })
        await expect(channelDialog).toBeVisible({ timeout: 15_000 })
        await channelDialog.getByRole('textbox').first().fill(channelName)
        await channelDialog
          .locator('.ant-form-item')
          .filter({ hasText: 'Public channel' })
          .getByRole('switch')
          .click()
        await channelDialog.getByRole('button', { name: 'Create channel' }).click()
        await expect(spaceDialog.getByText(channelName, { exact: true })).toBeVisible({
          timeout: 60_000,
        })
        await owner!.getByRole('dialog').locator('.ant-modal-close').last().click()

        await openChannelInSpace(owner!, spaceName, channelName)
        await expect(
          owner!.getByTestId('room-header').getByRole('heading', { name: channelName }),
        ).toBeVisible({ timeout: 60_000 })
        channelId = new URL(owner!.url()).searchParams.get('room') ?? undefined
        expect(channelId).toMatch(/^!/)
      })

      await test.step('the second account joins both the space and its channel directly by ID', async () => {
        await expectJoinSucceeds(member!, spaceId!)
        await expectJoinSucceeds(member!, channelId!)
        await closeActiveSpace(member!)
        await expect(member!.getByTestId('room-row').filter({ hasText: spaceName })).toBeVisible({
          timeout: 60_000,
        })
      })

      await test.step('kick the member from the space', async () => {
        await openChannelInSpace(owner!, spaceName, channelName)
        await openParticipants(owner!)
        await moderateViaContextMenu(owner!, account2Id!, 'Kick from Space')
        await expect(member!.getByTestId('room-row').filter({ hasText: spaceName })).toHaveCount(
          0,
          { timeout: 60_000 },
        )
      })

      await test.step('a kick does not block rejoining a public space', async () => {
        await expectJoinSucceeds(member!, spaceId!)
        await closeActiveSpace(member!)
        await expect(member!.getByTestId('room-row').filter({ hasText: spaceName })).toBeVisible({
          timeout: 60_000,
        })
      })

      await test.step('ban the member from the space', async () => {
        await openChannelInSpace(owner!, spaceName, channelName)
        await openParticipants(owner!)
        await moderateViaContextMenu(owner!, account2Id!, 'Ban from Space')
        await expect(member!.getByTestId('room-row').filter({ hasText: spaceName })).toHaveCount(
          0,
          { timeout: 60_000 },
        )
      })

      await test.step('a ban blocks rejoining the public space', async () => {
        await expectJoinIsBlocked(member!, spaceId!)
      })

      await test.step('unbanning restores the ability to rejoin the space', async () => {
        await unbanViaSettings(owner!, spaceName, account2Id!)
        await expectJoinSucceeds(member!, spaceId!)
        await closeActiveSpace(member!)
        await expect(member!.getByTestId('room-row').filter({ hasText: spaceName })).toBeVisible({
          timeout: 60_000,
        })
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        const sessions = [
          ...(owner && !owner.isClosed() ? await storedSessions(owner).catch(() => []) : []),
          ...(member && !member.isClosed() ? await storedSessions(member).catch(() => []) : []),
        ]
        if (channelId) await cleanTestRoom(channelId, sessions)
        if (spaceId) await cleanTestRoom(spaceId, sessions)
        for (const [userId, password] of [
          [account1Id, account1.password],
          [account2Id, account2.password],
        ] as const) {
          const current = sessions.filter((session) => session.userId === userId).at(-1)
          if (current) await removeOtherDevices(browser, current, password)
        }
      } catch (error) {
        cleanupError = error
      } finally {
        await ownerContext?.close()
        await memberContext?.close()
      }
      if (!journeyError && cleanupError) journeyError = cleanupError
    }
    if (journeyError) throw journeyError
  })
})
