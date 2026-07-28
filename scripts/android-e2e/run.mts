#!/usr/bin/env node

import { chromium } from '@playwright/test'
import type { Browser as PwBrowser, Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { remote } from 'webdriverio'
import type { Browser as WdioBrowser, ChainablePromiseElement } from 'webdriverio'
import { adbBin, stopEmulator } from './lib/avd.mjs'
import { androidHome as resolveAndroidHome } from './lib/sdk.mjs'
import {
  adb,
  clearAppData,
  closeBackgroundApp,
  dumpsysActivitySummary,
  dumpsysNotifications,
  install,
  logcat,
  relaunchWithE2eDebugFlag,
  uninstall,
} from './support/adb'
import { startAppiumServer, type AppiumServer } from './support/appium'
import { androidE2eConfig, type AndroidE2eConfig } from './support/config'
import { pinch, swipe, tap } from './support/gestures'
import { waitForDecryptedNotification } from './support/notifications'
import { AndroidTestVideo } from './support/video'
import { startBrowserWebServer, type BrowserWebServer } from './support/web-server'
import {
  byLabel,
  byRole,
  byText,
  elementScreenRect,
  switchToNative,
  switchToWebview,
  testId,
} from './support/webview'

import {
  cleanTestRoom,
  resolveBaseUrl,
  storedSessions,
  wipeAllDevices,
  type StoredSession,
} from '../../tests/e2e/support/matrix-api'
import { openRoomActions, openRoomRow, sendMessage, signIn } from '../../tests/e2e/support/ui'
import type { MatrixTestAccount } from '../../tests/e2e/support/env'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '.out')
const videoPath = join(outDir, 'android-e2e.mp4')
mkdirSync(outDir, { recursive: true })

function log(step: string) {
  console.log(`\n=== ${step} ===`)
}

function firstDeviceSerial(androidHome: string): string {
  const result = spawnSync(adbBin(androidHome), ['devices'], { encoding: 'utf-8' })
  if (result.error) {
    throw new Error(
      `Could not run adb while looking for a booted Android device: ${result.error.message}`,
    )
  }
  const line = (result.stdout ?? '')
    .split('\n')
    .slice(1)
    .find((entry) => entry.trim().endsWith('\tdevice'))
  if (!line)
    throw new Error(`No booted Android device found via \`adb devices\`:\n${result.stdout}`)
  return line.split('\t')[0]!.trim()
}

async function readViewerTransform(browser: WdioBrowser) {
  return browser.execute(() => {
    const img = document.querySelector<HTMLImageElement>('img.viewerImage')
    if (!img) return null
    const transform = img.style.transform
    const scaleMatch = transform.match(/scale\(([-\d.]+)\)/)
    const translateMatch = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale/)
    return {
      scale: scaleMatch ? Number(scaleMatch[1]) : 1,
      x: translateMatch ? Number(translateMatch[1]) : 0,
      y: translateMatch ? Number(translateMatch[2]) : 0,
    }
  })
}

async function installViewerEventTrace(browser: WdioBrowser) {
  await browser.execute(() => {
    type ViewerEventTrace = {
      type: string
      elapsedMs: number
      target: string
      pointerId?: number
      pointerType?: string
      isPrimary?: boolean
      button?: number
      touches?: number
      changedTouches?: number
      transform: string | null
    }
    const state = window as typeof window & {
      __foxchatViewerEventTrace?: ViewerEventTrace[]
    }
    const started = performance.now()
    state.__foxchatViewerEventTrace = []
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'touchstart',
      'touchmove',
      'touchend',
      'touchcancel',
      'click',
    ]) {
      document.addEventListener(
        type,
        (event) => {
          const pointer = event instanceof PointerEvent ? event : undefined
          const touch = event instanceof TouchEvent ? event : undefined
          const target = event.target
          state.__foxchatViewerEventTrace?.push({
            type,
            elapsedMs: Math.round(performance.now() - started),
            target:
              target instanceof HTMLElement
                ? `${target.tagName.toLowerCase()}.${target.className}`
                : String(target),
            pointerId: pointer?.pointerId,
            pointerType: pointer?.pointerType,
            isPrimary: pointer?.isPrimary,
            button: pointer?.button,
            touches: touch?.touches.length,
            changedTouches: touch?.changedTouches.length,
            transform:
              document.querySelector<HTMLImageElement>('img.viewerImage')?.style.transform ?? null,
          })
        },
        { capture: true },
      )
    }
  })
}

async function readViewerEventTrace(browser: WdioBrowser) {
  return browser.execute(
    () =>
      (
        window as typeof window & {
          __foxchatViewerEventTrace?: unknown[]
        }
      ).__foxchatViewerEventTrace ?? [],
  )
}

async function eventMessageScreenRect(browser: WdioBrowser, body: string) {
  await switchToWebview(browser)
  const message = byText(browser, body)
  await message.waitForDisplayed({ timeout: 60_000 })
  await message.scrollIntoView({ block: 'center', inline: 'center' })
  const rect = await browser.execute((expectedBody) => {
    const eventRows = [...document.querySelectorAll<HTMLElement>('[data-event-id^="$"]')]
    const eventRow = [...eventRows]
      .reverse()
      .find((candidate) => candidate.innerText.includes(expectedBody))
    const messageRow = [...(eventRow?.children ?? [])].find(
      (candidate) => candidate instanceof HTMLElement && candidate.innerText.includes(expectedBody),
    )
    if (!(messageRow instanceof HTMLElement)) return null
    const box = messageRow.getBoundingClientRect()
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      dpr: window.devicePixelRatio,
    }
  }, body)
  if (!rect) throw new Error(`Could not find a rendered message row for "${body}"`)
  await switchToNative(browser)
  return {
    x: rect.x * rect.dpr,
    y: rect.y * rect.dpr,
    width: rect.width * rect.dpr,
    height: rect.height * rect.dpr,
  }
}

async function exerciseReplyGesture(browser: WdioBrowser, body: string) {
  const rect = await eventMessageScreenRect(browser, body)
  const y = rect.y + rect.height / 2
  await swipe(browser, { x: rect.x + rect.width * 0.78, y }, { x: rect.x + rect.width * 0.32, y })

  await switchToWebview(browser)
  const replyTray = browser.$('.replyText')
  await replyTray.waitForDisplayed({ timeout: 10_000 })
  if (!(await replyTray.getText()).includes(body))
    throw new Error('Swipe-to-reply opened a tray for the wrong message')
  const placeholder = await testId(browser, 'message-composer').getAttribute('data-placeholder')
  if (!placeholder?.startsWith('Reply to '))
    throw new Error(
      `Swipe-to-reply did not arm the composer (placeholder: ${JSON.stringify(placeholder)})`,
    )
  const cancel = browser.$('button[title="Cancel reply"]')
  await cancel.waitForDisplayed({ timeout: 10_000 })
  await cancel.click()
  await cancel.waitForDisplayed({ timeout: 10_000, reverse: true })
}

async function drawerState(browser: WdioBrowser) {
  await switchToWebview(browser)
  const urlOpen = await browser.execute(
    () => new URL(window.location.href).searchParams.get('drawerOpen') === 'true',
  )
  const sidebars = await browser.$$('[data-testid="room-sidebar"]')
  const visibility = await sidebars.map((sidebar) => sidebar.isDisplayed().catch(() => false))
  return {
    urlOpen,
    visibleSidebarCount: visibility.filter(Boolean).length,
  }
}

async function openRoomDrawer(browser: WdioBrowser) {
  const initial = await drawerState(browser)
  if (initial.urlOpen && initial.visibleSidebarCount > 0) return

  await browser.waitUntil(
    async () => {
      const state = await drawerState(browser)
      if (state.urlOpen && state.visibleSidebarCount > 0) return true
      await switchToWebview(browser)
      await browser.execute(() => window.dispatchEvent(new Event('foxchat-open-drawer')))
      return false
    },
    {
      timeout: 30_000,
      interval: 500,
      timeoutMsg: 'Swipe-right did not open and render the left room drawer',
    },
  )
}

async function openAndroidRoom(browser: WdioBrowser, roomId: string, roomName: string) {
  await switchToWebview(browser)
  const heading = byRole(browser, 'heading', roomName)
  if (await heading.isDisplayed().catch(() => false)) return

  await openRoomDrawer(browser)
  const escapedRoomId = roomId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const roomRow = browser.$(`[data-testid="room-row"][data-room-id="${escapedRoomId}"]`)
  await roomRow.waitForDisplayed({ timeout: 30_000 })
  await domClick(browser, roomRow)
  await heading.waitForDisplayed({ timeout: 30_000 })
}

async function displayedTestId(browser: WdioBrowser, id: string) {
  await switchToWebview(browser)
  const matches = await browser.$$(`[data-testid="${id}"]`)
  for (const match of matches) {
    if (await match.isDisplayed().catch(() => false)) return match
  }
  throw new Error(`No displayed [data-testid="${id}"] element was found`)
}

async function displayedCss(browser: WdioBrowser, selector: string) {
  await switchToWebview(browser)
  return displayedCssWithin(browser, selector)
}

async function displayedCssWithin(scope: WdioBrowser | ChainablePromiseElement, selector: string) {
  const matches = await scope.$$(selector)
  for (const match of matches) {
    if (await match.isDisplayed().catch(() => false)) return match
  }
  throw new Error(`No displayed element matched ${JSON.stringify(selector)}`)
}

async function displayedNamedElement(
  scope: WdioBrowser | ChainablePromiseElement,
  selector: string,
  name: string,
) {
  const matches = await scope.$$(selector)
  let exactFallback: WebdriverIO.Element | undefined
  for (const match of matches) {
    const [text, ariaLabel] = await Promise.all([
      match
        .getProperty('textContent')
        .then((value) => String(value ?? ''))
        .catch(() => ''),
      match.getAttribute('aria-label').catch(() => null),
    ])
    if (text.trim() !== name && ariaLabel !== name) continue
    exactFallback ??= match
    if (await match.isDisplayed().catch(() => false)) return match
  }
  if (exactFallback) return exactFallback
  throw new Error(`No ${selector} element named ${JSON.stringify(name)} was found`)
}

async function domClick(
  browser: WdioBrowser,
  element: WebdriverIO.Element | ChainablePromiseElement,
) {
  const target = await element
  await browser.execute((node) => node.click(), target)
}

async function exerciseDrawerGestures(browser: WdioBrowser) {
  const initial = await drawerState(browser)
  if (initial.urlOpen) throw new Error('Room drawer was unexpectedly open before gesture test')

  const main = await elementScreenRect(browser, 'main')
  const mainY = main.y + main.height * 0.45
  await swipe(
    browser,
    { x: main.x + Math.max(24, main.width * 0.08), y: mainY },
    { x: main.x + main.width * 0.55, y: mainY },
  )
  await browser.waitUntil(
    async () => {
      const state = await drawerState(browser)
      return state.urlOpen && state.visibleSidebarCount > 0
    },
    {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: 'Swipe-right did not open and render the left room drawer',
    },
  )

  await switchToWebview(browser)
  const viewport = await browser.execute(() => ({
    width: window.innerWidth * window.devicePixelRatio,
    height: window.innerHeight * window.devicePixelRatio,
  }))
  await switchToNative(browser)
  await swipe(
    browser,
    { x: viewport.width * 0.75, y: viewport.height * 0.45 },
    { x: viewport.width * 0.25, y: viewport.height * 0.45 },
  )
  await browser.waitUntil(
    async () => {
      const state = await drawerState(browser)
      return !state.urlOpen && state.visibleSidebarCount === 0
    },
    {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: 'Swipe-left did not close and hide the left room drawer',
    },
  )
}

async function roomRowScreenCenter(browser: WdioBrowser, roomId: string) {
  await switchToWebview(browser)
  const rect = await browser.execute((expectedRoomId) => {
    const row = [...document.querySelectorAll<HTMLElement>('[data-testid="room-row"]')].find(
      (candidate) =>
        candidate.dataset.roomId === expectedRoomId &&
        candidate.getClientRects().length > 0 &&
        getComputedStyle(candidate).visibility !== 'hidden',
    )
    if (!row) return null
    const box = row.getBoundingClientRect()
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      dpr: window.devicePixelRatio,
    }
  }, roomId)
  if (!rect) throw new Error(`Could not find a visible drawer row for ${roomId}`)
  await switchToNative(browser)
  return {
    x: (rect.x + rect.width / 2) * rect.dpr,
    y: (rect.y + rect.height / 2) * rect.dpr,
  }
}

async function waitForSingleTapRoomSelection(
  browser: WdioBrowser,
  roomId: string,
  roomName: string,
) {
  await browser.waitUntil(
    async () => {
      await switchToWebview(browser)
      return browser.execute(
        ({ expectedRoomId, expectedRoomName }) => {
          const url = new URL(window.location.href)
          const drawerOpen = url.searchParams.get('drawerOpen') === 'true'
          const heading = [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')].some(
            (candidate) =>
              candidate.textContent?.trim() === expectedRoomName &&
              (candidate as HTMLElement).getClientRects().length > 0,
          )
          return url.searchParams.get('room') === expectedRoomId && !drawerOpen && heading
        },
        { expectedRoomId: roomId, expectedRoomName: roomName },
      )
    },
    {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: `One native tap after opening the drawer did not select ${roomName}`,
    },
  )
}

async function selectRoomWithOneNativeTap(
  browser: WdioBrowser,
  roomId: string,
  roomName: string,
  previouslySelectedRoomId: string,
) {
  await switchToWebview(browser)
  const beforeTap = await browser.execute(() => {
    const url = new URL(window.location.href)
    return {
      roomId: url.searchParams.get('room'),
      drawerOpen: url.searchParams.get('drawerOpen') === 'true',
    }
  })
  if (beforeTap.roomId !== previouslySelectedRoomId || !beforeTap.drawerOpen)
    throw new Error(
      `Drawer gesture changed navigation before the intended tap: ${JSON.stringify(beforeTap)}`,
    )
  const center = await roomRowScreenCenter(browser, roomId)
  await tap(browser, center)
  await waitForSingleTapRoomSelection(browser, roomId, roomName)
}

async function exerciseDrawerRoomSelection(
  browser: WdioBrowser,
  gestureTarget: { roomId: string; roomName: string },
  toolbarTarget: { roomId: string; roomName: string },
) {
  const initial = await drawerState(browser)
  if (initial.urlOpen) throw new Error('Room drawer was unexpectedly open before selection test')

  const main = await elementScreenRect(browser, 'main')
  const mainY = main.y + main.height * 0.45
  await swipe(
    browser,
    { x: main.x + Math.max(24, main.width * 0.08), y: mainY },
    { x: main.x + main.width * 0.55, y: mainY },
  )
  await browser.waitUntil(
    async () => {
      const state = await drawerState(browser)
      return state.urlOpen && state.visibleSidebarCount > 0
    },
    {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: 'Swipe-right did not open the drawer for the single-tap room test',
    },
  )
  await selectRoomWithOneNativeTap(
    browser,
    gestureTarget.roomId,
    gestureTarget.roomName,
    toolbarTarget.roomId,
  )

  await switchToWebview(browser)
  await byRole(browser, 'button', 'Open room list').click()
  await browser.waitUntil(
    async () => {
      const state = await drawerState(browser)
      return state.urlOpen && state.visibleSidebarCount > 0
    },
    {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: 'Toolbar button did not open the drawer for the control selection',
    },
  )
  await selectRoomWithOneNativeTap(
    browser,
    toolbarTarget.roomId,
    toolbarTarget.roomName,
    gestureTarget.roomId,
  )
}

async function sessionsFromAndroidStorage(browser: WdioBrowser): Promise<StoredSession[]> {
  await switchToWebview(browser)
  return browser.execute(() => {
    try {
      return JSON.parse(localStorage.getItem('foxchat.matrix.accounts') ?? '[]')
    } catch {
      return []
    }
  })
}

async function storedAndroidAccountCount(browser: WdioBrowser) {
  return browser.execute(() => {
    try {
      const accounts = JSON.parse(localStorage.getItem('foxchat.matrix.accounts') ?? '[]')
      return Array.isArray(accounts) ? accounts.length : 0
    } catch {
      return 0
    }
  })
}

async function waitForStoredAndroidAccounts(
  browser: WdioBrowser,
  minimum: number,
  timeout = 90_000,
) {
  await browser.waitUntil(async () => (await storedAndroidAccountCount(browser)) >= minimum, {
    timeout,
    interval: 500,
    timeoutMsg: `Android did not persist ${minimum} Matrix account(s)`,
  })
}

async function allowAndroidNotificationPermission(browser: WdioBrowser, packageName: string) {
  await switchToNative(browser)
  const allow = browser.$('id=com.android.permissioncontroller:id/permission_allow_button')
  const appeared = await allow
    .waitForDisplayed({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  if (!appeared) {
    const permission = adb([
      'shell',
      'pm',
      'check-permission',
      '--user',
      '0',
      'android.permission.POST_NOTIFICATIONS',
      packageName,
    ]).trim()
    if (permission === 'granted') {
      await switchToWebview(browser)
      return
    }
    throw new Error(
      `Android did not request the "Allow FoxChat to send you notifications" permission after login and POST_NOTIFICATIONS is ${permission || 'not granted'}`,
    )
  }
  await allow.click()
  await allow.waitForDisplayed({ timeout: 10_000, reverse: true })
  await switchToWebview(browser)
}

async function fillAndroidInput(
  browser: WdioBrowser,
  input: ReturnType<typeof byLabel> | WebdriverIO.Element,
  value: string,
) {
  const element = await input
  await browser.execute(
    (target, nextValue) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!setter) throw new Error('HTMLInputElement value setter is unavailable')
      setter.call(target, nextValue)
      target.dispatchEvent(new Event('input', { bubbles: true }))
      target.dispatchEvent(new Event('change', { bubbles: true }))
    },
    element,
    value,
  )
}

async function loginAndroid(browser: WdioBrowser, account: MatrixTestAccount) {
  await switchToWebview(browser)
  await waitForAndroidLoginPage(browser)
  await installSanitizedFetchTrace(browser)
  const homeserverInput = byLabel(browser, 'Homeserver')
  await fillAndroidInput(browser, homeserverInput, account.homeserver)
  console.log(`Android homeserver input: ${await homeserverInput.getValue()}`)
  await fillAndroidInput(browser, byLabel(browser, 'Matrix ID or username'), account.userId)
  await fillAndroidInput(browser, byLabel(browser, 'Password'), account.password)
  await submitAndroidLogin(
    browser,
    byRole(browser, 'button', 'Sign in'),
    async () => (await storedAndroidAccountCount(browser)) >= 1,
    'primary-account login',
    account.password,
  )
}

async function submitAndroidLogin(
  browser: WdioBrowser,
  submit: ReturnType<typeof byRole>,
  succeeded: () => Promise<boolean>,
  label: string,
  password: string,
) {
  let lastError = ''
  const maxAttempts = Number(process.env.ANDROID_E2E_LOGIN_ATTEMPTS || 3)
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await submit.waitForEnabled({ timeout: 30_000 })
    await submit.click()
    await browser.waitUntil(
      async () => {
        if (await succeeded()) return true
        const errors = await browser.$$('.ant-message-error')
        for (const error of errors) {
          if (!(await error.isDisplayed().catch(() => false))) continue
          lastError = (await error.getText().catch(() => '')).trim()
          return true
        }
        return false
      },
      {
        timeout: 90_000,
        interval: 500,
        timeoutMsg: `${label} produced neither the authenticated UI nor an error`,
      },
    )
    if (await succeeded()) return
    if (attempt === maxAttempts)
      throw new Error(
        `${label} failed after ${attempt} attempt${attempt === 1 ? '' : 's'}${
          lastError ? `: ${lastError}` : ''
        }; request trace: ${JSON.stringify(await readSanitizedFetchTrace(browser))}`,
      )

    await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 30_000))
    await fillAndroidInput(browser, byLabel(browser, 'Password'), password)
  }
}

type SanitizedFetchTrace = {
  method: string
  path: string
  status?: number
  error?: string
}

async function installSanitizedFetchTrace(browser: WdioBrowser) {
  await browser.execute(() => {
    const state = window as typeof window & {
      __foxchatE2eFetchTrace?: SanitizedFetchTrace[]
      __foxchatE2eFetchWrapped?: boolean
    }
    if (state.__foxchatE2eFetchWrapped) return
    state.__foxchatE2eFetchWrapped = true
    state.__foxchatE2eFetchTrace = []
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input : undefined
      const method = String(init?.method ?? request?.method ?? 'GET').toUpperCase()
      let path = '<invalid-url>'
      try {
        path = new URL(request?.url ?? String(input), location.href).pathname
        if (path.startsWith('//')) path = '<malformed-absolute-path>'
      } catch {}
      try {
        const response = await originalFetch(input, init)
        state.__foxchatE2eFetchTrace?.push({
          method,
          path,
          status: response.status,
        })
        return response
      } catch (error) {
        state.__foxchatE2eFetchTrace?.push({
          method,
          path,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      } finally {
        if ((state.__foxchatE2eFetchTrace?.length ?? 0) > 100)
          state.__foxchatE2eFetchTrace?.splice(0, 50)
      }
    }
  })
}

async function readSanitizedFetchTrace(browser: WdioBrowser): Promise<SanitizedFetchTrace[]> {
  return browser.execute(() => {
    const state = window as typeof window & {
      __foxchatE2eFetchTrace?: SanitizedFetchTrace[]
    }
    return (state.__foxchatE2eFetchTrace ?? []).slice(-200)
  })
}

async function waitForAndroidLoginPage(browser: WdioBrowser) {
  const loginPage = testId(browser, 'login-page')
  try {
    await loginPage.waitForDisplayed({ timeout: 30_000 })
  } catch (error) {
    const startupText = await browser
      .execute(() => document.body?.innerText?.trim() ?? '')
      .catch(() => '')
    const startupUrl = await browser.getUrl().catch(() => '')
    if (/Failed to request https?:\/\//i.test(startupText))
      throw new Error(
        [
          'The installed APK is a development shell whose configured Vite',
          `server is unavailable (${startupUrl || startupText}).`,
          'Point ANDROID_E2E_APK_PATH at the already-produced asset-bearing',
          'CI APK (the signed universal APK in the Android worker).',
        ].join(' '),
        { cause: error },
      )
    throw new Error(
      `FoxChat's login page did not appear (WebView URL: ${startupUrl || 'unknown'}).`,
      { cause: error },
    )
  }
}

async function verifyWebviewNetwork(browser: WdioBrowser, homeserver: string) {
  const probe = async (baseUrl: string) =>
    browser.executeAsync<
      {
        ok: boolean
        status?: number
        error?: string
        online: boolean
        origin: string
      },
      [string]
    >((url, done) => {
      const target = new URL('/_matrix/client/versions', url).toString()
      fetch(target)
        .then((response) =>
          done({
            ok: response.ok,
            status: response.status,
            online: navigator.onLine,
            origin: location.origin,
          }),
        )
        .catch((error: unknown) =>
          done({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            online: navigator.onLine,
            origin: location.origin,
          }),
        )
    }, baseUrl)

  for (const [label, url] of [
    ['public Matrix endpoint', 'https://matrix.org'],
    [
      'configured homeserver',
      /^https?:\/\//i.test(homeserver) ? homeserver : `https://${homeserver}`,
    ],
  ] as const) {
    const result = await probe(url)
    if (!result.ok)
      throw new Error(
        `Android WebView could not reach the ${label} from ${result.origin} ` +
          `(online=${result.online}, status=${result.status ?? 'none'}): ` +
          `${result.error ?? 'HTTP request failed'}`,
      )
  }
}

async function addAccountAndroid(browser: WdioBrowser, account: MatrixTestAccount) {
  await switchToWebview(browser)
  await installSanitizedFetchTrace(browser)
  await openRoomDrawer(browser)
  await domClick(browser, await displayedTestId(browser, 'account-menu'))
  await byText(browser, 'Switch accounts').click()
  const accounts = byRole(browser, 'dialog', 'Accounts')
  await accounts.waitForDisplayed({ timeout: 10_000 })
  await byRole(accounts, 'button', 'Log in with another account').click()
  await fillAndroidInput(browser, byLabel(browser, 'Homeserver'), account.homeserver)
  await fillAndroidInput(browser, byLabel(browser, 'Matrix ID or username'), account.userId)
  await fillAndroidInput(browser, byLabel(browser, 'Password'), account.password)
  await submitAndroidLogin(
    browser,
    byRole(browser, 'button', 'Log in and save account'),
    async () => !(await accounts.isDisplayed().catch(() => false)),
    'additional-account login',
    account.password,
  )
  await waitForStoredAndroidAccounts(browser, 2)
}

async function restoreBackup(browser: WdioBrowser, recoveryKey: string) {
  await switchToWebview(browser)
  await openRoomDrawer(browser)
  await domClick(browser, await displayedTestId(browser, 'account-menu'))
  await domClick(browser, await displayedCss(browser, 'button[aria-label="Open settings"]'))
  const settings = byRole(browser, 'dialog', 'Settings')
  await settings.waitForDisplayed({ timeout: 10_000 })
  await domClick(browser, await displayedNamedElement(settings, '[role="tab"]', 'Security'))
  await domClick(
    browser,
    await displayedNamedElement(settings, 'button,[role="button"]', 'Restore encrypted history'),
  )
  const restore = byRole(browser, 'dialog', 'Restore encrypted history')
  await restore.waitForDisplayed({ timeout: 10_000 })
  const recoveryInput = await displayedCssWithin(restore, 'input[type="password"]')
  await recoveryInput.addValue(recoveryKey)
  const restoreButton = await displayedNamedElement(
    restore,
    'button,[role="button"]',
    'Restore keys',
  )
  await browser.execute(() => {
    const state = window as typeof window & {
      __foxchatE2eRecoveryProgress?: string[]
    }
    state.__foxchatE2eRecoveryProgress = []
    window.addEventListener('foxchat-recovery-progress', ((event: CustomEvent) => {
      state.__foxchatE2eRecoveryProgress?.push(String(event.detail))
    }) as EventListener)
  })
  await domClick(browser, restoreButton)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000))
  const restoreStarted = await restoreButton
    .getAttribute('class')
    .then((className) => className?.includes('ant-btn-loading'))
    .catch(() => false)
  if (!restoreStarted && (await restore.isDisplayed().catch(() => false)))
    throw new Error('Recovery submission did not enter the loading state')
  let restoreError = ''
  let backupKeyCount: number | undefined
  let importedKeyCount: number | undefined
  let onDemandRecoveryEnabled = false
  await browser.waitUntil(
    async () => {
      const progress = await browser.execute(() => {
        const state = window as typeof window & {
          __foxchatE2eRecoveryProgress?: string[]
        }
        return state.__foxchatE2eRecoveryProgress ?? []
      })
      const complete = progress.find((entry) => entry.startsWith('restore-complete:'))
      if (complete) {
        const [total, imported] = complete.slice('restore-complete:'.length).split(':').map(Number)
        backupKeyCount = total
        importedKeyCount = imported
        return true
      }
      if (progress.includes('recovery-enabled')) {
        onDemandRecoveryEnabled = true
        return true
      }
      const errors = await browser.$$('.ant-message-error')
      for (const error of errors) {
        if (!(await error.isDisplayed().catch(() => false))) continue
        restoreError = String(await error.getProperty('textContent').catch(() => '')).trim()
        return true
      }
      return false
    },
    {
      timeout: 240_000,
      interval: 500,
      timeoutMsg: 'Recovery remained open without succeeding or reporting an error',
    },
  )
  if (restoreError) throw new Error(`Recovery-key restore failed: ${restoreError}`)
  if (
    !onDemandRecoveryEnabled &&
    (!Number.isFinite(backupKeyCount) || !Number.isFinite(importedKeyCount))
  )
    throw new Error('Recovery finished without a valid existing-backup restore result')
  await restore.waitForDisplayed({ reverse: true, timeout: 30_000 })
  console.log(
    onDemandRecoveryEnabled
      ? 'Existing backup unlocked; on-demand encrypted-history recovery enabled.'
      : `Existing backup unlocked and restored (${importedKeyCount}/${backupKeyCount} keys imported).`,
  )
}

async function verifyPushAutoSetup(
  browser: WdioBrowser,
  expectedAccounts: string[],
  expectedBackupRecoveryAccounts: string[] = [],
) {
  await switchToWebview(browser)
  await browser.refresh()
  await switchToWebview(browser)
  await waitForStoredAndroidAccounts(browser, 1, 30_000)
  await openRoomDrawer(browser)
  await domClick(browser, await displayedTestId(browser, 'account-menu'))
  await domClick(browser, await displayedCss(browser, 'button[aria-label="Open settings"]'))
  const settings = byRole(browser, 'dialog', 'Settings')
  await settings.waitForDisplayed({ timeout: 10_000 })
  await domClick(
    browser,
    await displayedNamedElement(settings, '[role="tab"]', 'Push notifications'),
  )
  await browser.waitUntil(
    async () => {
      const enabled = await byText(settings, 'Native background decrypt enabled', { exact: false })
        .isDisplayed()
        .catch(() => false)
      if (!enabled) return false
      const accountStates = await Promise.all(
        expectedAccounts.map((userId) =>
          byText(settings, userId)
            .isDisplayed()
            .catch(() => false),
        ),
      )
      if (!accountStates.every(Boolean)) return false
      const accountItems = await settings.$$('.ant-list-item')
      const itemTexts: string[] = []
      for (const item of accountItems)
        itemTexts.push(
          await item
            .getProperty('textContent')
            .then((value) => String(value ?? ''))
            .catch(() => ''),
        )
      return expectedBackupRecoveryAccounts.every((userId) =>
        itemTexts.some(
          (text) => text.includes(userId) && text.includes('Key backup recovery: configured'),
        ),
      )
    },
    {
      timeout: 90_000,
      interval: 3000,
      timeoutMsg:
        'Push never auto-configured: expected a ' +
        '"Native background decrypt enabled" and all expected accounts in Settings > Push notifications.',
    },
  )
  await displayedNamedElement(settings, 'button,[role="button"]', 'Close')
    .then((button) => domClick(browser, button))
    .catch(() => undefined)
}

async function createEncryptedRoomAndInviteInBrowser(
  page: Page,
  roomName: string,
  inviteeUserId: string,
): Promise<string> {
  await openRoomActions(page)
  await page.getByText('Create a room', { exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a room' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('Room name').fill(roomName)
  const encryption = dialog.getByRole('switch', {
    name: 'Encrypt this room',
  })
  if ((await encryption.getAttribute('aria-checked')) !== 'true') await encryption.click()
  await dialog.getByRole('button', { name: 'Create room' }).click()
  await page
    .getByTestId('room-header')
    .getByRole('heading', { name: roomName })
    .waitFor({ state: 'visible', timeout: 60_000 })
  await page
    .getByText('Encrypted with Megolm', { exact: true })
    .waitFor({ state: 'visible', timeout: 30_000 })

  const roomId = new URL(page.url()).searchParams.get('room')
  if (!roomId) throw new Error(`Could not read room ID from browser URL: ${page.url()}`)

  await page.getByRole('button', { name: 'Room information' }).click()
  await page.getByText('Invite', { exact: true }).click()
  const invite = page.getByRole('dialog', { name: 'Invite to room' })
  await invite.waitFor({ state: 'visible', timeout: 10_000 })
  await invite.getByLabel('Matrix user ID').fill(inviteeUserId)
  await invite.getByRole('button', { name: 'Send invitation' }).click()
  await invite.waitFor({ state: 'hidden', timeout: 30_000 })

  return roomId
}

async function acceptInviteOnAndroid(
  browser: WdioBrowser,
  roomName: string,
  roomId: string,
  session: StoredSession,
) {
  let visibleInvitations: WebdriverIO.Element[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    await switchToWebview(browser)
    if (attempt > 0) {
      await browser.refresh()
      await switchToWebview(browser)
      await waitForStoredAndroidAccounts(browser, 1, 30_000)
    }
    await openRoomDrawer(browser)
    const appeared = await browser
      .waitUntil(
        async () => {
          const invitations = await browser.$$('.invitation')
          visibleInvitations = []
          for (const invitation of invitations)
            if (await invitation.isDisplayed().catch(() => false))
              visibleInvitations.push(invitation)
          return visibleInvitations.length > 0
        },
        {
          timeout: 60_000,
          interval: 1000,
          timeoutMsg: `Invitation for "${roomName}" did not appear on Android`,
        },
      )
      .then(() => true)
      .catch(() => false)
    if (appeared) break
  }
  if (!visibleInvitations.length)
    throw new Error(`Android did not render the server-confirmed invitation for ${roomId}`)
  const invitationTexts = await Promise.all(
    visibleInvitations.map((invitation) => invitation.getText()),
  )
  const matchingIndex = invitationTexts.findIndex((text) => text.includes(roomName))
  const invitation =
    visibleInvitations[
      matchingIndex >= 0 ? matchingIndex : visibleInvitations.length === 1 ? 0 : -1
    ]
  if (!invitation)
    throw new Error(
      `Android rendered invitations, but none matched "${roomName}": ${invitationTexts.join(' | ')}`,
    )
  const accept = await invitation.$('.//button[normalize-space(string(.))="Accept"]')
  await domClick(browser, accept)
  await waitForServerJoin(session, roomId)
  await byRole(browser, 'heading', roomName).waitForDisplayed({
    timeout: 90_000,
  })
}

async function waitForServerJoin(session: StoredSession, roomId: string) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const response = await fetch(`${session.baseUrl}/_matrix/client/v3/joined_rooms`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
    if (!response.ok)
      throw new Error(`Matrix joined-room checkpoint failed with HTTP ${response.status}`)
    const joined = (await response.json()) as { joined_rooms?: string[] }
    if (joined.joined_rooms?.includes(roomId)) return
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000))
  }
  throw new Error(`Android invitation action never changed ${roomId} to joined membership`)
}

async function waitForPublishedDeviceKey(
  browser: WdioBrowser,
  userId: string,
  timeoutMs = 60_000,
): Promise<StoredSession> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const session = (await sessionsFromAndroidStorage(browser)).find(
      (candidate) => candidate.userId === userId,
    )
    if (!session) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
      continue
    }
    const response = await fetch(`${session.baseUrl}/_matrix/client/v3/keys/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        device_keys: { [session.userId]: [session.deviceId] },
      }),
    })
    if (response.status === 401) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
      continue
    }
    if (!response.ok)
      throw new Error(`Android device-key checkpoint failed with HTTP ${response.status}`)
    const result = (await response.json()) as {
      device_keys?: Record<string, Record<string, unknown>>
    }
    if (result.device_keys?.[session.userId]?.[session.deviceId]) return session
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000))
  }
  const runtime = await browser
    .execute(() => ({
      promiseWithResolvers: typeof (Promise as PromiseConstructor & { withResolvers?: unknown })
        .withResolvers,
      userAgent: navigator.userAgent,
    }))
    .catch(() => ({ promiseWithResolvers: '<probe failed>', userAgent: '<probe failed>' }))
  const cryptoTrace = (await readSanitizedFetchTrace(browser)).filter(({ path }) =>
    /\/(?:keys(?:\/|$)|sync$|refresh$)/.test(path),
  )
  throw new Error(
    [
      `Android account ${userId} never published crypto keys for its current session device.`,
      `Runtime: ${JSON.stringify(runtime)}.`,
      `Crypto request trace: ${JSON.stringify(cryptoTrace)}`,
    ].join(' '),
  )
}

async function waitForServerInvite(session: StoredSession, roomId: string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const response = await fetch(`${session.baseUrl}/_matrix/client/v3/sync?timeout=0`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
    if (!response.ok)
      throw new Error(`Matrix invite checkpoint failed with HTTP ${response.status}`)
    const sync = (await response.json()) as {
      rooms?: { invite?: Record<string, unknown> }
    }
    if (roomId in (sync.rooms?.invite ?? {})) return
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000))
  }
  throw new Error("The invited room never appeared in the Android account's Matrix /sync")
}

async function primeEncryptedSession(
  page: Page,
  browser: WdioBrowser,
  roomId: string,
  roomName: string,
  body: string,
  recipientUserId: string,
  recipientDeviceId: string,
) {
  let resolveTargetedShare!: (shared: boolean) => void
  const targetedShare = new Promise<boolean>((resolveShare) => {
    resolveTargetedShare = resolveShare
  })
  const observedRecipients = new Set<string>()
  const observeKeyShare = (request: import('@playwright/test').Request) => {
    if (!request.url().includes('/sendToDevice/m.room.encrypted/')) return
    try {
      const payload = request.postDataJSON() as {
        messages?: Record<string, Record<string, unknown>>
      }
      for (const [userId, devices] of Object.entries(payload.messages ?? {}))
        for (const deviceId of Object.keys(devices)) observedRecipients.add(`${userId}/${deviceId}`)
      if (payload.messages?.[recipientUserId]?.[recipientDeviceId]) resolveTargetedShare(true)
    } catch {}
  }
  page.on('request', observeKeyShare)
  try {
    await page.reload()
    await openRoomRow(page, roomName)
    const selectedRoomId = new URL(page.url()).searchParams.get('room')
    if (selectedRoomId !== roomId)
      throw new Error(
        `Browser reopened the wrong encrypted room: expected ${roomId}, got ${selectedRoomId ?? 'no room'}`,
      )
    await page.getByTestId('message-composer').waitFor({
      state: 'visible',
      timeout: 60_000,
    })
    await sendMessage(page, body)
    const shared = await Promise.race([
      targetedShare,
      page.waitForTimeout(30_000).then(() => false),
    ])
    if (!shared)
      throw new Error(
        `Browser sender did not share the new room key with Android device ${recipientDeviceId}; observed encrypted to-device recipients: ${[...observedRecipients].join(', ') || 'none'}`,
      )
  } finally {
    page.off('request', observeKeyShare)
  }
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await switchToWebview(browser)
    await browser.refresh()
    await switchToWebview(browser)
    await waitForStoredAndroidAccounts(browser, 1, 30_000)
    await openAndroidRoom(browser, roomId, roomName)
    const message = byText(browser, body)
    const visible = await browser
      .waitUntil(() => message.isDisplayed().catch(() => false), {
        timeout: 15_000,
        interval: 1000,
      })
      .then(() => true)
      .catch(() => false)
    if (visible) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 3000))
      return
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5000))
  }
  throw new Error(
    'Android did not decrypt the priming message within two minutes of receiving the room key',
  )
}

async function waitForDecryptedNotificationWithDiagnostics(
  browser: WdioBrowser,
  packageName: string,
  mainActivity: string,
  roomId: string,
  expectedBody: string,
) {
  try {
    return await waitForDecryptedNotification(roomId, expectedBody)
  } catch (notificationError) {
    let nativeStatus: unknown = '<unavailable>'
    try {
      relaunchWithE2eDebugFlag(packageName, mainActivity)
      await switchToWebview(browser)
      await waitForStoredAndroidAccounts(browser, 1, 30_000)
      nativeStatus = await browser.executeAsync((done) => {
        const invoke = (
          window as typeof window & {
            __TAURI_INTERNALS__?: {
              invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>
            }
          }
        ).__TAURI_INTERNALS__?.invoke
        if (!invoke) {
          done('<Tauri invoke unavailable>')
          return
        }
        void invoke('plugin:remote-push|native_crypto_status')
          .then(done)
          .catch((error) =>
            done({
              statusReadError: error instanceof Error ? error.message : String(error),
            }),
          )
      })
    } catch (statusError) {
      nativeStatus = {
        statusReadError: statusError instanceof Error ? statusError.message : String(statusError),
      }
    }
    throw new Error(
      `${notificationError instanceof Error ? notificationError.message : String(notificationError)} Native crypto status: ${JSON.stringify(nativeStatus)}`,
      { cause: notificationError },
    )
  }
}

async function sendImageGalleryAndOpenViewer(page: Page, browser: WdioBrowser) {
  const fixtures = [
    resolve(__dirname, '..', '..', 'foxlogo.png'),
    resolve(__dirname, '..', '..', 'public', 'favicon.png'),
  ]
  await page.locator('input[type="file"]').setInputFiles(fixtures)
  await page.getByText('foxlogo.png', { exact: true }).waitFor({
    state: 'visible',
    timeout: 15_000,
  })
  await page.getByText('favicon.png', { exact: true }).waitFor({
    state: 'visible',
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'Send message' }).click()
  await page.getByTestId('message-gallery').last().waitFor({
    state: 'visible',
    timeout: 60_000,
  })

  await switchToWebview(browser)
  const gallery = testId(browser, 'message-gallery')
  await gallery.waitForDisplayed({ timeout: 60_000 })
  await byRole(browser, 'button', 'Open image 1 of 2').click()
  await byRole(browser, 'dialog', 'Image viewer').waitForDisplayed({ timeout: 10_000 })
}

async function sendSingleImageAndOpenViewer(page: Page, browser: WdioBrowser) {
  const fixture = resolve(__dirname, '..', '..', 'foxlogo.png')
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await page.getByText('foxlogo.png', { exact: true }).waitFor({
    state: 'visible',
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'Send message' }).click()
  await page.getByTestId('message-image').last().waitFor({
    state: 'visible',
    timeout: 60_000,
  })

  await switchToWebview(browser)
  const standalone = testId(browser, 'message-image')
  await standalone.waitForDisplayed({ timeout: 60_000 })
  if (await testId(browser, 'message-gallery').isExisting())
    throw new Error('A single image was rendered as a gallery')
  const image = standalone.$('.//img')
  await image.waitForDisplayed({ timeout: 10_000 })
  await image.click()
  await byRole(browser, 'dialog', 'Image viewer').waitForDisplayed({ timeout: 10_000 })
  if (
    (await byRole(browser, 'button', 'Previous image').isExisting()) ||
    (await byRole(browser, 'button', 'Next image').isExisting())
  )
    throw new Error('A standalone image viewer unexpectedly exposed gallery navigation')
  await byRole(browser, 'button', 'Close image').click()
  await byRole(browser, 'dialog', 'Image viewer').waitForDisplayed({
    timeout: 10_000,
    reverse: true,
  })
}

async function exerciseImageViewerGestures(browser: WdioBrowser) {
  await switchToWebview(browser)
  let rect = await elementScreenRect(browser, 'img.viewerImage')
  await switchToWebview(browser)
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  const short = Math.min(rect.width, rect.height)

  const viewerAlt = () =>
    browser.execute(() => document.querySelector<HTMLImageElement>('img.viewerImage')?.alt ?? null)
  const firstAlt = await viewerAlt()
  if (!firstAlt) throw new Error('Gallery viewer did not expose the first image label')

  log('navigate the gallery with arrow buttons')
  await byRole(browser, 'button', 'Next image').click()
  await browser.waitUntil(async () => (await viewerAlt()) !== firstAlt, {
    timeout: 10_000,
    interval: 200,
    timeoutMsg: 'Next-image arrow did not change the gallery image',
  })
  await byRole(browser, 'button', 'Previous image').click()
  await browser.waitUntil(async () => (await viewerAlt()) === firstAlt, {
    timeout: 10_000,
    interval: 200,
    timeoutMsg: 'Previous-image arrow did not return to the first gallery image',
  })

  log('swipe left and right between gallery images while unzoomed')
  await switchToNative(browser)
  await swipe(
    browser,
    { x: center.x + Math.min(110, rect.width * 0.25), y: center.y },
    { x: center.x - Math.min(110, rect.width * 0.25), y: center.y },
  )
  await switchToWebview(browser)
  await browser.waitUntil(async () => (await viewerAlt()) !== firstAlt, {
    timeout: 10_000,
    interval: 200,
    timeoutMsg: 'Left swipe did not advance the gallery image',
  })
  rect = await elementScreenRect(browser, 'img.viewerImage')
  await switchToNative(browser)
  await swipe(
    browser,
    { x: center.x - Math.min(110, rect.width * 0.25), y: center.y },
    { x: center.x + Math.min(110, rect.width * 0.25), y: center.y },
  )
  await switchToWebview(browser)
  await browser.waitUntil(async () => (await viewerAlt()) === firstAlt, {
    timeout: 10_000,
    interval: 200,
    timeoutMsg: 'Right swipe did not return to the first gallery image',
  })

  log('pinch out to zoom in')
  await switchToWebview(browser)
  await installViewerEventTrace(browser)
  await switchToNative(browser)
  await pinch(browser, center, {
    startDistance: short * 0.16,
    endDistance: short * 0.5,
  })
  await switchToWebview(browser)
  let transform = await readViewerTransform(browser)
  if (!transform || transform.scale <= 1.05) {
    const trace = await readViewerEventTrace(browser)
    throw new Error(
      `Pinch-zoom did not increase scale (got ${JSON.stringify(transform)}). ` +
        `Captured events: ${JSON.stringify(trace)}`,
    )
  }

  log('drag to pan')
  await switchToNative(browser)
  await swipe(browser, center, { x: center.x - 80, y: center.y - 40 })
  await switchToWebview(browser)
  const panned = await readViewerTransform(browser)
  if (!panned || (panned.x === transform.x && panned.y === transform.y))
    throw new Error(
      `Pan did not change the image offset (before ${JSON.stringify(transform)}, after ${JSON.stringify(panned)})`,
    )
  transform = panned

  log('tap once to reset zoom')
  await switchToNative(browser)
  await tap(browser, center)
  await switchToWebview(browser)
  const reset = await readViewerTransform(browser)
  if (!reset || Math.abs(reset.scale - 1) > 0.05)
    throw new Error(`Single tap did not reset zoom (got ${JSON.stringify(reset)})`)

  log('tap again to close the viewer')
  await switchToNative(browser)
  await tap(browser, center)
  await switchToWebview(browser)
  await byRole(browser, 'dialog', 'Image viewer').waitForDisplayed({
    timeout: 10_000,
    reverse: true,
  })
}

async function saveFailureDiagnostics(
  browser: WdioBrowser | undefined,
  label: string,
  packageName?: string,
) {
  try {
    if (browser) {
      await switchToNative(browser).catch(() => undefined)
      const shot = await browser.takeScreenshot()
      await writeFile(join(outDir, `${label}.png`), Buffer.from(shot, 'base64'))
    }
  } catch (error) {
    console.error('Could not capture failure screenshot:', error)
  }
  try {
    await writeFile(join(outDir, `${label}-notifications.txt`), dumpsysNotifications())
  } catch (error) {
    console.error('Could not dump notifications for diagnostics:', error)
  }
  try {
    await writeFile(join(outDir, `${label}-logcat.txt`), logcat())
  } catch (error) {
    console.error('Could not dump logcat for diagnostics:', error)
  }
  if (packageName) {
    try {
      await writeFile(join(outDir, `${label}-activity.txt`), dumpsysActivitySummary(packageName))
    } catch (error) {
      console.error('Could not dump activity state for diagnostics:', error)
    }
  }
}

async function main() {
  const { enabled, reason, value: config } = androidE2eConfig()
  if (!enabled) {
    console.log(`Skipping Android e2e journey: ${reason}`)
    return
  }
  const cfg = config as AndroidE2eConfig
  const deviceKeyDiagnostic = process.env.ANDROID_E2E_DIAGNOSTIC === 'device-key-publication'

  const androidHome = cfg.androidHome || resolveAndroidHome()
  const serial = firstDeviceSerial(androidHome)
  console.log(`Using device ${serial}`)

  let appium: AppiumServer | undefined
  let browser: WdioBrowser | undefined
  let pwBrowser: PwBrowser | undefined
  let webServer: BrowserWebServer | undefined
  let video: AndroidTestVideo | undefined
  const sessions: StoredSession[] = []
  const roomIds: string[] = []

  try {
    log('resolve Matrix homeservers outside the WebView')
    ;[cfg.account1, cfg.account2, cfg.account3, cfg.account4] = await Promise.all(
      [cfg.account1, cfg.account2, cfg.account3, cfg.account4].map(async (account) => ({
        ...account,
        homeserver: await resolveBaseUrl(account.homeserver),
      })),
    )

    log('start Appium and install the app')
    appium = await startAppiumServer(cfg.appiumPort)
    uninstall(cfg.packageName)
    install(cfg.apkPath)
    clearAppData(cfg.packageName)
    browser = await remote({
      hostname: '127.0.0.1',
      port: appium.port,
      path: '/',
      logLevel: 'warn',
      capabilities: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:udid': serial,
        'appium:appPackage': cfg.packageName,
        'appium:appActivity': cfg.mainActivity,
        'appium:optionalIntentArguments': '--ez foxchat.e2e.webview_debug true',
        'appium:autoGrantPermissions': true,
        'appium:noReset': true,
        'appium:recreateChromeDriverSessions': true,
        'appium:ensureWebviewsHavePages': false,
        'appium:adbExecTimeout': 60_000,
        'appium:newCommandTimeout': 600,
      },
    })

    if ((process.env.ANDROID_E2E_RECORD_VIDEO ?? 'true').toLowerCase() !== 'false') {
      log('start full Android test recording')
      video = new AndroidTestVideo(browser, videoPath)
      await switchToNative(browser)
      await video.start()
      await switchToWebview(browser)
    }

    log('verify the installed APK is ready')
    await switchToWebview(browser)
    await waitForAndroidLoginPage(browser)
    await verifyWebviewNetwork(browser, cfg.account1.homeserver)

    log(
      deviceKeyDiagnostic
        ? 'wipe stale devices for Android account 1'
        : 'wipe stale devices for all four accounts',
    )
    const pwForCleanup = await chromium.launch()
    try {
      const accountsToClean = deviceKeyDiagnostic
        ? [cfg.account1]
        : [cfg.account1, cfg.account2, cfg.account3, cfg.account4]
      for (const account of accountsToClean) await wipeAllDevices(pwForCleanup, account)
    } finally {
      await pwForCleanup.close()
    }

    const runId = `${Date.now()}`
    const roomName = `${cfg.roomPrefix} android ${runId}`
    const secondRoomName = `${cfg.roomPrefix} android multi ${runId}`
    const firstPrime = `android encrypted-session prime ${runId}`
    const secondPrime = `android multi-account encrypted-session prime ${runId}`
    const firstMessage = `android push test message ${runId}`
    const secondMessage = `android multi-account push test message ${runId}`

    log('normal login as account 1')
    await loginAndroid(browser, cfg.account1)
    await allowAndroidNotificationPermission(browser, cfg.packageName)
    const primaryAndroidSessions = await sessionsFromAndroidStorage(browser)
    sessions.push(...primaryAndroidSessions)
    let primaryAndroidSession = primaryAndroidSessions.find(
      (session) => session.userId === cfg.account1.userId,
    )
    if (!primaryAndroidSession) throw new Error("Could not read account 1's Android Matrix session")
    primaryAndroidSession = await waitForPublishedDeviceKey(browser, cfg.account1.userId)
    if (deviceKeyDiagnostic) {
      const runtime = await browser.execute(() => ({
        promiseWithResolvers: typeof (Promise as PromiseConstructor & { withResolvers?: unknown })
          .withResolvers,
        userAgent: navigator.userAgent,
      }))
      console.log(
        `Android device ${primaryAndroidSession.deviceId} published its crypto keys. Runtime: ${JSON.stringify(runtime)}`,
      )
      return
    }

    log('load the backup keys')
    await restoreBackup(browser, cfg.account1.recoveryKey!)
    const postRecoverySessions = await sessionsFromAndroidStorage(browser)
    const postRecoveryPrimary = postRecoverySessions.find(
      (session) => session.userId === cfg.account1.userId,
    )
    if (!postRecoveryPrimary) throw new Error('Account 1 disappeared from Android after recovery')
    primaryAndroidSession = postRecoveryPrimary
    sessions.push(postRecoveryPrimary)
    primaryAndroidSession = await waitForPublishedDeviceKey(browser, cfg.account1.userId)

    log('check push notifications auto-set-up')
    await verifyPushAutoSetup(browser, [cfg.account1.userId], [cfg.account1.userId])

    log('sign accounts 3 and 4 into independent normal browsers')
    webServer = await startBrowserWebServer(cfg.baseUrl, cfg.skipWebServer)
    pwBrowser = await chromium.launch()
    const account3Context = await pwBrowser.newContext({
      baseURL: cfg.baseUrl,
      viewport: { width: 1280, height: 800 },
    })
    const account3Page = await account3Context.newPage()
    await signIn(account3Page, cfg.account3)
    sessions.push(...(await storedSessions(account3Page)))
    const account4Context = await pwBrowser.newContext({
      baseURL: cfg.baseUrl,
      viewport: { width: 1280, height: 800 },
    })
    const account4Page = await account4Context.newPage()
    await signIn(account4Page, cfg.account4)
    sessions.push(...(await storedSessions(account4Page)))

    log('account 3 creates an encrypted room and invites Android account 1')
    const roomId = await createEncryptedRoomAndInviteInBrowser(
      account3Page,
      roomName,
      cfg.account1.userId,
    )
    roomIds.push(roomId)
    await waitForServerInvite(primaryAndroidSession, roomId)
    await acceptInviteOnAndroid(browser, roomName, roomId, primaryAndroidSession)
    await primeEncryptedSession(
      account3Page,
      browser,
      roomId,
      roomName,
      firstPrime,
      cfg.account1.userId,
      primaryAndroidSession.deviceId,
    )

    log('close the Android app process and send from the normal browser')
    await switchToNative(browser)
    await closeBackgroundApp(cfg.packageName)
    await sendMessage(account3Page, firstMessage)
    console.log('Waiting 20s before checking for the push notification...')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20_000))
    await waitForDecryptedNotificationWithDiagnostics(
      browser,
      cfg.packageName,
      cfg.mainActivity,
      roomId,
      firstMessage,
    )
    console.log('Notification decrypted correctly while the app was backgrounded.')

    log('bring the app back and add a second account')
    relaunchWithE2eDebugFlag(cfg.packageName, cfg.mainActivity)
    await switchToWebview(browser)
    await waitForStoredAndroidAccounts(browser, 1, 30_000)
    await addAccountAndroid(browser, cfg.account2)
    const multiAccountSessions = await sessionsFromAndroidStorage(browser)
    sessions.push(...multiAccountSessions)
    const secondaryAndroidSession = multiAccountSessions.find(
      (session) => session.userId === cfg.account2.userId,
    )
    if (!secondaryAndroidSession)
      throw new Error("Could not read account 2's Android Matrix session")

    log('account 4 creates another encrypted room and invites Android account 2')
    const secondRoomId = await createEncryptedRoomAndInviteInBrowser(
      account4Page,
      secondRoomName,
      cfg.account2.userId,
    )
    roomIds.push(secondRoomId)
    await waitForServerInvite(secondaryAndroidSession, secondRoomId)
    await acceptInviteOnAndroid(browser, secondRoomName, secondRoomId, secondaryAndroidSession)
    await primeEncryptedSession(
      account4Page,
      browser,
      secondRoomId,
      secondRoomName,
      secondPrime,
      cfg.account2.userId,
      secondaryAndroidSession.deviceId,
    )

    log('confirm native push setup includes both Android accounts')
    await verifyPushAutoSetup(
      browser,
      [cfg.account1.userId, cfg.account2.userId],
      [cfg.account1.userId],
    )

    log('close the multi-account Android app process and send again')
    await switchToNative(browser)
    await closeBackgroundApp(cfg.packageName)
    await sendMessage(account4Page, secondMessage)
    console.log('Waiting 20s before checking for the second push notification...')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20_000))
    await waitForDecryptedNotificationWithDiagnostics(
      browser,
      cfg.packageName,
      cfg.mainActivity,
      secondRoomId,
      secondMessage,
    )
    console.log('Multi-account push still works after adding a second account.')

    log('bring the app back and open the second room')
    relaunchWithE2eDebugFlag(cfg.packageName, cfg.mainActivity)
    await switchToWebview(browser)
    await waitForStoredAndroidAccounts(browser, 2, 30_000)
    await openAndroidRoom(browser, secondRoomId, secondRoomName)

    log('swipe a message to activate reply')
    await exerciseReplyGesture(browser, secondMessage)

    log('swipe right/left to open and close the room drawer')
    await exerciseDrawerGestures(browser)

    log('select a room with one tap after gesture-opening the drawer')
    await exerciseDrawerRoomSelection(
      browser,
      { roomId, roomName },
      { roomId: secondRoomId, roomName: secondRoomName },
    )

    log('send and view a standalone image')
    await sendSingleImageAndOpenViewer(account4Page, browser)

    log('send an image gallery and open the viewer')
    await sendImageGalleryAndOpenViewer(account4Page, browser)
    await exerciseImageViewerGestures(browser)

    console.log('\nAndroid push notification journey completed successfully.')
  } catch (error) {
    console.error('\nAndroid e2e journey failed:', error)
    await saveFailureDiagnostics(browser, 'failure', cfg.packageName)
    process.exitCode = 1
  } finally {
    if (video) {
      try {
        await video.stop()
        console.log(`Android test video saved to ${videoPath}`)
      } catch (error) {
        console.error('Could not save Android test video:', error)
        process.exitCode = 1
      }
    }
    await pwBrowser?.close().catch(() => undefined)
    await webServer?.stop().catch(() => undefined)
    await browser?.deleteSession().catch(() => undefined)
    appium?.stop()
    try {
      for (const roomId of roomIds) await cleanTestRoom(roomId, sessions)
    } catch (error) {
      console.error('Room cleanup failed (non-fatal):', error)
    }
    stopEmulator(androidHome)
  }
}

main()
