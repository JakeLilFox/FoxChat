import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const PACKAGE_NAME = 'foxchat.jakefox.de.dev'
const MAX_ANDROID_VERSION_CODE = 2_100_000_000
const scriptPath = fileURLToPath(import.meta.url)
const scriptDirectory = dirname(scriptPath)
const repositoryRoot = resolve(scriptDirectory, '..')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) fail(`Could not run ${basename(command)}: ${result.error.message}`)
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stderr || result.stdout}` : ''
    fail(`${basename(command)} ${args.join(' ')} failed with exit code ${result.status}${details}`)
  }
  return options.capture ? result.stdout.trim() : ''
}

function adbCandidates() {
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb'
  return [
    process.env.ANDROID_ADB,
    process.env.ADB,
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'platform-tools', executable),
    process.env.ANDROID_SDK_ROOT &&
      join(process.env.ANDROID_SDK_ROOT, 'platform-tools', executable),
    process.platform === 'win32' &&
      process.env.LOCALAPPDATA &&
      join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', executable),
    join(homedir(), 'Downloads', 'platform-tools', executable),
  ].filter(Boolean)
}

function findAdb() {
  const candidates = [
    ...new Set([
      ...adbCandidates().filter((candidate) => existsSync(candidate)),
      process.platform === 'win32' ? 'adb.exe' : 'adb',
    ]),
  ]
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['version'], { encoding: 'utf8', stdio: 'pipe' })
    if (!result.error && result.status === 0) return candidate
  }
  fail(`No runnable ADB executable was found (checked ${candidates.join(', ')})`)
}

function androidJavaHome() {
  const candidates = [
    process.env.ANDROID_JAVA_HOME,
    process.platform === 'win32' &&
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Android', 'Android Studio', 'jbr'),
    process.env.JAVA_HOME,
  ].filter(Boolean)
  for (const candidate of new Set(candidates)) {
    const executable = join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    if (!existsSync(executable)) continue
    const result = spawnSync(executable, ['-version'], { encoding: 'utf8', stdio: 'pipe' })
    const versionText = `${result.stderr ?? ''}${result.stdout ?? ''}`
    const major = Number(versionText.match(/version "(?:1\.)?(\d+)/)?.[1])
    if (!result.error && result.status === 0 && major >= 17 && major <= 24) return candidate
  }
  return undefined
}

function connectedDevice(adb) {
  const requested = process.env.ANDROID_DEVICE_SERIAL?.trim()
  const output = run(adb, ['devices'], { capture: true })
  const devices = output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.match(/^(\S+)\s+device$/)?.[1])
    .filter(Boolean)
  if (requested) {
    if (!devices.includes(requested)) {
      fail(`ANDROID_DEVICE_SERIAL=${requested} is not an authorized connected device`)
    }
    return requested
  }
  if (devices.length === 0) fail('No authorized Android device is connected through ADB')
  if (devices.length > 1) {
    fail(
      `Multiple Android devices are connected; set ANDROID_DEVICE_SERIAL (${devices.join(', ')})`,
    )
  }
  return devices[0]
}

function installedVersionCode(adb, serial) {
  const result = spawnSync(adb, ['-s', serial, 'shell', 'dumpsys', 'package', PACKAGE_NAME], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (result.error || result.status !== 0) return 0
  return Number(result.stdout.match(/versionCode=(\d+)/)?.[1] ?? 0)
}

export function timestampVersion(now, minimumCode = 0) {
  const pad = (value) => String(value).padStart(2, '0')
  const dateVersion = [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`,
  ].join('.')
  const versionCode = Math.max(Math.floor(now.getTime() / 1_000), minimumCode + 1)
  if (versionCode > MAX_ANDROID_VERSION_CODE) {
    fail(`Generated Android versionCode ${versionCode} exceeds ${MAX_ANDROID_VERSION_CODE}`)
  }
  return { versionCode, versionName: `${dateVersion}-dev` }
}

function apkFiles(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return apkFiles(path)
    return entry.isFile() && entry.name.endsWith('.apk') ? [path] : []
  })
}

function newestDevApk(buildStartedAt) {
  const outputRoot = join(
    repositoryRoot,
    'src-tauri',
    'gen',
    'android',
    'app',
    'build',
    'outputs',
    'apk',
  )
  const candidates = apkFiles(outputRoot)
    .map((path) => ({ path, modifiedAt: statSync(path).mtimeMs }))
    .filter(({ path, modifiedAt }) => /debug/i.test(path) && modifiedAt >= buildStartedAt - 5_000)
    .sort((first, second) => second.modifiedAt - first.modifiedAt)
  if (!candidates.length) fail(`The Android build produced no new debug APK below ${outputRoot}`)
  return candidates[0].path
}

function main() {
  const adb = findAdb()
  const serial = connectedDevice(adb)
  const version = timestampVersion(new Date(), installedVersionCode(adb, serial))
  const javaHome = androidJavaHome()

  console.log(
    `Building ${PACKAGE_NAME} ${version.versionName} (${version.versionCode}) for ${serial}`,
  )
  if (javaHome) console.log(`Using Android JDK from ${javaHome}`)
  if (process.argv.includes('--print-config')) return

  const environment = {
    ...process.env,
    ANDROID_DEV_SIDE_BY_SIDE: 'true',
    VERSION_CODE: String(version.versionCode),
    VERSION_NAME: version.versionName,
    VITE_BUILD_VERSION: version.versionName,
    ...(javaHome ? { JAVA_HOME: javaHome } : {}),
  }
  const buildStartedAt = Date.now()
  run(
    process.execPath,
    [
      join(repositoryRoot, 'scripts', 'tauri.mjs'),
      'android',
      'build',
      '--apk',
      '--debug',
      '--target',
      'aarch64',
    ],
    { env: environment },
  )
  const apk = newestDevApk(buildStartedAt)

  console.log(`Installing ${apk}`)
  run(adb, ['-s', serial, 'install', '-r', '-g', apk])

  const installed = run(adb, ['-s', serial, 'shell', 'dumpsys', 'package', PACKAGE_NAME], {
    capture: true,
  })
  if (!installed.includes(`versionCode=${version.versionCode}`)) {
    fail(`${PACKAGE_NAME} was installed, but Android did not report the expected versionCode`)
  }
  console.log(`Installed ${PACKAGE_NAME} ${version.versionName} on ${serial}`)
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) main()
