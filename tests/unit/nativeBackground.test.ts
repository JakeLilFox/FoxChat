// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncNativeBackground } from '../../src/platform/nativeBackground'

describe('native app background', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete window.__TAURI_INTERNALS__
    delete window.FoxChatWindowAppearance
  })

  it('synchronizes the Android window and WebView background', () => {
    const invoke = vi.fn(() => Promise.resolve())
    const setTheme = vi.fn()
    window.__TAURI_INTERNALS__ = { invoke: invoke as never }
    window.FoxChatWindowAppearance = { setTheme }
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('FoxChat Android')

    syncNativeBackground('dark')

    expect(setTheme).toHaveBeenCalledWith('dark')
    expect(invoke).toHaveBeenCalledWith('plugin:webview|set_webview_background_color', {
      color: [17, 19, 26, 255],
    })
  })

  it('does not use the Android-only bridge on desktop', () => {
    const invoke = vi.fn(() => Promise.resolve())
    const setTheme = vi.fn()
    window.__TAURI_INTERNALS__ = { invoke: invoke as never }
    window.FoxChatWindowAppearance = { setTheme }
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('FoxChat Desktop')

    syncNativeBackground('light')

    expect(setTheme).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('plugin:webview|set_webview_background_color', {
      color: [245, 246, 250, 255],
    })
  })
})
