import { isAndroidApp, isNativeApp } from './nativeBackground'
import type { Update } from '@tauri-apps/plugin-updater'

export const SKIPPED_DESKTOP_UPDATE_KEY = 'foxchat.desktopUpdate.skippedVersion'
const SUPPORTED_DESKTOP_UPDATE_BUNDLES = new Set(['nsis', 'msi', 'appimage', 'app'])

export const isDesktopApp = () =>
  isNativeApp() &&
  !isAndroidApp() &&
  !/iphone|ipad|ipod/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent)

export function supportsDesktopUpdates(bundleType: string) {
  return SUPPORTED_DESKTOP_UPDATE_BUNDLES.has(bundleType)
}

export async function checkForDesktopUpdate(timeout = 15_000): Promise<{
  currentVersion: string
  update: Update | null
}> {
  if (!isDesktopApp()) throw new Error('Desktop updates are only available in the desktop app.')

  const [{ getBundleType, getVersion }, { check }] = await Promise.all([
    import('@tauri-apps/api/app'),
    import('@tauri-apps/plugin-updater'),
  ])
  const [bundleType, currentVersion] = await Promise.all([getBundleType(), getVersion()])
  if (!supportsDesktopUpdates(bundleType))
    throw new Error(`Automatic updates are not available for the ${bundleType} package format.`)

  return {
    currentVersion,
    update: await check({ timeout }),
  }
}

export function isDesktopUpdateSkipped(version: string, storage: Storage = localStorage) {
  return storage.getItem(SKIPPED_DESKTOP_UPDATE_KEY) === version
}

export function skipDesktopUpdate(version: string, storage: Storage = localStorage) {
  storage.setItem(SKIPPED_DESKTOP_UPDATE_KEY, version)
}
