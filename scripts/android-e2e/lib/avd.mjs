import { spawn, spawnSync } from 'node:child_process'
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'
import { emulatorBin, needsShell, platformToolsBin, run } from './sdk.mjs'

export const AVD_NAME = 'foxchat-e2e'
export const SNAPSHOT_NAME = 'foxchat-e2e-signedin'
const EMULATOR_SCREEN_SESSION = 'foxchat-android-emulator'

export const SYSTEM_IMAGE = 'system-images;android-34;google_apis_playstore;x86_64'

function avdManagerBin(home) {
  const suffix = platform() === 'win32' ? '.bat' : ''
  return join(home, 'cmdline-tools', 'latest', 'bin', `avdmanager${suffix}`)
}

export function adbBin(home) {
  return platformToolsBin(home, 'adb')
}

export function avdDir(home, name = AVD_NAME) {
  return join(avdHomeDir(home), `${name}.avd`)
}

function avdHomeDir(home) {
  return process.env.ANDROID_AVD_HOME || join(home, 'avd')
}

export function ensureAvdHome(home) {
  const avdHome = avdHomeDir(home)
  mkdirSync(avdHome, { recursive: true })
  return avdHome
}

function ensureAdbVendorKey(home) {
  const base64 = process.env.ANDROID_E2E_ADB_KEY_BASE64
  if (!base64) return undefined
  const keyPath = join(home, 'adb-vendor-key')
  writeFileSync(keyPath, Buffer.from(base64, 'base64'))
  if (platform() !== 'win32') {
    try {
      chmodSync(keyPath, 0o600)
    } catch {}
  }
  return keyPath
}

function sdkEnv(home) {
  const adbVendorKey = ensureAdbVendorKey(home)
  return {
    ...process.env,
    ANDROID_HOME: home,
    ANDROID_SDK_ROOT: home,
    ANDROID_AVD_HOME: ensureAvdHome(home),
    ...(adbVendorKey ? { ADB_VENDOR_KEYS: adbVendorKey } : {}),
  }
}

export function avdExists(home, name = AVD_NAME) {
  const binary = avdManagerBin(home)
  const result = spawnSync(binary, ['list', 'avd'], {
    env: sdkEnv(home),
    shell: needsShell(binary),
    encoding: 'utf-8',
  })
  return (result.stdout ?? '').includes(`Name: ${name}`)
}

export function repairAvdPaths(home, name = AVD_NAME) {
  const iniPath = join(ensureAvdHome(home), `${name}.ini`)
  const configPath = join(avdDir(home, name), 'config.ini')
  if (!existsSync(iniPath) || !existsSync(configPath))
    throw new Error(`Cannot repair AVD paths: expected ${iniPath} and ${configPath}`)

  const absoluteAvdPath = avdDir(home, name)
  const ini = readFileSync(iniPath, 'utf8')
  const repairedIni = /^path=.*$/m.test(ini)
    ? ini.replace(/^path=.*$/m, `path=${absoluteAvdPath}`)
    : `${ini.trimEnd()}\npath=${absoluteAvdPath}\n`
  writeFileSync(iniPath, repairedIni)

  const imagePath = `${SYSTEM_IMAGE.split(';').join('/')}/`
  const config = readFileSync(configPath, 'utf8')
  const repairedConfig = /^image\.sysdir\.1=.*$/m.test(config)
    ? config.replace(/^image\.sysdir\.1=.*$/m, `image.sysdir.1=${imagePath}`)
    : `${config.trimEnd()}\nimage.sysdir.1=${imagePath}\n`
  writeFileSync(configPath, repairedConfig)
}

export function createAvd(home, name = AVD_NAME) {
  run(
    avdManagerBin(home),
    ['create', 'avd', '--name', name, '--package', SYSTEM_IMAGE, '--device', 'pixel_7', '--force'],
    { env: sdkEnv(home), input: 'no\n' },
  )
}

export function startEmulator(
  home,
  { headless, name = AVD_NAME, extraArgs = [], detached = false, logFile } = {},
) {
  const args = ['-avd', name, '-no-snapshot-save', '-no-boot-anim', ...extraArgs]
  if (headless) args.push('-no-window', '-no-audio', '-gpu', 'swiftshader_indirect')

  if (detached && platform() === 'linux') {
    if (!logFile) throw new Error('startEmulator({ detached: true }) requires a logFile path')
    const result = spawnSync(
      'screen',
      [
        '-dmS',
        EMULATOR_SCREEN_SESSION,
        'bash',
        '-c',
        'log_file=$1; shift; exec "$@" >>"$log_file" 2>&1',
        'foxchat-emulator-shell',
        logFile,
        emulatorBin(home),
        ...args,
      ],
      {
        env: sdkEnv(home),
        encoding: 'utf-8',
      },
    )
    if (result.error)
      throw new Error(
        `Could not launch the Android emulator through GNU screen: ${result.error.message}`,
      )
    if (result.status !== 0)
      throw new Error(
        `GNU screen could not launch the Android emulator (${result.status}): ` +
          `${result.stderr || result.stdout}`,
      )
    console.log(`Emulator launched in screen session "${EMULATOR_SCREEN_SESSION}".`)
    return result
  }

  let stdio = 'inherit'
  if (detached) {
    if (!logFile) throw new Error('startEmulator({ detached: true }) requires a logFile path')
    const fd = openSync(logFile, 'a')
    stdio = ['ignore', fd, fd]
  }
  const child = spawn(emulatorBin(home), args, { env: sdkEnv(home), stdio, detached })
  child.on('error', (error) => {
    throw new Error(`Failed to start the Android emulator: ${error.message}`)
  })
  if (detached) child.unref()
  return child
}

function commandOutput(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    timeout: 10_000,
    ...options,
  })
  return {
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    timedOut: result.error?.code === 'ETIMEDOUT',
  }
}

function logTail(logFile, lines = 100) {
  if (!logFile || !existsSync(logFile)) return '(emulator log was not created)'
  return readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-lines).join('\n')
}

export async function waitForBoot(home, { timeoutMs = 5 * 60_000, logFile } = {}) {
  const adb = adbBin(home)
  const env = sdkEnv(home)
  const startedAt = Date.now()
  const deadline = Date.now() + timeoutMs
  let lastProgressAt = 0
  let lastState = 'not detected'

  while (Date.now() < deadline) {
    const state = commandOutput(adb, ['get-state'], { env })
    lastState = state.timedOut ? 'adb get-state timed out' : state.output || 'not detected'
    if (lastState === 'device') {
      const boot = commandOutput(adb, ['shell', 'getprop', 'sys.boot_completed'], { env })
      if (boot.output.trim() === '1') return
      lastState = `device present; sys.boot_completed=${JSON.stringify(boot.output)}`
    }

    if (Date.now() - lastProgressAt >= 15_000) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000)
      console.log(`Waiting for Android boot (${elapsed}s): ${lastState}`)
      lastProgressAt = Date.now()
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  const devices = commandOutput(adb, ['devices', '-l'], {
    env,
  }).output
  const screens =
    platform() === 'linux'
      ? commandOutput('screen', ['-ls']).output
      : '(GNU screen is only used on Linux)'
  throw new Error(
    [
      `Emulator did not finish booting within ${timeoutMs}ms.`,
      `Last state: ${lastState}`,
      `adb devices -l:\n${devices || '(no output)'}`,
      `screen -ls:\n${screens || '(no sessions)'}`,
      `Emulator log tail:\n${logTail(logFile)}`,
    ].join('\n\n'),
  )
}

export function stopEmulator(home) {
  spawnSync(adbBin(home), ['emu', 'kill'], { env: sdkEnv(home) })
}

export function saveSnapshot(home, name = SNAPSHOT_NAME) {
  run(adbBin(home), ['emu', 'avd', 'snapshot', 'save', name], { env: sdkEnv(home) })
}

export function isKvmAvailable() {
  if (platform() !== 'linux' || !existsSync('/dev/kvm')) return false
  try {
    accessSync('/dev/kvm', fsConstants.R_OK | fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}
