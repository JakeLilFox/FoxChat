import { expect, test, type Page } from '@playwright/test'

const HOMESERVER = 'https://register.example'
const USER_ID = '@newfox:register.example'
const DEVICE_ID = 'TESTDEVICE1'
const ACCESS_TOKEN = 'test-access-token'

/**
 * Stubs just enough of a homeserver for the app's own registration/login and initial
 * Matrix client startup (IndexedDB store + rust crypto + one empty /sync) to complete
 * without a real server. Everything not explicitly branched on falls back to an empty
 * 200 - client startup touches several capability/key endpoints this test does not care
 * about the contents of.
 */
async function mockHomeserver(page: Page) {
  await page.route(`${HOMESERVER}/**`, async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (path === '/.well-known/matrix/client') {
      await route.fulfill({ status: 404, body: '{}' })
      return
    }
    if (path === '/_matrix/client/versions') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ versions: ['v1.11'], unstable_features: {} }),
      })
      return
    }
    if (path === '/_matrix/client/v3/register' && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user_id: USER_ID,
          access_token: ACCESS_TOKEN,
          device_id: DEVICE_ID,
          refresh_token: 'test-refresh-token',
          expires_in_ms: 3_600_000,
        }),
      })
      return
    }
    if (path === '/_matrix/client/v3/login' && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user_id: USER_ID,
          access_token: ACCESS_TOKEN,
          device_id: DEVICE_ID,
          refresh_token: 'test-refresh-token',
          expires_in_ms: 3_600_000,
        }),
      })
      return
    }
    if (path === '/_matrix/client/v3/sync') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          next_batch: 's_1',
          rooms: { join: {}, invite: {}, leave: {} },
          account_data: { events: [] },
          presence: { events: [] },
          to_device: { events: [] },
          device_lists: {},
        }),
      })
      return
    }
    if (path.startsWith('/_matrix/client/v3/pushrules')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ global: {} }),
      })
      return
    }
    if (path === '/_matrix/client/v3/capabilities') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ capabilities: {} }),
      })
      return
    }
    if (path === '/_matrix/client/v3/keys/upload' && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ one_time_key_counts: {} }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

test('the welcome dialog appears after registering a new account', async ({ page }) => {
  await mockHomeserver(page)
  await page.goto('/')
  await expect(page.getByTestId('login-page')).toBeVisible()

  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Homeserver').fill(HOMESERVER)
  await page.getByLabel('Username', { exact: true }).fill('newfox')
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')
  await page.getByLabel('Confirm password').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()

  const welcome = page.getByRole('dialog', { name: 'Welcome to Matrix' })
  await expect(welcome).toBeVisible({ timeout: 30_000 })
  await expect(welcome).toContainText('end-to-end encrypted')
  await expect(welcome).toContainText('automatically trusted')
  await expect(welcome).toContainText('Settings')

  await welcome.getByRole('button', { name: 'Skip for now' }).click()
  await expect(welcome).toBeHidden()
})

test('the welcome dialog does not appear when signing in to an existing account', async ({
  page,
}) => {
  await mockHomeserver(page)
  await page.goto('/')
  await expect(page.getByTestId('login-page')).toBeVisible()

  await page.getByLabel('Homeserver').fill(HOMESERVER)
  await page.getByLabel('Matrix ID or username').fill(USER_ID)
  await page.getByLabel('Password').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByTestId('room-sidebar').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('dialog', { name: 'Welcome to Matrix' })).toBeHidden()
})

test('the welcome dialog does not reappear on a later reload of the same session', async ({
  page,
}) => {
  await mockHomeserver(page)
  await page.goto('/')
  await expect(page.getByTestId('login-page')).toBeVisible()

  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Homeserver').fill(HOMESERVER)
  await page.getByLabel('Username', { exact: true }).fill('newfox')
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')
  await page.getByLabel('Confirm password').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()

  const welcome = page.getByRole('dialog', { name: 'Welcome to Matrix' })
  await expect(welcome).toBeVisible({ timeout: 30_000 })
  await welcome.getByRole('button', { name: 'Skip for now' }).click()
  await expect(welcome).toBeHidden()

  await page.reload()
  await expect(page.getByTestId('room-sidebar').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('dialog', { name: 'Welcome to Matrix' })).toBeHidden()
})
