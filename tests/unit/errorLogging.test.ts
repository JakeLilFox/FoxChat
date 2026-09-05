// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installConsoleErrorLogging,
  installMessageErrorLogging,
  installVisibleErrorToastLogging,
  reportClientError,
} from '../../src/platform/errorLogging'

describe('client error logging', () => {
  afterEach(() => {
    delete window.__TAURI_INTERNALS__
    vi.restoreAllMocks()
  })

  it('persists Android errors while redacting credentials', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true })
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 16)',
    })
    window.__TAURI_INTERNALS__ = { invoke }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    reportClientError(
      'login',
      'Login failed',
      Object.assign(new Error('InvalidCertificate(Revoked)'), {
        httpStatus: 495,
        accessToken: 'syt_never-log-this',
        nested: { password: 'also-secret' },
      }),
    )

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const call = invoke.mock.calls[0]
    const args = call[1] as { action: string; payload: string }
    expect(call[0]).toBe('plugin:remote-push|native_matrix')
    expect(args.action).toBe('logClientError')
    expect(args.payload).toContain('InvalidCertificate(Revoked)')
    expect(args.payload).toContain('httpStatus')
    expect(args.payload).not.toContain('syt_never-log-this')
    expect(args.payload).not.toContain('also-secret')
  })

  it('logs every error toast and still calls the original message API', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 Chrome/152',
    })
    const original = vi.fn((_value: unknown) => Promise.resolve())
    const message = { error: original }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const uninstall = installMessageErrorLogging(message as never)

    message.error({ content: 'Matrix client has been stopped' })

    expect(original).toHaveBeenCalledWith({ content: 'Matrix client has been stopped' })
    expect(consoleError).toHaveBeenCalledWith(
      '[user-visible-error] Matrix client has been stopped',
      expect.objectContaining({ summary: 'Matrix client has been stopped' }),
    )
    uninstall()
  })

  it('logs an error toast rendered outside the patched message API', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 16)',
    })
    const invoke = vi.fn().mockResolvedValue({ ok: true })
    window.__TAURI_INTERNALS__ = { invoke }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = document.createElement('div')
    document.body.append(host)
    const uninstall = installVisibleErrorToastLogging(host)

    const wrapper = document.createElement('div')
    wrapper.innerHTML =
      '<div class="ant-message-notice-error"><div class="ant-message-error">M_UNKNOWN_TOKEN: Unknown access token</div></div>'
    host.append(wrapper)

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const args = invoke.mock.calls[0]?.[1] as { action: string; payload: string }
    expect(args.action).toBe('logClientError')
    expect(args.payload).toContain('M_UNKNOWN_TOKEN: Unknown access token')
    uninstall()
    host.remove()
  })

  it('persists errors written directly to console.error', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 16)',
    })
    const invoke = vi.fn().mockResolvedValue({ ok: true })
    window.__TAURI_INTERNALS__ = { invoke }
    const original = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const uninstall = installConsoleErrorLogging()

    console.error('Matrix request failed', new Error('M_UNKNOWN_TOKEN'))

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const args = invoke.mock.calls[0]?.[1] as { action: string; payload: string }
    expect(args.action).toBe('logClientError')
    expect(args.payload).toContain('M_UNKNOWN_TOKEN')
    expect(args.payload).toContain('Matrix request failed')
    uninstall()
    expect(original).toHaveBeenCalled()
  })
})
