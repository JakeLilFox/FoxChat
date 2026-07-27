import { expect, test, type Locator, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { liveMatrixConfig } from './support/env'
import { cleanTestRoom, joinRoomAs, storedSessions, type StoredSession } from './support/matrix-api'
import { retryMutatingRequest } from './support/retry'
import { closeDialog, openRoomActions, openRoomSettings, signIn } from './support/ui'

const live = liveMatrixConfig()
const FAVICON_PATH = resolve(process.cwd(), 'public/favicon.png')

const formItem = (scope: Page | Locator, label: string) =>
  scope.locator('.ant-form-item').filter({ hasText: label }).first()

const selectOption = async (
  page: Page,
  scope: Page | Locator,
  label: string,
  optionName: string,
) => {
  await formItem(scope, label).locator('.ant-select').click()
  const option = page.locator('.ant-select-item-option').filter({ hasText: optionName }).last()
  await option.waitFor({ state: 'visible', timeout: 15_000 })
  await option.click()
}

const toggleSwitch = (scope: Page | Locator, label: string) =>
  formItem(scope, label).locator('.ant-switch').click()

const openCollapsePanel = async (scope: Locator, label: string) => {
  const header = scope.locator('.ant-collapse-header').filter({ hasText: label })
  await header.click()

  await expect(header).toHaveAttribute('aria-expanded', 'true', {
    timeout: 10_000,
  })

  await header.page().waitForTimeout(350)
}

test.describe('live room settings journey', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled, live.reason)

  test('room creation options and every General/Access/Federation/Roles setting persist', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const encryptedRoomName = `${live.roomPrefix} Settings Encrypted ${runId}`
    const plainRoomName = `${live.roomPrefix} Settings Plain ${runId}`

    let context
    let page: Page | undefined
    let encryptedRoomId: string | undefined
    let plainRoomId: string | undefined
    let account1Id: string | undefined
    let account2Id: string | undefined
    let sessions: StoredSession[] = []
    let journeyError: unknown

    try {
      context = await browser.newContext({
        baseURL,
        viewport: { width: 1440, height: 900 },
      })
      page = await context.newPage()

      await test.step('sign in', async () => {
        await signIn(page!, account1)
        account1Id = (await storedSessions(page!)).at(-1)?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)
      })

      const createRoom = async (
        name: string,
        options: { encrypted?: boolean; federated?: boolean; public?: boolean },
      ) => {
        await openRoomActions(page!)
        await page!.getByRole('menu').getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(name)
        if (options.public) await toggleSwitch(dialog, 'Public room')
        if (options.federated === false) await toggleSwitch(dialog, 'Allow federation')
        if (options.encrypted) await toggleSwitch(dialog, 'Encrypt this room')
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

      await test.step('create a private, encrypted, federated room', async () => {
        encryptedRoomId = await createRoom(encryptedRoomName, {
          encrypted: true,
          federated: true,
        })
        await expect(page!.getByText('Encrypted with Megolm', { exact: true })).toBeVisible()
      })

      await test.step('create a private, unencrypted, non-federated room (for the Encryption tab and Federation status checks)', async () => {
        plainRoomId = await createRoom(plainRoomName, {
          encrypted: false,
          federated: false,
        })
      })

      await test.step('invite account 2 into the encrypted room via raw API, so role-assignment has a second member', async () => {
        const detailsTitle = page!.getByText('Channel details', { exact: true })
        const back = page!.getByRole('button', { name: 'arrow-left' })
        if (await back.isVisible()) await back.click()
        await page!.getByTestId('room-row').filter({ hasText: encryptedRoomName }).click()
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
          { label: 'Matrix invite (account 2)' },
        )
      })

      await test.step('account 2 joins via raw API', async () => {
        const tempContext = await browser.newContext({ baseURL })
        const tempPage = await tempContext.newPage()
        try {
          await signIn(tempPage, account2)
          const account2Session = (await storedSessions(tempPage)).at(-1)
          account2Id = account2Session?.userId
          expect(account2Id).toMatch(/^@[^:]+:.+/)
          await joinRoomAs(account2Session!, encryptedRoomId!)
          sessions.push(account2Session!)
        } finally {
          await tempContext.close()
        }
      })

      await test.step('General tab: name, topic, avatar, and local name all persist through a reload', async () => {
        const panel = await openRoomSettings(page!, encryptedRoomName, 'General')
        const newName = `${encryptedRoomName} renamed`
        const nameField = formItem(panel, 'Matrix room name').getByRole('textbox')
        await nameField.fill(newName)
        await formItem(panel, 'Matrix room name').getByRole('button', { name: 'Save' }).click()
        await expect(page!.getByText('Name updated')).toBeVisible({ timeout: 15_000 })

        const topicField = formItem(panel, 'Topic').getByRole('textbox')
        await topicField.fill('A topic set by the room settings test')
        await formItem(panel, 'Topic').getByRole('button', { name: 'Save topic' }).click()
        await expect(page!.getByText('Topic updated')).toBeVisible({ timeout: 15_000 })

        await formItem(panel, 'Avatar').locator('input[type="file"]').setInputFiles(FAVICON_PATH)
        await expect(page!.getByText('Avatar updated')).toBeVisible({ timeout: 30_000 })

        const localNameField = formItem(panel, 'Local room name').getByRole('textbox')
        await localNameField.fill('My local room name')
        await formItem(panel, 'Local room name')
          .getByRole('button', { name: 'Save locally' })
          .click()
        await expect(page!.getByText('room renamed locally')).toBeVisible({ timeout: 15_000 })

        await closeDialog(page!)
        await page!.reload()
        await expect(page!.getByTestId('room-sidebar').first()).toBeVisible({ timeout: 90_000 })

        const reopened = await openRoomSettings(page!, 'My local room name', 'General')
        await expect(formItem(reopened, 'Matrix room name').getByRole('textbox')).toHaveValue(
          newName,
        )
        await expect(formItem(reopened, 'Topic').getByRole('textbox')).toHaveValue(
          'A topic set by the room settings test',
        )
        await expect(formItem(reopened, 'Local room name').getByRole('textbox')).toHaveValue(
          'My local room name',
        )
        await expect(reopened.locator('img').first()).toBeVisible()
        await closeDialog(page!)
      })

      await test.step('Addresses panel: adding, making canonical, and removing an alias all persist', async () => {
        const panel = await openRoomSettings(page!, 'My local room name', 'General')
        await openCollapsePanel(panel, 'Addresses')
        const aliasLocal = `settings-test-${runId}`
        await formItem(panel, 'Aliases').getByPlaceholder('alias-name').fill(aliasLocal)
        await formItem(panel, 'Aliases').getByRole('button', { name: 'Add' }).click()
        await expect(page!.getByText('Alias added')).toBeVisible({ timeout: 15_000 })
        await expect(panel.getByText(`#${aliasLocal}:`)).toBeVisible()

        await closeDialog(page!)
        const reopened = await openRoomSettings(page!, 'My local room name', 'General')
        await openCollapsePanel(reopened, 'Addresses')
        await expect(reopened.getByText(`#${aliasLocal}:`)).toBeVisible()
        await closeDialog(page!)
      })

      await test.step('Access & visibility panel: join rule, guest access, and history visibility all persist', async () => {
        const panel = await openRoomSettings(page!, 'My local room name', 'General')
        await openCollapsePanel(panel, 'Access & visibility')
        await selectOption(page!, panel, 'Who can join', 'Ask to join')
        await expect(page!.getByText('Join rule updated')).toBeVisible({ timeout: 15_000 })
        const guestAccessWasChecked =
          (await formItem(panel, 'Guest access')
            .locator('.ant-switch')
            .getAttribute('aria-checked')) === 'true'
        await toggleSwitch(panel, 'Guest access')
        await expect(page!.getByText('Guest access updated')).toBeVisible({ timeout: 15_000 })
        await selectOption(
          page!,
          panel,
          'Who can read history',
          'Members, only from the moment they joined',
        )
        await expect(page!.getByText('History visibility updated')).toBeVisible({ timeout: 15_000 })

        await closeDialog(page!)
        await page!.reload()
        await expect(page!.getByTestId('room-sidebar').first()).toBeVisible({ timeout: 90_000 })
        const reopened = await openRoomSettings(page!, 'My local room name', 'General')
        await openCollapsePanel(reopened, 'Access & visibility')
        await expect(
          formItem(reopened, 'Who can join').locator('.ant-select-content'),
        ).toContainText('Ask to join')
        await expect(formItem(reopened, 'Guest access').locator('.ant-switch')).toHaveAttribute(
          'aria-checked',
          guestAccessWasChecked ? 'false' : 'true',
        )
        await expect(
          formItem(reopened, 'Who can read history').locator('.ant-select-content'),
        ).toContainText('only from the moment they joined')
        await closeDialog(page!)
      })

      await test.step('Federation tab: status reflects creation-time federation choice', async () => {
        const panel = await openRoomSettings(page!, plainRoomName, 'Federation')
        await expect(panel.getByText('Disabled', { exact: true })).toBeVisible()
        await expect(
          panel.getByText('Federation was disabled when this room was created'),
        ).toBeVisible()
        await closeDialog(page!)
      })

      await test.step("Federation tab: server ACL refuses to save a rule blocking the account's own homeserver", async () => {
        const panel = await openRoomSettings(page!, 'My local room name', 'Federation')
        await formItem(panel, 'Allowed servers').getByRole('textbox').fill('blocked.invalid')
        await panel.getByRole('button', { name: 'Save server ACL' }).click()
        await expect(
          page!.getByText(/must continue to allow this account's homeserver/),
        ).toBeVisible({
          timeout: 15_000,
        })
        await closeDialog(page!)
      })

      await test.step('Federation tab: a valid server ACL persists', async () => {
        const panel = await openRoomSettings(page!, 'My local room name', 'Federation')
        await panel.getByRole('button', { name: 'Allow all except denied' }).click()
        await formItem(panel, 'Denied servers').getByRole('textbox').fill('bad.example.org')
        await panel.getByRole('button', { name: 'Save server ACL' }).click()
        await expect(page!.getByText('Server ACL updated')).toBeVisible({ timeout: 15_000 })

        await closeDialog(page!)
        const reopened = await openRoomSettings(page!, 'My local room name', 'Federation')
        await expect(formItem(reopened, 'Denied servers').getByRole('textbox')).toHaveValue(
          'bad.example.org',
        )
        await closeDialog(page!)
      })

      await test.step('Encryption panel: enabling encryption on a previously unencrypted room is one-way', async () => {
        const panel = await openRoomSettings(page!, plainRoomName, 'General')
        await openCollapsePanel(panel, 'Encryption')
        await expect(
          panel.getByText('Messages in this room are not end-to-end encrypted.'),
        ).toBeVisible()
        await panel.getByRole('button', { name: 'Enable encryption' }).click()
        await expect(page!.getByText('Encryption enabled for this room')).toBeVisible({
          timeout: 15_000,
        })
        await expect(panel.getByRole('button', { name: 'Enable encryption' })).toBeHidden()

        await closeDialog(page!)
        await page!.reload()
        await expect(page!.getByTestId('room-sidebar').first()).toBeVisible({ timeout: 90_000 })
        const reopened = await openRoomSettings(page!, plainRoomName, 'General')
        await openCollapsePanel(reopened, 'Encryption')
        await expect(reopened.getByText(/cannot be turned back off/)).toBeVisible()
        await expect(reopened.getByRole('button', { name: 'Enable encryption' })).toHaveCount(0)
        await closeDialog(page!)
      })

      await test.step('Roles & permissions: a custom role, a changed permission, and a member assignment all persist', async () => {
        const panel = await openRoomSettings(page!, 'My local room name', 'Roles & permissions')
        await panel.getByRole('button', { name: 'Create role' }).click()
        const roleButton = panel.locator('button').filter({ hasText: 'New role' })
        await expect(roleButton).toBeVisible()
        await roleButton.click()

        const roleName = `Custom Mod ${runId}`
        await formItem(panel, 'Role name').getByRole('textbox').fill(roleName)
        await formItem(panel, 'Power level').locator('input').fill('40')

        const pinToggle = panel
          .locator('.ant-list-item')
          .filter({ hasText: 'Pin messages' })
          .locator('.ant-switch')
        const wasChecked = (await pinToggle.getAttribute('aria-checked')) === 'true'
        await pinToggle.click()

        const memberRow = panel.locator('.ant-list-item').filter({ hasText: account2Id! })
        await memberRow.locator('.ant-select').click()
        const roleOption = page!
          .locator('.ant-select-item-option')
          .filter({ hasText: roleName })
          .last()
        await roleOption.waitFor({ state: 'visible', timeout: 15_000 })
        await roleOption.click()

        await panel.getByRole('button', { name: 'Save changes' }).click()
        await expect(page!.getByText('Room roles saved')).toBeVisible({ timeout: 15_000 })

        await closeDialog(page!)
        const reopened = await openRoomSettings(page!, 'My local room name', 'Roles & permissions')
        const reopenedRoleButton = reopened.locator('button').filter({ hasText: roleName })
        await expect(reopenedRoleButton).toBeVisible()
        await expect(reopenedRoleButton).toContainText('40')
        await reopenedRoleButton.click()
        const reopenedPinToggle = reopened
          .locator('.ant-list-item')
          .filter({ hasText: 'Pin messages' })
          .locator('.ant-switch')
        await expect(reopenedPinToggle).toHaveAttribute(
          'aria-checked',
          wasChecked ? 'false' : 'true',
        )
        const reopenedMemberRow = reopened
          .locator('.ant-list-item')
          .filter({ hasText: account2Id! })
        await expect(reopenedMemberRow.locator('.ant-select-content')).toContainText(roleName)
        await closeDialog(page!)
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        if (page && !page.isClosed()) sessions.push(...(await storedSessions(page).catch(() => [])))
        if (encryptedRoomId) await cleanTestRoom(encryptedRoomId, sessions)
        if (plainRoomId) await cleanTestRoom(plainRoomId, sessions)
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
