import { isAndroidApp, isNativeApp } from './nativeBackground'

export const SKIPPED_DESKTOP_UPDATE_KEY = 'foxchat.desktopUpdate.skippedVersion'

export const isDesktopApp = () =>
  isNativeApp() &&
  !isAndroidApp() &&
  !/iphone|ipad|ipod/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent)

export function isDesktopUpdateSkipped(version: string, storage: Storage = localStorage) {
  return storage.getItem(SKIPPED_DESKTOP_UPDATE_KEY) === version
}

export function skipDesktopUpdate(version: string, storage: Storage = localStorage) {
  storage.setItem(SKIPPED_DESKTOP_UPDATE_KEY, version)
}
