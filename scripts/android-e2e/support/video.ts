import ffmpegPath from 'ffmpeg-static'
import { spawnSync } from 'node:child_process'
import { copyFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Browser } from 'webdriverio'

const SEGMENT_SECONDS = 90
const ROTATE_AFTER_MS = 85_000

function concatPath(path: string) {
  return `${path}.concat.txt`
}

function segmentPath(path: string, index: number) {
  return `${path}.part-${String(index).padStart(3, '0')}.mp4`
}

function ffmpegConcatPath(path: string) {
  return resolve(path).replaceAll('\\', '/').replaceAll("'", "'\\''")
}

export class AndroidTestVideo {
  private active = false
  private stopping = false
  private segmentIndex = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private operation: Promise<void> = Promise.resolve()
  private readonly segments: string[] = []

  constructor(
    private readonly browser: Browser,
    private readonly outputPath: string,
  ) {}

  async start() {
    await rm(this.outputPath, { force: true })
    await rm(concatPath(this.outputPath), { force: true })
    await this.startSegment()
  }

  private async startSegment() {
    await this.browser.startRecordingScreen({
      timeLimit: String(SEGMENT_SECONDS),
      bitRate: 4_000_000,
    })
    this.active = true
    this.scheduleRotation()
  }

  private scheduleRotation() {
    if (this.stopping) return
    this.timer = setTimeout(() => {
      this.operation = this.operation
        .then(() => this.rotate())
        .catch((error) => {
          this.active = false
          throw error
        })
    }, ROTATE_AFTER_MS)
  }

  private async saveActiveSegment() {
    if (!this.active) return
    this.active = false
    const path = segmentPath(this.outputPath, this.segmentIndex++)
    await this.browser.saveRecordingScreen(path)
    const info = await stat(path)
    if (!info.size) throw new Error(`Android screen recording segment was empty: ${path}`)
    this.segments.push(path)
  }

  private async rotate() {
    await this.saveActiveSegment()
    if (!this.stopping) await this.startSegment()
  }

  async stop() {
    this.stopping = true
    if (this.timer) clearTimeout(this.timer)
    await this.operation
    await this.saveActiveSegment()
    if (!this.segments.length) throw new Error('Android screen recording produced no segments')
    await this.joinSegments()
  }

  private async joinSegments() {
    if (this.segments.length === 1) {
      await copyFile(this.segments[0], this.outputPath)
      await rm(this.segments[0], { force: true })
      return
    }
    if (!ffmpegPath) throw new Error('ffmpeg-static does not provide a binary for this platform')

    const listPath = concatPath(this.outputPath)
    await writeFile(
      listPath,
      `${this.segments.map((path) => `file '${ffmpegConcatPath(path)}'`).join('\n')}\n`,
      'utf8',
    )
    const result = spawnSync(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        this.outputPath,
      ],
      {
        cwd: dirname(this.outputPath),
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      },
    )
    if (result.status !== 0)
      throw new Error(
        `Could not join Android recording segments (${result.status}): ` +
          `${result.stderr || result.stdout}`,
      )

    await Promise.all([
      rm(listPath, { force: true }),
      ...this.segments.map((path) => rm(path, { force: true })),
    ])
  }
}
