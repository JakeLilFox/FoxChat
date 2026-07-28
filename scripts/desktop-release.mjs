import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function releaseVersion(rawVersion) {
  const value = String(rawVersion ?? '')
    .trim()
    .replace(/^v/, '')
  if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) return value
  if (/^\d+$/.test(value)) return `0.1.${value}`
  throw new Error(
    `Desktop release version must be SemVer or a CI build number, received "${value}"`,
  )
}

function findArtifact(directories, suffix) {
  const searched = []
  for (const directory of Array.isArray(directories) ? directories : [directories]) {
    const absoluteDirectory = resolve(root, directory)
    searched.push(absoluteDirectory)
    if (!existsSync(absoluteDirectory)) continue
    const name = readdirSync(absoluteDirectory).find(
      (entry) => entry.endsWith(suffix) && !entry.endsWith(`${suffix}.sig`),
    )
    if (name) return resolve(absoluteDirectory, name)
  }
  throw new Error(`No ${suffix} artifact found in ${searched.join(', ')}`)
}

function copyReleaseArtifact(source, outputDirectory, outputName) {
  const destination = resolve(outputDirectory, outputName)
  copyFileSync(source, destination)
  return destination
}

function prepare(rawVersion) {
  const version = releaseVersion(rawVersion)
  const configPath = resolve(root, 'src-tauri/tauri.conf.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.version = version
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  console.log(`Prepared FoxChat desktop ${version}`)
}

function createManifest(rawVersion) {
  const version = releaseVersion(rawVersion)
  const outputDirectory = resolve(root, 'desktop-updates')
  mkdirSync(outputDirectory, { recursive: true })

  const linuxAppImage = findArtifact(
    [
      'src-tauri/target/release/bundle/appimage',
      'desktop/src-tauri/target/release/bundle/appimage',
    ],
    '.AppImage',
  )
  const windowsInstaller = findArtifact(
    'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis',
    '-setup.exe',
  )
  const linuxDeb = findArtifact(
    ['src-tauri/target/release/bundle/deb', 'desktop/src-tauri/target/release/bundle/deb'],
    '.deb',
  )
  const linuxRpm = findArtifact(
    ['src-tauri/target/release/bundle/rpm', 'desktop/src-tauri/target/release/bundle/rpm'],
    '.rpm',
  )

  const published = {
    linux: copyReleaseArtifact(
      linuxAppImage,
      outputDirectory,
      `FoxChat-${version}-linux-x86_64.AppImage`,
    ),
    windows: copyReleaseArtifact(
      windowsInstaller,
      outputDirectory,
      `FoxChat-${version}-windows-x86_64-setup.exe`,
    ),
  }
  copyReleaseArtifact(linuxAppImage, outputDirectory, 'FoxChat-linux-x86_64.AppImage')
  copyReleaseArtifact(windowsInstaller, outputDirectory, 'FoxChat-windows-x86_64-setup.exe')
  copyReleaseArtifact(linuxDeb, outputDirectory, 'FoxChat-linux-x86_64.deb')
  copyReleaseArtifact(linuxRpm, outputDirectory, 'FoxChat-linux-x86_64.rpm')
  for (const [artifact, names] of [
    [
      linuxAppImage,
      [`FoxChat-${version}-linux-x86_64.AppImage.sig`, 'FoxChat-linux-x86_64.AppImage.sig'],
    ],
    [
      windowsInstaller,
      [`FoxChat-${version}-windows-x86_64-setup.exe.sig`, 'FoxChat-windows-x86_64-setup.exe.sig'],
    ],
  ]) {
    for (const name of names) copyReleaseArtifact(`${artifact}.sig`, outputDirectory, name)
  }

  const signature = (artifact) => readFileSync(`${artifact}.sig`, 'utf8').trim()
  const baseUrl = 'https://foxchat.jakefox.de/updates'
  const manifest = {
    version,
    notes: process.env.DESKTOP_UPDATE_NOTES || `FoxChat desktop update ${version}`,
    pub_date: new Date().toISOString(),
    platforms: {
      'linux-x86_64': {
        signature: signature(linuxAppImage),
        url: `${baseUrl}/${basename(published.linux)}`,
      },
      'windows-x86_64': {
        signature: signature(windowsInstaller),
        url: `${baseUrl}/${basename(published.windows)}`,
      },
    },
  }
  writeFileSync(resolve(outputDirectory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Created signed update manifest for FoxChat desktop ${version}`)
}

const [command, version] = process.argv.slice(2)
if (command === 'prepare') prepare(version)
else if (command === 'manifest') createManifest(version)
else {
  throw new Error('Usage: node scripts/desktop-release.mjs <prepare|manifest> <version>')
}
