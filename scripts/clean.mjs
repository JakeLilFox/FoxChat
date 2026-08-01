import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')

// Keep this list explicit. Cleanup must never infer targets from .gitignore because
// ignored files also include credentials and local machine configuration.
const generatedPaths = [
  'dist',
  'dist-ssr',
  'coverage',
  'blob-report',
  'playwright-report',
  'test-results',
  '.playwright',
  '.gradle-ci',
  'desktop-updates',
  'android-artifacts',
  '.android-command-line-tools.zip',
  'ci_apk.apk',
  'foxchat-e2e-avd.tar.gz',
  'node_modules/.cache',
  'node_modules/.tmp',
  'node_modules/.vite',
  'foxchathomepage/coverage',
  'foxchathomepage/dist',
  'foxchathomepage/node_modules/.cache',
  'foxchathomepage/node_modules/.tmp',
  'foxchathomepage/node_modules/.vite',
  'push-gateway/coverage',
  'bridge/dist',
  'bridge/target',
  'src-tauri/target',
  'src-tauri/gen/android/.gradle',
  'src-tauri/gen/android/.tauri',
  'src-tauri/gen/android/build',
  'src-tauri/gen/android/buildSrc/build',
  'src-tauri/gen/android/app/.cxx',
  'src-tauri/gen/android/app/.externalNativeBuild',
  'src-tauri/gen/android/app/build',
  'src-tauri/gen/android/app/captures',
  'src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a',
  'src-tauri/gen/android/app/src/main/jniLibs/armeabi-v7a',
  'src-tauri/gen/android/app/src/main/jniLibs/x86',
  'src-tauri/gen/android/app/src/main/jniLibs/x86_64',
  'src-tauri/gen/android/app/src/main/assets/tauri.conf.json',
  'src-tauri/gen/android/proguard-tauri.pro',
  'src-tauri/gen/android/tauri.build.gradle.kts',
  'src-tauri/gen/android/tauri.properties',
  'src-tauri/gen/android/tauri.settings.gradle',
  'scripts/android-e2e/.out',
  'tests/appimage/.ci-tools',
]

const protectedNamePatterns = [
  /^google-services\.json$/i,
  /^google-credentials.*\.json$/i,
  /^service-account.*\.json$/i,
  /^tauri-signing\.key(?:\.pub)?$/i,
  /^(?:test|android|andriod)\.env$/i,
  /^\.env(?:\..+)?$/i,
  /^(?:local|key|keystore)\.properties$/i,
  /\.(?:jks|keystore|p12|pfx|pem|key)$/i,
]

const isProtectedName = (name) => protectedNamePatterns.some((pattern) => pattern.test(name))

function assertInsideWorkspace(path) {
  const pathFromRoot = relative(root, path)
  if (!pathFromRoot || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) {
    throw new Error(`Refusing to clean outside the project workspace: ${path}`)
  }
}

function findProtectedFiles(path, matches = []) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) return matches
  if (!stat.isDirectory()) {
    if (isProtectedName(path.split(/[\\/]/).at(-1))) matches.push(path)
    return matches
  }

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = resolve(path, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) findProtectedFiles(entryPath, matches)
    else if (isProtectedName(entry.name)) matches.push(entryPath)
  }
  return matches
}

function findDirectoriesNamed(startPath, expectedName, matches = []) {
  if (!existsSync(startPath)) return matches
  for (const entry of readdirSync(startPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const entryPath = resolve(startPath, entry.name)
    if (entry.name === expectedName) matches.push(entryPath)
    else findDirectoriesNamed(entryPath, expectedName, matches)
  }
  return matches
}

const targets = generatedPaths.map((path) => resolve(root, path))

const tauriDirectory = resolve(root, 'src-tauri')
if (existsSync(tauriDirectory)) {
  for (const entry of readdirSync(tauriDirectory, { withFileTypes: true })) {
    if (entry.isDirectory() && /^target-codex-[a-z0-9._-]+$/i.test(entry.name)) {
      targets.push(resolve(tauriDirectory, entry.name))
    }
  }
}

targets.push(
  ...findDirectoriesNamed(resolve(root, 'src-tauri/gen/android/app/src/main'), 'generated'),
)

let removed = 0
let skipped = 0
for (const target of [...new Set(targets)].sort()) {
  assertInsideWorkspace(target)
  if (!existsSync(target)) continue

  const protectedFiles = findProtectedFiles(target)
  if (protectedFiles.length) {
    skipped++
    console.warn(
      `Skipped ${relative(root, target)} because it contains protected file(s): ${protectedFiles
        .map((path) => relative(root, path))
        .join(', ')}`,
    )
    continue
  }

  console.log(`${dryRun ? 'Would remove' : 'Removed'} ${relative(root, target)}`)
  if (!dryRun) rmSync(target, { recursive: true, force: true })
  removed++
}

console.log(
  `${dryRun ? 'Dry run complete' : 'Cleanup complete'}: ${removed} target(s) ${
    dryRun ? 'found' : 'removed'
  }, ${skipped} skipped to protect secrets.`,
)
