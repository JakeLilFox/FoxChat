// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { installMessageErrorLogging, reportClientError } from '../../src/platform/errorLogging'

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
})
