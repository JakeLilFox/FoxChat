import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { cp, writeFile } from 'node:fs/promises'
import { platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..', '..')

const CMDLINE_TOOLS_VERSION = '14742923'

function cmdlineToolsUrl() {
  if (platform() === 'linux')
    return `https://static.jakefox.de/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip`
  if (platform() === 'darwin')
    return `https://dl.google.com/android/repository/commandlinetools-mac-${CMDLINE_TOOLS_VERSION}_latest.zip`
  return `https://dl.google.com/android/repository/commandlinetools-win-${CMDLINE_TOOLS_VERSION}_latest.zip`
}

export function androidHome() {
  return process.env.ANDROID_HOME || join(repoRoot, '.android-sdk')
}

function needsShell(command) {
  return platform() === 'win32' && /\.(bat|cmd)$/i.test(command)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: needsShell(command),
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`)
  return result
}

function sdkmanagerBin(home) {
  const name = platform() === 'win32' ? 'sdkmanager.bat' : 'sdkmanager'
  return join(home, 'cmdline-tools', 'latest', 'bin', name)
}

export async function ensureCmdlineTools(home) {
  const sdkmanager = sdkmanagerBin(home)
  if (existsSync(sdkmanager)) return sdkmanager

  console.log('Downloading Android command-line tools...')
  mkdirSync(join(home, 'cmdline-tools', 'latest'), { recursive: true })
  const archive = join(repoRoot, '.android-command-line-tools.zip')
  const extractDir = join(repoRoot, '.android-command-line-tools')
  mkdirSync(extractDir, { recursive: true })

  const response = await fetch(cmdlineToolsUrl())
  if (!response.ok)
    throw new Error(
      `Could not download command-line tools: ${response.status} ${response.statusText}`,
    )
  await writeFile(archive, Buffer.from(await response.arrayBuffer()))

  if (platform() === 'win32') {
    run('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path "${archive}" -DestinationPath "${extractDir}" -Force`,
    ])
  } else {
    run('unzip', ['-q', '-o', archive, '-d', extractDir])
  }

  await cp(join(extractDir, 'cmdline-tools'), join(home, 'cmdline-tools', 'latest'), {
    recursive: true,
  })

  if (!existsSync(sdkmanager))
    throw new Error(`sdkmanager still missing at ${sdkmanager} after extraction`)
  return sdkmanager
}

export async function installSdkPackages(home, packages) {
  const sdkmanager = await ensureCmdlineTools(home)
  const env = { ...process.env, ANDROID_HOME: home, ANDROID_SDK_ROOT: home }
  if (!env.JAVA_HOME)
    throw new Error(
      'JAVA_HOME must be set before installing Android SDK packages (see the android_build_jdk memory note - a JDK 17+ install is required).',
    )

  const licenses = spawnSync(sdkmanager, [`--sdk_root=${home}`, '--licenses'], {
    input: Array(64).fill('y').join('\n') + '\n',
    env,
    shell: needsShell(sdkmanager),
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  if (licenses.error) throw licenses.error
  if (licenses.status !== 0)
    throw new Error(`sdkmanager --licenses exited with code ${licenses.status}`)

  run(sdkmanager, [`--sdk_root=${home}`, ...packages], { env })
}

export function platformToolsBin(home, name) {
  const suffix = platform() === 'win32' ? '.exe' : ''
  return join(home, 'platform-tools', `${name}${suffix}`)
}

export function emulatorBin(home) {
  const suffix = platform() === 'win32' ? '.exe' : ''
  return join(home, 'emulator', `emulator${suffix}`)
}

export { needsShell, run }
