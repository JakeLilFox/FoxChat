import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow } from './support/ui'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('login-page')).toBeVisible()
})

test('login layout stays inside the viewport and exposes usable controls', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.getByTestId('login-page')).toContainText('FoxChat')
  await expect(page.getByLabel('Homeserver')).toBeEditable()
  await expect(page.getByLabel('Matrix ID or username')).toBeEditable()
  await expect(page.getByLabel('Password')).toBeEditable()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()

  const login = await page.getByTestId('login-page').boundingBox()
  expect(login).not.toBeNull()
  expect(login!.x).toBeGreaterThanOrEqual(0)
  expect(login!.y).toBeGreaterThanOrEqual(0)
  expect(login!.x + login!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  expect(login!.y + login!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
  await expectNoHorizontalOverflow(page)
})

test('required login validation keeps focusable errors on screen', async ({ page }) => {
  await page.getByLabel('Homeserver').fill('')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.ant-form-item-has-error')).toHaveCount(3)
  await expect(page.getByTestId('login-page')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('password visibility can be toggled without changing its value', async ({ page }) => {
  const password = page.getByLabel('Password')
  await password.fill('not-a-real-password')
  await expect(password).toHaveAttribute('type', 'password')
  await page.locator('.ant-input-password-icon').click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(password).toHaveValue('not-a-real-password')
})

test('login values survive responsive layout changes', async ({ page }) => {
  const homeserver = page.getByLabel('Homeserver')
  const username = page.getByLabel('Matrix ID or username')
  const password = page.getByLabel('Password')

  await homeserver.fill('https://example.org')
  await username.fill('@fox:example.org')
  await password.fill('temporary test value')
  await page.setViewportSize({ width: 320, height: 568 })

  await expect(homeserver).toHaveValue('https://example.org')
  await expect(username).toHaveValue('@fox:example.org')
  await expect(password).toHaveValue('temporary test value')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(username).toHaveValue('@fox:example.org')
  await expectNoHorizontalOverflow(page)
})

test('the Enter key submits through the same required-field validation', async ({ page }) => {
  await page.getByLabel('Homeserver').fill('https://example.org')
  await page.getByLabel('Matrix ID or username').focus()
  await page.keyboard.press('Enter')

  await expect(page.locator('.ant-form-item-has-error')).toHaveCount(2)
  await expect(page.getByTestId('login-page')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('the remembered homeserver is restored after a reload', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('foxchat.matrix.lastHomeserver', 'https://remembered.example.org')
  })
  await page.reload()

  await expect(page.getByLabel('Homeserver')).toHaveValue('https://remembered.example.org')
  await expect(page.getByLabel('Matrix ID or username')).toHaveValue('')
  await expect(page.getByLabel('Password')).toHaveValue('')
})
