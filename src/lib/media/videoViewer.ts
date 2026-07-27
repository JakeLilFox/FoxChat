export type ViewerVideo = { url: string; alt: string }
export const showVideoViewer = (url: string, alt = 'Video') =>
  window.dispatchEvent(
    new CustomEvent<ViewerVideo>('foxchat-video-viewer', {
      detail: { url, alt },
    }),
  )
