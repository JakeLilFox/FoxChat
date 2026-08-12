// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeTrack {
  constructor(public readyState: MediaStreamTrackState = 'live') {}
}

class FakeStream {
  constructor(
    readonly id: string,
    private tracks: FakeTrack[],
  ) {}

  getAudioTracks() {
    return [...this.tracks]
  }

  replaceTrack(track: FakeTrack) {
    this.tracks = [track]
  }
}

class FakeNode {
  disconnected = false

  connect<T>(target: T) {
    return target
  }

  disconnect() {
    this.disconnected = true
  }
}

class FakeAnalyser extends FakeNode {
  fftSize = 0
  smoothingTimeConstant = 0

  getFloatTimeDomainData(values: Float32Array) {
    values.fill(0)
  }
}

class FakeGain extends FakeNode {
  gain = { value: 1 }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  destination = new FakeNode()
  sources: FakeNode[] = []
  gains: FakeGain[] = []

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  createMediaStreamSource() {
    const source = new FakeNode()
    this.sources.push(source)
    return source
  }

  createAnalyser() {
    return new FakeAnalyser()
  }

  createGain() {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }

  resume() {
    return Promise.resolve()
  }
}

const audio = (stream: FakeStream) => {
  const element = document.createElement('audio')
  Object.defineProperty(element, 'srcObject', { configurable: true, writable: true, value: stream })
  document.body.append(element)
  return element
}

describe('Element Call audio mixer lifecycle', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('AudioContext', FakeAudioContext)
    FakeAudioContext.instances = []
  })

  afterEach(async () => {
    const mixer = await import('../../src/components/calls/ElementCallAudioMixer')
    mixer.reset()
    document.body.replaceChildren()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('rewires an element when LiveKit replaces its stream', async () => {
    const mixer = await import('../../src/components/calls/ElementCallAudioMixer')
    const first = new FakeStream('first', [new FakeTrack()])
    const second = new FakeStream('second', [new FakeTrack()])
    const element = audio(first)
    const match = { element, userId: '@alice:example.org', source: 'microphone' as const }

    mixer.reconcile([match])
    const originalSource = FakeAudioContext.instances[0].sources[0]
    element.srcObject = second as unknown as MediaStream
    mixer.reconcile([match])

    expect(originalSource.disconnected).toBe(true)
    expect(FakeAudioContext.instances[0].sources).toHaveLength(2)
    expect(mixer.hasChannel('@alice:example.org', 'microphone')).toBe(true)
  })

  it('rewires the surviving element after a temporary duplicate is removed', async () => {
    const mixer = await import('../../src/components/calls/ElementCallAudioMixer')
    const oldElement = audio(new FakeStream('old', [new FakeTrack()]))
    const newElement = audio(new FakeStream('new', [new FakeTrack()]))
    const identity = { userId: '@alice:example.org', source: 'microphone' as const }

    mixer.reconcile([{ element: oldElement, ...identity }])
    const preRejoinSource = FakeAudioContext.instances[0].sources[0]
    mixer.reconcile([
      { element: oldElement, ...identity },
      { element: newElement, ...identity },
    ])
    const rejoinSource = FakeAudioContext.instances[0].sources.at(-1)!

    expect(preRejoinSource.disconnected).toBe(true)
    expect(FakeAudioContext.instances[0].sources.filter((source) => !source.disconnected)).toEqual([
      rejoinSource,
    ])
    expect(oldElement.dataset.foxchatMixerActive).toBeUndefined()
    expect(newElement.dataset.foxchatMixerActive).toBe('true')

    newElement.remove()
    mixer.reconcile([{ element: oldElement, ...identity }])

    expect(rejoinSource.disconnected).toBe(true)
    expect(newElement.dataset.foxchatMixerActive).toBeUndefined()
    expect(oldElement.dataset.foxchatMixerActive).toBe('true')
    expect(FakeAudioContext.instances[0].sources).toHaveLength(3)
    expect(
      FakeAudioContext.instances[0].sources.filter((source) => !source.disconnected),
    ).toHaveLength(1)
    expect(mixer.hasChannel('@alice:example.org', 'microphone')).toBe(true)
  })

  it('disconnects departed participants and keeps stale iframe audio quarantined', async () => {
    const mixer = await import('../../src/components/calls/ElementCallAudioMixer')
    const element = audio(new FakeStream('departed', [new FakeTrack()]))

    mixer.reconcile([{ element, userId: '@alice:example.org', source: 'microphone' as const }])
    const departedSource = FakeAudioContext.instances[0].sources[0]
    mixer.reconcile([])

    expect(departedSource.disconnected).toBe(true)
    expect(mixer.hasChannel('@alice:example.org', 'microphone')).toBe(false)
    expect(element.muted).toBe(true)
    expect(mixer.isManaged(element)).toBe(true)
  })

  it('rebuilds a source when the audio track changes inside the same stream', async () => {
    const mixer = await import('../../src/components/calls/ElementCallAudioMixer')
    const stream = new FakeStream('stable-stream', [new FakeTrack()])
    const element = audio(stream)
    const match = { element, userId: '@alice:example.org', source: 'microphone' as const }

    mixer.reconcile([match])
    const originalSource = FakeAudioContext.instances[0].sources[0]
    stream.replaceTrack(new FakeTrack())
    mixer.reconcile([match])

    expect(originalSource.disconnected).toBe(true)
    expect(FakeAudioContext.instances[0].sources).toHaveLength(2)
  })

  it('resets mute state and releases managed elements between calls', async () => {
    const mixer = await import('../../src/components/calls/ElementCallAudioMixer')
    const element = audio(new FakeStream('first-call', [new FakeTrack()]))

    mixer.reconcile([{ element, userId: '@alice:example.org', source: 'microphone' as const }])
    mixer.setMasterMuted(true)
    mixer.reset()

    expect(element.muted).toBe(false)
    expect(element.dataset.foxchatMixerActive).toBeUndefined()
    expect(mixer.isManaged(element)).toBe(false)
    expect(mixer.hasChannel('@alice:example.org', 'microphone')).toBe(false)
  })

  it('applies and restores participant volume on the active GainNode', async () => {
    const mixer = await import('../../src/components/calls/ElementCallAudioMixer')
    const element = audio(new FakeStream('volume', [new FakeTrack()]))

    mixer.reconcile([{ element, userId: '@alice:example.org', source: 'microphone' as const }])
    const gain = FakeAudioContext.instances[0].gains[0]

    mixer.setUserVolume('@alice:example.org', 'microphone', 25)
    expect(gain.gain.value).toBe(0.25)
    expect(element.dataset.foxchatMixerGain).toBe('0.25')

    mixer.setMasterMuted(true)
    expect(gain.gain.value).toBe(0)
    expect(element.dataset.foxchatMixerGain).toBe('0')

    mixer.setMasterMuted(false)
    expect(gain.gain.value).toBe(0.25)
    expect(element.dataset.foxchatMixerGain).toBe('0.25')
  })

  it('matches multiple remote streams from LiveKit participant identity metadata', async () => {
    const mixer = await import('../../src/components/calls/ElementCallAudioMixer')
    const aliceTile = document.createElement('div')
    const bobTile = document.createElement('div')
    aliceTile.dataset.lkParticipantIdentity = '@alice:example.org'
    bobTile.dataset.participantIdentity = '@bob:example.org'
    const aliceAudio = audio(new FakeStream('alice', [new FakeTrack()]))
    const bobAudio = audio(new FakeStream('bob', [new FakeTrack()]))
    aliceTile.append(aliceAudio)
    bobTile.append(bobAudio)
    document.body.append(aliceTile, bobTile)
    const members = [
      { userId: '@alice:example.org', name: 'Alice' },
      { userId: '@bob:example.org', name: 'Bob' },
    ]

    const matches = mixer.scanAudioElements(document, members as never, '@self:example.org')

    expect(matches.map(({ element, userId }) => ({ element, userId }))).toEqual([
      { element: aliceAudio, userId: '@alice:example.org' },
      { element: bobAudio, userId: '@bob:example.org' },
    ])
  })

  it('keeps explicit Element Call owners stable if metadata briefly disappears', async () => {
    const mixer = await import('../../src/components/calls/ElementCallAudioMixer')
    const aliceAudio = audio(new FakeStream('alice', [new FakeTrack()]))
    const bobAudio = audio(new FakeStream('bob', [new FakeTrack()]))
    const carolAudio = audio(new FakeStream('carol', [new FakeTrack()]))
    aliceAudio.dataset.foxchatParticipantIdentity = '@alice:example.org:ALICE_DEVICE'
    bobAudio.dataset.foxchatParticipantIdentity = '@bob:example.org:BOB_DEVICE'
    carolAudio.dataset.foxchatParticipantIdentity = '@carol:example.org:CAROL_DEVICE'
    const members = [
      { userId: '@alice:example.org', name: 'Alice' },
      { userId: '@bob:example.org', name: 'Bob' },
      { userId: '@carol:example.org', name: 'Carol' },
    ]

    const initial = mixer.scanAudioElements(document, members as never, '@self:example.org')

    expect(initial.map(({ element, userId }) => ({ element, userId }))).toEqual([
      { element: aliceAudio, userId: '@alice:example.org' },
      { element: bobAudio, userId: '@bob:example.org' },
      { element: carolAudio, userId: '@carol:example.org' },
    ])

    delete aliceAudio.dataset.foxchatParticipantIdentity
    delete bobAudio.dataset.foxchatParticipantIdentity
    delete carolAudio.dataset.foxchatParticipantIdentity
    bobAudio.remove()
    const afterDeparture = mixer.scanAudioElements(
      document,
      [members[0], members[2]] as never,
      '@self:example.org',
    )
    expect(afterDeparture.map(({ element, userId }) => ({ element, userId }))).toEqual([
      { element: aliceAudio, userId: '@alice:example.org' },
      { element: carolAudio, userId: '@carol:example.org' },
    ])
  })
})
