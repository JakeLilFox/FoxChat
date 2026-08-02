import { VoiceFrameAnalyzer, VOICE_DETECTION_FFT_SIZE } from './voiceDetection'

const CALIBRATION_MS = 1200
const WARMUP_MS = 80
const ATTACK_MS = 110
const ENERGY_FALLBACK_MS = 180
const RELEASE_MS = 350
const MIN_MARGIN_DB = 12
const CLOSE_HYSTERESIS_DB = 6
const AUTOMATIC_THRESHOLD_POSITION = 0.58
const FLOOR_ADAPT_DOWN = 0.08
const FLOOR_ADAPT_UP = 0.008
const SPEECH_ADAPT = 0.04
const POLL_MS = 32

export type VoiceActivationLevel = {
  level: number
  threshold: number
  speaking: boolean
  voiceLike: boolean
  aboveThreshold: boolean
  candidate: boolean
}

export type VoiceActivationMonitorOptions = {
  gated?: boolean
  delayMs?: number
}

export function voiceActivityDecision(
  aboveThresholdForMs: number | undefined,
  speechShaped: boolean,
  speaking: boolean,
) {
  const aboveThreshold = aboveThresholdForMs !== undefined
  const fallback = aboveThreshold && aboveThresholdForMs >= ENERGY_FALLBACK_MS
  const candidate = aboveThreshold && (speaking || speechShaped || fallback)
  return {
    candidate,
    active: candidate && (speaking || aboveThresholdForMs >= ATTACK_MS),
    voiceLike: speechShaped || fallback,
  }
}

export class VoiceActivation {
  private context?: AudioContext
  private analyser?: AnalyserNode
  private stream?: MediaStream
  private source?: MediaStreamAudioSourceNode
  private timer?: number
  private releaseTimer?: number
  private bins?: Float32Array<ArrayBuffer>
  private waveform?: Float32Array<ArrayBuffer>
  private noiseFloor = -65
  private speechLevel = -45
  private calibrationLevels: number[] = []
  private speaking = false
  private startedAt = 0
  private aboveThresholdSince?: number
  private onSpeakingChange: (speaking: boolean) => void
  private onLevel?: (info: VoiceActivationLevel) => void
  private onActivity?: () => void
  private manualThresholdDb?: number
  private monitorDelay?: DelayNode
  private monitorGain?: GainNode
  private monitorGated = false
  private monitorDelayMs = 0
  private monitorVolume = 1
  private monitorCloseTimer?: number
  private frameAnalyzer = new VoiceFrameAnalyzer()

  constructor(
    onSpeakingChange: (speaking: boolean) => void,
    onLevel?: (info: VoiceActivationLevel) => void,
    onActivity?: () => void,
    manualThresholdDb?: number,
  ) {
    this.onSpeakingChange = onSpeakingChange
    this.onLevel = onLevel
    this.onActivity = onActivity
    this.setManualThreshold(manualThresholdDb)
  }

  async start(deviceId?: string) {
    const supported = navigator.mediaDevices.getSupportedConstraints()
    const constraints: MediaTrackConstraints & Record<string, unknown> = {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      channelCount: 1,
    }
    // Chromium supports this outside some TypeScript DOM definitions.
    if ((supported as Record<string, boolean | undefined>).voiceIsolation)
      constraints.voiceIsolation = true
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: constraints,
    })
    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(this.stream)
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = VOICE_DETECTION_FFT_SIZE
    this.analyser.smoothingTimeConstant = 0
    this.source.connect(this.analyser)
    this.bins = new Float32Array(this.analyser.frequencyBinCount)
    this.waveform = new Float32Array(this.analyser.fftSize)
    this.noiseFloor = -65
    this.speechLevel = -45
    this.calibrationLevels = []
    this.speaking = false
    this.aboveThresholdSince = undefined
    this.frameAnalyzer.reset()
    this.startedAt = performance.now()
    this.loop()
  }

  private updateMonitorGate(preserveTail = false) {
    if (!this.monitorGain) return
    const target =
      (!this.monitorGated || this.speaking) && this.monitorVolume > 0 ? 0.7 * this.monitorVolume : 0
    if (this.monitorCloseTimer !== undefined) {
      window.clearTimeout(this.monitorCloseTimer)
      this.monitorCloseTimer = undefined
    }
    const apply = () => {
      if (!this.monitorGain) return
      const now = this.monitorGain.context.currentTime
      this.monitorGain.gain.cancelScheduledValues(now)
      this.monitorGain.gain.setValueAtTime(this.monitorGain.gain.value, now)
      this.monitorGain.gain.linearRampToValueAtTime(target, now + (target ? 0.008 : 0.025))
    }
    if (!target && preserveTail && this.monitorDelayMs > 0) {
      this.monitorCloseTimer = window.setTimeout(() => {
        this.monitorCloseTimer = undefined
        apply()
      }, this.monitorDelayMs)
    } else {
      apply()
    }
  }

  private loop = () => {
    if (!this.analyser || !this.context || !this.bins || !this.waveform) return
    this.analyser.getFloatFrequencyData(this.bins)
    this.analyser.getFloatTimeDomainData(this.waveform)
    const analysis = this.frameAnalyzer.analyze(
      this.bins,
      this.waveform,
      this.context.sampleRate,
      this.analyser.fftSize,
      this.speaking,
    )
    const level = analysis.level
    const now = performance.now()
    const calibrating = now - this.startedAt < CALIBRATION_MS

    const speechShaped = analysis.voiceLike

    if (
      calibrating &&
      level <= this.noiseFloor + MIN_MARGIN_DB &&
      Number.isFinite(level) &&
      level > -100
    ) {
      this.calibrationLevels.push(level)
      if (this.calibrationLevels.length >= 6) {
        const sorted = [...this.calibrationLevels].sort((left, right) => left - right)
        this.noiseFloor = sorted[Math.floor((sorted.length - 1) * 0.35)]
      }
      this.speechLevel = Math.max(this.speechLevel, this.noiseFloor + 18)
    }

    const automaticThreshold = Math.max(
      this.noiseFloor + MIN_MARGIN_DB,
      this.noiseFloor + (this.speechLevel - this.noiseFloor) * AUTOMATIC_THRESHOLD_POSITION,
    )
    const threshold = this.manualThresholdDb ?? automaticThreshold
    const activeThreshold = this.speaking ? threshold - CLOSE_HYSTERESIS_DB : threshold
    const aboveThreshold = level > activeThreshold
    if (aboveThreshold) this.aboveThresholdSince ??= now
    else this.aboveThresholdSince = undefined
    const decision = voiceActivityDecision(
      this.aboveThresholdSince === undefined ? undefined : now - this.aboveThresholdSince,
      speechShaped,
      this.speaking,
    )
    const candidate = now - this.startedAt >= WARMUP_MS && decision.candidate

    if (candidate) {
      this.onActivity?.()
      this.speechLevel += (level - this.speechLevel) * SPEECH_ADAPT
    } else {
      // Never learn an above-threshold sound as the noise floor. A voice that
      // the shape classifier misses would otherwise push its own threshold up.
      if (!aboveThreshold && !this.speaking && !calibrating) {
        const adapt = level < this.noiseFloor ? FLOOR_ADAPT_DOWN : FLOOR_ADAPT_UP
        this.noiseFloor += (level - this.noiseFloor) * adapt
      }
    }

    const active = candidate && decision.active
    if (active && !this.speaking) {
      if (this.releaseTimer !== undefined) {
        window.clearTimeout(this.releaseTimer)
        this.releaseTimer = undefined
      }
      this.speaking = true
      this.updateMonitorGate()
      this.onSpeakingChange(true)
    } else if (!active && this.speaking && this.releaseTimer === undefined) {
      this.releaseTimer = window.setTimeout(() => {
        this.releaseTimer = undefined
        this.speaking = false
        this.updateMonitorGate(true)
        this.onSpeakingChange(false)
      }, RELEASE_MS)
    } else if (active && this.releaseTimer !== undefined) {
      window.clearTimeout(this.releaseTimer)
      this.releaseTimer = undefined
    }
    this.onLevel?.({
      level,
      threshold,
      speaking: this.speaking,
      voiceLike: decision.voiceLike,
      aboveThreshold,
      candidate,
    })
    this.timer = window.setTimeout(this.loop, POLL_MS)
  }

  get isSpeaking() {
    return this.speaking
  }

  setManualThreshold(thresholdDb?: number) {
    this.manualThresholdDb =
      thresholdDb === undefined ? undefined : Math.max(-90, Math.min(-10, thresholdDb))
  }

  setMonitoringVolume(volumePercent: number) {
    this.monitorVolume = Math.max(0, Math.min(2, volumePercent / 100))
    this.updateMonitorGate()
  }

  async startMonitoring(options: VoiceActivationMonitorOptions = {}) {
    if (!this.context || !this.source) throw new Error('The microphone is not ready yet')
    this.stopMonitoring()
    this.monitorGated = options.gated === true
    this.monitorDelayMs = Math.max(0, Math.min(1000, options.delayMs ?? 0))
    this.monitorDelay = this.context.createDelay(1)
    this.monitorGain = this.context.createGain()
    this.monitorDelay.delayTime.value = this.monitorDelayMs / 1000
    this.monitorGain.gain.value = !this.monitorGated || this.speaking ? 0.7 * this.monitorVolume : 0
    this.source
      .connect(this.monitorDelay)
      .connect(this.monitorGain)
      .connect(this.context.destination)
    await this.context.resume()
  }

  stopMonitoring() {
    if (this.monitorCloseTimer !== undefined) {
      window.clearTimeout(this.monitorCloseTimer)
      this.monitorCloseTimer = undefined
    }
    if (this.source && this.monitorDelay) {
      try {
        this.source.disconnect(this.monitorDelay)
      } catch {
        // The context can already be closing during component cleanup.
      }
    }
    this.monitorDelay?.disconnect()
    this.monitorGain?.disconnect()
    this.monitorDelay = undefined
    this.monitorGain = undefined
    this.monitorGated = false
    this.monitorDelayMs = 0
  }

  stop() {
    this.stopMonitoring()
    if (this.timer !== undefined) window.clearTimeout(this.timer)
    if (this.releaseTimer !== undefined) window.clearTimeout(this.releaseTimer)
    this.timer = undefined
    this.releaseTimer = undefined
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.source?.disconnect()
    void this.context?.close().catch(() => undefined)
    this.stream = undefined
    this.context = undefined
    this.source = undefined
    this.analyser = undefined
    this.bins = undefined
    this.waveform = undefined
    this.calibrationLevels = []
    this.frameAnalyzer.reset()
  }
}
