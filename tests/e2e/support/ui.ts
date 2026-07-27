import { expect, type Locator, type Page } from '@playwright/test'
import type { MatrixTestAccount } from './env'

async function submitMatrixLogin(
  page: Page,
  button: Locator,
  password: Locator,
  passwordValue: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await password.fill(passwordValue)
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/login'),
      { timeout: 90_000 },
    )
    await button.click()
    const response = await responsePromise
    if (response.ok()) return
    const failure = (await response.json().catch(() => ({}))) as {
      errcode?: string
      error?: string
      retry_after_ms?: number
    }
    await password.fill('').catch(() => undefined)
    if (
      response.status() === 429 &&
      attempt < 2 &&
      typeof failure.retry_after_ms === 'number' &&
      failure.retry_after_ms <= 120_000
    ) {
      await page.waitForTimeout(failure.retry_after_ms + 250)
      await expect(button).toBeEnabled({ timeout: 30_000 })
      continue
    }
    throw new Error(
      `Matrix login returned ${response.status()}${
        failure.errcode ? ` ${failure.errcode}` : ''
      }${failure.error ? `: ${failure.error}` : ''}`,
    )
  }
}

export async function signIn(page: Page, account: MatrixTestAccount) {
  await page.goto('/')
  await expect(page.getByTestId('login-page')).toBeVisible()
  await page.getByLabel('Homeserver').fill(account.homeserver)
  await page.getByLabel('Matrix ID or username').fill(account.userId)
  const password = page.getByLabel('Password')
  await submitMatrixLogin(
    page,
    page.getByRole('button', { name: 'Sign in' }),
    password,
    account.password,
  )
  await expect(page.getByTestId('room-sidebar').first()).toBeVisible({
    timeout: 90_000,
  })
}

export async function addAccount(page: Page, account: MatrixTestAccount) {
  await page.getByTestId('account-menu').click()
  await page.getByText('Switch accounts', { exact: true }).click()
  const accounts = page.getByRole('dialog', { name: 'Accounts' })
  await expect(accounts).toBeVisible()
  await accounts.getByRole('button', { name: 'Log in with another account' }).click()
  await accounts.getByLabel('Homeserver').fill(account.homeserver)
  await accounts.getByLabel('Matrix ID or username').fill(account.userId)
  const password = accounts.getByLabel('Password')
  await submitMatrixLogin(
    page,
    accounts.getByRole('button', { name: 'Log in and save account' }),
    password,
    account.password,
  )

  await expect(accounts).toBeHidden({ timeout: 90_000 })
  await expect(page.getByTestId('room-sidebar').first()).toBeVisible({
    timeout: 90_000,
  })
}

export async function openRoomActions(page: Page) {
  await page.getByRole('button', { name: 'Room actions' }).first().click()
}

export async function sendMessage(page: Page, body: string) {
  const composer = page.getByTestId('message-composer')
  await expect(composer).toBeEditable()
  await composer.fill(body)
  const responsePromise = page.waitForResponse(
    (response) => {
      if (!response.ok() || response.request().method() !== 'PUT') return false
      const path = new URL(response.url()).pathname
      return /\/send\/m\.room\.(?:message|encrypted)\//.test(path)
    },
    { timeout: 90_000 },
  )
  await page.getByRole('button', { name: 'Send message' }).click()
  const response = await responsePromise
  const result = (await response.json()) as { event_id?: string }
  expect(result.event_id).toMatch(/^\$/)
  return result.event_id!
}

export function scrollBottomDistance(page: Page): Promise<number> {
  return page
    .getByTestId('timeline')
    .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
}

export async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1)
}

export async function closeDialog(page: Page) {
  await page.getByRole('dialog').locator('.ant-modal-close').last().click()
}

export async function openRoomRow(page: Page, name: string) {
  const back = page.getByRole('button', { name: 'arrow-left' })
  if (await back.isVisible()) await back.click()
  const row = page.getByTestId('room-row').filter({ hasText: name })

  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
}

export async function openRoomSettings(page: Page, name: string, tab: string) {
  const back = page.getByRole('button', { name: 'arrow-left' })
  if (await back.isVisible()) await back.click()
  const row = page.getByTestId('room-row').filter({ hasText: name })
  await expect(row).toBeVisible({ timeout: 30_000 })
  const menuItem = page.getByRole('menuitem', { name: /settings$/ })

  for (let attempt = 0; attempt < 5; attempt++) {
    await row.click({ button: 'right' }).catch(() => undefined)
    if (await menuItem.isVisible().catch(() => false)) break
    await page.waitForTimeout(500)
  }
  await expect(menuItem).toBeVisible({ timeout: 10_000 })

  await menuItem.dispatchEvent('click')
  const dialog = page.getByRole('dialog', { name: /settings$/ })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: tab }).click()
  return dialog.getByRole('tabpanel', { name: tab })
}

export async function openCurrentRoomSettings(page: Page, tab: string) {
  const detailsTitle = page.getByText(/^(Channel|Space) details$/)
  if (!(await detailsTitle.isVisible()))
    await page.getByRole('button', { name: 'Room information' }).click()
  await expect(detailsTitle).toBeVisible()
  await page.getByRole('button', { name: 'setting', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /settings$/ })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: tab }).click()
  return dialog.getByRole('tabpanel', { name: tab })
}

export async function openChannelInSpace(page: Page, spaceName: string, channelName: string) {
  await openRoomRow(page, spaceName)
  const channelRow = page.getByTestId('room-sidebar').getByText(channelName).first()
  await expect(channelRow).toBeVisible({ timeout: 30_000 })
  await channelRow.click()
}

export async function openAppSettings(page: Page, tab: string) {
  await page
    .getByTestId('account-menu')
    .getByRole('button', { name: 'Open settings', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: tab }).click()
  return dialog
}

export async function setAutoReadAllAccounts(page: Page, enabled: boolean) {
  const dialog = await openAppSettings(page, 'Push notifications')
  const toggle = dialog.getByRole('switch', { name: 'Read rooms with every account' })
  if ((await toggle.getAttribute('aria-checked')) !== String(enabled)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', String(enabled))
  await closeDialog(page)
}
