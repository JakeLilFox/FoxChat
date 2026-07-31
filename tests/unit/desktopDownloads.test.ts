// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

const downloadMocks = vi.hoisted(() => ({
  save: vi.fn(),
  writeFile: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: downloadMocks.save }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: downloadMocks.writeFile }))

import { safeDownloadFilename, saveBlobDownload } from '../../src/platform/downloads'

describe('desktop downloads', () => {
  afterEach(() => {
    downloadMocks.save.mockReset()
    downloadMocks.writeFile.mockClear()
    delete window.__TAURI_INTERNALS__
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens a native save dialog and writes the selected desktop file', async () => {
    window.__TAURI_INTERNALS__ = { invoke: vi.fn() }
    downloadMocks.save.mockResolvedValue('C:\\Users\\Fox\\Downloads\\report_.pdf')

    await expect(
      saveBlobDownload(new Blob([new Uint8Array([1, 2, 3])]), 'report?.pdf'),
    ).resolves.toBe(true)

    expect(downloadMocks.save).toHaveBeenCalledWith({
      defaultPath: 'report_.pdf',
      filters: [{ name: 'File', extensions: ['pdf'] }],
    })
    expect(downloadMocks.writeFile).toHaveBeenCalledWith(
      'C:\\Users\\Fox\\Downloads\\report_.pdf',
      new Uint8Array([1, 2, 3]),
    )
  })

  it('does not write anything when the native save dialog is cancelled', async () => {
    window.__TAURI_INTERNALS__ = { invoke: vi.fn() }
    downloadMocks.save.mockResolvedValue(null)

    await expect(saveBlobDownload(new Blob(['file']), 'file.txt')).resolves.toBe(false)
    expect(downloadMocks.writeFile).not.toHaveBeenCalled()
  })

  it('retains browser downloads outside the desktop client', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const createObjectURL = vi.fn(() => 'blob:test-download')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))

    await expect(saveBlobDownload(new Blob(['file']), 'notes.txt')).resolves.toBe(true)

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
  })

  it('prevents paths and reserved filename characters from reaching native dialogs', () => {
    expect(safeDownloadFilename('../unsafe:<name>.txt. ')).toBe('_unsafe__name_.txt')
    expect(safeDownloadFilename('   ', 'download.bin')).toBe('download.bin')
  })
})
