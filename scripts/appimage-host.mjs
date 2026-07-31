import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const account = process.env.APPIMAGE_E2E_ACCOUNT?.trim() || '1'
const platform = process.env.APPIMAGE_E2E_PLATFORM?.trim() || 'ubuntu-linux'
const outputDirectory = resolve(
  root,
  process.env.APPIMAGE_E2E_OUTPUT_DIR ?? `test-results/appimage-${platform}`,
)

function findAppImage() {
  if (process.env.APPIMAGE_E2E_PATH) {
    const explicit = resolve(root, process.env.APPIMAGE_E2E_PATH)
    if (!existsSync(explicit)) throw new Error(`APPIMAGE_E2E_PATH does not exist: ${explicit}`)
    return explicit
  }
  for (const directory of [
    'src-tauri/target/release/bundle/appimage',
    'desktop/src-tauri/target/release/bundle/appimage',
  ]) {
    const absolute = resolve(root, directory)
    if (!existsSync(absolute)) continue
    const name = readdirSync(absolute).find(
      (entry) => entry.endsWith('.AppImage') && !entry.endsWith('.AppImage.sig'),
    )
    if (name) return resolve(absolute, name)
  }
  throw new Error(
    'No AppImage found. Build the Linux desktop bundle first or set APPIMAGE_E2E_PATH.',
  )
}

const loaded = dotenv.config({
  path: resolve(root, process.env.APPIMAGE_E2E_ENV_FILE ?? 'test.env'),
  quiet: true,
})
if (loaded.error) throw loaded.error

const mapped = {}
for (const suffix of ['HOMESERVER', 'USER', 'PASSWORD', 'RECOVERY_KEY']) {
  const value = loaded.parsed?.[`MATRIX_E2E_ACCOUNT_${account}_${suffix}`]
  if (!value) throw new Error(`Missing account ${account} ${suffix} in the E2E environment`)
  mapped[`MATRIX_E2E_ACCOUNT_1_${suffix}`] = value
}
const callReceiverAccount = process.env.APPIMAGE_E2E_CALL_RECEIVER_ACCOUNT?.trim()
if (process.env.APPIMAGE_E2E_CALLS === '1') {
  if (!callReceiverAccount)
    throw new Error('APPIMAGE_E2E_CALL_RECEIVER_ACCOUNT is required when call testing is enabled')
  for (const suffix of ['HOMESERVER', 'USER', 'PASSWORD']) {
    const value = loaded.parsed?.[`MATRIX_E2E_ACCOUNT_${callReceiverAccount}_${suffix}`]
    if (!value) throw new Error(`Missing call receiver account ${callReceiverAccount} ${suffix}`)
    mapped[`MATRIX_E2E_CALL_RECEIVER_${suffix}`] = value
  }
}

const runtimeRoot = mkdtempSync(resolve(tmpdir(), 'foxchat-appimage-e2e-'))
mkdirSync(outputDirectory, { recursive: true })
for (const name of ['config', 'data', 'cache', 'runtime']) {
  mkdirSync(resolve(runtimeRoot, name), { recursive: true })
}

const childEnvironment = {
  ...process.env,
  ...mapped,
  APPIMAGE_E2E_PLATFORM: platform,
  APPIMAGE_E2E_OUTPUT_DIR: outputDirectory,
  APPIMAGE_E2E_INSTALLED_PATH: resolve(runtimeRoot, 'app-under-test.AppImage'),
  APPIMAGE_E2E_SCRIPT: resolve(root, 'scripts/appimage-smoke.mjs'),
  APPIMAGE_E2E_PROJECT_ROOT: root,
  APPIMAGE_E2E_NATIVE_DRIVER: process.env.APPIMAGE_E2E_NATIVE_DRIVER ?? '/usr/bin/WebKitWebDriver',
  PLAYWRIGHT_BROWSERS_PATH:
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? resolve(homedir(), '.cache', 'ms-playwright'),
  XDG_CONFIG_HOME: resolve(runtimeRoot, 'config'),
  XDG_DATA_HOME: resolve(runtimeRoot, 'data'),
  XDG_CACHE_HOME: resolve(runtimeRoot, 'cache'),
  XDG_RUNTIME_DIR: resolve(runtimeRoot, 'runtime'),
}
chmodSync(resolve(runtimeRoot, 'runtime'), 0o700)

const appImage = findAppImage()
try {
  const result = spawnSync('bash', ['tests/appimage/run.sh', appImage], {
    cwd: root,
    env: childEnvironment,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`AppImage ${platform} E2E exited with ${result.status}`)
} finally {
  rmSync(runtimeRoot, { recursive: true, force: true })
}
