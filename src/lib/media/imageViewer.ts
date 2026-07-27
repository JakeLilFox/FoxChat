export type ViewerImage = { url: string; alt: string }
export const showImageViewer = (url: string, alt = 'Image') =>
  window.dispatchEvent(
    new CustomEvent<ViewerImage>('foxchat-image-viewer', {
      detail: { url, alt },
    }),
  )
