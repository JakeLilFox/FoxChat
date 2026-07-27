import { chromium, type Browser } from '@playwright/test'

export type MediaBrowserOptions = {
  fakeAudioWavPath?: string

  autoSelectCaptureSourceTitle?: string
  headless?: boolean
}

const envHeadless = () => {
  const value = process.env.E2E_HEADLESS?.trim().toLowerCase()
  return value !== 'false'
}

export const hasUsableDisplay = () => process.platform !== 'linux' || !!process.env.DISPLAY

export async function launchMediaBrowser({
  fakeAudioWavPath,
  autoSelectCaptureSourceTitle,
  headless,
}: MediaBrowserOptions = {}): Promise<Browser> {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  if (fakeAudioWavPath) args.push(`--use-file-for-fake-audio-capture=${fakeAudioWavPath}`)
  if (autoSelectCaptureSourceTitle)
    args.push(`--auto-select-desktop-capture-source=${autoSelectCaptureSourceTitle}`)
  return chromium.launch({
    headless: headless ?? envHeadless(),
    args,
  })
}

export async function launchScreenShareBrowser({
  autoSelectCaptureSourceTitle,
  fakeAudioWavPath,
}: {
  autoSelectCaptureSourceTitle: string
  fakeAudioWavPath?: string
}): Promise<Browser> {
  const args = [`--auto-select-desktop-capture-source=${autoSelectCaptureSourceTitle}`]
  if (fakeAudioWavPath) {
    args.push(
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${fakeAudioWavPath}`,
    )
  }
  return chromium.launch({ headless: false, args })
}
