import { describe, expect, it } from 'vitest'

import {
  VoiceFrameAnalyzer,
  VOICE_DETECTION_FFT_SIZE,
} from '../../src/components/calls/voiceDetection'

const sampleRate = 16_000

function periodicWaveform() {
  return Float32Array.from(
    { length: VOICE_DETECTION_FFT_SIZE },
    (_, index) => Math.sin((2 * Math.PI * 200 * index) / sampleRate) * 0.5,
  )
}

function spectrum(alternating = false, inverted = false) {
  const bins = new Float32Array(VOICE_DETECTION_FFT_SIZE / 2).fill(-90)
  for (let index = 12; index <= 230; index++) {
    const quietBin = index % 2 === (inverted ? 0 : 1)
    bins[index] = alternating && quietBin ? -60 : -35
  }
  return bins
}

function lowFrequencySound(inverted = false) {
  const bins = spectrum(true, inverted)
  for (let index = 1; index <= 10; index++) bins[index] = -10
  return bins
}

describe('VoiceFrameAnalyzer', () => {
  it('rejects a steady spectrum even when its waveform is strongly periodic', () => {
    const analyzer = new VoiceFrameAnalyzer()
    const bins = spectrum()
    const waveform = periodicWaveform()

    analyzer.analyze(bins, waveform, sampleRate, VOICE_DETECTION_FFT_SIZE, false)
    const repeated = analyzer.analyze(bins, waveform, sampleRate, VOICE_DETECTION_FFT_SIZE, false)

    expect(repeated.spectralFluxDb).toBeCloseTo(0)
    expect(repeated.openingShape).toBe(false)
  })

  it('tracks spectral-envelope changes when an analyser reuses its output array', () => {
    const analyzer = new VoiceFrameAnalyzer()
    const reusableBins = spectrum()
    const waveform = periodicWaveform()
    analyzer.analyze(reusableBins, waveform, sampleRate, VOICE_DETECTION_FFT_SIZE, false)

    reusableBins.set(spectrum(true))
    const changed = analyzer.analyze(
      reusableBins,
      waveform,
      sampleRate,
      VOICE_DETECTION_FFT_SIZE,
      false,
    )

    expect(changed.spectralFluxDb).toBeGreaterThan(10)
    expect(changed.smoothedSpectralFluxDb).toBeGreaterThan(0)
  })

  it('accepts changing speech-shaped frames with the quality-preferred thresholds', () => {
    const analyzer = new VoiceFrameAnalyzer()
    const waveform = periodicWaveform()
    analyzer.analyze(spectrum(true), waveform, sampleRate, VOICE_DETECTION_FFT_SIZE, false)
    analyzer.analyze(spectrum(true, true), waveform, sampleRate, VOICE_DETECTION_FFT_SIZE, false)

    const changed = analyzer.analyze(
      spectrum(true),
      waveform,
      sampleRate,
      VOICE_DETECTION_FFT_SIZE,
      false,
    )

    expect(changed.openingShape).toBe(true)
  })

  it('rejects a changing periodic sound dominated by frequencies below speech', () => {
    const analyzer = new VoiceFrameAnalyzer()
    const waveform = periodicWaveform()
    analyzer.analyze(spectrum(true), waveform, sampleRate, VOICE_DETECTION_FFT_SIZE, false)
    analyzer.analyze(spectrum(true, true), waveform, sampleRate, VOICE_DETECTION_FFT_SIZE, false)

    const changed = analyzer.analyze(
      lowFrequencySound(),
      waveform,
      sampleRate,
      VOICE_DETECTION_FFT_SIZE,
      false,
    )

    expect(changed.spectralFluxDb).toBeGreaterThan(10)
    expect(changed.openingShape).toBe(false)
  })

  it('clears temporal evidence when reset', () => {
    const analyzer = new VoiceFrameAnalyzer()
    const waveform = periodicWaveform()
    analyzer.analyze(spectrum(), waveform, sampleRate, VOICE_DETECTION_FFT_SIZE, false)
    analyzer.analyze(spectrum(true), waveform, sampleRate, VOICE_DETECTION_FFT_SIZE, false)

    analyzer.reset()
    const firstAfterReset = analyzer.analyze(
      spectrum(true),
      waveform,
      sampleRate,
      VOICE_DETECTION_FFT_SIZE,
      false,
    )

    expect(firstAfterReset.spectralFluxDb).toBe(0)
    expect(firstAfterReset.smoothedSpectralFluxDb).toBe(0)
  })
})
