import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const imageName = process.env.APPIMAGE_E2E_IMAGE ?? 'foxchat-appimage-e2e'
const dockerNetwork = process.env.APPIMAGE_E2E_DOCKER_NETWORK?.trim()
const sharedMemorySize = process.env.APPIMAGE_E2E_SHM_SIZE?.trim() || '512m'
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

const appImage = findAppImage()
const envFile = resolve(root, process.env.APPIMAGE_E2E_ENV_FILE ?? 'test.env')
if (!existsSync(envFile)) throw new Error(`AppImage E2E environment file not found: ${envFile}`)
const outputDirectory = resolve(root, 'test-results/appimage')
mkdirSync(outputDirectory, { recursive: true })

runDocker([
  'build',
  ...(dockerNetwork ? ['--network', dockerNetwork] : []),
  '--file',
  'tests/appimage/Dockerfile',
  '--tag',
  imageName,
  '.',
])
runDocker([
  'run',
  '--rm',
  ...(dockerNetwork ? ['--network', dockerNetwork] : []),
  '--shm-size',
  sharedMemorySize,
  '--env-file',
  envFile,
  '--mount',
  `type=bind,source=${appImage},target=/artifacts/FoxChat.AppImage,readonly`,
  '--mount',
  `type=bind,source=${outputDirectory},target=/test-output`,
  imageName,
])
