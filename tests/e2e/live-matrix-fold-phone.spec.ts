import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import { cleanTestRoom, storedSessions, type StoredSession } from './support/matrix-api'
import { retryMutatingRequest } from './support/retry'
import { expectNoHorizontalOverflow, openRoomActions, signIn } from './support/ui'
import { MOBILE_LAYOUT_BREAKPOINT } from '../../src/lib/responsiveLayout'

const live = liveMatrixConfig()

// A book-style foldable's cover display (folded) vs. its inner display (unfolded), e.g. a
// Galaxy Fold/Pixel Fold class device. Landscape-folded exercises the height-based Android
// check on its own: width alone would read as roomy, only the short side gives it away.
const FOLDED = { width: 344, height: 882 }
const FOLDED_LANDSCAPE = { width: 882, height: 344 }
const UNFOLDED = { width: 884, height: 1104 }

const ANDROID_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel Fold) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/125.0.0.0 Mobile Safari/537.36'

async function captureLayout(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

test.describe('foldable phone layout', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled, live.reason)

  test('the room drawer switches between the drawer and a persistent sidebar across a fold', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(3 * 60_000)
    const account = live.account1!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Fold ${runId}`

    let context: BrowserContext | undefined
    let page: Page | undefined
    let roomId: string | undefined
    let sessions: StoredSession[] = []
    let journeyError: unknown

    try {
      context = await browser.newContext({
        baseURL,
        viewport: UNFOLDED,
        userAgent: ANDROID_USER_AGENT,
        isMobile: true,
        hasTouch: true,
      })
      // Some Android WebViews can update CSS media queries before the JS MediaQueryList used by
      // React catches up. The final step deliberately freezes the JS layout decision as wide while
      // crossing the CSS breakpoint, reproducing the old empty/transparent sidebar column.
      await context.addInitScript(() => {
        const originalMatchMedia = window.matchMedia.bind(window)
        const responsiveQueries = new Set(['(max-width: 760px)', '(max-height: 760px)'])
        const testWindow = window as typeof window & { __foxchatE2EForceWideLayout?: boolean }
        testWindow.__foxchatE2EForceWideLayout = false
        window.matchMedia = ((query: string) => {
          const media = originalMatchMedia(query)
          if (!responsiveQueries.has(query)) return media
          return new Proxy(media, {
            get(target, property) {
              if (property === 'matches' && testWindow.__foxchatE2EForceWideLayout) return false
              const value = Reflect.get(target, property, target) as unknown
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
        }) as typeof window.matchMedia
      })
      // This is a layout test, but Android authentication is native-only. Emulate the
      // native login boundary while reporting no migrated accounts so the remainder
      // of the journey can keep using the browser Matrix client.
      await context.addInitScript(() => {
        ;(
          window as unknown as {
            __TAURI_INTERNALS__: {
              invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
            }
          }
        ).__TAURI_INTERNALS__ = {
          invoke: async <T>(command: string, args?: Record<string, unknown>) => {
            if (command !== 'plugin:remote-push|native_matrix') return undefined as T
            const action = String(args?.action ?? '')
            if (action === 'status') {
              return {
                available: true,
                owner: 'matrix-rust-sdk',
                accounts: [],
              } as T
            }
            if (action !== 'login') return undefined as T
            const payload = JSON.parse(String(args?.payload ?? '{}')) as {
              homeserver: string
              username: string
              password: string
            }
            const enteredUrl = /^https?:\/\//i.test(payload.homeserver)
              ? payload.homeserver
              : `https://${payload.homeserver}`
            const wellKnownResponse = await fetch(new URL('/.well-known/matrix/client', enteredUrl))
            const wellKnown = wellKnownResponse.ok
              ? ((await wellKnownResponse.json()) as {
                  'm.homeserver'?: { base_url?: string }
                })
              : undefined
            const baseUrl = (wellKnown?.['m.homeserver']?.base_url ?? enteredUrl).replace(/\/$/, '')
            const response = await fetch(`${baseUrl}/_matrix/client/v3/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'm.login.password',
                identifier: { type: 'm.id.user', user: payload.username },
                password: payload.password,
                refresh_token: true,
                initial_device_display_name: 'FoxChat fold layout test',
              }),
            })
            if (!response.ok) throw new Error(`Matrix login returned ${response.status}`)
            const session = (await response.json()) as {
              access_token: string
              refresh_token?: string
              user_id: string
              device_id: string
              home_server?: string
            }
            return {
              baseUrl,
              accessToken: session.access_token,
              refreshToken: session.refresh_token,
              userId: session.user_id,
              deviceId: session.device_id,
            } as T
          },
        }
      })
      page = await context.newPage()

      await test.step('sign in unfolded and create a channel', async () => {
        await signIn(page!, account)
        sessions = await storedSessions(page!)
        const accountId = sessions.at(-1)?.userId
        expect(accountId).toMatch(/^@[^:]+:.+/)

        await openRoomActions(page!)
        await page!.getByRole('menu').getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(accountId!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(roomName)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom for fold test' },
        )
        await expect(
          page!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)
      })

      await test.step('unfolded: the room list is a persistent sidebar, not a drawer', async () => {
        await expect(page!.locator('[data-mobile-layout]')).toHaveAttribute(
          'data-mobile-layout',
          'false',
        )
        const sidebar = page!.getByTestId('room-sidebar')
        await expect(sidebar).toHaveCount(1)
        await expect(sidebar.getByTestId('room-row').filter({ hasText: roomName })).toBeVisible()
        const box = await sidebar.boundingBox()
        expect(box?.width ?? 0).toBeGreaterThan(300)
        const appearance = await sidebar.evaluate((element) => {
          const style = getComputedStyle(element)
          return { display: style.display, background: style.backgroundColor }
        })
        expect(appearance.display).toBe('flex')
        expect(appearance.background).not.toBe('rgba(0, 0, 0, 0)')
        await expect(page!.getByRole('button', { name: 'Open room list' })).toBeHidden()
        await expectNoHorizontalOverflow(page!)
        await expect(page!.locator('.ant-message-notice')).toHaveCount(0, { timeout: 10_000 })
        await captureLayout(page!, testInfo, 'android-unfolded-persistent-sidebar')
      })

      await test.step('folding closed switches to the mobile drawer', async () => {
        await page!.setViewportSize(FOLDED)
        await expect(page!.locator('[data-mobile-layout]')).toHaveAttribute(
          'data-mobile-layout',
          'true',
        )
        await expect(page!.getByTestId('room-sidebar')).toHaveCount(0)
        const menu = page!.getByRole('button', { name: 'Open room list' })
        await expect(menu).toBeVisible()
        await expectNoHorizontalOverflow(page!)
        await captureLayout(page!, testInfo, 'android-folded-drawer-closed')

        await menu.click()
        const drawerSidebar = page!.getByTestId('room-sidebar').last()
        await expect(drawerSidebar).toBeVisible()
        await expect(
          drawerSidebar.getByTestId('room-row').filter({ hasText: roomName }),
        ).toBeVisible()
        await captureLayout(page!, testInfo, 'android-folded-drawer-open')
        await page!.keyboard.press('Escape')
        await expect(page!.getByTestId('room-sidebar')).toHaveCount(0)
      })

      await test.step('rotating while still folded (wide but short) stays mobile', async () => {
        await page!.setViewportSize(FOLDED_LANDSCAPE)
        await expect(page!.locator('[data-mobile-layout]')).toHaveAttribute(
          'data-mobile-layout',
          'true',
        )
        await expect(page!.getByRole('button', { name: 'Open room list' })).toBeVisible()
        await expectNoHorizontalOverflow(page!)
      })

      await test.step('unfolding again brings the persistent sidebar back', async () => {
        await page!.getByRole('button', { name: 'Open room list' }).click()
        await expect(page!.getByTestId('room-sidebar').last()).toBeVisible()
        await page!.setViewportSize(UNFOLDED)
        await expect(page!.locator('[data-mobile-layout]')).toHaveAttribute(
          'data-mobile-layout',
          'false',
        )
        const sidebar = page!.getByTestId('room-sidebar')
        await expect(sidebar).toHaveCount(1)
        await expect(sidebar.getByTestId('room-row').filter({ hasText: roomName })).toBeVisible()
        await expect(page!.getByRole('button', { name: 'Open room list' })).toBeHidden()
        await expectNoHorizontalOverflow(page!)
        await captureLayout(page!, testInfo, 'android-unfolded-again-persistent-sidebar')
      })

      await test.step('Android CSS and JS viewport disagreement cannot blank the sidebar', async () => {
        await page!.evaluate(() => {
          ;(
            window as typeof window & { __foxchatE2EForceWideLayout?: boolean }
          ).__foxchatE2EForceWideLayout = true
        })
        await page!.setViewportSize({ width: MOBILE_LAYOUT_BREAKPOINT, height: UNFOLDED.height })
        await expect(page!.locator('[data-mobile-layout]')).toHaveAttribute(
          'data-mobile-layout',
          'false',
        )
        const sidebar = page!.getByTestId('room-sidebar')
        await expect(sidebar).toHaveCount(1)
        await expect(sidebar).toBeVisible()
        await expect(sidebar.getByTestId('room-row').filter({ hasText: roomName })).toBeVisible()
        await expect(page!.getByRole('button', { name: 'Open room list' })).toBeHidden()
        const appearance = await sidebar.evaluate((element) => {
          const style = getComputedStyle(element)
          return { display: style.display, background: style.backgroundColor }
        })
        expect(appearance.display).toBe('flex')
        expect(appearance.background).not.toBe('rgba(0, 0, 0, 0)')
        await expectNoHorizontalOverflow(page!)
        await captureLayout(page!, testInfo, 'android-webview-breakpoint-disagreement')
      })
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        if (page && !page.isClosed()) sessions = await storedSessions(page).catch(() => sessions)
        await cleanTestRoom(roomId, sessions)
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
