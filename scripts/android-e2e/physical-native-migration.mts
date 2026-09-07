#!/usr/bin/env node

import { chromium, type Page } from '@playwright/test'
import { config as loadDotenv } from 'dotenv'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { matrixTestAccount } from '../../tests/e2e/support/env'

loadDotenv({ path: resolve('test.env'), override: false, quiet: true })

const outputDir = resolve('.android-e2e-user', 'physical-native-migration')
mkdirSync(outputDir, { recursive: true })

const account = (() => {
  const configured = matrixTestAccount(1)
  if (!configured?.recoveryKey)
    throw new Error('Test account 1 and its recovery key must be configured in test.env')
  return { ...configured, recoveryKey: configured.recoveryKey }
})()

const cdpEndpoint = process.env.ANDROID_E2E_CDP_ENDPOINT || 'http://127.0.0.1:9222'

type NativeAccountStatus = {
  userId?: string
  state?: string
  runtimeActive?: boolean
  syncState?: string | null
  retryAvailable?: boolean
  error?: string | null
}

type NativeStatus = {
  available?: boolean
  owner?: string
  accounts?: NativeAccountStatus[]
}

const delay = (milliseconds: number) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

async function visibleError(page: Page) {
  return page
    .locator('.ant-message-error:visible,.ant-message-notice-error:visible')
    .last()
    .textContent()
    .then((value) => value?.trim() || '')
    .catch(() => '')
}

async function captureWebView(page: Page, name: string) {
  await page
    .screenshot({ path: resolve(outputDir, name), timeout: 5_000 })
    .catch((error) =>
      console.warn(
        `WebView screenshot ${name} was unavailable: ${error instanceof Error ? error.message : String(error)}`,
      ),
    )
}

async function nativeStatus(page: Page): Promise<NativeStatus> {
  return page.evaluate(async () => {
    const invoke = (
      window as typeof window & {
        __TAURI_INTERNALS__?: {
          invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>
        }
      }
    ).__TAURI_INTERNALS__?.invoke
    if (!invoke) throw new Error('Tauri invoke is unavailable in the Android WebView')
    return (await invoke('plugin:remote-push|native_matrix', {
      action: 'status',
      payload: '{}',
    })) as NativeStatus
  })
}

async function waitForLogin(page: Page) {
  const hasStoredAccount = () =>
    page.evaluate((userId) => {
      try {
        const accounts = JSON.parse(localStorage.getItem('foxchat.matrix.accounts') ?? '[]') as Array<{
          userId?: string
        }>
        return accounts.some((entry) => entry.userId === userId)
      } catch {
        return false
      }
    }, account.userId)

  if (!(await hasStoredAccount())) {
    await page.getByTestId('login-page').waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByLabel('Homeserver').fill(account.homeserver)
    await page.getByLabel('Matrix ID or username').fill(account.userId)
    await page.getByLabel('Password').fill(account.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (await hasStoredAccount()) return
    const error = await visibleError(page)
    if (error) throw new Error(`Android login failed: ${error}`)
    await delay(500)
  }
  throw new Error(`Android login did not finish. Visible UI: ${(await page.locator('body').innerText()).slice(0, 1000)}`)
}

async function restoreRecovery(page: Page) {
  const restore = page.getByRole('dialog', { name: 'Restore encrypted history' })
  if (!(await restore.isVisible().catch(() => false))) {
    await page.evaluate(() => window.dispatchEvent(new Event('foxchat-open-drawer')))
    await page.getByTestId('account-menu').filter({ visible: true }).first().waitFor({
      state: 'visible',
      // Login replaces the auth route with the app shell. Android WebView may briefly expose an
      // empty transition document while the initial room list is rendered, especially on a
      // first install with a large disposable test account.
      timeout: 90_000,
    })
    await page
      .locator('button[aria-label="Open settings"]:visible')
      .first()
      .evaluate((element) => (element as HTMLElement).click())
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.waitFor({ state: 'visible', timeout: 15_000 })
    const securityTab = settings.getByRole('tab', { name: 'Security' })
    await securityTab.evaluate((element) => (element as HTMLElement).click())
    if ((await securityTab.getAttribute('aria-selected')) !== 'true')
      throw new Error('Security settings tab did not become selected')
    await settings
      .getByRole('button', { name: 'Restore encrypted history' })
      .evaluate((element) => (element as HTMLElement).click())
    await restore.waitFor({ state: 'visible', timeout: 15_000 })
  }
  await restore.locator('input[type="password"]').fill(account.recoveryKey!)

  await page.evaluate(() => {
    const state = window as typeof window & { __physicalRecoveryProgress?: string[] }
    state.__physicalRecoveryProgress = []
    window.addEventListener('foxchat-recovery-progress', ((event: CustomEvent) => {
      state.__physicalRecoveryProgress?.push(String(event.detail))
    }) as EventListener)
  })
  await restore
    .getByRole('button', { name: 'Restore keys' })
    .evaluate((element) => (element as HTMLElement).click())

  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    const progress = await page.evaluate(
      () =>
        (window as typeof window & { __physicalRecoveryProgress?: string[] })
          .__physicalRecoveryProgress ?? [],
    )
    const status = await nativeStatus(page).catch(() => undefined)
    const nativeAccount = status?.accounts?.find((entry) => entry.userId === account.userId)
    if (nativeAccount?.state === 'ready') {
      // A successful adoption reloads the WebView. That can destroy the page-local recovery
      // progress listener before it sees recovery-enabled even though the durable native
      // transaction has already committed READY.
      return [...progress, 'native-ready']
    }
    if (
      progress.includes('recovery-enabled') ||
      progress.some((entry) => entry.startsWith('restore-complete:'))
    ) {
      await restore.waitFor({ state: 'hidden', timeout: 30_000 })
      return progress
    }
    const error = await visibleError(page)
    if (error) throw new Error(`Recovery-key restore failed: ${error}`)
    await delay(500)
  }
  throw new Error('Recovery-key restore did not finish within five minutes')
}

async function waitForNativeMigration(page: Page) {
  const deadline = Date.now() + 300_000
  let latest: NativeStatus = {}
  while (Date.now() < deadline) {
    try {
      latest = await nativeStatus(page)
      const nativeAccount = latest.accounts?.find((entry) => entry.userId === account.userId)
      if (nativeAccount?.state === 'error')
        throw new Error(`Native migration entered ERROR: ${nativeAccount.error || 'no detail'}`)
      if (
        nativeAccount?.state === 'ready' &&
        nativeAccount.runtimeActive === true &&
        nativeAccount.syncState === 'running'
      )
        return latest
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Native migration entered ERROR'))
        throw error
    }
    await delay(2_000)
  }
  throw new Error(`Native migration did not reach ready/running: ${JSON.stringify(latest)}`)
}

const browser = await chromium.connectOverCDP(cdpEndpoint)
try {
  const page = browser.contexts().flatMap((context) => context.pages())[0]
  if (!page) throw new Error('No debuggable Android WebView page was found')

  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })

  console.log('Physical phone: logging the disposable account into the isolated .e2e app')
  await waitForLogin(page)
  await captureWebView(page, '01-legacy-login.png')

  const beforeRecovery = await nativeStatus(page).catch(() => undefined)
  const alreadyReady = beforeRecovery?.accounts?.some(
    (entry) => entry.userId === account.userId && entry.state === 'ready',
  )
  console.log('Physical phone: restoring encrypted-history access')
  const recoveryProgress = alreadyReady ? ['native-ready'] : await restoreRecovery(page)
  console.log(`Recovery progress: ${recoveryProgress.join(', ')}`)

  console.log('Physical phone: waiting for native Rust ownership and live sync')
  const status = await waitForNativeMigration(page)
  await captureWebView(page, '02-native-ready.png')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => (document.body.innerText || '').includes('Matrix client'),
    undefined,
    { timeout: 90_000 },
  )
  // On a narrow physical phone the account menu is intentionally mounted inside the drawer.
  // A page reload closes that drawer, so expose the same layer a user would open before asserting
  // that the authenticated app shell is usable.
  await page.evaluate(() => window.dispatchEvent(new Event('foxchat-open-drawer')))
  await page.getByTestId('account-menu').first().waitFor({ state: 'visible', timeout: 90_000 })
  const body = await page.locator('body').innerText()
  if (body.includes('Decrypting and synchronizing your rooms'))
    throw new Error('The app returned to the infinite decrypting/synchronizing screen after reload')
  await captureWebView(page, '03-after-webview-reload.png')

  const testAccountStatus = status.accounts?.find((entry) => entry.userId === account.userId)
  console.log(`Native migration status: ${JSON.stringify(testAccountStatus)}`)
  console.log(`Captured browser errors: ${JSON.stringify(browserErrors)}`)
  console.log('Physical native-migration test passed')
} finally {
  await browser.close()
}
