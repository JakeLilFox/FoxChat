export type VoiceRecordingResult = {
  blob: Blob
  mimeType: string
  duration: number
  waveform: number[]
}

const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

const downsample = (samples: number[], target: number): number[] => {
  if (!samples.length) return new Array(target).fill(0)
  if (samples.length <= target) return samples
  const bucket = samples.length / target
  const result: number[] = []
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * bucket)
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket))
    const slice = samples.slice(start, end)
    result.push(Math.round(slice.reduce((sum, value) => sum + value, 0) / slice.length))
  }
  return result
}

export class VoiceRecorder {
  private recorder?: MediaRecorder
  private stream?: MediaStream
  private audioContext?: AudioContext
  private chunks: Blob[] = []
  private samples: number[] = []
  private sampleTimer?: number
  private startedAt = 0

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.chunks = []
    this.samples = []
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data)
    }
    this.audioContext = new AudioContext()
    const source = this.audioContext.createMediaStreamSource(this.stream)
    const analyser = this.audioContext.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    this.sampleTimer = window.setInterval(() => {
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (const value of data) peak = Math.max(peak, Math.abs(value - 128))
      this.samples.push(Math.min(1024, Math.round((peak / 128) * 1024)))
    }, 100)
    this.startedAt = Date.now()
    this.recorder.start()
  }

  private teardown() {
    window.clearInterval(this.sampleTimer)
    this.stream?.getTracks().forEach((track) => track.stop())
    void this.audioContext?.close().catch(() => undefined)
  }

  async stop(): Promise<VoiceRecordingResult> {
    const recorder = this.recorder
    if (!recorder) throw new Error('Recording was not started')
    const duration = Date.now() - this.startedAt
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () =>
        resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }))
      recorder.stop()
    })
    this.teardown()
    return {
      blob,
      mimeType: blob.type,
      duration,
      waveform: downsample(this.samples, 100),
    }
  }

  cancel() {
    this.recorder?.stop()
    this.teardown()
  }
}
