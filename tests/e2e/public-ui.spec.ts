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

test('a new account can be configured from the login screen and requires matching passwords', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Create an account' }).click()

  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await expect(page.getByLabel('Homeserver')).toBeEditable()
  await expect(page.getByLabel('Username', { exact: true })).toBeEditable()
  await expect(page.getByLabel('Display name (optional)')).toBeEditable()
  await expect(page.getByLabel('Confirm password')).toBeEditable()

  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')
  await page.getByLabel('Confirm password').fill('different password')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByText('The passwords do not match.')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: 'Back to sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
})

test('registration follows the homeserver token and terms challenges', async ({ page }) => {
  const registrationBodies: Array<Record<string, unknown>> = []
  await page.route('https://register.example/.well-known/matrix/client', (route) =>
    route.fulfill({ status: 404, body: '{}' }),
  )
  await page.route('https://register.example/_matrix/client/v3/register', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    registrationBodies.push(body)
    const auth = body.auth as Record<string, unknown> | undefined
    if (auth?.type === 'm.login.registration_token') {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          session: 'register-session',
          completed: ['m.login.registration_token'],
          flows: [{ stages: ['m.login.registration_token', 'm.login.terms'] }],
          params: {
            'm.login.terms': {
              policies: {
                privacy: {
                  version: '1.0',
                  en: { name: 'Privacy policy', url: 'https://register.example/privacy' },
                },
              },
            },
          },
        }),
      })
      return
    }
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        session: 'register-session',
        flows: [{ stages: ['m.login.registration_token', 'm.login.terms'] }],
      }),
    })
  })

  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Homeserver').fill('https://register.example')
  await page.getByLabel('Username', { exact: true }).fill('newfox')
  await page.getByLabel('Display name (optional)').fill('New Fox')
  await page.getByLabel('Password', { exact: true }).fill('registration-password')
  await page.getByLabel('Confirm password').fill('registration-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()

  await expect(page.getByTestId('registration-challenge')).toBeVisible()
  await page.getByLabel('Registration token').fill('invite-token')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
    'href',
    'https://register.example/privacy',
  )
  expect(registrationBodies).toHaveLength(2)
  expect(registrationBodies[0]).toMatchObject({
    username: 'newfox',
    password: 'registration-password',
    initial_device_display_name: 'FoxChat',
    refresh_token: true,
  })
  expect(registrationBodies[1].auth).toEqual({
    type: 'm.login.registration_token',
    token: 'invite-token',
    session: 'register-session',
  })
})
