import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
let cargo = 'cargo'

if (process.platform === 'win32') {
  cargo = join(homedir(), '.cargo', 'bin', 'cargo.exe')
  if (!existsSync(cargo)) {
    console.error(
      [
        'FoxChat native builds require the official Rustup Windows toolchain.',
        'The Cygwin cargo/rustc toolchain cannot cross-compile Tauri for Android.',
        '',
        'Install it with:',
        '  winget install --id Rustlang.Rustup',
        '',
        'Then open a new terminal and run:',
        '  rustup default stable-msvc',
        '  rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android',
        '  cargo install tauri-cli --version "^2.0.0" --locked',
      ].join('\n'),
    )
    process.exit(1)
  }
}

const environment = { ...process.env }
delete environment.LD_LIBRARY_PATH

if (process.platform === 'win32') {
  const cargoBin = join(homedir(), '.cargo', 'bin')
  const path = environment.PATH ?? environment.Path ?? ''
  const entries = path.split(delimiter).filter((entry) => entry.length > 0)
  const deduped = entries.filter((entry) => entry.toLowerCase() !== cargoBin.toLowerCase())
  environment.PATH = [cargoBin, ...deduped].join(delimiter)
  delete environment.Path
}
const result = spawnSync(cargo, ['tauri', ...args], { stdio: 'inherit', env: environment })
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
