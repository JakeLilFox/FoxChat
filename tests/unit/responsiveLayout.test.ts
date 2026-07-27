import { describe, expect, it } from 'vitest'
import { shouldUseMobileLayout } from '../../src/lib/responsiveLayout'

describe('shouldUseMobileLayout', () => {
  it('keeps an Android phone in mobile layout after rotating to landscape', () => {
    expect(shouldUseMobileLayout(false, true, 915, 412)).toBe(true)
  })

  it('keeps an Android phone in mobile layout in portrait', () => {
    expect(shouldUseMobileLayout(true, true, 412, 915)).toBe(true)
  })

  it('allows a large Android tablet to use the desktop layout', () => {
    expect(shouldUseMobileLayout(false, true, 1280, 800)).toBe(false)
  })

  it('does not force desktop browsers into mobile layout based on screen height', () => {
    expect(shouldUseMobileLayout(false, false, 915, 412)).toBe(false)
  })
})
