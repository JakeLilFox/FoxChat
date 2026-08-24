import { describe, expect, it } from 'vitest'
import { shouldUseMobileLayout } from '../../src/lib/responsiveLayout'

describe('shouldUseMobileLayout', () => {
  it('keeps an Android phone in mobile layout after rotating to landscape', () => {
    // viewport 915x412: width is wide, but the short (height) side is a phone.
    expect(shouldUseMobileLayout(false, true, true)).toBe(true)
  })

  it('keeps an Android phone in mobile layout in portrait', () => {
    // viewport 412x915: narrow width alone is enough to force mobile.
    expect(shouldUseMobileLayout(true, true, false)).toBe(true)
  })

  it('allows a large Android tablet to use the desktop layout', () => {
    // viewport 1280x800: neither side is narrow.
    expect(shouldUseMobileLayout(false, true, false)).toBe(false)
  })

  it('allows an unfolded Android foldable to use the desktop layout', () => {
    // Both width and height clear the breakpoint once unfolded, even though the
    // folded (cover-display) state was narrow moments earlier.
    expect(shouldUseMobileLayout(false, true, false)).toBe(false)
  })

  it('does not force desktop browsers into mobile layout based on viewport height', () => {
    expect(shouldUseMobileLayout(false, false, true)).toBe(false)
  })
})
