import { expect, test, type Locator, type Page, type Response } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { liveMatrixConfig } from './support/env'
import {
  cleanTestRoom,
  removeOtherDevices,
  storedSessions,
  type StoredSession,
} from './support/matrix-api'
import { retryMutatingRequest } from './support/retry'
import { openRoomActions, openRoomRow, sendMessage, signIn } from './support/ui'

const live = liveMatrixConfig()
const fixture = readFileSync(resolve(process.cwd(), 'public/favicon.png'))

const parentMessage = (content: Locator) =>
  content.locator('xpath=ancestor::div[@data-event-id][1]')

const reactionChip = (message: Locator, reaction: string) =>
  message.getByTestId('reaction-chip').filter({ hasText: reaction })

async function expectOwnReactionColor(chip: Locator) {
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(chip).toHaveClass(/mine/)
  expect(
    await chip.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        background: style.backgroundColor,
        border: style.borderTopColor,
        color: style.color,
      }
    }),
  ).toEqual({
    background: 'rgb(238, 234, 255)',
    border: 'rgb(115, 87, 232)',
    color: 'rgb(115, 87, 232)',
  })
}

test.describe('live image-gallery journey', () => {
  test.skip(!live.enabled, live.reason)

  test('galleries stay compatible and reactions persist for text, images, and galleries', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(5 * 60_000)
    const account = live.account1!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} Gallery ${runId}`
    const textBody = `Gallery reaction text ${runId}`
    let context
    let page: Page | undefined
    let roomId: string | undefined
    let session: StoredSession | undefined
    let journeyError: unknown

    try {
      context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } })
      page = await context.newPage()

      await test.step('sign in and create an unencrypted test room', async () => {
        await signIn(page!, account)
        session = (await storedSessions(page!)).at(-1)
        await openRoomActions(page!)
        await page!.getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await dialog.getByLabel('Room name').fill(roomName)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom (gallery)' },
        )
        await expect(
          page!.getByTestId('room-header').getByRole('heading', { name: roomName }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)
      })

      await test.step('send a normal text message', async () => {
        await sendMessage(page!, textBody)
        await expect(
          page!.locator('[data-event-id^="$"]').filter({ hasText: textBody }).last(),
        ).toBeVisible({ timeout: 60_000 })
      })

      await test.step('upload a standalone image without gallery metadata', async () => {
        await page!.locator('input[type="file"]').setInputFiles({
          name: 'reaction-standalone.png',
          mimeType: 'image/png',
          buffer: fixture,
        })
        const imageResponse = page!.waitForResponse(
          (response) => {
            if (
              response.request().method() !== 'PUT' ||
              !new URL(response.url()).pathname.includes('/send/m.room.message/')
            )
              return false
            const content = response.request().postDataJSON() as Record<string, unknown>
            return content.msgtype === 'm.image' && content['foxchat.gallery'] === undefined
          },
          { timeout: 90_000 },
        )
        await page!.getByRole('button', { name: 'Send message' }).click()
        await expect((await imageResponse).ok()).toBe(true)
        await expect(page!.getByTestId('message-image')).toHaveCount(1, {
          timeout: 60_000,
        })
      })

      const sentImages: Array<Record<string, unknown>> = []
      const collectImageEvents = (request: import('@playwright/test').Request) => {
        if (
          request.method() !== 'PUT' ||
          !new URL(request.url()).pathname.includes('/send/m.room.message/')
        )
          return
        const content = request.postDataJSON() as Record<string, unknown>
        if (content.msgtype === 'm.image') sentImages.push(content)
      }
      page.on('request', collectImageEvents)

      await test.step('upload six independent image events', async () => {
        await page!.locator('input[type="file"]').setInputFiles(
          Array.from({ length: 6 }, (_, index) => ({
            name: `gallery-${index + 1}.png`,
            mimeType: 'image/png',
            buffer: fixture,
          })),
        )
        await expect(page!.getByRole('button', { name: 'Remove image' })).toHaveCount(6)
        await page!.getByRole('button', { name: 'Send message' }).click()
        await expect.poll(() => sentImages.length, { timeout: 90_000 }).toBe(6)

        expect(sentImages.every((content) => content.msgtype === 'm.image')).toBe(true)
        const galleryCounts = new Map<string, number>()
        for (const content of sentImages) {
          const galleryId = content['foxchat.gallery']
          expect(galleryId).toEqual(expect.any(String))
          galleryCounts.set(String(galleryId), (galleryCounts.get(String(galleryId)) ?? 0) + 1)
        }
        expect([...galleryCounts.values()].sort((a, b) => b - a)).toEqual([5, 1])
      })

      await test.step('render five events as one gallery and navigate its viewer', async () => {
        const gallery = page!.getByTestId('message-gallery')
        await expect(gallery).toBeVisible({ timeout: 60_000 })
        const galleryImages = gallery.getByRole('button', { name: /^Open image / })
        await expect(galleryImages).toHaveCount(5)
        await expect
          .poll(
            () =>
              galleryImages.evaluateAll((buttons) =>
                buttons.every((button) => !(button as HTMLButtonElement).disabled),
              ),
            {
              message: 'all gallery images should be ready before opening the viewer',
              timeout: 60_000,
            },
          )
          .toBe(true)
        await gallery.getByRole('button', { name: 'Open image 1 of 5' }).click()

        const viewer = page!.getByRole('dialog', { name: 'Image viewer' })
        await expect(viewer).toBeVisible()
        const image = viewer.locator('img.viewerImage')
        const firstAlt = await image.getAttribute('alt')
        await viewer.getByRole('button', { name: 'Next image' }).click()
        await expect(image).not.toHaveAttribute('alt', firstAlt!)
        await page!.keyboard.press('ArrowLeft')
        await expect(image).toHaveAttribute('alt', firstAlt!)
        await viewer.getByRole('button', { name: 'Close image' }).click()
        await expect(viewer).toBeHidden()
      })

      const reactionCases = () => [
        {
          name: 'text message',
          message: page!.locator('[data-event-id^="$"]').filter({ hasText: textBody }).last(),
          reaction: '👍',
        },
        {
          name: 'standalone image',
          message: parentMessage(page!.getByTestId('message-image').first()),
          reaction: '❤️',
        },
        {
          name: 'image gallery',
          message: parentMessage(page!.getByTestId('message-gallery')),
          reaction: '😂',
        },
      ]

      await test.step('react to text, standalone image, and image gallery', async () => {
        const reactionEventIds: string[] = []
        const syncedEventIds = new Set<string>()
        const collectSyncedEvents = (response: Response) => {
          if (!response.ok() || !new URL(response.url()).pathname.endsWith('/sync')) return
          void response
            .json()
            .then(
              (sync: {
                rooms?: {
                  join?: Record<string, { timeline?: { events?: Array<{ event_id?: string }> } }>
                }
              }) => {
                for (const event of sync.rooms?.join?.[roomId!]?.timeline?.events ?? [])
                  if (event.event_id) syncedEventIds.add(event.event_id)
              },
            )
            .catch(() => undefined)
        }
        page!.on('response', collectSyncedEvents)
        try {
          for (const item of reactionCases()) {
            await item.message.hover()
            const reactionResponse = page!.waitForResponse(
              (response) =>
                response.request().method() === 'PUT' &&
                new URL(response.url()).pathname.includes('/send/m.reaction/'),
              { timeout: 30_000 },
            )
            await item.message
              .getByRole('button', { name: `React with ${item.reaction}`, exact: true })
              .click()
            const accepted = await reactionResponse
            await expect(accepted.ok(), `${item.name} reaction should succeed`).toBe(true)
            const result = (await accepted.json()) as { event_id?: string }
            expect(result.event_id).toMatch(/^\$/)
            reactionEventIds.push(result.event_id!)
            const chip = reactionChip(item.message, item.reaction)
            await expect(chip, `${item.name} reaction should be visible`).toHaveAttribute(
              'aria-label',
              `${item.reaction} 1`,
              { timeout: 30_000 },
            )
            await expectOwnReactionColor(chip)
          }
          await expect
            .poll(() => reactionEventIds.every((eventId) => syncedEventIds.has(eventId)), {
              message: 'all reactions should reach the app sync before reload',
              timeout: 60_000,
            })
            .toBe(true)
        } finally {
          page!.off('response', collectSyncedEvents)
        }
      })

      await test.step('retain the gallery and selected reactions after reload', async () => {
        await page!.reload()
        await expect(page!.getByTestId('room-sidebar').first()).toBeVisible({ timeout: 90_000 })
        await openRoomRow(page!, roomName)
        await expect(page!.getByTestId('message-gallery')).toHaveAttribute(
          'data-gallery-size',
          '5',
          { timeout: 60_000 },
        )
        const textMessage = page!
          .locator('[data-event-id^="$"]')
          .filter({ hasText: textBody })
          .last()
        if ((await textMessage.count()) === 0) {
          await page!.getByTestId('timeline').hover()
          await page!.mouse.wheel(0, -900)
        }
        await expect(textMessage).toBeVisible({ timeout: 60_000 })
        for (const item of reactionCases()) {
          const chip = reactionChip(item.message, item.reaction)
          await expect(chip, `${item.name} reaction should survive reload`).toHaveAttribute(
            'aria-label',
            `${item.reaction} 1`,
            { timeout: 60_000 },
          )
          await expectOwnReactionColor(chip)
        }
      })

      await test.step('unreact from every message type after reload', async () => {
        for (const item of reactionCases()) {
          const chip = reactionChip(item.message, item.reaction)
          const redactionResponse = page!.waitForResponse(
            (response) =>
              response.request().method() === 'PUT' &&
              new URL(response.url()).pathname.includes('/redact/'),
            { timeout: 30_000 },
          )
          await chip.click()
          await expect(
            (await redactionResponse).ok(),
            `${item.name} redaction should succeed`,
          ).toBe(true)
          await expect(chip, `${item.name} reaction should be removed`).toHaveCount(0, {
            timeout: 30_000,
          })
        }
      })
      page.off('request', collectImageEvents)
    } catch (error) {
      journeyError = error
    } finally {
      let cleanupError: unknown
      try {
        const sessions = page && !page.isClosed() ? await storedSessions(page).catch(() => []) : []
        if (roomId) await cleanTestRoom(roomId, sessions)
        if (session) await removeOtherDevices(browser, session, account.password)
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
