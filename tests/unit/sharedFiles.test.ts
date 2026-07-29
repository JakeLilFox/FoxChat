// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { compressedImageFile, stripImageMetadata } from '../../src/lib/media/sharedFiles'

describe('WebKit-compatible image processing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const installImageElementFallback = () => {
    const createObjectURL = vi.fn(() => 'blob:foxchat-test')
    const revokeObjectURL = vi.fn()
    const NativeURL = URL
    vi.stubGlobal(
      'URL',
      Object.assign(class extends NativeURL {}, { createObjectURL, revokeObjectURL }),
    )
    vi.stubGlobal('createImageBitmap', undefined)
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 2
        naturalHeight = 3
        width = 2
        height = 3
        onload?: () => void
        onerror?: () => void

        set src(_value: string) {
          queueMicrotask(() => this.onload?.())
        }
      },
    )

    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
      callback(new Blob([new Uint8Array([1])], { type: type || 'image/png' }))
    })
    return { createObjectURL, revokeObjectURL, drawImage }
  }

  it('compresses through an image element when createImageBitmap is unavailable', async () => {
    const fallback = installImageElementFallback()
    const source = new File([new Uint8Array(100)], 'photo.png', { type: 'image/png' })

    const output = await compressedImageFile(source)

    expect(output).not.toBe(source)
    expect(output.name).toBe('photo.webp')
    expect(output.type).toBe('image/webp')
    expect(fallback.drawImage).toHaveBeenCalledOnce()
    expect(fallback.createObjectURL).toHaveBeenCalledWith(source)
    expect(fallback.revokeObjectURL).toHaveBeenCalledWith('blob:foxchat-test')
  })

  it('strips metadata through an image element when createImageBitmap is unavailable', async () => {
    const fallback = installImageElementFallback()
    const source = new File([new Uint8Array(100)], 'photo.png', { type: 'image/png' })

    const output = await stripImageMetadata(source)

    expect(output.name).toBe('photo.png')
    expect(output.type).toBe('image/png')
    expect(fallback.drawImage).toHaveBeenCalledOnce()
    expect(fallback.revokeObjectURL).toHaveBeenCalledWith('blob:foxchat-test')
  })
})
