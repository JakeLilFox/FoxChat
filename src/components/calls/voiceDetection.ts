export const VOICE_DETECTION_FFT_SIZE = 1024

const SPEECH_BAND_LOW_HZ = 180
const SPEECH_BAND_HIGH_HZ = 3600
const VOICED_BAND_HIGH_HZ = 1400
const HIGH_BAND_LOW_HZ = 4000
const HIGH_BAND_HIGH_HZ = 8000
const SPECTRAL_FLUX_SMOOTHING = 0.35
const OPENING_PERIODICITY = 0.35
const OPENING_SPECTRAL_FLUX_DB = 8.5
const CONTINUATION_SPECTRAL_FLUX_DB = 8.25

export type VoiceBandStats = {
  level: number
  flatness: number
  centroid: number
  spread: number
}

export type VoiceFrameAnalysis = {
  level: number
  periodicity: number
  speech: VoiceBandStats
  voiced: VoiceBandStats
  high: VoiceBandStats
  openingShape: boolean
  continuationShape: boolean
  voiceLike: boolean
}

export type TemporalVoiceFrameAnalysis = VoiceFrameAnalysis & {
  baseOpeningShape: boolean
  baseContinuationShape: boolean
  spectralFluxDb: number
  smoothedSpectralFluxDb: number
}

function bandStats(
  data: Float32Array,
  sampleRate: number,
  fftSize: number,
  lowHz: number,
  highHz: number,
): VoiceBandStats {
  const binHz = sampleRate / fftSize
  const lowBin = Math.max(0, Math.ceil(lowHz / binHz))
  const highBin = Math.min(data.length - 1, Math.floor(highHz / binHz))
  let power = 0
  let logPower = 0
  let weightedFrequency = 0
  let weightedSquaredFrequency = 0
  let count = 0
  for (let index = lowBin; index <= highBin; index++) {
    if (!Number.isFinite(data[index])) continue
    const binPower = Math.max(1e-12, 10 ** (data[index] / 10))
    power += binPower
    logPower += Math.log(binPower)
    const frequency = index * binHz
    weightedFrequency += frequency * binPower
    weightedSquaredFrequency += frequency * frequency * binPower
    count++
  }
  if (!count || power <= 0) return { level: -100, flatness: 1, centroid: highHz, spread: 0 }
  const meanPower = power / count
  const centroid = weightedFrequency / power
  return {
    level: 10 * Math.log10(meanPower),
    flatness: Math.exp(logPower / count) / meanPower,
    centroid,
    spread: Math.sqrt(Math.max(0, weightedSquaredFrequency / power - centroid * centroid)),
  }
}

function periodicity(data: Float32Array, sampleRate: number) {
  if (data.length < 2) return 0
  let mean = 0
  for (const sample of data) mean += sample
  mean /= data.length

  const minLag = Math.max(1, Math.floor(sampleRate / 420))
  const maxLag = Math.min(data.length - 16, Math.ceil(sampleRate / 85))
  let best = 0
  for (let lag = minLag; lag <= maxLag; lag += 2) {
    let correlation = 0
    let leftEnergy = 0
    let rightEnergy = 0
    for (let index = 0; index < data.length - lag; index++) {
      const left = data[index] - mean
      const right = data[index + lag] - mean
      correlation += left * right
      leftEnergy += left * left
      rightEnergy += right * right
    }
    const energy = Math.sqrt(leftEnergy * rightEnergy)
    if (energy > 1e-8) best = Math.max(best, correlation / energy)
  }
  return best
}

export function analyzeVoiceFrame(
  frequencyData: Float32Array,
  waveform: Float32Array,
  sampleRate: number,
  fftSize: number,
  continuing: boolean,
): VoiceFrameAnalysis {
  const speech = bandStats(
    frequencyData,
    sampleRate,
    fftSize,
    SPEECH_BAND_LOW_HZ,
    SPEECH_BAND_HIGH_HZ,
  )
  const voiced = bandStats(
    frequencyData,
    sampleRate,
    fftSize,
    SPEECH_BAND_LOW_HZ,
    VOICED_BAND_HIGH_HZ,
  )
  const high = bandStats(frequencyData, sampleRate, fftSize, HIGH_BAND_LOW_HZ, HIGH_BAND_HIGH_HZ)
  const framePeriodicity = periodicity(waveform, sampleRate)
  const openingShape =
    framePeriodicity >= 0.2 &&
    voiced.level >= speech.level - 3.5 &&
    speech.level >= high.level + 5 &&
    speech.flatness <= 0.42 &&
    speech.centroid <= 1900 &&
    speech.spread >= 380
  const continuationShape =
    framePeriodicity >= 0.11 &&
    voiced.level >= speech.level - 5.5 &&
    speech.level >= high.level + 2 &&
    speech.flatness <= 0.62 &&
    speech.centroid <= 2700 &&
    speech.spread >= 260

  return {
    level: speech.level,
    periodicity: framePeriodicity,
    speech,
    voiced,
    high,
    openingShape,
    continuationShape,
    voiceLike: continuing ? continuationShape : openingShape,
  }
}

function spectralFluxDb(
  current: Float32Array,
  previous: Float32Array | undefined,
  sampleRate: number,
  fftSize: number,
  currentLevel: number,
) {
  if (!previous) return 0
  const previousLevel = bandStats(
    previous,
    sampleRate,
    fftSize,
    SPEECH_BAND_LOW_HZ,
    SPEECH_BAND_HIGH_HZ,
  ).level
  const binHz = sampleRate / fftSize
  const lowBin = Math.max(0, Math.ceil(SPEECH_BAND_LOW_HZ / binHz))
  const highBin = Math.min(current.length - 1, Math.floor(SPEECH_BAND_HIGH_HZ / binHz))
  let squaredDifference = 0
  let count = 0
  for (let index = lowBin; index <= highBin; index++) {
    if (!Number.isFinite(current[index]) || !Number.isFinite(previous[index])) continue
    const difference = current[index] - currentLevel - (previous[index] - previousLevel)
    squaredDifference += difference * difference
    count++
  }
  return count ? Math.sqrt(squaredDifference / count) : 0
}

/** Keeps the small amount of history needed to reject steady non-speech sounds. */
export class VoiceFrameAnalyzer {
  private previousFrequencyData?: Float32Array
  private smoothedSpectralFluxDb = 0

  analyze(
    frequencyData: Float32Array,
    waveform: Float32Array,
    sampleRate: number,
    fftSize: number,
    continuing: boolean,
  ): TemporalVoiceFrameAnalysis {
    const base = analyzeVoiceFrame(frequencyData, waveform, sampleRate, fftSize, continuing)
    const frameSpectralFluxDb = spectralFluxDb(
      frequencyData,
      this.previousFrequencyData,
      sampleRate,
      fftSize,
      base.level,
    )
    this.smoothedSpectralFluxDb +=
      (frameSpectralFluxDb - this.smoothedSpectralFluxDb) * SPECTRAL_FLUX_SMOOTHING
    if (this.previousFrequencyData?.length !== frequencyData.length)
      this.previousFrequencyData = new Float32Array(frequencyData.length)
    this.previousFrequencyData.set(frequencyData)

    const openingShape =
      base.continuationShape &&
      base.periodicity >= OPENING_PERIODICITY &&
      this.smoothedSpectralFluxDb >= OPENING_SPECTRAL_FLUX_DB
    const continuationShape =
      base.continuationShape && this.smoothedSpectralFluxDb >= CONTINUATION_SPECTRAL_FLUX_DB

    return {
      ...base,
      baseOpeningShape: base.openingShape,
      baseContinuationShape: base.continuationShape,
      spectralFluxDb: frameSpectralFluxDb,
      smoothedSpectralFluxDb: this.smoothedSpectralFluxDb,
      openingShape,
      continuationShape,
      voiceLike: continuing ? continuationShape : openingShape,
    }
  }

  reset() {
    this.previousFrequencyData = undefined
    this.smoothedSpectralFluxDb = 0
  }
}
