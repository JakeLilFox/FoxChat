// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InfoSettings } from '../../src/components/settings/InfoSettings'
import {
  isDesktopApp,
  isDesktopUpdateSkipped,
  SKIPPED_DESKTOP_UPDATE_KEY,
  skipDesktopUpdate,
  supportsDesktopUpdates,
} from '../../src/platform/desktopUpdates'

describe('desktop update preferences', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    vi.restoreAllMocks()
    delete window.__TAURI_INTERNALS__
  })

  it('skips only the selected release', () => {
    skipDesktopUpdate('1.4.2')

    expect(localStorage.getItem(SKIPPED_DESKTOP_UPDATE_KEY)).toBe('1.4.2')
    expect(isDesktopUpdateSkipped('1.4.2')).toBe(true)
    expect(isDesktopUpdateSkipped('1.4.3')).toBe(false)
  })

  it('enables checks only in the native desktop app', () => {
    expect(isDesktopApp()).toBe(false)

    window.__TAURI_INTERNALS__ = { invoke: vi.fn() }
    const userAgent = vi.spyOn(navigator, 'userAgent', 'get')
    userAgent.mockReturnValue('FoxChat Android')
    expect(isDesktopApp()).toBe(false)

    userAgent.mockReturnValue('FoxChat Windows')
    expect(isDesktopApp()).toBe(true)
  })

  it('supports only desktop package formats handled by the signed updater', () => {
    expect(supportsDesktopUpdates('nsis')).toBe(true)
    expect(supportsDesktopUpdates('msi')).toBe(true)
    expect(supportsDesktopUpdates('appimage')).toBe(true)
    expect(supportsDesktopUpdates('app')).toBe(true)
    expect(supportsDesktopUpdates('deb')).toBe(false)
    expect(supportsDesktopUpdates('rpm')).toBe(false)
    expect(supportsDesktopUpdates('apk')).toBe(false)
  })

  it('renders the update settings only in the native desktop app', () => {
    expect(renderToStaticMarkup(createElement(InfoSettings))).not.toContain('Desktop updates')

    window.__TAURI_INTERNALS__ = { invoke: vi.fn() }
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('FoxChat Windows')

    const desktopSettings = renderToStaticMarkup(createElement(InfoSettings))
    expect(desktopSettings).toContain('Desktop updates')
    expect(desktopSettings).toContain('Check for updates')
  })
})
