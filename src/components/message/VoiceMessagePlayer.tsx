import { VoicePlayer, VoiceWaveform } from '../../styles'
import { useEffect, useRef, useState } from 'react'
import { PauseCircleFilled, PlayCircleFilled } from '@ant-design/icons'

let sharedAudioContext: AudioContext | undefined
const getAudioContext = () => {
  if (!sharedAudioContext) sharedAudioContext = new AudioContext()
  return sharedAudioContext
}

export function VoiceMessagePlayer({
  src,
  duration,
  waveform,
}: {
  src: string
  duration: number
  waveform: number[]
}) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [loadError, setLoadError] = useState(false)
  const bufferRef = useRef<AudioBuffer | undefined>(undefined)
  const loadingRef = useRef<Promise<AudioBuffer> | undefined>(undefined)
  const sourceRef = useRef<AudioBufferSourceNode | undefined>(undefined)
  const offsetRef = useRef(0)
  const startedAtRef = useRef(0)
  const progressTimerRef = useRef<number | undefined>(undefined)

  const totalSeconds = () => bufferRef.current?.duration ?? duration / 1000

  const loadBuffer = async () => {
    if (bufferRef.current) return bufferRef.current
    loadingRef.current ??= fetch(src)
      .then((response) => response.arrayBuffer())
      .then((data) => getAudioContext().decodeAudioData(data))
    const buffer = await loadingRef.current
    bufferRef.current = buffer
    return buffer
  }

  const stopSource = () => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop()
      } catch {
        /* The source may already be stopped. */
      }
      sourceRef.current = undefined
    }
    if (progressTimerRef.current !== undefined) {
      window.clearTimeout(progressTimerRef.current)
      progressTimerRef.current = undefined
    }
  }

  const tick = () => {
    const buffer = bufferRef.current
    if (!buffer) return
    const elapsed = getAudioContext().currentTime - startedAtRef.current + offsetRef.current
    if (elapsed >= buffer.duration) {
      setProgress(1)
      setPlaying(false)
      offsetRef.current = 0
      stopSource()
      return
    }
    setProgress(elapsed / buffer.duration)
    progressTimerRef.current = window.setTimeout(tick, 100)
  }

  const playFrom = async (offsetSeconds: number) => {
    try {
      const buffer = await loadBuffer()
      stopSource()
      const context = getAudioContext()
      if (context.state === 'suspended') await context.resume()
      const clamped = Math.min(Math.max(0, offsetSeconds), buffer.duration)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      offsetRef.current = clamped
      startedAtRef.current = context.currentTime
      source.start(0, clamped)
      sourceRef.current = source
      setPlaying(true)
      progressTimerRef.current = window.setTimeout(tick, 100)
    } catch {
      setLoadError(true)
    }
  }

  const pause = () => {
    offsetRef.current = Math.min(
      totalSeconds(),
      getAudioContext().currentTime - startedAtRef.current + offsetRef.current,
    )
    stopSource()
    setPlaying(false)
  }

  useEffect(() => stopSource, [])

  const toggle = () => {
    if (playing) pause()
    else void playFrom(offsetRef.current)
  }

  const seek = (ratio: number) => {
    const clamped = Math.min(1, Math.max(0, ratio))
    setProgress(clamped)
    const target = clamped * totalSeconds()
    if (playing) void playFrom(target)
    else offsetRef.current = target
  }

  const nudge = (deltaRatio: number) => {
    const clamped = Math.min(1, Math.max(0, progress + deltaRatio))
    setProgress(clamped)
    offsetRef.current = clamped * totalSeconds()
    if (playing) void playFrom(offsetRef.current)
  }

  const seconds = Math.round(duration / 1000)
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const bars = waveform.length ? waveform : new Array(30).fill(200)
  const peak = Math.max(1, ...bars)

  return (
    <VoicePlayer>
      <button
        type="button"
        onClick={toggle}
        disabled={loadError}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {playing ? <PauseCircleFilled /> : <PlayCircleFilled />}
      </button>
      <VoiceWaveform
        role="slider"
        tabIndex={0}
        aria-label="Seek voice message"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        onClick={(event) => {
          if (loadError) return
          const rect = event.currentTarget.getBoundingClientRect()
          seek((event.clientX - rect.left) / rect.width)
        }}
        onKeyDown={(event) => {
          if (loadError) return
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            nudge(-5 / Math.max(1, totalSeconds()))
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            nudge(5 / Math.max(1, totalSeconds()))
          }
        }}
      >
        {bars.map((value, index) => (
          <span
            key={index}
            style={{
              height: `${Math.max(3, Math.round((value / peak) * 26))}px`,
              opacity: index / bars.length <= progress ? 1 : 0.45,
            }}
          />
        ))}
      </VoiceWaveform>
      <span className="time">{loadError ? 'Unplayable' : label}</span>
    </VoicePlayer>
  )
}
