import { expect, test, type Browser, type Frame, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { liveMatrixConfig } from './support/env'
import { dominantFrequencyOf, expectDominantFrequency, writeToneWav } from './support/audio'
import { hasUsableDisplay, launchMediaBrowser, launchScreenShareBrowser } from './support/media'
import {
  cleanTestRoom,
  removeOtherDevices,
  storedSessions,
  type StoredSession,
} from './support/matrix-api'
import { pace, retryMutatingRequest } from './support/retry'
import { openRoomActions, signIn } from './support/ui'

const live = liveMatrixConfig()
const linuxSystemMicrophone =
  process.platform === 'linux' && process.env.LINUX_SYSTEM_MIC_E2E === 'true'

const callFrameLocator = (page: Page) => page.frameLocator('iframe[title$="call engine"]')

const requireCallFrame = (page: Page): Frame => {
  const frame = page.frame({ url: /\/element-call\// })
  if (!frame) throw new Error('Element Call iframe was not found on the page')
  return frame
}

const joinVoiceChannel = (page: Page) => page.getByTitle('Join voice channel').click()

const waitForCallConnected = (page: Page) =>
  expect(callFrameLocator(page).locator('[data-testid="incall_leave"]')).toBeVisible({
    timeout: 90_000,
  })

test.describe('live voice-channel and screenshare journey', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled || !live.allowVoice, live.enabled ? live.voiceReason : live.reason)

  const scratchDir = mkdtempSync(join(tmpdir(), 'foxchat-e2e-voice-'))
  let roomName: string | undefined
  let roomId: string | undefined
  let account1Id: string | undefined
  let account2Id: string | undefined
  let account1StatePath: string | undefined
  let account2StatePath: string | undefined
  let sessions: StoredSession[] = []

  test.afterAll(async ({ browser }) => {
    if (!roomName?.startsWith(live.roomPrefix)) return
    const uniqueSessions = [
      ...new Map(
        sessions.map((session) => [
          `${session.baseUrl}\0${session.userId}\0${session.deviceId}`,
          session,
        ]),
      ).values(),
    ]
    const currentSessions = [account1Id, account2Id].flatMap((userId) => {
      const current = uniqueSessions.filter((session) => session.userId === userId).at(-1)
      return current ? [current] : []
    })
    await cleanTestRoom(roomId, currentSessions).catch(() => undefined)
    for (const [account, userId] of [
      [live.account1, account1Id],
      [live.account2, account2Id],
    ] as const) {
      const current = currentSessions.filter((session) => session.userId === userId).at(-1)
      if (current && account)
        await removeOtherDevices(browser, current, account.password).catch(() => undefined)
    }
  })

  test('two clients join a voice channel and exchange audio', async ({ baseURL }, testInfo) => {
    test.setTimeout(8 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    roomName = `${live.roomPrefix} Voice ${runId}`
    const tone1Hz = linuxSystemMicrophone ? 440 : 523
    const tone2Hz = 349
    const tone1Path = join(scratchDir, 'tone1.wav')
    const tone2Path = join(scratchDir, 'tone2.wav')
    writeToneWav(tone1Path, { frequencyHz: tone1Hz })
    writeToneWav(tone2Path, { frequencyHz: tone2Hz })

    let browser1: Browser | undefined
    let browser2: Browser | undefined
    let page1: Page | undefined
    let page2: Page | undefined
    let journeyError: unknown

    try {
      browser1 = await launchMediaBrowser(
        linuxSystemMicrophone ? { useSystemMediaDevices: true } : { fakeAudioWavPath: tone1Path },
      )
      browser2 = await launchMediaBrowser({ fakeAudioWavPath: tone2Path })
      const context1 = await browser1.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
      })
      const context2 = await browser2.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
      })
      page1 = await context1.newPage()
      page2 = await context2.newPage()

      await test.step('sign in both accounts', async () => {
        await signIn(page1!, account1)
        account1Id = (await storedSessions(page1!)).at(-1)?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)
        await signIn(page2!, account2)
        account2Id = (await storedSessions(page2!)).at(-1)?.userId
        expect(account2Id).toMatch(/^@[^:]+:.+/)
      })

      await test.step('create a voice channel and invite the second account', async () => {
        await openRoomActions(page1!)
        await page1!.getByText('Create a room', { exact: true }).click()
        const dialog = page1!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page1!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(roomName!)
        const voiceSwitch = dialog.getByRole('switch', {
          name: "Voice channel · this can't be changed later",
        })
        if ((await voiceSwitch.getAttribute('aria-checked')) !== 'true') await voiceSwitch.click()
        await retryMutatingRequest(
          page1!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom (voice channel)' },
        )
        await expect(
          page1!.getByTestId('room-header').getByRole('heading', {
            name: roomName,
          }),
        ).toBeVisible({ timeout: 60_000 })
        roomId = new URL(page1!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)

        await pace(page1!)
        const detailsTitle = page1!.getByText('Channel details', {
          exact: true,
        })
        if (!(await detailsTitle.isVisible()))
          await page1!.getByRole('button', { name: 'Room information' }).click()
        await expect(detailsTitle).toBeVisible()
        await page1!.getByText('Invite', { exact: true }).last().click()
        const invite = page1!.getByRole('dialog', { name: 'Invite to room' })
        await invite.getByLabel('Matrix user ID').fill(account2Id!)
        await retryMutatingRequest(
          page1!,
          (url) => url.pathname.endsWith('/invite'),
          () => invite.getByRole('button', { name: 'Send invitation' }).click(),
          { label: 'Matrix invite (voice channel)' },
        )

        const invitation = page2!.locator('.invitation').filter({
          hasText: roomName,
        })
        await expect(invitation).toBeVisible({ timeout: 60_000 })
        await invitation.getByRole('button', { name: 'Accept' }).click()
        await expect(
          page2!.getByTestId('room-header').getByRole('heading', {
            name: roomName,
          }),
        ).toBeVisible({ timeout: 60_000 })
      })

      await test.step('both join the voice channel', async () => {
        if (linuxSystemMicrophone)
          await page1!.evaluate(() => {
            Object.defineProperty(window, '__TAURI_INTERNALS__', {
              configurable: true,
              value: {},
            })
          })
        await joinVoiceChannel(page1!)
        await joinVoiceChannel(page2!)
        await waitForCallConnected(page1!)
        await waitForCallConnected(page2!)
      })

      await test.step("each side receives the other's fake microphone tone", async () => {
        await expectDominantFrequency(requireCallFrame(page2!), tone1Hz, {
          toleranceHz: 30,
        })
        await expectDominantFrequency(requireCallFrame(page1!), tone2Hz, {
          toleranceHz: 30,
        })
      })

      await test.step('muting the microphone stops the tone from arriving', async () => {
        await page1!.getByRole('button', { name: 'Mute microphone' }).click()
        await page1!.waitForTimeout(1_000)
        const muted = await dominantFrequencyOf(requireCallFrame(page2!), {
          sampleMs: 2_000,
        })
        if (muted) expect(muted.peakDb).toBeLessThan(-55)
        await page1!.getByRole('button', { name: 'Unmute microphone' }).click()
      })

      account1StatePath = join(scratchDir, 'account1-state.json')
      account2StatePath = join(scratchDir, 'account2-state.json')
      await context1.storageState({ path: account1StatePath })
      await context2.storageState({ path: account2StatePath })

      await test.step('both leave the call', async () => {
        await page1!.getByRole('button', { name: 'Leave' }).click()
        await page2!.getByRole('button', { name: 'Leave' }).click()
        await expect(page1!.getByRole('button', { name: 'Leave' })).toBeHidden()
        await expect(page2!.getByRole('button', { name: 'Leave' })).toBeHidden()
      })

      sessions = await storedSessions(page1!)
      sessions.push(...(await storedSessions(page2!)))
    } catch (error) {
      journeyError = error
    } finally {
      await page1?.close().catch(() => undefined)
      await page2?.close().catch(() => undefined)
      await browser1?.close().catch(() => undefined)
      await browser2?.close().catch(() => undefined)
    }
    if (journeyError) throw journeyError
  })

  test('screenshare: the shared color arrives at the receiving client', async ({
    baseURL,
  }, testInfo) => {
    test.setTimeout(6 * 60_000)
    test.skip(
      !roomId || !account1StatePath || !account2StatePath,
      'The voice-channel setup test did not complete',
    )
    test.skip(
      !hasUsableDisplay(),
      'Screenshare capture needs a real headed browser with a compositor (no $DISPLAY/Xvfb available here)',
    )

    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const shareTitle = `foxchat-e2e-share-${runId}`
    const shareColor = { r: 51, g: 102, b: 255 }

    let browser1: Browser | undefined
    let browser2: Browser | undefined
    let page1: Page | undefined
    let page2: Page | undefined
    let journeyError: unknown

    try {
      browser1 = await launchScreenShareBrowser({
        autoSelectCaptureSourceTitle: shareTitle,
      })
      browser2 = await launchMediaBrowser({})
      const context1 = await browser1.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
        permissions: ['microphone'],
        storageState: account1StatePath,
      })
      const context2 = await browser2.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
        storageState: account2StatePath,
      })
      page1 = await context1.newPage()
      page2 = await context2.newPage()

      await test.step('restore both sessions and reopen the voice channel', async () => {
        await page1!.goto('/')
        await expect(page1!.getByTestId('room-sidebar').first()).toBeVisible({
          timeout: 90_000,
        })
        await page2!.goto('/')
        await expect(page2!.getByTestId('room-sidebar').first()).toBeVisible({
          timeout: 90_000,
        })
        await page1!.getByTestId('room-row').filter({ hasText: roomName! }).click()
        await page2!.getByTestId('room-row').filter({ hasText: roomName! }).click()
        await expect(
          page1!.getByTestId('room-header').getByRole('heading', {
            name: roomName,
          }),
        ).toBeVisible({ timeout: 60_000 })
        await expect(
          page2!.getByTestId('room-header').getByRole('heading', {
            name: roomName,
          }),
        ).toBeVisible({ timeout: 60_000 })
        await joinVoiceChannel(page1!)
        await joinVoiceChannel(page2!)
        await waitForCallConnected(page1!)
        await waitForCallConnected(page2!)
      })

      await test.step('share a known-color tab', async () => {
        await page1!.evaluate(
          ({ title, color }) => {
            document.title = title
            const overlay = document.createElement('div')
            overlay.id = 'foxchat-e2e-share-overlay'
            overlay.style.cssText = `position:fixed;inset:0;background:rgb(${color.r},${color.g},${color.b});z-index:2147483647;pointer-events:none;`
            document.body.appendChild(overlay)
          },
          { title: shareTitle, color: shareColor },
        )
        await expect(page1!).toHaveTitle(shareTitle)
        await page1!.waitForTimeout(500)
        const sharingOptions = page1!.getByRole('button', {
          name: 'Screen sharing options',
        })
        for (let attempt = 0; attempt < 2; attempt++) {
          await page1!.getByRole('button', { name: 'Share screen' }).click()
          await page1!.getByRole('button', { name: 'Choose what to share' }).click()
          if (
            await sharingOptions
              .waitFor({ state: 'visible', timeout: 15_000 })
              .then(() => true)
              .catch(() => false)
          )
            break
          await page1!.waitForTimeout(500)
        }
        await expect(sharingOptions).toBeVisible({ timeout: 15_000 })
      })

      await test.step('the receiving client opts in and samples the shared pixels', async () => {
        await expect(page2!.getByText(/is sharing their screen/)).toBeVisible({ timeout: 60_000 })
        await page2!.getByRole('button', { name: 'desktop View screen', exact: true }).click()
        await page2!.waitForTimeout(2_000)
        const sampled = await page2!.evaluate(async () => {
          const video = document.querySelector('video')
          if (!video) return undefined
          const canvas = document.createElement('canvas')
          canvas.width = video.videoWidth || 1
          canvas.height = video.videoHeight || 1
          const ctx = canvas.getContext('2d')
          if (!ctx) return undefined
          ctx.drawImage(video, 0, 0)
          const data = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data
          return { r: data[0], g: data[1], b: data[2] }
        })
        if (!sampled)
          throw new Error(
            'No <video> element with the shared screen was found on the receiving client',
          )
        const distance = Math.sqrt(
          (sampled.r - shareColor.r) ** 2 +
            (sampled.g - shareColor.g) ** 2 +
            (sampled.b - shareColor.b) ** 2,
        )
        expect(
          distance,
          `expected the sampled color rgb(${sampled.r},${sampled.g},${sampled.b}) to be close to rgb(${shareColor.r},${shareColor.g},${shareColor.b})`,
        ).toBeLessThan(40)
      })

      await test.step('toggle the screen-share audio mute control', async () => {
        const screenTile = page2!.getByRole('button', { name: /Screen share/ })
        const muteButton = screenTile.getByRole('button', {
          name: 'sound',
          exact: true,
        })
        await expect(muteButton).toBeVisible({ timeout: 30_000 })
        await muteButton.click()
        await expect(muteButton).toBeHidden()
      })

      await test.step('stop sharing', async () => {
        await page1!.getByRole('button', { name: 'Screen sharing options' }).click()
        await page1!.mouse.move(0, 0)
        await page1!.getByRole('menuitem', { name: 'End stream' }).click()
        await expect(page2!.getByText(/is sharing their screen/)).toBeHidden({ timeout: 30_000 })
      })

      await test.step('both leave the call', async () => {
        await page1!.getByRole('button', { name: 'Leave' }).click()
        await page2!.getByRole('button', { name: 'Leave' }).click()
      })

      sessions.push(...(await storedSessions(page1!)))
      sessions.push(...(await storedSessions(page2!)))
    } catch (error) {
      journeyError = error
    } finally {
      await page1?.close().catch(() => undefined)
      await page2?.close().catch(() => undefined)
      await browser1?.close().catch(() => undefined)
      await browser2?.close().catch(() => undefined)
    }
    if (journeyError) throw journeyError
  })
})
