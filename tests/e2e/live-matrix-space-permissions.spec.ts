import { expect, test, type Locator, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { liveMatrixConfig } from './support/env'
import {
  cleanTestRoom,
  getRoomState,
  joinRoomAs,
  storedSessions,
  type StoredSession,
} from './support/matrix-api'
import { pace, retryMutatingRequest } from './support/retry'
import {
  closeDialog,
  openChannelInSpace,
  openCurrentRoomSettings,
  openRoomActions,
  openRoomSettings,
  signIn,
} from './support/ui'

const live = liveMatrixConfig()
const FAVICON_PATH = resolve(process.cwd(), 'public/favicon.png')

const formItem = (scope: Locator, label: string) =>
  scope.locator('.ant-form-item').filter({ hasText: label }).first()

const roleButton = (scope: Locator, name: string) =>
  scope.locator('button').filter({ hasText: name })

const hasOwnRoleTags = async (session: StoredSession, roomId: string) =>
  !!(await getRoomState(session, roomId, 'in.cinny.room.power_level_tags', ''))

const openSettingsToggle = async (page: Page) => {
  await page
    .getByTestId('account-menu')
    .getByRole('button', { name: 'Open settings', exact: true })
    .click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  return settings
}

const closeSettings = async (page: Page) => {
  const settings = page.getByRole('dialog', { name: 'Settings' })
  if (!(await settings.isVisible())) return
  await settings.locator('.ant-modal-close').click()
  await expect(settings).toBeHidden()
}

const setAutoSyncPreference = async (page: Page, enabled: boolean) => {
  const settings = await openSettingsToggle(page)
  const toggle = settings
    .locator('.ant-list-item')
    .filter({ hasText: 'Auto-sync space permissions to new channels' })
    .locator('.ant-switch')
  const checked = (await toggle.getAttribute('aria-checked')) === 'true'
  if (checked !== enabled) await toggle.click()
  await closeSettings(page)
}

test.describe('live space settings and permissions journey', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled, live.reason)

  test('space creation, settings persistence, and role/permission propagation to channels - existing, re-synced, and auto-synced-on-creation', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(8 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const spaceName = `${live.roomPrefix} Perms Space ${runId}`
    const channel1Name = `Channel One ${runId}`
    const channel2Name = `Channel Two ${runId}`
    const channel3Name = `Channel Three ${runId}`
    const channel4Name = `Channel Four ${runId}`
    const roleName = `Custom Role ${runId}`

    let context
    let page: Page | undefined
    let spaceId: string | undefined
    let channel1Id: string | undefined
    let channel2Id: string | undefined
    let channel3Id: string | undefined
    let channel4Id: string | undefined
    let account1Id: string | undefined
    let account1Session: StoredSession | undefined
    let account2Id: string | undefined
    let sessions: StoredSession[] = []
    let journeyError: unknown

    try {
      context = await browser.newContext({
        baseURL,
        viewport: { width: 1440, height: 900 },
      })
      page = await context.newPage()

      await test.step('sign in and ensure the auto-sync-on-creation preference starts at its default (off)', async () => {
        await signIn(page!, account1)
        account1Session = (await storedSessions(page!)).at(-1)
        account1Id = account1Session?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)
        await setAutoSyncPreference(page!, false)
      })

      await test.step('create the space and confirm its name and banner persist', async () => {
        await openRoomActions(page!)
        await page!.getByRole('menu').getByText('Create Space', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a Space' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Space name').fill(spaceName)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create Space' }).click(),
          { label: `Matrix createRoom (${spaceName})` },
        )
        await expect(page!.getByRole('heading', { name: spaceName }).first()).toBeVisible({
          timeout: 30_000,
        })
        spaceId = new URL(page!.url()).searchParams.get('space') ?? undefined
        expect(spaceId).toMatch(/^!/)

        const panel = await openRoomSettings(page!, spaceName, 'General')
        await panel.locator('input[type="file"]').last().setInputFiles(FAVICON_PATH)
        await expect(page!.getByText('Space banner updated')).toBeVisible({ timeout: 30_000 })
        await closeDialog(page!)

        await page!.reload()
        await expect(page!.getByTestId('room-sidebar').first()).toBeVisible({ timeout: 90_000 })
        const reopened = await openRoomSettings(page!, spaceName, 'General')
        await expect(reopened.getByRole('button', { name: 'Remove banner' })).toBeVisible()
        await closeDialog(page!)
      })

      const createChannel = async (name: string) => {
        const panel = await openRoomSettings(page!, spaceName, 'Channels')
        await panel.getByRole('button', { name: 'plus' }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create channel' })
        await expect(dialog).toBeVisible()
        await dialog.getByRole('textbox').first().fill(name)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create channel' }).click(),
          { label: `Matrix createRoom (${name})` },
        )
        await expect(page!.getByText('Channel created')).toBeVisible({ timeout: 30_000 })
        await closeDialog(page!)
        await pace(page!)
        await openChannelInSpace(page!, spaceName, name)
        const id = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(id).toMatch(/^!/)
        return id!
      }

      await test.step('create two channels in the space', async () => {
        channel1Id = await createChannel(channel1Name)
        channel2Id = await createChannel(channel2Name)
      })

      await test.step('invite account 2 into both channels via raw API', async () => {
        const tempContext = await browser.newContext({ baseURL })
        const tempPage = await tempContext.newPage()
        try {
          await signIn(tempPage, account2)
          const account2Session = (await storedSessions(tempPage)).at(-1)
          account2Id = account2Session?.userId
          expect(account2Id).toMatch(/^@[^:]+:.+/)
          for (const id of [channel1Id!, channel2Id!]) {
            await openChannelInSpace(
              page!,
              spaceName,
              channel1Id === id ? channel1Name : channel2Name,
            )
            const detailsTitle = page!.getByText('Channel details', { exact: true })
            if (!(await detailsTitle.isVisible()))
              await page!.getByRole('button', { name: 'Room information' }).click()
            await expect(detailsTitle).toBeVisible()
            await page!.getByText('Invite', { exact: true }).last().click()
            const dialog = page!.getByRole('dialog', { name: 'Invite to room' })
            await dialog.getByLabel('Matrix user ID').fill(account2.userId)
            await retryMutatingRequest(
              page!,
              (url) => url.pathname.endsWith('/invite'),
              () => dialog.getByRole('button', { name: 'Send invitation' }).click(),
              { label: `Matrix invite (${id})` },
            )
            await joinRoomAs(account2Session!, id)
          }
          sessions.push(account2Session!)
        } finally {
          await tempContext.close()
        }
      })

      await test.step('define a space-level role and permission change, then Sync baseline propagates it to both existing channels', async () => {
        const panel = await openRoomSettings(page!, spaceName, 'Roles & permissions')
        await panel.getByRole('button', { name: 'Create role' }).click()
        await roleButton(panel, 'New role').click()
        await formItem(panel, 'Role name').getByRole('textbox').fill(roleName)
        await formItem(panel, 'Power level').locator('input').fill('40')

        const pinToggle = panel
          .locator('.ant-list-item')
          .filter({ hasText: 'Pin messages' })
          .locator('.ant-switch')
        await pinToggle.click()

        await panel.getByRole('button', { name: 'Sync baseline' }).click()
        await page!.getByRole('button', { name: 'OK' }).click()
        await expect(page!.getByText(/Roles synced to \d+ rooms/)).toBeVisible({
          timeout: 30_000,
        })
        await closeDialog(page!)

        for (const [name, id] of [
          [channel1Name, channel1Id!],
          [channel2Name, channel2Id!],
        ] as const) {
          await openChannelInSpace(page!, spaceName, name)
          const channelPanel = await openCurrentRoomSettings(page!, 'Roles & permissions')
          await expect(roleButton(channelPanel, roleName)).toBeVisible({ timeout: 15_000 })
          await closeDialog(page!)
          expect(await hasOwnRoleTags(account1Session!, id)).toBe(true)
        }
      })

      await test.step("a channel created afterward does NOT have the space's permissions yet (auto-sync is off by default) - a manual re-sync then catches it", async () => {
        channel3Id = await createChannel(channel3Name)
        expect(await hasOwnRoleTags(account1Session!, channel3Id)).toBe(false)

        const spacePanel = await openRoomSettings(page!, spaceName, 'Roles & permissions')
        await spacePanel.getByRole('button', { name: 'Sync baseline' }).click()
        await page!.getByRole('button', { name: 'OK' }).click()
        await expect(page!.getByText(/Roles synced to \d+ rooms/)).toBeVisible({
          timeout: 30_000,
        })
        await closeDialog(page!)

        expect(await hasOwnRoleTags(account1Session!, channel3Id)).toBe(true)
        await openChannelInSpace(page!, spaceName, channel3Name)
        const syncedPanel = await openCurrentRoomSettings(page!, 'Roles & permissions')
        await expect(roleButton(syncedPanel, roleName)).toBeVisible({ timeout: 15_000 })
        await closeDialog(page!)
      })

      await test.step("with the auto-sync-on-creation preference enabled, a new channel gets the space's roles immediately - no manual sync needed", async () => {
        await setAutoSyncPreference(page!, true)
        channel4Id = await createChannel(channel4Name)
        expect(await hasOwnRoleTags(account1Session!, channel4Id)).toBe(true)
        const panel = await openCurrentRoomSettings(page!, 'Roles & permissions')
        await expect(roleButton(panel, roleName)).toBeVisible({ timeout: 15_000 })
        await closeDialog(page!)
        await setAutoSyncPreference(page!, false)
      })

      await test.step("assigning a role from the member menu's Space section propagates the member assignment to every channel", async () => {
        await openChannelInSpace(page!, spaceName, channel1Name)
        const detailsTitle = page!.getByText('Channel details', { exact: true })
        if (!(await detailsTitle.isVisible()))
          await page!.getByRole('button', { name: 'Room information' }).click()
        await expect(detailsTitle).toBeVisible()
        const participant = page!.locator('.participantMxid', { hasText: account2Id! }).first()
        await expect(participant).toBeVisible({ timeout: 15_000 })
        await participant.click({ button: 'right' })
        const spaceItem = page!.getByRole('menuitem', { name: new RegExp(`^Space · `) })
        await expect(spaceItem).toBeVisible({ timeout: 10_000 })
        await spaceItem.hover()
        const roleItem = page!.getByRole('menuitem', {
          name: new RegExp(`^${roleName} · 40$`),
        })
        await roleItem.waitFor({ state: 'visible', timeout: 10_000 })
        await roleItem.dispatchEvent('click')
        await expect(page!.getByText(/Role assigned across \d+ rooms/)).toBeVisible({
          timeout: 60_000,
        })

        await openChannelInSpace(page!, spaceName, channel2Name)
        const panel = await openCurrentRoomSettings(page!, 'Roles & permissions')
        const memberRow = panel.locator('.ant-list-item').filter({ hasText: account2Id! })
        await expect(memberRow.locator('.ant-select-content')).toContainText(roleName, {
          timeout: 15_000,
        })
        await closeDialog(page!)
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        if (page && !page.isClosed()) sessions.push(...(await storedSessions(page).catch(() => [])))
        for (const id of [channel1Id, channel2Id, channel3Id, channel4Id, spaceId]) {
          if (id) await cleanTestRoom(id, sessions)
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
