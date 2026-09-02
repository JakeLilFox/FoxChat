import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { liveMatrixConfig } from './support/env'
import { cleanTestRoom, storedSessions, type StoredSession } from './support/matrix-api'
import { retryMutatingRequest } from './support/retry'
import { expectNoHorizontalOverflow, openRoomActions, signIn } from './support/ui'

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
            const wellKnownResponse = await fetch(
              new URL('/.well-known/matrix/client', enteredUrl),
            )
            const wellKnown = wellKnownResponse.ok
              ? ((await wellKnownResponse.json()) as {
                  'm.homeserver'?: { base_url?: string }
                })
              : undefined
            const baseUrl = (wellKnown?.['m.homeserver']?.base_url ?? enteredUrl).replace(
              /\/$/,
              '',
            )
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
        await expect(page!.getByRole('button', { name: 'Open room list' })).toBeHidden()
        await expectNoHorizontalOverflow(page!)
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

        await menu.click()
        const drawerSidebar = page!.getByTestId('room-sidebar').last()
        await expect(drawerSidebar).toBeVisible()
        await expect(
          drawerSidebar.getByTestId('room-row').filter({ hasText: roomName }),
        ).toBeVisible()
        await page!
          .locator('.ant-drawer-mask')
          .last()
          .click({ position: { x: FOLDED.width - 20, y: 20 } })
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
