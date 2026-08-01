import { readdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import {
  VoiceFrameAnalyzer,
  VOICE_DETECTION_FFT_SIZE,
  type TemporalVoiceFrameAnalysis,
} from '../src/components/calls/voiceDetection.ts'

type FixtureKind = 'music' | 'noise' | 'speech'

type Wav = {
  sampleRate: number
  samples: Float32Array
}

type FrameResult = TemporalVoiceFrameAnalysis & {
  sequence: number
  rmsDb: number
  zeroCrossingRate: number
  spectralCrestDb: number
  lowDifferenceDb: number
  upperDifferenceDb: number
}

const fixtureDirectory = resolve('tests/assets/sounds')
const benchmarkWindowsPerLongFixture = 8
const framesPerBenchmarkWindow = 32
const benchmarkSampleRate = 48_000
const benchmarkPollMs = 32

function readWav(path: string): Wav {
  const buffer = readFileSync(path)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error(`${path} is not a RIFF/WAVE file`)

  let formatOffset = -1
  let formatSize = 0
  let dataOffset = -1
  let dataSize = 0
  for (let offset = 12; offset + 8 <= buffer.length; ) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const contentOffset = offset + 8
    if (id === 'fmt ') {
      formatOffset = contentOffset
      formatSize = size
    } else if (id === 'data') {
      dataOffset = contentOffset
      dataSize = Math.min(size, buffer.length - contentOffset)
    }
    offset = contentOffset + size + (size % 2)
  }
  if (formatOffset < 0 || formatSize < 16 || dataOffset < 0)
    throw new Error(`${path} has no usable format or data chunk`)

  const audioFormat = buffer.readUInt16LE(formatOffset)
  const channels = buffer.readUInt16LE(formatOffset + 2)
  const sampleRate = buffer.readUInt32LE(formatOffset + 4)
  const bitsPerSample = buffer.readUInt16LE(formatOffset + 14)
  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16)
    throw new Error(
      `${path} must be mono 16-bit PCM (format=${audioFormat}, channels=${channels}, bits=${bitsPerSample})`,
    )

  const samples = new Float32Array(Math.floor(dataSize / 2))
  for (let index = 0; index < samples.length; index++)
    samples[index] = buffer.readInt16LE(dataOffset + index * 2) / 32768
  return { sampleRate, samples }
}

function spectrum(frame: Float32Array) {
  const size = frame.length
  const real = new Float64Array(size)
  const imaginary = new Float64Array(size)
  let windowSum = 0
  for (let index = 0; index < size; index++) {
    const phase = (2 * Math.PI * index) / size
    const window = 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase)
    real[index] = frame[index] * window
    windowSum += window
  }

  for (let index = 1, target = 0; index < size; index++) {
    let bit = size >> 1
    while (target & bit) {
      target ^= bit
      bit >>= 1
    }
    target ^= bit
    if (index < target) {
      const realValue = real[index]
      real[index] = real[target]
      real[target] = realValue
      const imaginaryValue = imaginary[index]
      imaginary[index] = imaginary[target]
      imaginary[target] = imaginaryValue
    }
  }

  for (let length = 2; length <= size; length *= 2) {
    const angle = (-2 * Math.PI) / length
    const stepReal = Math.cos(angle)
    const stepImaginary = Math.sin(angle)
    for (let start = 0; start < size; start += length) {
      let twiddleReal = 1
      let twiddleImaginary = 0
      for (let index = 0; index < length / 2; index++) {
        const evenIndex = start + index
        const oddIndex = evenIndex + length / 2
        const oddReal = real[oddIndex] * twiddleReal - imaginary[oddIndex] * twiddleImaginary
        const oddImaginary = real[oddIndex] * twiddleImaginary + imaginary[oddIndex] * twiddleReal
        real[oddIndex] = real[evenIndex] - oddReal
        imaginary[oddIndex] = imaginary[evenIndex] - oddImaginary
        real[evenIndex] += oddReal
        imaginary[evenIndex] += oddImaginary
        const nextTwiddleReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal
        twiddleReal = nextTwiddleReal
      }
    }
  }

  const bins = new Float32Array(size / 2)
  for (let index = 0; index < bins.length; index++) {
    const amplitude = (2 * Math.hypot(real[index], imaginary[index])) / windowSum
    bins[index] = 20 * Math.log10(Math.max(1e-10, amplitude))
  }
  return bins
}

function frameRmsDb(frame: Float32Array) {
  let power = 0
  for (const sample of frame) power += sample * sample
  return 10 * Math.log10(Math.max(1e-12, power / frame.length))
}

function resampledFrame(wav: Wav, outputOffset: number) {
  const frame = new Float32Array(VOICE_DETECTION_FFT_SIZE)
  const sourcePerOutputSample = wav.sampleRate / benchmarkSampleRate
  for (let index = 0; index < frame.length; index++) {
    const sourcePosition = (outputOffset + index) * sourcePerOutputSample
    const leftIndex = Math.floor(sourcePosition)
    const mix = sourcePosition - leftIndex
    const left = wav.samples[leftIndex] ?? 0
    const right = wav.samples[leftIndex + 1] ?? left
    frame[index] = left + (right - left) * mix
  }
  return frame
}

function zeroCrossingRate(frame: Float32Array) {
  let crossings = 0
  for (let index = 1; index < frame.length; index++)
    if (frame[index - 1] < 0 !== frame[index] < 0) crossings++
  return crossings / (frame.length - 1)
}

function bandLevel(bins: Float32Array, sampleRate: number, lowHz: number, highHz: number) {
  const binHz = sampleRate / VOICE_DETECTION_FFT_SIZE
  const lowBin = Math.ceil(lowHz / binHz)
  const highBin = Math.min(bins.length - 1, Math.floor(highHz / binHz))
  let power = 0
  let count = 0
  for (let index = lowBin; index <= highBin; index++) {
    power += 10 ** (bins[index] / 10)
    count++
  }
  return 10 * Math.log10(Math.max(1e-12, power / count))
}

function spectralCrestDb(bins: Float32Array, sampleRate: number) {
  const binHz = sampleRate / VOICE_DETECTION_FFT_SIZE
  const lowBin = Math.ceil(180 / binHz)
  const highBin = Math.floor(3600 / binHz)
  let maximum = -Infinity
  let power = 0
  for (let index = lowBin; index <= highBin; index++) {
    maximum = Math.max(maximum, bins[index])
    power += 10 ** (bins[index] / 10)
  }
  const level = 10 * Math.log10(power / (highBin - lowBin + 1))
  return maximum - level
}

function percentile(values: number[], position: number) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor((sorted.length - 1) * position)] ?? -Infinity
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function analyzeFixture(path: string) {
  const wav = readWav(path)
  if (wav.samples.length < VOICE_DETECTION_FFT_SIZE)
    throw new Error(`${path} is shorter than one analysis frame`)
  const frameStride = Math.round((benchmarkSampleRate * benchmarkPollMs) / 1000)
  const frames: FrameResult[] = []
  const frameAnalyzer = new VoiceFrameAnalyzer()
  let previousOffset: number | undefined
  let sequence = 0
  const outputSampleCount = Math.floor((wav.samples.length * benchmarkSampleRate) / wav.sampleRate)
  const availableFrameCount =
    Math.floor((outputSampleCount - VOICE_DETECTION_FFT_SIZE) / frameStride) + 1
  const maximumSampledFrames = benchmarkWindowsPerLongFixture * framesPerBenchmarkWindow
  const frameIndexes: number[] = []
  if (availableFrameCount <= maximumSampledFrames) {
    for (let index = 0; index < availableFrameCount; index++) frameIndexes.push(index)
  } else {
    for (let windowIndex = 0; windowIndex < benchmarkWindowsPerLongFixture; windowIndex++) {
      const windowStart = Math.round(
        (windowIndex * (availableFrameCount - framesPerBenchmarkWindow)) /
          (benchmarkWindowsPerLongFixture - 1),
      )
      for (let index = 0; index < framesPerBenchmarkWindow; index++)
        frameIndexes.push(windowStart + index)
    }
  }

  for (const frameIndex of frameIndexes) {
    const offset = frameIndex * frameStride
    if (previousOffset !== undefined && offset !== previousOffset + frameStride) {
      frameAnalyzer.reset()
      sequence++
    }
    const waveform = resampledFrame(wav, offset)
    const bins = spectrum(waveform)
    const analysis = frameAnalyzer.analyze(
      bins,
      waveform,
      benchmarkSampleRate,
      VOICE_DETECTION_FFT_SIZE,
      false,
    )
    frames.push({
      ...analysis,
      sequence,
      rmsDb: frameRmsDb(waveform),
      zeroCrossingRate: zeroCrossingRate(waveform),
      spectralCrestDb: spectralCrestDb(bins, benchmarkSampleRate),
      lowDifferenceDb: analysis.speech.level - bandLevel(bins, benchmarkSampleRate, 20, 160),
      upperDifferenceDb:
        bandLevel(bins, benchmarkSampleRate, 180, 1000) -
        bandLevel(bins, benchmarkSampleRate, 1000, 3600),
    })
    previousOffset = offset
  }

  const loudThreshold = Math.max(
    -60,
    percentile(
      frames.map((frame) => frame.rmsDb),
      0.9,
    ) - 30,
  )
  const loudFrames = frames.filter((frame) => frame.rmsDb >= loudThreshold)
  const rate = (predicate: (frame: FrameResult) => boolean) =>
    loudFrames.filter(predicate).length / loudFrames.length
  const activationWindows = (predicate: (frame: FrameResult) => boolean) => {
    const activated = new Set<number>()
    let run = 0
    let previousSequence = -1
    for (const frame of frames) {
      if (frame.sequence !== previousSequence) run = 0
      previousSequence = frame.sequence
      run = frame.rmsDb >= loudThreshold && predicate(frame) ? run + 1 : 0
      // 110 ms attack at the production 32 ms polling interval.
      if (run >= 5) activated.add(frame.sequence)
    }
    return activated.size
  }
  return {
    file: basename(path),
    duration: wav.samples.length / wav.sampleRate,
    sampledFrames: frames.length,
    loudFrames: loudFrames.length,
    sampledWindows: sequence + 1,
    oldActivationWindows: activationWindows((frame) => frame.baseOpeningShape),
    newActivationWindows: activationWindows((frame) => frame.openingShape),
    opening: rate((frame) => frame.baseOpeningShape),
    continuation: rate((frame) => frame.baseContinuationShape),
    smoothFlux9: rate((frame) => frame.smoothedSpectralFluxDb >= 9),
    proposedOpening: rate((frame) => frame.openingShape),
    proposedContinuation: rate((frame) => frame.continuationShape),
    diagnostics: {
      periodicity: percentile(
        loudFrames.map((frame) => frame.periodicity),
        0.5,
      ),
      zeroCrossingRate: percentile(
        loudFrames.map((frame) => frame.zeroCrossingRate),
        0.5,
      ),
      spectralCrestDb: percentile(
        loudFrames.map((frame) => frame.spectralCrestDb),
        0.5,
      ),
      lowDifferenceDb: percentile(
        loudFrames.map((frame) => frame.lowDifferenceDb),
        0.5,
      ),
      upperDifferenceDb: percentile(
        loudFrames.map((frame) => frame.upperDifferenceDb),
        0.5,
      ),
      spectralFluxDb: percentile(
        loudFrames.map((frame) => frame.spectralFluxDb),
        0.5,
      ),
    },
  }
}

const fixtures = readdirSync(fixtureDirectory)
  .filter((file) => file.endsWith('.wav'))
  .map((file) => {
    const kind = file.slice(0, file.indexOf('-')) as FixtureKind
    if (!['music', 'noise', 'speech'].includes(kind))
      throw new Error(`Unknown fixture kind in ${file}`)
    return { kind, path: resolve(fixtureDirectory, file) }
  })

if (!fixtures.length) throw new Error(`No WAV fixtures found in ${fixtureDirectory}`)

const results = fixtures.map(({ kind, path }) => ({ kind, ...analyzeFixture(path) }))
const summaries = (['music', 'noise', 'speech'] as const).map((kind) => {
  const matches = results.filter((result) => result.kind === kind)
  const loudFrames = matches.reduce((sum, result) => sum + result.loudFrames, 0)
  const weightedRate = (select: (result: (typeof results)[number]) => number) =>
    matches.reduce((sum, result) => sum + select(result) * result.loudFrames, 0) / loudFrames
  return {
    kind,
    fixtures: matches.length,
    minutes: matches.reduce((sum, result) => sum + result.duration / 60, 0).toFixed(1),
    frames: loudFrames,
    oldOpening: weightedRate((result) => result.opening),
    newOpening: weightedRate((result) => result.proposedOpening),
    oldContinuation: weightedRate((result) => result.continuation),
    newContinuation: weightedRate((result) => result.proposedContinuation),
    sampledWindows: matches.reduce((sum, result) => sum + result.sampledWindows, 0),
    oldActivationWindows: matches.reduce((sum, result) => sum + result.oldActivationWindows, 0),
    newActivationWindows: matches.reduce((sum, result) => sum + result.newActivationWindows, 0),
  }
})

console.table(
  summaries.map((summary) => ({
    ...summary,
    oldOpening: percent(summary.oldOpening),
    newOpening: percent(summary.newOpening),
    oldContinuation: percent(summary.oldContinuation),
    newContinuation: percent(summary.newContinuation),
    oldActivated: `${summary.oldActivationWindows}/${summary.sampledWindows}`,
    newActivated: `${summary.newActivationWindows}/${summary.sampledWindows}`,
  })),
)

const speechSummary = summaries.find((summary) => summary.kind === 'speech')!
const nonSpeechSummaries = summaries.filter((summary) => summary.kind !== 'speech')
const nonSpeechFrames = nonSpeechSummaries.reduce((sum, summary) => sum + summary.frames, 0)
const nonSpeechRate = (field: 'oldOpening' | 'newOpening') =>
  nonSpeechSummaries.reduce((sum, summary) => sum + summary[field] * summary.frames, 0) /
  nonSpeechFrames
const oldNonSpeechOpening = nonSpeechRate('oldOpening')
const newNonSpeechOpening = nonSpeechRate('newOpening')
const oldNonSpeechActivations = nonSpeechSummaries.reduce(
  (sum, summary) => sum + summary.oldActivationWindows,
  0,
)
const newNonSpeechActivations = nonSpeechSummaries.reduce(
  (sum, summary) => sum + summary.newActivationWindows,
  0,
)
const regressions = [
  {
    passes: speechSummary.newOpening >= 0.3,
    message: `speech opening rate ${percent(speechSummary.newOpening)} is below 30%`,
  },
  {
    passes: newNonSpeechOpening <= 0.2,
    message: `non-speech opening rate ${percent(newNonSpeechOpening)} is above 20%`,
  },
  {
    passes: newNonSpeechOpening <= oldNonSpeechOpening * 0.4,
    message: 'non-speech frame rejection improved by less than 60%',
  },
  {
    passes: speechSummary.newActivationWindows >= speechSummary.oldActivationWindows * 0.75,
    message: 'speech activation-window retention fell below 75%',
  },
  {
    passes: newNonSpeechActivations <= oldNonSpeechActivations * 0.3,
    message: 'non-speech activation-window rejection improved by less than 70%',
  },
]
const failures = regressions.filter((regression) => !regression.passes)
if (failures.length)
  throw new Error(
    `Speech benchmark regression:\n${failures.map((failure) => `- ${failure.message}`).join('\n')}`,
  )
console.log('Speech benchmark thresholds passed.')

if (process.argv.includes('--details')) {
  console.table(
    results.map((result) => ({
      kind: result.kind,
      file: result.file,
      seconds: result.duration.toFixed(1),
      frames: `${result.loudFrames}/${result.sampledFrames}`,
      oldOpening: percent(result.opening),
      newOpening: percent(result.proposedOpening),
      oldContinuation: percent(result.continuation),
      newContinuation: percent(result.proposedContinuation),
      flux: percent(result.smoothFlux9),
    })),
  )

  console.table(
    results.map((result) => ({
      kind: result.kind,
      file: result.file,
      periodicity: result.diagnostics.periodicity.toFixed(2),
      zeroCrossing: result.diagnostics.zeroCrossingRate.toFixed(3),
      crestDb: result.diagnostics.spectralCrestDb.toFixed(1),
      lowDiffDb: result.diagnostics.lowDifferenceDb.toFixed(1),
      upperDiffDb: result.diagnostics.upperDifferenceDb.toFixed(1),
      fluxDb: result.diagnostics.spectralFluxDb.toFixed(1),
    })),
  )
}
