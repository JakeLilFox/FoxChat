// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  DESKTOP_DETAILS_OPEN_KEY,
  EMOJI_PICKER_SOURCE_TAB_KEY,
  MATRIX_PICKER_CONTENT_TAB_KEY,
  desktopDetailsOpen,
  emojiPickerSourceTab,
  matrixPickerContentTab,
  setDesktopDetailsOpen,
  setEmojiPickerSourceTab,
  setMatrixPickerContentTab,
} from '../../src/lib/uiPreferences'

describe('local UI preferences', () => {
  beforeEach(() => localStorage.clear())

  it('restores the emoji picker source and Matrix content tabs', () => {
    expect(emojiPickerSourceTab()).toBe('unicode')
    expect(matrixPickerContentTab()).toBe('emoticon')

    setEmojiPickerSourceTab('matrix')
    setMatrixPickerContentTab('sticker')

    expect(localStorage.getItem(EMOJI_PICKER_SOURCE_TAB_KEY)).toBe('matrix')
    expect(localStorage.getItem(MATRIX_PICKER_CONTENT_TAB_KEY)).toBe('sticker')
    expect(emojiPickerSourceTab()).toBe('matrix')
    expect(matrixPickerContentTab()).toBe('sticker')
  })

  it('falls back safely when stored picker tabs are invalid', () => {
    localStorage.setItem(EMOJI_PICKER_SOURCE_TAB_KEY, 'unknown')
    localStorage.setItem(MATRIX_PICKER_CONTENT_TAB_KEY, 'unknown')

    expect(emojiPickerSourceTab()).toBe('unicode')
    expect(matrixPickerContentTab()).toBe('emoticon')
  })

  it('defaults the desktop details panel to open and restores changes', () => {
    expect(desktopDetailsOpen()).toBe(true)

    setDesktopDetailsOpen(false)
    expect(localStorage.getItem(DESKTOP_DETAILS_OPEN_KEY)).toBe('false')
    expect(desktopDetailsOpen()).toBe(false)

    setDesktopDetailsOpen(true)
    expect(desktopDetailsOpen()).toBe(true)
  })
})
