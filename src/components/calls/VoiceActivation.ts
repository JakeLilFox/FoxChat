const SPEECH_BAND_LOW_HZ = 180
const SPEECH_BAND_HIGH_HZ = 3600
const VOICED_BAND_HIGH_HZ = 1400
const HIGH_BAND_LOW_HZ = 4000
const HIGH_BAND_HIGH_HZ = 8000
const CALIBRATION_MS = 1200
const WARMUP_MS = 80
const ATTACK_MS = 110
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
  private candidateSince?: number
  private onSpeakingChange: (speaking: boolean) => void
  private onLevel?: (info: VoiceActivationLevel) => void
  private onActivity?: () => void
  private manualThresholdDb?: number
  private monitorDelay?: DelayNode
  private monitorGain?: GainNode
  private monitorGated = false
  private monitorDelayMs = 0
  private monitorCloseTimer?: number

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
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.2
    this.source.connect(this.analyser)
    this.bins = new Float32Array(this.analyser.frequencyBinCount)
    this.waveform = new Float32Array(this.analyser.fftSize)
    this.noiseFloor = -65
    this.speechLevel = -45
    this.calibrationLevels = []
    this.speaking = false
    this.candidateSince = undefined
    this.startedAt = performance.now()
    this.loop()
  }

  private bandStats(data: Float32Array<ArrayBuffer>, lowHz: number, highHz: number) {
    if (!this.analyser || !this.context)
      return { level: -100, flatness: 1, centroid: highHz, spread: 0 }
    const binHz = this.context.sampleRate / this.analyser.fftSize
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

  private periodicity(data: Float32Array<ArrayBuffer>) {
    if (!this.context || data.length < 2) return 0
    let mean = 0
    for (const sample of data) mean += sample
    mean /= data.length

    const minLag = Math.max(1, Math.floor(this.context.sampleRate / 420))
    const maxLag = Math.min(data.length - 16, Math.ceil(this.context.sampleRate / 85))
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

  private updateMonitorGate(preserveTail = false) {
    if (!this.monitorGain) return
    const target = !this.monitorGated || this.speaking ? 0.7 : 0
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
    const speech = this.bandStats(this.bins, SPEECH_BAND_LOW_HZ, SPEECH_BAND_HIGH_HZ)
    const voiced = this.bandStats(this.bins, SPEECH_BAND_LOW_HZ, VOICED_BAND_HIGH_HZ)
    const high = this.bandStats(this.bins, HIGH_BAND_LOW_HZ, HIGH_BAND_HIGH_HZ)
    const periodicity = this.periodicity(this.waveform)
    const level = speech.level
    const now = performance.now()
    const calibrating = now - this.startedAt < CALIBRATION_MS

    const openingShape =
      periodicity >= 0.2 &&
      voiced.level >= speech.level - 3.5 &&
      speech.level >= high.level + 5 &&
      speech.flatness <= 0.42 &&
      speech.centroid <= 1900 &&
      speech.spread >= 380
    const continuationShape =
      periodicity >= 0.11 &&
      voiced.level >= speech.level - 5.5 &&
      speech.level >= high.level + 2 &&
      speech.flatness <= 0.62 &&
      speech.centroid <= 2700 &&
      speech.spread >= 260
    const speechShaped = this.speaking ? continuationShape : openingShape

    if (calibrating && !openingShape && Number.isFinite(level) && level > -100) {
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
    const candidate = now - this.startedAt >= WARMUP_MS && level > activeThreshold && speechShaped

    if (candidate) {
      this.onActivity?.()
      this.candidateSince ??= now
      this.speechLevel += (level - this.speechLevel) * SPEECH_ADAPT
    } else {
      this.candidateSince = undefined
      if (!this.speaking && !calibrating) {
        const adapt = level < this.noiseFloor ? FLOOR_ADAPT_DOWN : FLOOR_ADAPT_UP
        this.noiseFloor += (level - this.noiseFloor) * adapt
      }
    }

    const active = candidate && (this.speaking || now - (this.candidateSince ?? now) >= ATTACK_MS)
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
      voiceLike: speechShaped,
      aboveThreshold: level > activeThreshold,
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

  async startMonitoring(options: VoiceActivationMonitorOptions = {}) {
    if (!this.context || !this.source) throw new Error('The microphone is not ready yet')
    this.stopMonitoring()
    this.monitorGated = options.gated === true
    this.monitorDelayMs = Math.max(0, Math.min(1000, options.delayMs ?? 0))
    this.monitorDelay = this.context.createDelay(1)
    this.monitorGain = this.context.createGain()
    this.monitorDelay.delayTime.value = this.monitorDelayMs / 1000
    this.monitorGain.gain.value = !this.monitorGated || this.speaking ? 0.7 : 0
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
  }
}
