// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'
import { listenForAndroidResume } from '../../src/platform/nativeBackground'

describe('Android Matrix reconnect on resume', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete window.__TAURI_INTERNALS__
  })

  it('recognizes an Android Activity resume once after it was inactive', () => {
    window.__TAURI_INTERNALS__ = { invoke: vi.fn() }
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('FoxChat Android')
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const resumed = vi.fn()
    const stop = listenForAndroidResume(resumed)

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))

    expect(resumed).toHaveBeenCalledOnce()
    stop()
  })

  it('immediately retries a backed-off primary Matrix sync', () => {
    const retryImmediately = vi.fn(() => true)
    const service = new MatrixClientService()
    ;(service as unknown as { client: unknown }).client = {
      getSyncState: () => 'RECONNECTING',
      retryImmediately,
    }

    expect(service.retrySyncAfterResume()).toBe(1)
    expect(retryImmediately).toHaveBeenCalledOnce()
  })

  it('leaves a healthy sync alone', () => {
    const retryImmediately = vi.fn(() => true)
    const service = new MatrixClientService()
    ;(service as unknown as { client: unknown }).client = {
      getSyncState: () => 'SYNCING',
      retryImmediately,
    }

    expect(service.retrySyncAfterResume()).toBe(0)
    expect(retryImmediately).not.toHaveBeenCalled()
  })

  it('never starts or retries a WebView sync loop in Android native mode', () => {
    window.__TAURI_INTERNALS__ = { invoke: vi.fn() }
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('FoxChat Android')
    const retryImmediately = vi.fn(() => true)
    const service = new MatrixClientService()
    ;(service as unknown as { client: unknown }).client = {
      getSyncState: () => 'RECONNECTING',
      retryImmediately,
    }

    expect(service.retrySyncAfterResume()).toBe(1)
    expect(retryImmediately).not.toHaveBeenCalled()
  })
})
