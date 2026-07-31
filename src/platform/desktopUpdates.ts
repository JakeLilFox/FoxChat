import { isAndroidApp, isNativeApp } from './nativeBackground'
import { BUILD_VERSION } from '../lib/constants'
import type { Update } from '@tauri-apps/plugin-updater'

export const SKIPPED_DESKTOP_UPDATE_KEY = 'foxchat.desktopUpdate.skippedVersion'
const SUPPORTED_DESKTOP_UPDATE_BUNDLES = new Set(['nsis', 'msi', 'appimage', 'app'])

export const isDesktopApp = () =>
  isNativeApp() &&
  !isAndroidApp() &&
  !/iphone|ipad|ipod/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent)

export const isDevelopmentBuildVersion = (version: string = BUILD_VERSION) =>
  version.trim().toLowerCase() === 'development'

export const desktopUpdateChecksEnabled = (version: string = BUILD_VERSION) =>
  isDesktopApp() && !isDevelopmentBuildVersion(version)

export function supportsDesktopUpdates(bundleType: string) {
  return SUPPORTED_DESKTOP_UPDATE_BUNDLES.has(bundleType)
}

export async function checkForDesktopUpdate(timeout = 15_000): Promise<{
  currentVersion: string
  update: Update | null
}> {
  if (!isDesktopApp()) throw new Error('Desktop updates are only available in the desktop app.')
  if (isDevelopmentBuildVersion())
    throw new Error('Desktop update checks are disabled for development builds.')

  const { getBundleType, getVersion } = await import('@tauri-apps/api/app')
  const [bundleType, currentVersion] = await Promise.all([getBundleType(), getVersion()])
  if (isDevelopmentBuildVersion(currentVersion))
    throw new Error('Desktop update checks are disabled for development builds.')
  if (!supportsDesktopUpdates(bundleType))
    throw new Error(`Automatic updates are not available for the ${bundleType} package format.`)

  const { check } = await import('@tauri-apps/plugin-updater')
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
