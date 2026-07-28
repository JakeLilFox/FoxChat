export type ViewerImage = { url: string; alt: string }
export type ViewerGallery = { images: ViewerImage[]; index: number }

const openViewer = (gallery: ViewerGallery) =>
  window.dispatchEvent(
    new CustomEvent<ViewerGallery>('foxchat-image-viewer', {
      detail: gallery,
    }),
  )

export const showImageViewer = (url: string, alt = 'Image') =>
  openViewer({ images: [{ url, alt }], index: 0 })

export const showImageGallery = (images: ViewerImage[], index = 0) => {
  if (!images.length) return
  openViewer({
    images,
    index: Math.min(images.length - 1, Math.max(0, index)),
  })
}
