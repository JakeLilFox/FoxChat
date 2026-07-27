export type PopoutFps = 15 | 30 | 60

type ActivePopout = { stop: () => void; close: () => void }

const active = new Map<string, ActivePopout>()

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const openBrowserWindow = (url: string, label: string) => {
  const handle = window.open(url, label, 'popup,width=640,height=400')
  return { close: () => handle?.close() }
}

const openTauriWindow = async (url: string, label: string) => {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const webview = new WebviewWindow(label, {
    url,
    width: 640,
    height: 400,
    title: 'FoxChat · Screen share',
  })
  return {
    close: () => {
      void webview.close()
    },
  }
}

export const isPopoutOpen = (mediaId: string) => active.has(mediaId)
export const activePopoutIds = () => [...active.keys()]

export const closePopout = (mediaId: string) => {
  active.get(mediaId)?.stop()
  active.get(mediaId)?.close()
  active.delete(mediaId)
}

export const closeAllPopouts = () => {
  for (const id of activePopoutIds()) closePopout(id)
}

export const openPopout = (mediaId: string, video: HTMLVideoElement, label: string) => {
  if (active.has(mediaId)) {
    active.get(mediaId)?.close()
    active.delete(mediaId)
  }
  const channelName = `foxchat-popout-${mediaId}-${Date.now()}`
  const channel = new BroadcastChannel(channelName)
  const url = `${import.meta.env.BASE_URL}popout.html?channel=${encodeURIComponent(channelName)}&title=${encodeURIComponent(label)}`
  const windowLabel = `foxchat-popout-${mediaId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}`

  let fps: PopoutFps = 15
  let frame = 0
  let disposed = false
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })

  const tick = () => {
    if (disposed) return
    const width = video.videoWidth,
      height = video.videoHeight
    if (width && height && context) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      context.drawImage(video, 0, 0, width, height)
      createImageBitmap(canvas)
        .then((bitmap) => {
          if (!disposed) channel.postMessage({ type: 'frame', bitmap })
          bitmap.close()
        })
        .catch(() => undefined)
    }
    frame = window.setTimeout(tick, 1000 / fps)
  }

  channel.onmessage = (event) => {
    const data = event.data as { type?: string; fps?: PopoutFps }
    if (data?.type === 'fps' && data.fps) fps = data.fps
    else if (data?.type === 'closed') {
      stop()
      active.delete(mediaId)
    }
  }

  const stop = () => {
    if (disposed) return
    disposed = true
    window.clearTimeout(frame)
    channel.postMessage({ type: 'closed' })
    channel.close()
  }

  tick()

  const entry: ActivePopout = { stop, close: () => undefined }
  active.set(mediaId, entry)

  const opener = isTauri()
    ? openTauriWindow(url, windowLabel)
    : Promise.resolve(openBrowserWindow(url, windowLabel))
  void opener.then((handle) => {
    if (disposed) {
      handle.close()
      return
    }
    entry.close = handle.close
  })
}
