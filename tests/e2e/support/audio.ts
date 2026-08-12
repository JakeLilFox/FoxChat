import { writeFileSync } from 'node:fs'
import type { Frame, Page } from '@playwright/test'

export type ToneOptions = {
  frequencyHz: number
  durationSeconds?: number
  sampleRate?: number
  amplitude?: number
  tremoloHz?: number
}

export function writeToneWav(
  path: string,
  {
    frequencyHz,
    durationSeconds = 30,
    sampleRate = 48_000,
    amplitude = 0.6,
    tremoloHz = 4,
  }: ToneOptions,
) {
  const sampleCount = Math.floor(durationSeconds * sampleRate)
  const dataSize = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate
    const tremolo = 1 - 0.18 * (0.5 + 0.5 * Math.sin(2 * Math.PI * tremoloHz * t))
    const sample = amplitude * tremolo * Math.sin(2 * Math.PI * frequencyHz * t)
    const clamped = Math.max(-1, Math.min(1, sample))
    buffer.writeInt16LE(Math.round(clamped * 32_767), 44 + i * 2)
  }

  writeFileSync(path, buffer)
}

export type DominantFrequencyResult = {
  elementIndex: number
  peakHz: number
  peakDb: number
  userId?: string
}

export async function dominantFrequenciesOf(
  target: Frame | Page,
  {
    sampleMs = 2_500,
    fftSize = 8_192,
    mixerActiveOnly = false,
  }: { sampleMs?: number; fftSize?: number; mixerActiveOnly?: boolean } = {},
): Promise<DominantFrequencyResult[]> {
  return target.evaluate(
    async ({ sampleMs, fftSize, mixerActiveOnly }) => {
      const audios = [...document.querySelectorAll('audio')]
      const entries = audios.flatMap((audio, elementIndex) => {
        if (mixerActiveOnly && audio.dataset.foxchatMixerActive !== 'true') return []
        const stream = audio.srcObject
        if (!(stream instanceof MediaStream) || !stream.getAudioTracks().length) return []
        const context = new AudioContext()
        const source = context.createMediaStreamSource(stream)
        const analyser = context.createAnalyser()
        analyser.fftSize = fftSize
        analyser.smoothingTimeConstant = 0
        source.connect(analyser)
        return [{ context, analyser, elementIndex, userId: audio.dataset.foxchatMixerUserId }]
      })
      const peaks = entries.map(({ elementIndex, userId }) => ({
        elementIndex,
        userId,
        peakHz: 0,
        peakDb: -Infinity,
      }))
      const bins = new Float32Array(fftSize / 2)
      const start = performance.now()
      while (performance.now() - start < sampleMs) {
        for (let index = 0; index < entries.length; index++) {
          const entry = entries[index]
          entry.analyser.getFloatFrequencyData(bins)
          let maxIndex = 0
          let maxValue = -Infinity
          for (let bin = 1; bin < bins.length; bin++) {
            if (bins[bin] > maxValue) {
              maxValue = bins[bin]
              maxIndex = bin
            }
          }
          if (maxValue > peaks[index].peakDb) {
            peaks[index] = {
              elementIndex: entry.elementIndex,
              userId: entry.userId,
              peakDb: maxValue,
              peakHz: (maxIndex * entry.context.sampleRate) / fftSize,
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      for (const entry of entries) void entry.context.close().catch(() => undefined)
      return peaks.filter((peak) => peak.peakDb !== -Infinity)
    },
    { sampleMs, fftSize, mixerActiveOnly },
  )
}

export async function dominantFrequencyOf(
  target: Frame | Page,
  { sampleMs = 2_500, fftSize = 8_192 }: { sampleMs?: number; fftSize?: number } = {},
): Promise<DominantFrequencyResult | undefined> {
  return target.evaluate(
    async ({ sampleMs, fftSize }) => {
      type Entry = { context: AudioContext; analyser: AnalyserNode }
      const audios = [...document.querySelectorAll('audio')]
      const entries: (Entry | undefined)[] = audios.map((audio) => {
        const stream = audio.srcObject
        if (!(stream instanceof MediaStream) || !stream.getAudioTracks().length) return undefined
        const context = new AudioContext()
        const source = context.createMediaStreamSource(stream)
        const analyser = context.createAnalyser()
        analyser.fftSize = fftSize
        analyser.smoothingTimeConstant = 0
        source.connect(analyser)
        return { context, analyser }
      })

      const peaks = entries.map(() => ({ peakHz: 0, peakDb: -Infinity }))
      const bins = new Float32Array(fftSize / 2)
      const start = performance.now()
      while (performance.now() - start < sampleMs) {
        for (let index = 0; index < entries.length; index++) {
          const entry = entries[index]
          if (!entry) continue
          entry.analyser.getFloatFrequencyData(bins)
          let maxIndex = 0
          let maxValue = -Infinity
          for (let bin = 1; bin < bins.length; bin++) {
            if (bins[bin] > maxValue) {
              maxValue = bins[bin]
              maxIndex = bin
            }
          }
          if (maxValue > peaks[index].peakDb) {
            peaks[index] = {
              peakDb: maxValue,
              peakHz: (maxIndex * entry.context.sampleRate) / fftSize,
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      for (const entry of entries) void entry?.context.close().catch(() => undefined)

      let bestIndex = -1
      let best: { peakHz: number; peakDb: number } | undefined
      peaks.forEach((peak, index) => {
        if (peak.peakDb !== -Infinity && (!best || peak.peakDb > best.peakDb)) {
          best = peak
          bestIndex = index
        }
      })
      return best ? { elementIndex: bestIndex, ...best } : undefined
    },
    { sampleMs, fftSize },
  )
}

export async function expectDominantFrequency(
  target: Frame | Page,
  expectHz: number,
  {
    toleranceHz = 25,
    sampleMs = 2_500,
    timeoutMs = 30_000,
  }: { toleranceHz?: number; sampleMs?: number; timeoutMs?: number } = {},
): Promise<DominantFrequencyResult> {
  const deadline = Date.now() + timeoutMs
  let lastError: Error
  do {
    const result = await dominantFrequencyOf(target, { sampleMs })
    if (!result) {
      lastError = new Error(
        `Expected an <audio> element carrying ~${expectHz} Hz, but no element with a live track was found`,
      )
    } else if (Math.abs(result.peakHz - expectHz) > toleranceHz) {
      lastError = new Error(
        `Expected a dominant frequency near ${expectHz} Hz but measured ${result.peakHz.toFixed(1)} Hz (${result.peakDb.toFixed(1)} dB) on audio element #${result.elementIndex}`,
      )
    } else {
      return result
    }
  } while (Date.now() < deadline)
  throw lastError
}
