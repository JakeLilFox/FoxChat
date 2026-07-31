import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import { liveMatrixConfig } from './support/env'
import {
  cleanTestRoom,
  getAccountData,
  getRoomState,
  removeOtherDevices,
  setAccountData,
  setRoomState,
  storedSessions,
  uploadMedia,
  type StoredSession,
} from './support/matrix-api'
import { pace } from './support/retry'
import {
  closeDialog,
  addAccount,
  openChannelInSpace,
  openAppSettings,
  openRoomActions,
  openRoomRow,
  openRoomSettings,
  signIn,
} from './support/ui'

const live = liveMatrixConfig()
const FAVICON_PATH = resolve(process.cwd(), 'public/favicon.png')

const packButton = (page: Page, name: string) =>
  page.locator('.pack').getByRole('button', { name: new RegExp(name) })

const openEmojiPicker = async (page: Page) => {
  await page.getByTitle('Emoji and stickers').click()
  await page.getByRole('tab', { name: /^Matrix/ }).click()
  await page.getByRole('tab', { name: /^Stickers/ }).click()
}

const closeEmojiPicker = async (page: Page) => {
  await page.keyboard.press('Escape')
}

const switchAccount = async (page: Page, userId: string) => {
  await page.getByTestId('account-menu').click()
  await page.getByText('Switch accounts', { exact: true }).click()
  const accounts = page.getByRole('dialog', { name: 'Accounts' })
  const row = accounts.locator('.ant-list-item').filter({ hasText: userId })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Switch', exact: true }).click()
  await expect(accounts).toBeHidden({ timeout: 90_000 })
  await expect(page.getByTestId('room-sidebar').first()).toBeVisible({
    timeout: 90_000,
  })
}

const saveChanges = async (page: Page, scope: Page | Locator) => {
  await scope.getByRole('button', { name: 'Save all changes' }).click()

  await expect(page.getByText('Image pack saved').last()).toBeVisible({
    timeout: 30_000,
  })
}

const uploadAndSave = async (page: Page, scope: Page | Locator, name: string) => {
  const fileInput = scope.locator('input[type="file"][accept="image/*"]')
  await fileInput.setInputFiles(FAVICON_PATH)

  await expect(scope.getByLabel('Sticker name').last()).toHaveValue('favicon', { timeout: 30_000 })
  await scope.getByLabel('Sticker name').last().fill(name)
  await saveChanges(page, scope)
}

const clearImagePack = async (page: Page, scope: Locator) => {
  while (await scope.getByTitle('Remove').count()) {
    await scope.getByTitle('Remove').first().click()
  }
  await saveChanges(page, scope)
}

const STICKER_ZIP_ASSETS = ['pfp1.png', 'pfp2.png', 'pfp3.png']

const buildStickerZip = async () => {
  const zip = new JSZip()
  for (const name of STICKER_ZIP_ASSETS) {
    zip.file(name, readFileSync(resolve(process.cwd(), 'tests/assets', name)))
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  const dir = mkdtempSync(join(tmpdir(), 'foxchat-e2e-stickers-'))
  const zipPath = join(dir, 'stickers.zip')
  writeFileSync(zipPath, buffer)
  return { dir, zipPath }
}

const TELEGRAM_DOWNLOAD_ROUTE = 'https://sticker.zenzon.net/download?*'
const TELEGRAM_PACK_URL = 'https://t.me/addstickers/foxchat-e2e-pack'
const TELEGRAM_PACK_NAME = 'foxchat-e2e-pack'
const TELEGRAM_IMPORT_TIMEOUT_MS = 5 * 60_000

const importTelegramPack = async (page: Page, scope: Page | Locator) => {
  await scope.getByRole('button', { name: 'Import from Telegram' }).click()
  const modal = page.getByRole('dialog', { name: 'Import from Telegram' })
  await expect(modal).toBeVisible()
  await modal.getByLabel('Telegram sticker pack link').fill(TELEGRAM_PACK_URL)
  const download = page.waitForRequest(
    (request) => request.url().startsWith('https://sticker.zenzon.net/download?'),
    { timeout: TELEGRAM_IMPORT_TIMEOUT_MS },
  )
  await modal.getByRole('button', { name: 'Import', exact: true }).click()
  await download
  await expect(modal).toBeHidden({ timeout: TELEGRAM_IMPORT_TIMEOUT_MS })
  await expect(page.getByText('3 images imported from Telegram').last()).toBeVisible()
  await expect(scope.getByLabel('Pack name')).toHaveValue(TELEGRAM_PACK_NAME)
  await expect(scope.getByLabel('Sticker name')).toHaveCount(3)
}

test.describe('live sticker pack journey', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled, live.reason)

  test('upload, view, rename, remove, and send stickers for account, room, and space packs', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(8 * 60_000)
    const account1 = live.account1!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Stickers ${runId}`
    const spaceName = `${live.roomPrefix} Sticker Space ${runId}`
    const channelName = `${live.roomPrefix} Sticker Channel ${runId}`
    const personalStickerName = `personal-${runId}`
    const roomStickerName = `room-${runId}`
    const spaceStickerName = `space-${runId}`

    let context
    let page: Page | undefined
    let roomId: string | undefined
    let spaceId: string | undefined
    let channelId: string | undefined
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

      await test.step('create a room to send stickers into', async () => {
        await openRoomActions(page!)
        await page!.getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(roomName)
        await dialog.getByRole('button', { name: 'Create room' }).click()
        await expect(
          page!.getByTestId('room-header').getByRole('heading', {
            name: roomName,
          }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)
      })

      await test.step('personal sticker: upload, rename, and it shows in settings', async () => {
        await page!.getByTestId('account-menu').click()
        await page!
          .getByTestId('account-menu')
          .getByRole('button', { name: 'Open settings' })
          .click()
        const settings = page!.getByRole('dialog', { name: 'Settings' })
        await expect(settings).toBeVisible()
        await settings.getByRole('tab', { name: 'Stickers & emoji' }).click()
        const panel = settings.getByRole('tabpanel', {
          name: 'Stickers & emoji',
        })
        await clearImagePack(page!, panel)
        await uploadAndSave(page!, panel, personalStickerName)
        await closeDialog(page!)
        await page!.getByTestId('account-menu').click()
        await page!
          .getByTestId('account-menu')
          .getByRole('button', { name: 'Open settings' })
          .click()
        await settings.getByRole('tab', { name: 'Stickers & emoji' }).click()
        await expect(panel.getByLabel('Sticker name')).toHaveValue(personalStickerName, {
          timeout: 30_000,
        })
        await expect(panel.locator('.packImage img')).toHaveAttribute('src', /.+/, {
          timeout: 30_000,
        })
        await closeDialog(page!)
      })

      await test.step('personal sticker: shows in the sticker picker and sends into a room', async () => {
        await openEmojiPicker(page!)
        const stickerButton = packButton(page!, personalStickerName)
        await expect(stickerButton).toBeVisible({ timeout: 30_000 })
        await expect(stickerButton.locator('img')).toHaveAttribute('src', /.+/, { timeout: 30_000 })
        await stickerButton.click()
        await expect(page!.locator('[data-event-id^="$"]').last().locator('img')).toHaveAttribute(
          'src',
          /.+/,
          { timeout: 30_000 },
        )
      })

      await test.step('personal sticker: remove and it disappears from settings and the picker', async () => {
        await page!.getByTestId('account-menu').click()
        await page!
          .getByTestId('account-menu')
          .getByRole('button', { name: 'Open settings' })
          .click()
        const settings = page!.getByRole('dialog', { name: 'Settings' })
        await settings.getByRole('tab', { name: 'Stickers & emoji' }).click()
        const panel = settings.getByRole('tabpanel', {
          name: 'Stickers & emoji',
        })
        await panel.getByTitle('Remove').click()
        await saveChanges(page!, panel)
        await closeDialog(page!)
        await openEmojiPicker(page!)
        await expect(packButton(page!, personalStickerName)).toHaveCount(0)
        await closeEmojiPicker(page!)
      })

      await test.step('room sticker: upload, rename, and it shows in settings', async () => {
        const dialog = await openRoomSettings(page!, roomName, 'Stickers & emoji')
        await uploadAndSave(page!, dialog, roomStickerName)
        await closeDialog(page!)
        const reopened = await openRoomSettings(page!, roomName, 'Stickers & emoji')
        await expect(reopened.getByLabel('Sticker name')).toHaveValue(roomStickerName, {
          timeout: 30_000,
        })
        await expect(reopened.locator('.packImage img')).toHaveAttribute('src', /.+/, {
          timeout: 30_000,
        })
        await closeDialog(page!)
      })

      await test.step('room sticker: shows in the sticker picker and sends into the room', async () => {
        await openEmojiPicker(page!)
        const stickerButton = packButton(page!, roomStickerName)
        await expect(stickerButton).toBeVisible({ timeout: 30_000 })
        await expect(stickerButton.locator('img')).toHaveAttribute('src', /.+/, { timeout: 30_000 })
        await stickerButton.click()
        await expect(page!.locator('[data-event-id^="$"]').last().locator('img')).toHaveAttribute(
          'src',
          /.+/,
          { timeout: 30_000 },
        )
      })

      await test.step('room sticker: remove and it disappears from settings and the picker', async () => {
        const dialog = await openRoomSettings(page!, roomName, 'Stickers & emoji')
        await dialog.getByTitle('Remove').click()
        await saveChanges(page!, dialog)
        await closeDialog(page!)
        await openEmojiPicker(page!)
        await expect(packButton(page!, roomStickerName)).toHaveCount(0)
        await closeEmojiPicker(page!)
      })

      await test.step('create a space with a channel', async () => {
        await openRoomActions(page!)
        await page!.getByText('Create Space', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a Space' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Space name').fill(spaceName)
        await dialog.getByRole('button', { name: 'Create Space' }).click()
        await expect(page!.getByText(spaceName, { exact: true }).first()).toBeVisible({
          timeout: 60_000,
        })
        spaceId = new URL(page!.url()).searchParams.get('space') ?? undefined
        await page!.waitForTimeout(2_000)

        const spaceDialog = await openRoomSettings(page!, spaceName, 'Channels')
        await spaceDialog.getByRole('button', { name: 'plus' }).click()
        const channelDialog = page!.getByRole('dialog', {
          name: 'Create channel',
        })
        await expect(channelDialog).toBeVisible({ timeout: 15_000 })
        await channelDialog.getByRole('textbox').first().fill(channelName)
        await channelDialog.getByRole('button', { name: 'Create channel' }).click()
        await expect(spaceDialog.getByText(channelName, { exact: true })).toBeVisible({
          timeout: 60_000,
        })
        await closeDialog(page!)
        await pace(page!, 2_000)
        await openChannelInSpace(page!, spaceName, channelName)
        await expect(
          page!.getByTestId('room-header').getByRole('heading', {
            name: channelName,
          }),
        ).toBeVisible({ timeout: 60_000 })
        channelId = new URL(page!.url()).searchParams.get('room') ?? undefined
      })

      await test.step('space sticker: upload, rename, and it shows in settings', async () => {
        const dialog = await openRoomSettings(page!, spaceName, 'Stickers & emoji')
        await uploadAndSave(page!, dialog, spaceStickerName)
        await closeDialog(page!)
        const reopened = await openRoomSettings(page!, spaceName, 'Stickers & emoji')
        await expect(reopened.getByLabel('Sticker name')).toHaveValue(spaceStickerName, {
          timeout: 30_000,
        })
        await expect(reopened.locator('.packImage img')).toHaveAttribute('src', /.+/, {
          timeout: 30_000,
        })
        await closeDialog(page!)
      })

      await test.step('space sticker: shows in the picker from a channel inside the space, and sends', async () => {
        await openChannelInSpace(page!, spaceName, channelName)
        await expect(
          page!.getByTestId('room-header').getByRole('heading', {
            name: channelName,
          }),
        ).toBeVisible({ timeout: 60_000 })
        await openEmojiPicker(page!)
        const stickerButton = packButton(page!, spaceStickerName)
        await expect(stickerButton).toBeVisible({ timeout: 30_000 })
        await expect(stickerButton.locator('img')).toHaveAttribute('src', /.+/, { timeout: 30_000 })
        await stickerButton.click()
        await expect(page!.locator('[data-event-id^="$"]').last().locator('img')).toHaveAttribute(
          'src',
          /.+/,
          { timeout: 30_000 },
        )
      })

      await test.step('space sticker: remove and it disappears from settings and the channel picker', async () => {
        const dialog = await openRoomSettings(page!, spaceName, 'Stickers & emoji')
        await dialog.getByTitle('Remove').click()
        await saveChanges(page!, dialog)
        await closeDialog(page!)
        await openChannelInSpace(page!, spaceName, channelName)
        await openEmojiPicker(page!)
        await expect(packButton(page!, spaceStickerName)).toHaveCount(0)
        await closeEmojiPicker(page!)
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        const sessions: StoredSession[] = []
        if (page && !page.isClosed()) sessions.push(...(await storedSessions(page).catch(() => [])))
        if (roomId) await cleanTestRoom(roomId, sessions)
        if (channelId) await cleanTestRoom(channelId, sessions)
        if (spaceId) await cleanTestRoom(spaceId, sessions)
        if (account1Id) {
          const current = sessions.filter((s) => s.userId === account1Id).at(-1)
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

  test('combined accounts share default-on personal emoji and stickers after switching and reloading', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(5 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Combined Packs ${runId}`
    const sharedImageName = `combined-pack-${runId}`

    let context
    let page: Page | undefined
    let roomId: string | undefined
    let account1Id: string | undefined
    let account2Id: string | undefined
    let account1Session: StoredSession | undefined
    let journeyError: unknown

    try {
      context = await browser.newContext({ baseURL })
      page = await context.newPage()

      await test.step('sign in two accounts in the default Combined layout', async () => {
        await signIn(page!, account1)
        await addAccount(page!, account2)
        const sessions = await storedSessions(page!)
        account1Session = sessions.find((session) => session.userId !== sessions.at(-1)?.userId)
        const account2Session = sessions.at(-1)
        account1Id = account1Session?.userId
        account2Id = account2Session?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)
        expect(account2Id).toMatch(/^@[^:]+:.+/)
        expect(account1Id).not.toBe(account2Id)
      })

      await test.step('create a room with account two', async () => {
        await openRoomActions(page!)
        await page!.getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(account2Id!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(roomName)
        await dialog.getByRole('button', { name: 'Create room' }).click()
        await expect(
          page!.getByTestId('room-header').getByRole('heading', {
            name: roomName,
          }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)
      })

      await test.step('switch to account one and upload an image usable as both emoji and sticker', async () => {
        await switchAccount(page!, account1Id!)
        const settings = page!.getByRole('dialog', { name: 'Settings' })
        await page!.getByTestId('account-menu').click()
        await page!
          .getByTestId('account-menu')
          .getByRole('button', { name: 'Open settings' })
          .click()
        await settings.getByRole('tab', { name: 'Stickers & emoji' }).click()
        const panel = settings.getByRole('tabpanel', {
          name: 'Stickers & emoji',
        })
        const sharing = panel.getByRole('switch', {
          name: 'Show emoji and stickers from every account',
        })
        await expect(sharing).toBeEnabled()
        await expect(sharing).toHaveAttribute('aria-checked', 'true')
        await clearImagePack(page!, panel)
        await panel.locator('input[type="file"][accept="image/*"]').setInputFiles(FAVICON_PATH)
        const name = panel.getByLabel('Sticker name').last()
        await expect(name).toHaveValue('favicon', { timeout: 30_000 })
        await name.fill(sharedImageName)
        await panel.getByText('Both', { exact: true }).last().click()
        await saveChanges(page!, panel)
        await closeDialog(page!)
      })

      await test.step("switch to account two, reload again, and retain the other account's pack", async () => {
        await switchAccount(page!, account2Id!)
        await page!.reload()
        await expect(page!.getByTestId('room-sidebar').first()).toBeVisible({
          timeout: 90_000,
        })
        await openRoomRow(page!, roomName)

        await openEmojiPicker(page!)
        const sticker = packButton(page!, sharedImageName)
        await expect(sticker).toBeVisible({ timeout: 30_000 })
        await expect(sticker.locator('img')).toHaveAttribute('src', /.+/, {
          timeout: 30_000,
        })
        await expect(
          sticker
            .locator("xpath=ancestor::div[contains(@class, 'pack')]")
            .getByText(account1Id!, { exact: false }),
        ).toBeVisible()
        await closeEmojiPicker(page!)

        await page!.getByTitle('Emoji and stickers').click()
        await page!.getByRole('tab', { name: /^Matrix/ }).click()
        await page!.getByRole('tab', { name: /^Emoji/ }).click()
        await expect(packButton(page!, sharedImageName)).toBeVisible()
        await closeEmojiPicker(page!)
      })

      await test.step('the preference can hide and restore other-account packs', async () => {
        await page!.getByTestId('account-menu').click()
        await page!
          .getByTestId('account-menu')
          .getByRole('button', { name: 'Open settings' })
          .click()
        const settings = page!.getByRole('dialog', { name: 'Settings' })
        await settings.getByRole('tab', { name: 'Stickers & emoji' }).click()
        const sharing = settings.getByRole('switch', {
          name: 'Show emoji and stickers from every account',
        })
        await sharing.click()
        await expect(sharing).toHaveAttribute('aria-checked', 'false')
        await closeDialog(page!)
        await openEmojiPicker(page!)
        await expect(packButton(page!, sharedImageName)).toHaveCount(0)
        await closeEmojiPicker(page!)

        await page!.getByTestId('account-menu').click()
        await page!
          .getByTestId('account-menu')
          .getByRole('button', { name: 'Open settings' })
          .click()
        await settings.getByRole('tab', { name: 'Stickers & emoji' }).click()
        await sharing.click()
        await expect(sharing).toHaveAttribute('aria-checked', 'true')
        await closeDialog(page!)
        await openEmojiPicker(page!)
        await expect(packButton(page!, sharedImageName)).toBeVisible()
        await closeEmojiPicker(page!)
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        const sessions = page && !page.isClosed() ? await storedSessions(page).catch(() => []) : []
        if (account1Session)
          await setAccountData(account1Session, 'im.ponies.user_emotes', {
            pack: { display_name: 'Personal stickers' },
            images: {},
          })
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
        await context?.close()
      }
      if (!journeyError && cleanupError) journeyError = cleanupError
    }
    if (journeyError) throw journeyError
  })

  test('a pack under a custom (non-empty) state_key is detected and edited in place, not duplicated under ""', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(3 * 60_000)
    const account1 = live.account1!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Named Pack ${runId}`
    const initialStickerName = `named-${runId}`
    const renamedStickerName = `named-renamed-${runId}`
    const secondStickerName = `named-second-${runId}`
    const destinationName = `${live.roomPrefix} Favorite Pack Destination ${runId}`
    const packStateKey = 'Fox'
    const secondPackStateKey = 'Fox 2'

    let context
    let page: Page | undefined
    let roomId: string | undefined
    let destinationRoomId: string | undefined
    let account1Id: string | undefined
    let contentUri: string | undefined
    let favoriteAccountData: Record<string, Record<string, unknown> | undefined> | undefined
    let journeyError: unknown

    try {
      context = await browser.newContext({ baseURL })
      page = await context.newPage()

      await test.step('sign in', async () => {
        await signIn(page!, account1)
        account1Id = (await storedSessions(page!)).at(-1)?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)
      })

      await test.step('create a room', async () => {
        await openRoomActions(page!)
        await page!.getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(roomName)
        await dialog.getByRole('button', { name: 'Create room' }).click()
        await expect(
          page!.getByTestId('room-header').getByRole('heading', {
            name: roomName,
          }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)
      })

      await test.step("seed a pack under a custom state_key via the raw API, bypassing the app's own write path", async () => {
        const session = (await storedSessions(page!)).at(-1)!
        contentUri = await uploadMedia(
          session,
          readFileSync(FAVICON_PATH),
          'favicon.png',
          'image/png',
        )
        await setRoomState(session, roomId!, 'im.ponies.room_emotes', packStateKey, {
          pack: { display_name: 'Fox' },
          images: {
            [initialStickerName]: {
              url: contentUri!,
              info: { mimetype: 'image/png' },
            },
          },
        })
      })

      await test.step('Room settings > Stickers & emoji detects the named pack instead of showing empty', async () => {
        const panel = await openRoomSettings(page!, roomName, 'Stickers & emoji')
        await expect(panel.getByLabel('Sticker name')).toHaveValue(initialStickerName, {
          timeout: 30_000,
        })
        await closeDialog(page!)
      })

      await test.step('add a second pack through the raw API before editing the first pack', async () => {
        const session = (await storedSessions(page!)).at(-1)!
        await setRoomState(session, roomId!, 'im.ponies.room_emotes', secondPackStateKey, {
          pack: { display_name: 'Fox 2' },
          images: {
            [secondStickerName]: {
              url: contentUri!,
              info: { mimetype: 'image/png' },
            },
          },
        })
      })

      await test.step('editing and saving writes back to the same state_key, not a new "" one', async () => {
        const panel = await openRoomSettings(page!, roomName, 'Stickers & emoji')
        await panel.getByLabel('Sticker name').fill(renamedStickerName)
        await saveChanges(page!, panel)
        await closeDialog(page!)

        const session = (await storedSessions(page!)).at(-1)!
        const namedEvent = (await getRoomState(
          session,
          roomId!,
          'im.ponies.room_emotes',
          packStateKey,
        )) as { images?: Record<string, unknown> } | undefined
        expect(Object.keys(namedEvent?.images ?? {})).toEqual([renamedStickerName])

        const emptyKeyEvent = await getRoomState(session, roomId!, 'im.ponies.room_emotes', '')
        expect(emptyKeyEvent).toBeUndefined()
      })

      await test.step('the picker shows both the renamed and second room packs', async () => {
        await openEmojiPicker(page!)
        await expect(packButton(page!, renamedStickerName)).toBeVisible({
          timeout: 30_000,
        })
        await expect(packButton(page!, secondStickerName)).toBeVisible({
          timeout: 30_000,
        })
        await closeEmojiPicker(page!)
      })

      await test.step('favoriting the room exposes all of its packs in another room', async () => {
        const session = (await storedSessions(page!)).at(-1)!
        favoriteAccountData = Object.fromEntries(
          await Promise.all(
            ['m.image_pack.rooms', 'im.ponies.emote_rooms'].map(async (type) => [
              type,
              await getAccountData(session, type),
            ]),
          ),
        )

        const settings = await openAppSettings(page!, 'Stickers & emoji')
        const panel = settings.getByRole('tabpanel', { name: 'Stickers & emoji' })
        await panel.getByRole('combobox').click()
        await page!.getByText(new RegExp(roomName)).last().click()
        await panel.getByRole('button', { name: 'Add pack' }).click()
        await expect(page!.getByText('Favorite pack added').last()).toBeVisible()
        await closeDialog(page!)

        await openRoomActions(page!)
        await page!.getByRole('menu').getByText('Create a room', { exact: true }).click()
        const createDialog = page!.getByRole('dialog', { name: 'Create a room' })
        await createDialog.getByLabel('Account').click()
        await page!.getByText(account1Id!, { exact: true }).last().click()
        await createDialog.getByLabel('Room name').fill(destinationName)
        await createDialog.getByRole('button', { name: 'Create room' }).click()
        await expect(
          page!.getByTestId('room-header').getByRole('heading', { name: destinationName }),
        ).toBeVisible({ timeout: 60_000 })
        destinationRoomId = new URL(page!.url()).searchParams.get('room') ?? undefined

        await openEmojiPicker(page!)
        await expect(packButton(page!, renamedStickerName)).toBeVisible({ timeout: 30_000 })
        await expect(packButton(page!, secondStickerName)).toBeVisible({ timeout: 30_000 })
        await closeEmojiPicker(page!)
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        const sessions: StoredSession[] = []
        if (page && !page.isClosed()) sessions.push(...(await storedSessions(page).catch(() => [])))
        const session = sessions.filter((s) => s.userId === account1Id).at(-1)
        if (session && favoriteAccountData)
          for (const [type, content] of Object.entries(favoriteAccountData))
            await setAccountData(session, type, content ?? {})
        if (destinationRoomId) await cleanTestRoom(destinationRoomId, sessions)
        if (roomId) await cleanTestRoom(roomId, sessions)
        if (account1Id) {
          const current = sessions.filter((s) => s.userId === account1Id).at(-1)
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

  test('Telegram import creates and deletes both personal and room sticker packs', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(12 * 60_000)
    const account1 = live.account1!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Telegram Stickers ${runId}`

    let context
    let page: Page | undefined
    let roomId: string | undefined
    let account1Id: string | undefined
    let session: StoredSession | undefined
    let scratchDir: string | undefined
    let journeyError: unknown
    const telegramRequests: URL[] = []

    try {
      context = await browser.newContext({ baseURL })
      page = await context.newPage()
      const built = await buildStickerZip()
      scratchDir = built.dir
      const zip = readFileSync(built.zipPath)
      await page.route(TELEGRAM_DOWNLOAD_ROUTE, async (route) => {
        telegramRequests.push(new URL(route.request().url()))
        await route.fulfill({
          status: 200,
          contentType: 'application/zip',
          headers: {
            'access-control-allow-origin': '*',
            'content-disposition': `attachment; filename="${TELEGRAM_PACK_NAME}.zip"`,
            'x-sticker-count': String(STICKER_ZIP_ASSETS.length),
          },
          body: zip,
        })
      })

      await test.step('sign in and create a room', async () => {
        await signIn(page!, account1)
        session = (await storedSessions(page!)).at(-1)
        account1Id = session?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)

        await openRoomActions(page!)
        await page!.getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await dialog.getByLabel('Room name').fill(roomName)
        await dialog.getByRole('button', { name: 'Create room' }).click()
        await expect(
          page!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)
      })

      await test.step('import, save, and use a personal Telegram sticker pack', async () => {
        await page!.getByTestId('account-menu').click()
        await page!
          .getByTestId('account-menu')
          .getByRole('button', { name: 'Open settings' })
          .click()
        const settings = page!.getByRole('dialog', { name: 'Settings' })
        await settings.getByRole('tab', { name: 'Stickers & emoji' }).click()
        const panel = settings.getByRole('tabpanel', { name: 'Stickers & emoji' })
        await clearImagePack(page!, panel)
        await importTelegramPack(page!, panel)
        await saveChanges(page!, panel)
        await closeDialog(page!)

        await openEmojiPicker(page!)
        for (const name of ['pfp1', 'pfp2', 'pfp3'])
          await expect(packButton(page!, name)).toBeVisible({ timeout: 30_000 })
        await closeEmojiPicker(page!)
      })

      await test.step('remove the imported personal pack contents after verifying them', async () => {
        await page!.getByTestId('account-menu').click()
        await page!
          .getByTestId('account-menu')
          .getByRole('button', { name: 'Open settings' })
          .click()
        const settings = page!.getByRole('dialog', { name: 'Settings' })
        await settings.getByRole('tab', { name: 'Stickers & emoji' }).click()
        const panel = settings.getByRole('tabpanel', { name: 'Stickers & emoji' })
        await clearImagePack(page!, panel)
        await closeDialog(page!)
        await openEmojiPicker(page!)
        for (const name of ['pfp1', 'pfp2', 'pfp3'])
          await expect(packButton(page!, name)).toHaveCount(0)
        await closeEmojiPicker(page!)
      })

      await test.step('import, save, and use the same Telegram pack as a room pack', async () => {
        const panel = await openRoomSettings(page!, roomName, 'Stickers & emoji')
        await importTelegramPack(page!, panel)
        await saveChanges(page!, panel)
        await closeDialog(page!)

        const reopened = await openRoomSettings(page!, roomName, 'Stickers & emoji')
        await expect(reopened.getByLabel('Pack name')).toHaveValue(TELEGRAM_PACK_NAME)
        await expect(reopened.getByLabel('Sticker name')).toHaveCount(3)
        await closeDialog(page!)
        await openEmojiPicker(page!)
        for (const name of ['pfp1', 'pfp2', 'pfp3'])
          await expect(packButton(page!, name)).toBeVisible({ timeout: 30_000 })
        await closeEmojiPicker(page!)
      })

      await test.step('delete the room pack after verifying it', async () => {
        const panel = await openRoomSettings(page!, roomName, 'Stickers & emoji')
        const packTab = panel.locator('.ant-tabs-tab').filter({ hasText: TELEGRAM_PACK_NAME })
        await packTab.locator('.ant-tabs-tab-remove').click()
        const confirmation = page!.getByRole('dialog', { name: 'Remove this pack?' })
        await confirmation.getByRole('button', { name: 'Remove', exact: true }).click()
        await expect(confirmation).toBeHidden()
        await closeDialog(page!)

        expect(await getRoomState(session!, roomId!, 'im.ponies.room_emotes', '')).toEqual({})
        await openEmojiPicker(page!)
        for (const name of ['pfp1', 'pfp2', 'pfp3'])
          await expect(packButton(page!, name)).toHaveCount(0)
        await closeEmojiPicker(page!)
      })

      expect(telegramRequests).toHaveLength(2)
      for (const request of telegramRequests) {
        expect(request.pathname).toBe('/download')
        expect(request.searchParams.get('url')).toBe(TELEGRAM_PACK_URL)
        expect(request.searchParams.has('uri')).toBe(false)
      }
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        if (scratchDir) rmSync(scratchDir, { recursive: true, force: true })
        if (session)
          await setAccountData(session, 'im.ponies.user_emotes', {
            pack: { display_name: 'Personal stickers' },
            images: {},
          })
        const sessions: StoredSession[] = []
        if (page && !page.isClosed()) sessions.push(...(await storedSessions(page).catch(() => [])))
        if (roomId) await cleanTestRoom(roomId, sessions)
        if (account1Id) {
          const current = sessions.filter((candidate) => candidate.userId === account1Id).at(-1)
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

  test('zip import: every image inside the zip is added as a sticker', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(4 * 60_000)
    const account1 = live.account1!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Zip Stickers ${runId}`

    let context
    let page: Page | undefined
    let roomId: string | undefined
    let account1Id: string | undefined
    let scratchDir: string | undefined
    let journeyError: unknown

    try {
      context = await browser.newContext({ baseURL })
      page = await context.newPage()

      await test.step('sign in', async () => {
        await signIn(page!, account1)
        account1Id = (await storedSessions(page!)).at(-1)?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)
      })

      await test.step('create a room to send stickers into', async () => {
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

      await test.step('import a zip of pfp1/pfp2/pfp3 as stickers', async () => {
        const dialog = await openRoomSettings(page!, roomName, 'Stickers & emoji')
        await clearImagePack(page!, dialog)

        const built = await buildStickerZip()
        scratchDir = built.dir
        const zipInput = dialog.locator('input[type="file"][accept*="zip"]')
        await zipInput.setInputFiles(built.zipPath)

        const names = dialog.getByLabel('Sticker name')
        await expect(names).toHaveCount(3, { timeout: 30_000 })
        const values = await Promise.all((await names.all()).map((entry) => entry.inputValue()))
        expect(new Set(values)).toEqual(new Set(['pfp1', 'pfp2', 'pfp3']))

        await expect(dialog.locator('.packImage img')).toHaveCount(3)
        for (const image of await dialog.locator('.packImage img').all()) {
          await expect(image).toHaveAttribute('src', /.+/, { timeout: 30_000 })
        }

        await saveChanges(page!, dialog)
        await closeDialog(page!)
      })

      await test.step('reopening settings still shows all three imported stickers', async () => {
        const reopened = await openRoomSettings(page!, roomName, 'Stickers & emoji')
        await expect(reopened.getByLabel('Sticker name')).toHaveCount(3, { timeout: 30_000 })
        await closeDialog(page!)
      })

      await test.step('all three imported stickers show in the picker and can be sent', async () => {
        await openEmojiPicker(page!)
        for (const name of STICKER_ZIP_ASSETS.map((asset) => asset.replace(/\.png$/, ''))) {
          const stickerButton = packButton(page!, name)
          await expect(stickerButton).toBeVisible({ timeout: 30_000 })
          await expect(stickerButton.locator('img')).toHaveAttribute('src', /.+/, {
            timeout: 30_000,
          })
        }
        const search = page!.getByRole('searchbox', { name: 'Search emoji and stickers' })
        await search.fill('pfp2')
        await expect(packButton(page!, 'pfp2')).toBeVisible()
        await expect(packButton(page!, 'pfp1')).toHaveCount(0)
        await expect(packButton(page!, 'pfp3')).toHaveCount(0)
        await search.clear()
        await expect(packButton(page!, 'pfp1')).toBeVisible()
        await expect(packButton(page!, 'pfp3')).toBeVisible()
        await packButton(page!, 'pfp2').click()
        await expect(page!.locator('[data-event-id^="$"]').last().locator('img')).toHaveAttribute(
          'src',
          /.+/,
          { timeout: 30_000 },
        )
      })

      await test.step('clean up the imported pack', async () => {
        const dialog = await openRoomSettings(page!, roomName, 'Stickers & emoji')
        await clearImagePack(page!, dialog)
        await closeDialog(page!)
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        if (scratchDir) rmSync(scratchDir, { recursive: true, force: true })
        const sessions: StoredSession[] = []
        if (page && !page.isClosed()) sessions.push(...(await storedSessions(page).catch(() => [])))
        if (roomId) await cleanTestRoom(roomId, sessions)
        if (account1Id) {
          const current = sessions.filter((s) => s.userId === account1Id).at(-1)
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
