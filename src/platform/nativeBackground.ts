type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke: TauriInvoke }
    FoxChatWindowAppearance?: { setTheme: (mode: 'light' | 'dark') => void }
  }
}

const THEME_BACKGROUND: Record<'light' | 'dark', [number, number, number, number]> = {
  light: [245, 246, 250, 255],
  dark: [17, 19, 26, 255],
}

export const isNativeApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

export const isAndroidApp = () => isNativeApp() && /android/i.test(navigator.userAgent)

export function syncNativeBackground(mode: 'light' | 'dark') {
  if (isAndroidApp()) window.FoxChatWindowAppearance?.setTheme(mode)
  const invoke = window.__TAURI_INTERNALS__?.invoke
  if (!invoke) return
  void invoke('plugin:webview|set_webview_background_color', {
    color: THEME_BACKGROUND[mode],
  }).catch(() => undefined)
}

export function listenForAndroidResume(onResume: () => void) {
  if (!isAndroidApp()) return () => undefined
  let inactive = document.visibilityState === 'hidden'
  const markInactive = () => {
    inactive = true
  }
  const resume = () => {
    if (!inactive || document.visibilityState === 'hidden') return
    inactive = false
    onResume()
  }
  const visibilityChanged = () => {
    if (document.visibilityState === 'hidden') markInactive()
    else resume()
  }
  document.addEventListener('visibilitychange', visibilityChanged)
  window.addEventListener('blur', markInactive)
  window.addEventListener('focus', resume)
  return () => {
    document.removeEventListener('visibilitychange', visibilityChanged)
    window.removeEventListener('blur', markInactive)
    window.removeEventListener('focus', resume)
  }
}
