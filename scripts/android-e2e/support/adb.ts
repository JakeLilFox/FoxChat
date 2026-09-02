import { spawnSync } from 'node:child_process'
import { adbBin, adbEnvironment } from '../lib/avd.mjs'
import { androidHome } from '../lib/sdk.mjs'

function env() {
  const home = androidHome()
  return adbEnvironment(home)
}

export function adb(args: string[]): string {
  const result = spawnSync(adbBin(androidHome()), args, {
    env: env(),
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status !== 0)
    throw new Error(
      `adb ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`,
    )
  return result.stdout
}

function adbAllowFailure(args: string[]): string {
  const result = spawnSync(adbBin(androidHome()), args, {
    env: env(),
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return result.stdout
}

export function install(apkPath: string) {
  adb(['install', '-r', '-g', apkPath])
}

export function uninstall(packageName: string) {
  adbAllowFailure(['uninstall', packageName])
}

export function clearAppData(packageName: string) {
  const output = adb(['shell', 'pm', 'clear', packageName]).trim()
  if (output !== 'Success') throw new Error(`Could not clear ${packageName} app data: ${output}`)
}

export function pushFile(localPath: string, devicePath: string) {
  adb(['push', localPath, devicePath])
}

export function pressHome() {
  adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME'])
}

export async function closeBackgroundApp(packageName: string) {
  pressHome()
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const originalPids = adbAllowFailure(['shell', 'pidof', packageName]).trim()
  adb(['shell', 'am', 'kill', packageName])
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const currentPids = adbAllowFailure(['shell', 'pidof', packageName]).trim()
    if (!currentPids || (originalPids && currentPids !== originalPids)) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    `${packageName} process ${originalPids || '(unknown)'} did not exit after \`adb shell am kill\``,
  )
}

export function relaunchWithE2eDebugFlag(packageName: string, mainActivity: string) {
  adb([
    'shell',
    'am',
    'start',
    '-n',
    `${packageName}/${mainActivity}`,
    '-a',
    'android.intent.action.MAIN',
    '-c',
    'android.intent.category.LAUNCHER',
    '--ez',
    'foxchat.e2e.webview_debug',
    'true',
  ])
}

export function dumpsysNotifications(): string {
  return adb(['shell', 'dumpsys', 'notification', '--noredact'])
}

export function logcat(): string {
  return adb(['logcat', '-d'])
}

export function dumpsysActivitySummary(packageName: string): string {
  const output = adb(['shell', 'dumpsys', 'activity', 'activities'])
  const lines = output.split(/\r?\n/)
  const relevant = lines.filter(
    (line) =>
      line.includes(packageName) ||
      /mResumedActivity|mFocusedActivity|topResumedActivity/.test(line),
  )
  return relevant.join('\n') || '(no matching lines - process may not be running at all)'
}

export function screenSize(): { width: number; height: number } {
  const output = adb(['shell', 'wm', 'size'])
  const match = output.match(/(\d+)x(\d+)/)
  if (!match) throw new Error(`Could not parse \`adb shell wm size\` output: ${output}`)
  return { width: Number(match[1]), height: Number(match[2]) }
}
