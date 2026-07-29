const pendingSharedFiles = new Map<string, File[]>()
export const sharedFileEvent = 'foxchat-attachments'

export const queueSharedFiles = (roomId: string, files: File[]) => {
  pendingSharedFiles.set(roomId, [...(pendingSharedFiles.get(roomId) ?? []), ...files])
  window.dispatchEvent(new CustomEvent(sharedFileEvent, { detail: { roomId } }))
}

export const takeSharedFiles = (roomId: string) => {
  const files = pendingSharedFiles.get(roomId) ?? []
  pendingSharedFiles.delete(roomId)
  return files
}

export type NativeSharedFile = { name: string; type?: string; base64: string }
export const decodeNativeSharedFiles = (items: NativeSharedFile[]) =>
  items.map((item) => {
    const binary = atob(item.base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return new File([bytes], item.name, {
      type: item.type || 'application/octet-stream',
    })
  })

export function anonymizedFile(file: File) {
  const extension = file.name.match(/\.[^.]+$/)?.[0] ?? ''
  return new File([file], `${crypto.randomUUID()}${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  })
}

const extensionForImageType = (type: string) =>
  ({
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  })[type] ?? '.png'

const replaceFileExtension = (name: string, extension: string) =>
  /\.[^.]+$/.test(name) ? name.replace(/\.[^.]+$/, extension) : `${name}${extension}`

type DecodedImage = {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    } catch {
      // WebKitGTK may expose createImageBitmap without supporting File inputs.
    }
  }

  if (typeof Image === 'undefined') throw new Error('Image decoding is unavailable')
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Image decoding failed'))
      image.src = objectUrl
    })
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      close: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

const stripGifMetadata = async (file: File) => {
  const input = new Uint8Array(await file.arrayBuffer())
  if (input.length < 13 || new TextDecoder('ascii').decode(input.subarray(0, 3)) !== 'GIF') {
    throw new Error('This GIF is not valid')
  }

  const output: number[] = [...input.subarray(0, 13)]
  let offset = 13
  if (input[10] & 0x80) {
    const colorTableSize = 3 * 2 ** ((input[10] & 0x07) + 1)
    output.push(...input.subarray(offset, offset + colorTableSize))
    offset += colorTableSize
  }

  const subBlocksEnd = (start: number) => {
    let cursor = start
    while (cursor < input.length) {
      const size = input[cursor++]
      if (!size) return cursor
      cursor += size
    }
    return cursor
  }

  while (offset < input.length) {
    const blockStart = offset
    const marker = input[offset++]
    if (marker === 0x3b) {
      output.push(marker)
      break
    }
    if (marker === 0x2c) {
      if (offset + 9 > input.length) throw new Error('This GIF is truncated')
      const packed = input[offset + 8]
      offset += 9
      if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1)
      offset++
      offset = subBlocksEnd(offset)
      output.push(...input.subarray(blockStart, offset))
      continue
    }
    if (marker !== 0x21 || offset >= input.length) {
      throw new Error('This GIF contains an unsupported block')
    }

    const label = input[offset++]
    if (label === 0xfe) {
      offset = subBlocksEnd(offset)
      continue
    }
    if (offset >= input.length) throw new Error('This GIF is truncated')
    const headerSize = input[offset]
    const headerEnd = offset + 1 + headerSize
    if (headerEnd > input.length) throw new Error('This GIF is truncated')
    const applicationName =
      label === 0xff ? new TextDecoder('ascii').decode(input.subarray(offset + 1, headerEnd)) : ''
    offset = subBlocksEnd(headerEnd)
    if (!applicationName.startsWith('XMP DataXMP')) {
      output.push(...input.subarray(blockStart, offset))
    }
  }

  return new File([new Uint8Array(output)], file.name, {
    type: file.type,
    lastModified: Date.now(),
  })
}

/** Removes image metadata while preserving GIF animation. */
export async function stripImageMetadata(file: File) {
  const type = file.type.toLowerCase()
  if (type === 'image/gif') return stripGifMetadata(file)
  let image: DecodedImage
  try {
    image = await decodeImage(file)
  } catch {
    throw new Error(
      `Could not remove metadata from ${file.type || 'this image type'}. Turn it off to send the original.`,
    )
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image metadata removal is unavailable')
    context.drawImage(image.source, 0, 0)
    const requestedType =
      type === 'image/jpeg' || type === 'image/png' || type === 'image/webp'
        ? type
        : type === 'image/bmp' || type === 'image/svg+xml'
          ? 'image/png'
          : 'image/webp'
    const blob = await new Promise<Blob | undefined>((resolve) =>
      canvas.toBlob(
        (value) => resolve(value ?? undefined),
        requestedType,
        requestedType === 'image/png' ? undefined : 0.95,
      ),
    )
    if (!blob) throw new Error('Could not create a metadata-free image')
    const outputType = blob.type || requestedType
    return new File([blob], replaceFileExtension(file.name, extensionForImageType(outputType)), {
      type: outputType,
      lastModified: Date.now(),
    })
  } finally {
    image.close()
  }
}

export async function compressedImageFile(file: File) {
  if (!/^image\/(jpeg|png|webp|bmp)$/i.test(file.type)) return file
  let image: DecodedImage
  try {
    image = await decodeImage(file)
  } catch {
    // Compression is optional
    return file
  }
  const scale = Math.min(1, 1920 / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    image.close()
    return file
  }
  context.drawImage(image.source, 0, 0, canvas.width, canvas.height)
  image.close()
  const blob = await new Promise<Blob | undefined>((resolve) =>
    canvas.toBlob((value) => resolve(value ?? undefined), 'image/webp', 0.82),
  )
  if (!blob || blob.size >= file.size) return file
  const name = file.name.replace(/\.[^.]+$/, '') + '.webp'
  return new File([blob], name, {
    type: 'image/webp',
    lastModified: Date.now(),
  })
}
