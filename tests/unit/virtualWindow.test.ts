import { describe, expect, it } from 'vitest'
import { itemWindowAround } from '../../src/lib/virtualWindow'

describe('itemWindowAround', () => {
  it('keeps one hundred items above and below the visible range', () => {
    expect(itemWindowAround([250, 251, 252], 1_000, 100)).toEqual({ start: 150, end: 352 })
  })

  it('clamps overscan to the available items', () => {
    expect(itemWindowAround([20, 21], 50, 100)).toEqual({ start: 0, end: 49 })
  })

  it('starts with only the first overscan window before layout is measured', () => {
    expect(itemWindowAround([], 1_000, 100)).toEqual({ start: 0, end: 100 })
    expect(itemWindowAround([], 0, 100)).toEqual({ start: 0, end: -1 })
  })
})
