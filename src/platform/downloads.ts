import { isAndroidApp, isNativeApp } from './nativeBackground'

const INVALID_FILENAME_CHARACTERS = '<>:"/\\|?*'

export function safeDownloadFilename(filename: string, fallback = 'download') {
  const safe = [...filename]
    .map((character) =>
      character.charCodeAt(0) < 32 || INVALID_FILENAME_CHARACTERS.includes(character)
        ? '_'
        : character,
    )
    .join('')
    .trim()
    .replace(/^[. ]+/g, '')
    .replace(/[. ]+$/g, '')
  return safe || fallback
}

export async function saveBlobDownload(blob: Blob, filename: string) {
  const safeFilename = safeDownloadFilename(filename)
  if (isNativeApp() && !isAndroidApp()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ])
    const extension = safeFilename.match(/\.([a-z0-9]{1,10})$/i)?.[1]
    const path = await save({
      defaultPath: safeFilename,
      ...(extension ? { filters: [{ name: 'File', extensions: [extension] }] } : {}),
    })
    if (!path) return false
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
    return true
  }

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = safeFilename
  anchor.rel = 'noreferrer'
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return true
}

export async function saveUrlDownload(url: string, filename: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not download file (${response.status})`)
  return saveBlobDownload(await response.blob(), filename)
}
