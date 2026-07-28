// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isDesktopApp,
  isDesktopUpdateSkipped,
  SKIPPED_DESKTOP_UPDATE_KEY,
  skipDesktopUpdate,
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
})
