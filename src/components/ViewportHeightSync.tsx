import { useEffect } from 'react'
import { isAndroidApp } from '../platform/nativeBackground'

export function ViewportHeightSync() {
  useEffect(() => {
    // Mirror visualViewport because Android does not refresh 100dvh reliably for IME changes.
    if (isAndroidApp()) {
      const root = document.documentElement
      const viewport = window.visualViewport
      let frame: number | undefined
      let viewportWidth = document.documentElement.clientWidth || window.innerWidth
      let largestViewportHeight = viewport?.height ?? window.innerHeight
      let resetHeightBaseline = false
      root.classList.add('foxchat-android')
      const updateViewport = (resetBaseline = false) => {
        resetHeightBaseline ||= resetBaseline
        if (frame !== undefined) cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          frame = undefined
          const width = document.documentElement.clientWidth || window.innerWidth
          const height = viewport?.height ?? window.innerHeight
          // Width changes reset the IME baseline after rotation or fold changes.
          if (resetHeightBaseline || Math.abs(width - viewportWidth) > 1) {
            viewportWidth = width
            largestViewportHeight = height
          }
          resetHeightBaseline = false
          largestViewportHeight = Math.max(largestViewportHeight, height)
          root.style.setProperty('--foxchat-viewport-height', `${Math.round(height)}px`)
          root.style.setProperty('--foxchat-device-width', `${Math.round(width)}px`)
          root.style.setProperty(
            '--foxchat-device-height',
            `${Math.round(largestViewportHeight)}px`,
          )
          // Android may retain DOM focus after dismissing the IME.
          root.classList.toggle('foxchat-ime-open', largestViewportHeight - height > 120)
        })
      }
      const orientation = window.screen.orientation
      const viewportChanged = () => updateViewport()
      updateViewport(true)
      viewport?.addEventListener('resize', viewportChanged)
      viewport?.addEventListener('scroll', viewportChanged)
      window.addEventListener('resize', viewportChanged)
      const orientationChanged = () => {
        updateViewport(true)
      }
      orientation?.addEventListener('change', orientationChanged)
      window.addEventListener('orientationchange', orientationChanged)
      return () => {
        if (frame !== undefined) cancelAnimationFrame(frame)
        viewport?.removeEventListener('resize', viewportChanged)
        viewport?.removeEventListener('scroll', viewportChanged)
        window.removeEventListener('resize', viewportChanged)
        orientation?.removeEventListener('change', orientationChanged)
        window.removeEventListener('orientationchange', orientationChanged)
        root.classList.remove('foxchat-android')
        root.classList.remove('foxchat-ime-open')
        root.style.removeProperty('--foxchat-viewport-height')
        root.style.removeProperty('--foxchat-device-width')
        root.style.removeProperty('--foxchat-device-height')
      }
    }
    const viewport = window.visualViewport
    const update = () => {
      if (window.innerWidth <= 760)
        document.documentElement.style.setProperty(
          '--foxchat-viewport-height',
          `${Math.round(viewport?.height ?? window.innerHeight)}px`,
        )
      else document.documentElement.style.removeProperty('--foxchat-viewport-height')
    }
    update()
    viewport?.addEventListener('resize', update)
    window.addEventListener('resize', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      window.removeEventListener('resize', update)
      document.documentElement.style.removeProperty('--foxchat-viewport-height')
      document.documentElement.style.removeProperty('--foxchat-device-width')
      document.documentElement.style.removeProperty('--foxchat-device-height')
    }
  }, [])
  return null
}
