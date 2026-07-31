import { expect, test, type Locator, type Page } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import { storedSessions, wipeAllDevices } from './support/matrix-api'
import { addAccount, signIn } from './support/ui'

const live = liveMatrixConfig()

const openSecurityTab = async (page: Page) => {
  const settings = page.getByRole('dialog', { name: 'Settings' })
  const openSettings = page
    .getByTestId('account-menu')
    .getByRole('button', { name: 'Open settings', exact: true })

  await expect(async () => {
    if (!(await settings.isVisible())) await openSettings.click({ timeout: 2_000 })
    await expect(settings).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  await settings.getByRole('tab', { name: 'Security' }).click()
  return settings
}

const closeSettings = async (page: Page) => {
  const settings = page.getByRole('dialog', { name: 'Settings' })
  if (!(await settings.isVisible())) return
  await settings.locator('.ant-modal-close').click()
  await expect(settings).toBeHidden()
}

const verificationDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Verify another device' })

const sasEmojiLabels = (dialog: Locator) => dialog.locator('small')

const expectDeviceVerified = async (settings: Locator, deviceId: string) => {
  const row = settings.locator('.ant-list-item').filter({ hasText: deviceId })
  await expect(row).toBeVisible({ timeout: 30_000 })

  await expect(
    row.locator('.ant-list-item-meta-title').getByText('Verified', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 })
}

test.describe('live device verification journey', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled, live.reason)

  test('a fresh device is verified interactively by a recovery-key-unlocked device of the same account', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(4 * 60_000)
    const account = live.account1!
    test.skip(!account.recoveryKey, 'Account 1 has no recovery key configured')

    let verifiedContext
    let newContext
    let verifiedPage: Page | undefined
    let newPage: Page | undefined
    let journeyError: unknown

    try {
      await test.step('wipe every pre-existing device for this account', async () => {
        await wipeAllDevices(browser, account)
      })

      verifiedContext = await browser.newContext({ baseURL })
      newContext = await browser.newContext({ baseURL })
      verifiedPage = await verifiedContext.newPage()
      newPage = await newContext.newPage()

      await test.step('device A signs in and unlocks secret storage with the recovery key', async () => {
        await signIn(verifiedPage!, account)
        const settings = await openSecurityTab(verifiedPage!)
        await settings.getByRole('button', { name: 'Restore encrypted history' }).click()
        const restore = verifiedPage!.getByRole('dialog', {
          name: 'Restore encrypted history',
        })
        await restore.getByRole('textbox').fill(account.recoveryKey!)
        await restore.getByRole('button', { name: 'Restore keys' }).click()
        await expect(verifiedPage!.getByText('Encrypted history recovery enabled')).toBeVisible({
          timeout: 90_000,
        })
        await closeSettings(verifiedPage!)
      })

      let newDeviceId: string | undefined
      await test.step('device B signs in as a fresh, unverified device of the same account', async () => {
        await signIn(newPage!, account)
        newDeviceId = (await storedSessions(newPage!)).at(-1)?.deviceId
        expect(newDeviceId).toBeTruthy()
      })

      await test.step('device B requests interactive verification from another device', async () => {
        const settings = await openSecurityTab(newPage!)
        await settings.getByRole('button', { name: 'Verify with another device' }).click()
        await expect(verificationDialog(newPage!)).toBeVisible({
          timeout: 30_000,
        })
      })

      await test.step('device A receives the request and must be explicitly accepted - it must not auto-accept or auto-complete', async () => {
        const dialog = verificationDialog(verifiedPage!)
        await expect(dialog).toBeVisible({ timeout: 30_000 })

        await expect(
          dialog.getByRole('button', { name: 'Accept verification request' }),
        ).toBeVisible()
        await expect(sasEmojiLabels(dialog)).toHaveCount(0)
        await expect(
          dialog.getByText('Device verification completed.', { exact: true }),
        ).toBeHidden()
        await dialog.getByRole('button', { name: 'Accept verification request' }).click()
      })

      await test.step('both sides display the same SAS emoji sequence for the human to compare', async () => {
        const verifiedDialog = verificationDialog(verifiedPage!)
        const newDialog = verificationDialog(newPage!)
        const verifiedEmoji = sasEmojiLabels(verifiedDialog)
        const newEmoji = sasEmojiLabels(newDialog)
        await expect(verifiedEmoji.first()).toBeVisible({ timeout: 30_000 })
        await expect(newEmoji.first()).toBeVisible({ timeout: 30_000 })
        await expect(verifiedEmoji).toHaveCount(7)
        await expect(newEmoji).toHaveCount(7)
        expect(await verifiedEmoji.allTextContents()).toEqual(await newEmoji.allTextContents())
      })

      await test.step('confirming the match on both sides completes verification on both', async () => {
        const verifiedDialog = verificationDialog(verifiedPage!)
        const newDialog = verificationDialog(newPage!)
        await verifiedDialog.getByRole('button', { name: 'They match' }).click()
        await newDialog.getByRole('button', { name: 'They match' }).click()
        await expect(
          verifiedDialog.getByText('Device verification completed.', {
            exact: true,
          }),
        ).toBeVisible({ timeout: 30_000 })
        await expect(
          newDialog.getByText('Device verification completed.', {
            exact: true,
          }),
        ).toBeVisible({ timeout: 30_000 })
        await verifiedDialog.getByRole('button', { name: 'Done' }).click()
        await newDialog.getByRole('button', { name: 'Done' }).click()
        await expect(verifiedDialog).toBeHidden()
        await expect(newDialog).toBeHidden()
      })

      await test.step("device B now shows as verified in device A's device list", async () => {
        const settings = await openSecurityTab(verifiedPage!)
        await settings.getByRole('tab', { name: /^Devices/ }).click()
        await expectDeviceVerified(settings, newDeviceId!)
        const row = settings.locator('.ant-list-item').filter({ hasText: newDeviceId! })
        await expect(row.getByRole('button', { name: 'Verified' })).toBeDisabled()
      })

      await test.step('the trust survives a reload on both sides - the signature was actually persisted, not just held in memory', async () => {
        await verifiedPage!.reload()
        await expect(verifiedPage!.getByTestId('room-sidebar').first()).toBeVisible({
          timeout: 90_000,
        })
        const verifiedSettings = await openSecurityTab(verifiedPage!)
        await verifiedSettings.getByRole('tab', { name: /^Devices/ }).click()
        await expectDeviceVerified(verifiedSettings, newDeviceId!)

        await newPage!.reload()
        await expect(newPage!.getByTestId('room-sidebar').first()).toBeVisible({ timeout: 90_000 })
        const newSettings = await openSecurityTab(newPage!)
        await newSettings.getByRole('tab', { name: /^Devices/ }).click()

        await expectDeviceVerified(newSettings, newDeviceId!)
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        await wipeAllDevices(browser, account)
      } catch (error) {
        cleanupError = error
      } finally {
        await verifiedContext?.close()
        await newContext?.close()
      }
      if (!journeyError && cleanupError) journeyError = cleanupError
    }
    if (journeyError) throw journeyError
  })

  test('the incoming verification popup still appears and completes correctly while a different account is active in combined mode', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(4 * 60_000)
    const account = live.account1!
    const otherAccount = live.account3!
    test.skip(!account.recoveryKey, 'Account 1 has no recovery key configured')

    let combinedContext
    let newContext
    let combinedPage: Page | undefined
    let newPage: Page | undefined
    let journeyError: unknown

    try {
      await test.step('wipe every pre-existing device for both accounts', async () => {
        await wipeAllDevices(browser, account)
        await wipeAllDevices(browser, otherAccount)
      })

      combinedContext = await browser.newContext({ baseURL })
      newContext = await browser.newContext({ baseURL })
      combinedPage = await combinedContext.newPage()
      newPage = await newContext.newPage()

      await test.step('device A signs in as account 1, unlocks it with the recovery key, then adds and switches to account 3 - backgrounding account 1', async () => {
        await signIn(combinedPage!, account)
        const settings = await openSecurityTab(combinedPage!)
        await settings.getByRole('button', { name: 'Restore encrypted history' }).click()
        const restore = combinedPage!.getByRole('dialog', {
          name: 'Restore encrypted history',
        })
        await restore.getByRole('textbox').fill(account.recoveryKey!)
        await restore.getByRole('button', { name: 'Restore keys' }).click()
        await expect(combinedPage!.getByText('Encrypted history recovery enabled')).toBeVisible({
          timeout: 90_000,
        })
        await closeSettings(combinedPage!)

        await addAccount(combinedPage!, otherAccount)

        await combinedPage!.getByTestId('account-menu').click()
        await combinedPage!.getByText('Switch accounts', { exact: true }).click()
        const accounts = combinedPage!.getByRole('dialog', { name: 'Accounts' })
        await expect(accounts).toBeVisible()
        const otherRow = accounts.locator('.ant-list-item').filter({ hasText: otherAccount.userId })
        if (!(await otherRow.getByRole('button', { name: 'Current' }).isVisible())) {
          await otherRow.getByRole('button', { name: 'Switch' }).click()

          await expect(combinedPage!.getByTestId('room-sidebar').first()).toBeVisible({
            timeout: 90_000,
          })
          await combinedPage!.getByTestId('account-menu').click()
          await combinedPage!.getByText('Switch accounts', { exact: true }).click()
          await expect(otherRow.getByRole('button', { name: 'Current' })).toBeVisible()
        }
        await accounts.getByRole('button', { name: 'Close' }).click()
      })

      let newDeviceId: string | undefined
      await test.step('device B signs in as a fresh, unverified device of account 1', async () => {
        await signIn(newPage!, account)
        newDeviceId = (await storedSessions(newPage!)).at(-1)?.deviceId
        expect(newDeviceId).toBeTruthy()
      })

      await test.step('device B requests interactive verification of account 1', async () => {
        const settings = await openSecurityTab(newPage!)
        await settings.getByRole('button', { name: 'Verify with another device' }).click()
        await expect(verificationDialog(newPage!)).toBeVisible({
          timeout: 30_000,
        })
      })

      await test.step("device A still shows the popup for account 1's request, even with account 3 active in the room list", async () => {
        const dialog = verificationDialog(combinedPage!)
        await expect(dialog).toBeVisible({ timeout: 30_000 })
        await expect(
          dialog.getByRole('button', { name: 'Accept verification request' }),
        ).toBeVisible()
        await dialog.getByRole('button', { name: 'Accept verification request' }).click()
      })

      await test.step('both sides display the same SAS emoji sequence and complete', async () => {
        const combinedDialog = verificationDialog(combinedPage!)
        const newDialog = verificationDialog(newPage!)
        const combinedEmoji = sasEmojiLabels(combinedDialog)
        const newEmoji = sasEmojiLabels(newDialog)
        await expect(combinedEmoji.first()).toBeVisible({ timeout: 30_000 })
        await expect(newEmoji.first()).toBeVisible({ timeout: 30_000 })
        expect(await combinedEmoji.allTextContents()).toEqual(await newEmoji.allTextContents())
        await combinedDialog.getByRole('button', { name: 'They match' }).click()
        await newDialog.getByRole('button', { name: 'They match' }).click()
        await expect(
          combinedDialog.getByText('Device verification completed.', {
            exact: true,
          }),
        ).toBeVisible({ timeout: 30_000 })
        await expect(
          newDialog.getByText('Device verification completed.', {
            exact: true,
          }),
        ).toBeVisible({ timeout: 30_000 })
        await combinedDialog.getByRole('button', { name: 'Done' }).click()
        await newDialog.getByRole('button', { name: 'Done' }).click()
        await expect(combinedDialog).toBeHidden()
        await expect(newDialog).toBeHidden()
      })

      await test.step("device B sees itself as verified - account 1's real trust state, unaffected by account 3 being active", async () => {
        const newSettings = await openSecurityTab(newPage!)
        await newSettings.getByRole('tab', { name: /^Devices/ }).click()
        await expectDeviceVerified(newSettings, newDeviceId!)
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        await wipeAllDevices(browser, account)
        await wipeAllDevices(browser, otherAccount)
      } catch (error) {
        cleanupError = error
      } finally {
        await combinedContext?.close()
        await newContext?.close()
      }
      if (!journeyError && cleanupError) journeyError = cleanupError
    }
    if (journeyError) throw journeyError
  })
})
