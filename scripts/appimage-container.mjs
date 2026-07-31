import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const imageName = process.env.APPIMAGE_E2E_IMAGE ?? 'foxchat-appimage-e2e'
const dockerNetwork = process.env.APPIMAGE_E2E_DOCKER_NETWORK?.trim()
const sharedMemorySize = process.env.APPIMAGE_E2E_SHM_SIZE?.trim() || '512m'
const dockerfile = process.env.APPIMAGE_E2E_DOCKERFILE?.trim() || 'tests/appimage/Dockerfile'
const dockerCommand = (process.env.APPIMAGE_E2E_DOCKER_COMMAND ?? 'docker')
  .trim()
  .split(/\s+/)
  .filter(Boolean)
const dockerExecutable = dockerCommand.shift()

if (!dockerExecutable) throw new Error('APPIMAGE_E2E_DOCKER_COMMAND cannot be empty')

function runDocker(args) {
  const result = spawnSync(dockerExecutable, [...dockerCommand, ...args], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${[dockerExecutable, ...dockerCommand, ...args].join(' ')} failed`)
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}

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

const envFile = resolve(root, process.env.APPIMAGE_E2E_ENV_FILE ?? 'test.env')
if (!existsSync(envFile)) throw new Error(`AppImage E2E environment file not found: ${envFile}`)
const outputDirectory = resolve(root, 'test-results/appimage')
mkdirSync(outputDirectory, { recursive: true })

const account = process.env.APPIMAGE_E2E_ACCOUNT?.trim() || '1'
const loaded = dotenv.config({ path: envFile, quiet: true })
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
const notificationSenderAccount = process.env.APPIMAGE_E2E_NOTIFICATION_SENDER_ACCOUNT?.trim()
if (process.env.APPIMAGE_E2E_NOTIFICATIONS === '1') {
  if (!notificationSenderAccount)
    throw new Error(
      'APPIMAGE_E2E_NOTIFICATION_SENDER_ACCOUNT is required when notification testing is enabled',
    )
  for (const suffix of ['HOMESERVER', 'USER', 'PASSWORD']) {
    const value = loaded.parsed?.[`MATRIX_E2E_ACCOUNT_${notificationSenderAccount}_${suffix}`]
    if (!value)
      throw new Error(`Missing notification sender account ${notificationSenderAccount} ${suffix}`)
    mapped[`MATRIX_E2E_NOTIFICATION_SENDER_${suffix}`] = value
  }
}
const generatedEnv = resolve(outputDirectory, '.arch-e2e.env')
const callTesting = process.env.APPIMAGE_E2E_CALLS === '1'
const buildInContainer = process.env.APPIMAGE_E2E_BUILD_IN_CONTAINER === '1'
const projectMountRoot = '/opt/foxchat-project'
const browserMountRoot = '/opt/ms-playwright'
if (callTesting) {
  for (const path of [
    resolve(root, 'dist'),
    resolve(root, 'node_modules'),
    resolve(root, 'package.json'),
    resolve(homedir(), '.cache', 'ms-playwright'),
  ]) {
    if (!existsSync(path)) throw new Error(`Call E2E dependency does not exist: ${path}`)
  }
}
writeFileSync(
  generatedEnv,
  [
    ...Object.entries(mapped).map(
      ([key, value]) => `${key}=${String(value).replace(/\r?\n/g, '')}`,
    ),
    `APPIMAGE_E2E_PLATFORM=${process.env.APPIMAGE_E2E_PLATFORM ?? 'arch-linux'}`,
    `APPIMAGE_E2E_SKIP_RECOVERY=${process.env.APPIMAGE_E2E_SKIP_RECOVERY ?? '0'}`,
    `APPIMAGE_E2E_RECOVERY_ONLY=${process.env.APPIMAGE_E2E_RECOVERY_ONLY ?? '0'}`,
    `APPIMAGE_E2E_FAKE_MIC=${process.env.APPIMAGE_E2E_FAKE_MIC ?? '1'}`,
    `APPIMAGE_E2E_SKIP_MIC_TEST=${process.env.APPIMAGE_E2E_SKIP_MIC_TEST ?? '0'}`,
    `APPIMAGE_E2E_CALLS=${process.env.APPIMAGE_E2E_CALLS ?? '0'}`,
    `APPIMAGE_E2E_VERIFICATION=${process.env.APPIMAGE_E2E_VERIFICATION ?? '0'}`,
    `APPIMAGE_E2E_NOTIFICATIONS=${process.env.APPIMAGE_E2E_NOTIFICATIONS ?? '0'}`,
    ...(callTesting
      ? [
          `APPIMAGE_E2E_PROJECT_ROOT=${projectMountRoot}`,
          `PLAYWRIGHT_BROWSERS_PATH=${browserMountRoot}`,
        ]
      : []),
  ].join('\n') + '\n',
  { mode: 0o600 },
)

try {
  if (dockerfile.endsWith('Dockerfile.ci')) {
    const toolingDirectory = resolve(root, 'tests/appimage/.ci-tools/bin')
    const toolingDriver = resolve(toolingDirectory, 'tauri-driver')
    mkdirSync(toolingDirectory, { recursive: true })
    const installedDriver = process.env.APPIMAGE_E2E_TAURI_DRIVER?.trim()
    if (installedDriver) {
      copyFileSync(resolve(installedDriver), toolingDriver)
    } else if (!existsSync(toolingDriver)) {
      run('cargo', [
        'install',
        'tauri-driver',
        '--locked',
        '--root',
        resolve(root, 'tests/appimage/.ci-tools'),
      ])
    }
  }

  if (process.env.APPIMAGE_E2E_SKIP_DOCKER_BUILD !== '1') {
    runDocker([
      'build',
      ...(dockerNetwork ? ['--network', dockerNetwork] : []),
      '--file',
      dockerfile,
      '--tag',
      imageName,
      '.',
    ])
  }
  let application = buildInContainer ? undefined : findAppImage()
  if (buildInContainer) {
    const containerTarget = '/test-output/arch-target'
    runDocker([
      'run',
      '--rm',
      ...(dockerNetwork ? ['--network', dockerNetwork] : []),
      '--entrypoint',
      'bash',
      '--mount',
      `type=bind,source=${root},target=/workspace,readonly`,
      '--mount',
      `type=bind,source=${outputDirectory},target=/test-output`,
      imageName,
      '-lc',
      `CARGO_TARGET_DIR=${containerTarget} cargo build --locked --release --features custom-protocol --manifest-path /workspace/src-tauri/Cargo.toml --bin foxchat`,
    ])
    application = resolve(outputDirectory, 'arch-target/release/foxchat')
    if (!existsSync(application))
      throw new Error(`Arch Linux desktop binary was not produced: ${application}`)
  }
  const devices = (process.env.APPIMAGE_E2E_DRI_DEVICES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  runDocker([
    'run',
    '--rm',
    ...(dockerNetwork ? ['--network', dockerNetwork] : []),
    '--shm-size',
    sharedMemorySize,
    ...devices.flatMap((device) => ['--device', device]),
    '--env-file',
    generatedEnv,
    '--mount',
    `type=bind,source=${application},target=/artifacts/FoxChat.AppImage,readonly`,
    '--mount',
    `type=bind,source=${outputDirectory},target=/test-output`,
    '--mount',
    `type=bind,source=${resolve(root, 'scripts/appimage-smoke.mjs')},target=/opt/foxchat-test/appimage-smoke.mjs,readonly`,
    ...(callTesting
      ? [
          '--mount',
          `type=bind,source=${resolve(root, 'dist')},target=${projectMountRoot}/dist,readonly`,
          '--mount',
          `type=bind,source=${resolve(root, 'node_modules')},target=${projectMountRoot}/node_modules,readonly`,
          '--mount',
          `type=bind,source=${resolve(root, 'node_modules')},target=/opt/foxchat-test/node_modules,readonly`,
          '--mount',
          `type=bind,source=${resolve(root, 'package.json')},target=${projectMountRoot}/package.json,readonly`,
          '--mount',
          `type=bind,source=${resolve(homedir(), '.cache', 'ms-playwright')},target=${browserMountRoot},readonly`,
        ]
      : []),
    imageName,
  ])
} finally {
  rmSync(generatedEnv, { force: true })
}
