export const PUSH_TO_TALK_SHORTCUTS = [
  { value: 'CapsLock', label: 'Caps Lock' },
  { value: 'F8', label: 'F8' },
  { value: 'F9', label: 'F9' },
  { value: 'Control+Space', label: 'Ctrl + Space' },
  { value: 'Alt+Space', label: 'Alt + Space' },
] as const

const mobileDevice = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export const desktopPushToTalkAvailable = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && !mobileDevice()

export const pushToTalkShortcutLabel = (shortcut: string) =>
  PUSH_TO_TALK_SHORTCUTS.find((option) => option.value === shortcut)?.label ?? shortcut

export async function registerPushToTalk(
  shortcut: string,
  onPressedChange: (pressed: boolean) => void,
) {
  if (!desktopPushToTalkAvailable())
    throw new Error('Push-to-talk is only available in the desktop app')

  const { register, unregister } = await import('@tauri-apps/plugin-global-shortcut')
  let pressed = false
  await register(shortcut, (event) => {
    const nextPressed = event.state === 'Pressed'
    if (nextPressed === pressed) return
    pressed = nextPressed
    onPressedChange(nextPressed)
  })

  return async () => {
    if (pressed) onPressedChange(false)
    await unregister(shortcut).catch(() => undefined)
  }
}
