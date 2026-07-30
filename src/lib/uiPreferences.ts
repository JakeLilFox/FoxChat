export type EmojiPickerSourceTab = 'unicode' | 'matrix'
export type MatrixPickerContentTab = 'emoticon' | 'sticker'

export const EMOJI_PICKER_SOURCE_TAB_KEY = 'foxchat.emojiPicker.sourceTab'
export const MATRIX_PICKER_CONTENT_TAB_KEY = 'foxchat.emojiPicker.matrixContentTab'
export const DESKTOP_DETAILS_OPEN_KEY = 'foxchat.desktopDetailsOpen'

export const emojiPickerSourceTab = (): EmojiPickerSourceTab =>
  localStorage.getItem(EMOJI_PICKER_SOURCE_TAB_KEY) === 'matrix' ? 'matrix' : 'unicode'

export const setEmojiPickerSourceTab = (tab: EmojiPickerSourceTab) =>
  localStorage.setItem(EMOJI_PICKER_SOURCE_TAB_KEY, tab)

export const matrixPickerContentTab = (): MatrixPickerContentTab =>
  localStorage.getItem(MATRIX_PICKER_CONTENT_TAB_KEY) === 'sticker' ? 'sticker' : 'emoticon'

export const setMatrixPickerContentTab = (tab: MatrixPickerContentTab) =>
  localStorage.setItem(MATRIX_PICKER_CONTENT_TAB_KEY, tab)

export const desktopDetailsOpen = () => localStorage.getItem(DESKTOP_DETAILS_OPEN_KEY) !== 'false'

export const setDesktopDetailsOpen = (open: boolean) =>
  localStorage.setItem(DESKTOP_DETAILS_OPEN_KEY, String(open))
