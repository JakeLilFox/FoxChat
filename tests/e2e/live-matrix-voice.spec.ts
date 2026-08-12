import { expect, test, type Browser, type Frame, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { liveMatrixConfig } from './support/env'
import {
  dominantFrequenciesOf,
  dominantFrequencyOf,
  expectDominantFrequency,
  writeToneWav,
} from './support/audio'
import { hasUsableDisplay, launchMediaBrowser, launchScreenShareBrowser } from './support/media'
import {
  cleanTestRoom,
  createRoom,
  inviteToRoom,
  joinRoomAs,
  removeOtherDevices,
  storedSessions,
  type StoredSession,
} from './support/matrix-api'
import { pace, retryMutatingRequest } from './support/retry'
import { closeDialog, openAppSettings, openRoomActions, signIn } from './support/ui'

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

const callTile = (page: Page, userId: string, mediaKind = 'participant') =>
  page.locator(
    `[data-testid="call-tile"][data-user-id=${JSON.stringify(userId)}][data-media-kind="${mediaKind}"]`,
  )

const enableVoiceActivation = (page: Page) =>
  page.evaluate(() => {
    localStorage.setItem('foxchat.voiceInputMode', 'voice_activation')
    localStorage.setItem('foxchat.voiceActivationThresholdMode', 'manual')
    localStorage.setItem('foxchat.voiceActivationThresholdDb', '-80')
    window.dispatchEvent(
      new CustomEvent('foxchat-voice-input-mode-changed', { detail: 'voice_activation' }),
    )
    window.dispatchEvent(
      new CustomEvent('foxchat-voice-activation-threshold-changed', {
        detail: { mode: 'manual', thresholdDb: -80 },
      }),
    )
  })

const moveSliderToMinimum = async (slider: ReturnType<Page['getByRole']>) => {
  await slider.focus()
  for (let index = 0; index < 40; index++) await slider.press('ArrowLeft')
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
}

const moveSliderFromMinimumTo100 = async (slider: ReturnType<Page['getByRole']>) => {
  for (let index = 0; index < 20; index++) await slider.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', '100')
}

const profileName = async (session: StoredSession) => {
  const response = await fetch(
    `${session.baseUrl}/_matrix/client/v3/profile/${encodeURIComponent(session.userId)}`,
    { headers: { Authorization: `Bearer ${session.accessToken}` } },
  )
  if (!response.ok) return session.userId
  const profile = (await response.json()) as { displayname?: string }
  return profile.displayname?.trim() || session.userId
}

test.describe('live voice-channel and screenshare journey', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled || !live.allowVoice, live.enabled ? live.voiceReason : live.reason)

  const scratchDir = mkdtempSync(join(tmpdir(), 'foxchat-e2e-voice-'))
  let roomName: string | undefined
  let roomId: string | undefined
  let account1Id: string | undefined
  let account2Id: string | undefined
  let account3Id: string | undefined
  let account4Id: string | undefined
  let account1StatePath: string | undefined
  let account2StatePath: string | undefined
  let account3StatePath: string | undefined
  let account4StatePath: string | undefined
  let sessions: StoredSession[] = []
  const createdRoomIds: string[] = []

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
    const currentSessions = [account1Id, account2Id, account3Id, account4Id].flatMap((userId) => {
      const current = uniqueSessions.filter((session) => session.userId === userId).at(-1)
      return current ? [current] : []
    })
    for (const createdRoomId of createdRoomIds)
      await cleanTestRoom(createdRoomId, currentSessions).catch(() => undefined)
    for (const [account, userId] of [
      [live.account1, account1Id],
      [live.account2, account2Id],
      [live.account3, account3Id],
      [live.account4, account4Id],
    ] as const) {
      const current = currentSessions.filter((session) => session.userId === userId).at(-1)
      if (current && account)
        await removeOtherDevices(browser, current, account.password).catch(() => undefined)
    }
  })

  test('four clients use voice activation and survive a leave/rejoin without duplicate audio', async ({
    baseURL,
  }, testInfo) => {
    test.setTimeout(10 * 60_000)
    const accounts = [live.account1!, live.account2!, live.account3!, live.account4!]
    const frequencies = [523, 349, 659, 784]
    const tonePaths = frequencies.map((frequency, index) => {
      const path = join(scratchDir, `four-way-${testInfo.retry}-${index}.wav`)
      writeToneWav(path, { frequencyHz: frequency, durationSeconds: 180 })
      return path
    })
    const browsers: Browser[] = []
    const pages: Page[] = []
    const contexts: Awaited<ReturnType<Browser['newContext']>>[] = []
    let journeyError: unknown

    try {
      for (let index = 0; index < accounts.length; index++) {
        const browser = await launchMediaBrowser({ fakeAudioWavPath: tonePaths[index] })
        browsers.push(browser)
        const context = await browser.newContext({
          baseURL,
          viewport: { width: 1280, height: 800 },
          storageState:
            index === 0 ? account1StatePath : index === 1 ? account2StatePath : undefined,
        })
        contexts.push(context)
        pages.push(await context.newPage())
      }

      await test.step('sign in four members and create a shared voice channel', async () => {
        for (let index = 0; index < pages.length; index++)
          await signIn(pages[index], accounts[index])
        const activeSessions = await Promise.all(
          pages.map((page) => storedSessions(page).then((all) => all.at(-1)!)),
        )
        sessions.push(...activeSessions)
        ;[account1Id, account2Id, account3Id, account4Id] = activeSessions.map(
          (session) => session.userId,
        )
        roomName = `${live.roomPrefix} Four-way voice ${Date.now()}-${testInfo.retry}`
        roomId = await createRoom(activeSessions[0], {
          name: roomName,
          preset: 'private_chat',
          invite: activeSessions.slice(1).map((session) => session.userId),
          creation_content: { type: 'org.matrix.msc3417.call' },
          room_type: 'org.matrix.msc3417.call',
          power_level_content_override: {
            events: {
              'org.matrix.msc3401.call.member': 0,
              'm.call.member': 0,
              'org.matrix.msc4143.rtc.member': 0,
              'm.rtc.member': 0,
            },
          },
        })
        createdRoomIds.push(roomId)
        for (const session of activeSessions.slice(1)) await joinRoomAs(session, roomId)
        for (const page of pages) {
          const row = page.getByTestId('room-row').filter({ hasText: roomName })
          await expect(row).toBeVisible({ timeout: 60_000 })
          await row.click()
          await expect(
            page.getByTestId('room-header').getByRole('heading', { name: roomName }),
          ).toBeVisible({ timeout: 60_000 })
        }
      })

      await test.step('all four join with voice activation', async () => {
        await Promise.all(pages.map(enableVoiceActivation))
        await Promise.all(pages.map(joinVoiceChannel))
        await Promise.all(pages.map(waitForCallConnected))
        for (const page of pages)
          await expect(
            page.locator('[data-testid="call-tile"][data-media-kind="participant"]'),
          ).toHaveCount(4, {
            timeout: 90_000,
          })
      })

      await test.step('every participant tile has the correct name and speaking state', async () => {
        const activeSessions = await Promise.all(
          pages.map((page) => storedSessions(page).then((all) => all.at(-1)!)),
        )
        const expectedNames = await Promise.all(activeSessions.map(profileName))
        for (const page of pages) {
          for (let index = 0; index < activeSessions.length; index++) {
            const tile = callTile(page, activeSessions[index].userId)
            await expect(tile).toContainText(expectedNames[index])
            await expect(tile).toHaveAttribute('data-speaking', 'true', { timeout: 30_000 })
            await expect(tile).toHaveClass(/speaking/)
          }
        }
      })

      await test.step('one receiver has exactly one live stream for every remote tone', async () => {
        const remoteFrequencies = frequencies.slice(1)
        const remoteUserIds = [account2Id!, account3Id!, account4Id!]
        await expect
          .poll(
            async () => {
              const peaks = await dominantFrequenciesOf(requireCallFrame(pages[0]), {
                sampleMs: 1_200,
                mixerActiveOnly: true,
              })
              return remoteFrequencies.map(
                (frequency, index) =>
                  peaks
                    .filter((peak) => peak.peakDb > -50 && Math.abs(peak.peakHz - frequency) <= 30)
                    .filter((peak) => peak.userId === remoteUserIds[index]).length,
              )
            },
            { timeout: 60_000 },
          )
          .toEqual([1, 1, 1])
      })

      await test.step('the third participant leaves and rejoins without a ghost or duplicate', async () => {
        await pages[2].getByRole('button', { name: 'Leave' }).click()
        await expect(callTile(pages[0], account3Id!)).toBeHidden({ timeout: 60_000 })
        await expect
          .poll(
            async () => {
              const peaks = await dominantFrequenciesOf(requireCallFrame(pages[0]), {
                sampleMs: 1_000,
                mixerActiveOnly: true,
              })
              return peaks.filter(
                (peak) => peak.peakDb > -50 && Math.abs(peak.peakHz - frequencies[2]) <= 30,
              ).length
            },
            { timeout: 45_000 },
          )
          .toBe(0)

        await joinVoiceChannel(pages[2])
        await waitForCallConnected(pages[2])
        await expect(callTile(pages[0], account3Id!)).toBeVisible({ timeout: 60_000 })
        await expect
          .poll(
            async () => {
              const peaks = await dominantFrequenciesOf(requireCallFrame(pages[0]), {
                sampleMs: 1_200,
                mixerActiveOnly: true,
              })
              return peaks.filter(
                (peak) => peak.peakDb > -50 && Math.abs(peak.peakHz - frequencies[2]) <= 30,
              ).length
            },
            { timeout: 60_000 },
          )
          .toBe(1)
      })

      account1StatePath = join(scratchDir, 'account1-state.json')
      account2StatePath = join(scratchDir, 'account2-state.json')
      account3StatePath = join(scratchDir, 'account3-state.json')
      account4StatePath = join(scratchDir, 'account4-state.json')
      const statePaths = [
        account1StatePath,
        account2StatePath,
        account3StatePath,
        account4StatePath,
      ]
      for (let index = 0; index < contexts.length; index++)
        await contexts[index].storageState({ path: statePaths[index] })
      for (const page of pages) {
        await page.getByRole('button', { name: 'Leave' }).click()
        sessions.push(...(await storedSessions(page)))
      }
    } catch (error) {
      journeyError = error
    } finally {
      for (const page of pages) await page.close().catch(() => undefined)
      for (const browser of browsers) await browser.close().catch(() => undefined)
    }
    if (journeyError) throw journeyError
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
    writeToneWav(tone1Path, { frequencyHz: tone1Hz, durationSeconds: 180 })
    writeToneWav(tone2Path, { frequencyHz: tone2Hz, durationSeconds: 180 })

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
        createdRoomIds.push(roomId!)

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

      await test.step('changing microphone volume in Settings changes what the other client receives', async () => {
        await page1!.getByRole('button', { name: 'Back to chat' }).click()
        const settings = await openAppSettings(page1!, 'Voice')
        const slider = settings.getByRole('slider', { name: 'Microphone volume' })
        await moveSliderToMinimum(slider)
        await expect(settings.getByText('0%', { exact: true }).first()).toBeVisible()

        await expect
          .poll(
            async () => {
              const received = await dominantFrequencyOf(requireCallFrame(page2!), {
                sampleMs: 1_000,
              })
              return received?.peakDb ?? -Infinity
            },
            { timeout: 30_000 },
          )
          .toBeLessThan(-55)

        await moveSliderFromMinimumTo100(slider)
        await expect(settings.getByText('100%', { exact: true }).first()).toBeVisible()
        await expectDominantFrequency(requireCallFrame(page2!), tone1Hz, {
          toleranceHz: 30,
          timeoutMs: 30_000,
        })
        await closeDialog(page1!)
        await page1!.getByRole('button', { name: new RegExp(`${roomName}.*Voice`) }).click()
      })

      await test.step("right-clicking a participant changes that participant's mixer gain", async () => {
        await callTile(page1!, account2Id!).click({ button: 'right' })
        const slider = page1!.getByRole('slider', {
          name: `Microphone volume for ${account2Id}`,
        })
        await expect(slider).toBeVisible()
        await moveSliderToMinimum(slider)
        await expect(
          callFrameLocator(page1!).locator(
            `audio[data-foxchat-mixer-active="true"][data-foxchat-mixer-user-id=${JSON.stringify(account2Id!)}]`,
          ),
        ).toHaveAttribute('data-foxchat-mixer-gain', '0')

        await moveSliderFromMinimumTo100(slider)
        await expect(
          callFrameLocator(page1!).locator(
            `audio[data-foxchat-mixer-active="true"][data-foxchat-mixer-user-id=${JSON.stringify(account2Id!)}]`,
          ),
        ).toHaveAttribute('data-foxchat-mixer-gain', '1')
        await page1!.keyboard.press('Escape')
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

  test('four clients attribute two simultaneous screen shares to the correct people', async ({
    baseURL,
  }, testInfo) => {
    test.setTimeout(10 * 60_000)
    test.skip(
      !roomId ||
        !account1StatePath ||
        !account2StatePath ||
        !account3StatePath ||
        !account4StatePath,
      'The four-account voice setup did not complete',
    )
    test.skip(
      !hasUsableDisplay(),
      'Multiple screenshares need a real headed browser with a compositor',
    )
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const shareTitles = [`foxchat-share-one-${runId}`, `foxchat-share-three-${runId}`]
    const shareColors = [
      { r: 231, g: 76, b: 60 },
      { r: 46, g: 204, b: 113 },
    ]
    const statePaths = [
      account1StatePath!,
      account2StatePath!,
      account3StatePath!,
      account4StatePath!,
    ]
    const browsers: Browser[] = []
    const pages: Page[] = []
    let journeyError: unknown

    const startShare = async (page: Page, title: string, color: (typeof shareColors)[number]) => {
      await page.evaluate(
        ({ title, color }) => {
          document.title = title
          const overlay = document.createElement('div')
          overlay.id = `share-${title}`
          overlay.style.cssText = `position:fixed;inset:0;background:rgb(${color.r},${color.g},${color.b});z-index:2147483647;pointer-events:none;`
          document.body.appendChild(overlay)
        },
        { title, color },
      )
      await expect(page).toHaveTitle(title)
      await page.getByRole('button', { name: 'Share screen' }).click()
      await page.getByRole('button', { name: 'Choose what to share' }).click()
      await expect(page.getByRole('button', { name: 'Screen sharing options' })).toBeVisible({
        timeout: 30_000,
      })
    }

    try {
      for (let index = 0; index < statePaths.length; index++) {
        const browser =
          index === 0
            ? await launchScreenShareBrowser({ autoSelectCaptureSourceTitle: shareTitles[0] })
            : index === 2
              ? await launchScreenShareBrowser({ autoSelectCaptureSourceTitle: shareTitles[1] })
              : await launchMediaBrowser({})
        browsers.push(browser)
        const context = await browser.newContext({
          baseURL,
          viewport: { width: 1280, height: 800 },
          permissions: ['microphone'],
          storageState: statePaths[index],
        })
        pages.push(await context.newPage())
      }

      await test.step('all four restore, join the same room, and enter voice', async () => {
        for (const page of pages) {
          await page.goto('/')
          await expect(page.getByTestId('room-sidebar').first()).toBeVisible({ timeout: 90_000 })
        }
        const activeSessions = await Promise.all(
          pages.map((page) => storedSessions(page).then((all) => all.at(-1)!)),
        )
        const ownerSession = activeSessions[0]
        for (const session of activeSessions.slice(2)) {
          await inviteToRoom(ownerSession, roomId!, session.userId).catch(() => undefined)
          await joinRoomAs(session, roomId!)
        }
        for (const page of pages) {
          const row = page.getByTestId('room-row').filter({ hasText: roomName! })
          await expect(row).toBeVisible({ timeout: 60_000 })
          await row.click()
          await joinVoiceChannel(page)
          await waitForCallConnected(page)
        }
      })

      await test.step('the first and third participants share different sources', async () => {
        await startShare(pages[0], shareTitles[0], shareColors[0])
        await startShare(pages[2], shareTitles[1], shareColors[1])
        await expect(callTile(pages[0], account1Id!, 'screen')).toBeVisible({ timeout: 30_000 })
        await expect(callTile(pages[2], account3Id!, 'screen')).toBeVisible({ timeout: 30_000 })
      })

      await test.step('both receivers show the correct owner at the bottom of each share', async () => {
        const activeSessions = await Promise.all(
          pages.map((page) => storedSessions(page).then((all) => all.at(-1)!)),
        )
        const names = await Promise.all(activeSessions.map(profileName))
        for (const receiver of [pages[1], pages[3]]) {
          for (const sharerIndex of [0, 2]) {
            const tile = callTile(receiver, activeSessions[sharerIndex].userId, 'screen')
            await expect(tile).toBeVisible({ timeout: 60_000 })
            await expect(tile.getByTestId('call-tile-label')).toHaveText(
              new RegExp(`${names[sharerIndex].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*Screen`),
            )
            await tile.getByRole('button', { name: 'View screen' }).click()
            await expect(tile.locator('video')).toBeVisible({ timeout: 30_000 })
          }
        }
      })

      await test.step('the receiving client gets the distinct pixels from both named shares', async () => {
        const sharerIds = [account1Id!, account3Id!]
        for (let index = 0; index < sharerIds.length; index++) {
          const video = callTile(pages[1], sharerIds[index], 'screen').locator('video')
          const expectedColor = shareColors[index]
          await expect
            .poll(
              async () => {
                const sampled = await video.evaluate((element: HTMLVideoElement) => {
                  if (!element.videoWidth || !element.videoHeight) return undefined
                  const canvas = document.createElement('canvas')
                  canvas.width = element.videoWidth
                  canvas.height = element.videoHeight
                  const context = canvas.getContext('2d')
                  if (!context) return undefined
                  context.drawImage(element, 0, 0)
                  const pixel = context.getImageData(
                    canvas.width >> 1,
                    canvas.height >> 1,
                    1,
                    1,
                  ).data
                  return { r: pixel[0], g: pixel[1], b: pixel[2] }
                })
                if (!sampled) return Number.POSITIVE_INFINITY
                return Math.sqrt(
                  (sampled.r - expectedColor.r) ** 2 +
                    (sampled.g - expectedColor.g) ** 2 +
                    (sampled.b - expectedColor.b) ** 2,
                )
              },
              { timeout: 45_000 },
            )
            .toBeLessThan(45)
        }
      })

      await test.step('both shares stop independently and everyone leaves', async () => {
        for (const sharer of [pages[0], pages[2]]) {
          await sharer.getByRole('button', { name: 'Screen sharing options' }).click()
          await sharer.mouse.move(0, 0)
          await sharer.getByRole('menuitem', { name: 'End stream' }).click()
        }
        for (const page of pages) {
          await expect(
            page.locator('[data-testid="call-tile"][data-media-kind="screen"]'),
          ).toHaveCount(0, { timeout: 45_000 })
          await page.getByRole('button', { name: 'Leave' }).click()
          sessions.push(...(await storedSessions(page)))
        }
      })
    } catch (error) {
      journeyError = error
    } finally {
      for (const page of pages) await page.close().catch(() => undefined)
      for (const browser of browsers) await browser.close().catch(() => undefined)
    }
    if (journeyError) throw journeyError
  })
})
