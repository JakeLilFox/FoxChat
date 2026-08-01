// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MICROPHONE_VOLUME_KEY,
  clampMicrophoneVolumePercent,
  microphoneVolumePercent,
} from '../../src/lib/constants'
import { createMicrophoneGate } from '../../src/components/calls/ElementCallWidget'

const originalUserAgent = window.navigator.userAgent

class FakeTrack extends EventTarget {
  enabled = true
}

class FakeMediaStream {
  constructor(private tracks: FakeTrack[] = []) {}

  getTracks() {
    return [...this.tracks]
  }

  getAudioTracks() {
    return [...this.tracks]
  }

  getVideoTracks() {
    return []
  }

  addTrack(track: FakeTrack) {
    this.tracks.push(track)
  }

  removeTrack(track: FakeTrack) {
    this.tracks = this.tracks.filter((candidate) => candidate !== track)
  }
}

class FakeAudioParam {
  value = 0
  rampTargets: number[] = []

  cancelScheduledValues() {}

  setValueAtTime(value: number) {
    this.value = value
  }

  linearRampToValueAtTime(value: number) {
    this.value = value
    this.rampTargets.push(value)
  }
}

class FakeAudioNode {
  connect<T>(target: T) {
    return target
  }
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam()

  constructor(readonly context: FakeAudioContext) {
    super()
  }
}

class FakeDelayNode extends FakeAudioNode {
  delayTime = new FakeAudioParam()

  constructor(readonly context: FakeAudioContext) {
    super()
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  currentTime = 0
  gains: FakeGainNode[] = []

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  createMediaStreamSource() {
    return new FakeAudioNode()
  }

  createDelay() {
    return new FakeDelayNode(this)
  }

  createGain() {
    const gain = new FakeGainNode(this)
    this.gains.push(gain)
    return gain
  }

  createMediaStreamDestination() {
    return Object.assign(new FakeAudioNode(), {
      stream: new FakeMediaStream([new FakeTrack()]),
    })
  }

  close() {
    return Promise.resolve()
  }
}

afterEach(() => {
  localStorage.clear()
  FakeAudioContext.instances = []
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: originalUserAgent,
  })
})

describe('microphone volume preference', () => {
  it('defaults to 100% and clamps persisted values to 0-200%', () => {
    expect(microphoneVolumePercent()).toBe(100)
    expect(clampMicrophoneVolumePercent(-20)).toBe(0)
    expect(clampMicrophoneVolumePercent(250)).toBe(200)

    localStorage.setItem(MICROPHONE_VOLUME_KEY, '175')
    expect(microphoneVolumePercent()).toBe(175)
  })

  it('applies gain to the audio track returned to the Matrix call iframe', async () => {
    localStorage.setItem(MICROPHONE_VOLUME_KEY, '150')
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Linux',
    })
    vi.stubGlobal('MediaStream', FakeMediaStream)
    const sourceTrack = new FakeTrack()
    const sourceStream = new FakeMediaStream([sourceTrack])
    const mediaDevices = {
      getSupportedConstraints: () => ({}),
      getUserMedia: vi.fn(async (_constraints?: MediaStreamConstraints) => sourceStream),
    }
    const iframeWindow = {
      navigator: { mediaDevices },
      AudioContext: FakeAudioContext,
    }
    const iframe = {
      contentWindow: iframeWindow,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    const gate = createMicrophoneGate(iframe as unknown as HTMLIFrameElement)
    const publishedStream = await mediaDevices.getUserMedia({ audio: true })
    const gain = FakeAudioContext.instances[0].gains[0].gain

    expect(publishedStream.getAudioTracks()).toHaveLength(1)
    expect(publishedStream.getAudioTracks()[0]).not.toBe(sourceTrack)
    expect(gain.value).toBe(1.5)

    gate.setVolume(200)
    expect(gain.rampTargets.at(-1)).toBe(2)
    gate.setEnabled(false)
    expect(gain.rampTargets.at(-1)).toBe(0)
    gate.setEnabled(true)
    expect(gain.rampTargets.at(-1)).toBe(2)

    gate.disconnect()
  })
})
