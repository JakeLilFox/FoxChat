export const ACTIVE_SCROLLBAR_CLASS = 'foxchat-scroll-active'

export function trackActiveScrollbars(documentRoot: Document, idleDelay = 700) {
  const timers = new Map<Element, number>()
  const view = documentRoot.defaultView

  const scrolled = (event: Event) => {
    const target = event.target === documentRoot ? documentRoot.documentElement : event.target
    if (!(target instanceof Element)) return

    target.classList.add(ACTIVE_SCROLLBAR_CLASS)
    const previous = timers.get(target)
    if (previous !== undefined) view?.clearTimeout(previous)
    const timer = view?.setTimeout(() => {
      target.classList.remove(ACTIVE_SCROLLBAR_CLASS)
      timers.delete(target)
    }, idleDelay)
    if (timer !== undefined) timers.set(target, timer)
  }

  documentRoot.addEventListener('scroll', scrolled, true)
  return () => {
    documentRoot.removeEventListener('scroll', scrolled, true)
    for (const [target, timer] of timers) {
      view?.clearTimeout(timer)
      target.classList.remove(ACTIVE_SCROLLBAR_CLASS)
    }
    timers.clear()
  }
}
