import {
  MICROPHONE_DEVICE_KEY,
  PUSH_TO_TALK_SHORTCUT_CHANGED_EVENT,
  PUSH_TO_TALK_SHORTCUT_KEY,
  VOICE_ACTIVATION_CHANGED_EVENT,
  VOICE_ACTIVATION_KEY,
  VOICE_ACTIVATION_PREROLL_CHANGED_EVENT,
  VOICE_ACTIVATION_PREROLL_KEY,
  VOICE_ACTIVATION_THRESHOLD_CHANGED_EVENT,
  VOICE_ACTIVATION_THRESHOLD_KEY,
  VOICE_ACTIVATION_THRESHOLD_MODE_KEY,
  VOICE_INPUT_MODE_CHANGED_EVENT,
  VOICE_INPUT_MODE_KEY,
  preferredMicrophoneId,
  pushToTalkShortcut,
  voiceActivationPrerollMs,
  voiceActivationThresholdDb,
  voiceActivationThresholdMode,
  voiceInputMode,
  type VoiceActivationThresholdMode,
  type VoiceInputMode,
} from '../../lib/constants'
import { applyPreferredMicrophoneToActiveCalls } from './ElementCallWidget'
import { VoiceActivation, type VoiceActivationLevel } from './VoiceActivation'
import { PUSH_TO_TALK_SHORTCUTS, desktopPushToTalkAvailable } from '../../platform/pushToTalk'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, List as AntList, Radio, Select, Slider, Tag } from 'antd'
import { AudioOutlined, SoundOutlined, StopOutlined } from '@ant-design/icons'

const METER_MIN_DB = -90
const METER_MAX_DB = -10

const meterPercent = (value?: number) =>
  value === undefined
    ? 0
    : Math.max(0, Math.min(100, ((value - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)) * 100))

export function MicrophoneSetting() {
  const pushToTalkAvailable = desktopPushToTalkAvailable()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState(preferredMicrophoneId)
  const [needsPermission, setNeedsPermission] = useState(false)
  const [inputMode, setInputMode] = useState<VoiceInputMode>(() => {
    const stored = voiceInputMode()
    return stored === 'push_to_talk' && !pushToTalkAvailable ? 'open' : stored
  })
  const [thresholdMode, setThresholdMode] = useState<VoiceActivationThresholdMode>(
    voiceActivationThresholdMode,
  )
  const [thresholdDb, setThresholdDb] = useState(voiceActivationThresholdDb)
  const [prerollMs, setPrerollMs] = useState(voiceActivationPrerollMs)
  const [shortcut, setShortcut] = useState(pushToTalkShortcut)
  const [preview, setPreview] = useState<VoiceActivationLevel>()
  const [testing, setTesting] = useState(false)
  const [monitorReady, setMonitorReady] = useState(false)
  const [microphoneError, setMicrophoneError] = useState('')
  const engineRef = useRef<VoiceActivation | undefined>(undefined)
  const thresholdModeRef = useRef(thresholdMode)
  const thresholdDbRef = useRef(thresholdDb)
  thresholdModeRef.current = thresholdMode
  thresholdDbRef.current = thresholdDb

  const refresh = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices()
    const inputs = all.filter((device) => device.kind === 'audioinput')
    setDevices(inputs)
    setNeedsPermission(inputs.length > 0 && inputs.every((device) => !device.label))
  }, [])

  useEffect(() => {
    void refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [refresh])

  const shouldPreview = inputMode === 'voice_activation' || testing
  useEffect(() => {
    if (!shouldPreview || needsPermission) {
      setPreview(undefined)
      setMonitorReady(false)
      return
    }

    const engine = new VoiceActivation(
      () => undefined,
      setPreview,
      undefined,
      thresholdModeRef.current === 'manual' ? thresholdDbRef.current : undefined,
    )
    engineRef.current = engine
    setMicrophoneError('')
    void engine
      .start(deviceId)
      .then(() => {
        if (engineRef.current !== engine) return
        setMonitorReady(true)
      })
      .catch((error) => {
        if (engineRef.current !== engine) return
        setMonitorReady(false)
        setTesting(false)
        setMicrophoneError(
          error instanceof Error ? error.message : 'Could not start the microphone',
        )
      })
    return () => {
      if (engineRef.current === engine) engineRef.current = undefined
      engine.stop()
    }
  }, [shouldPreview, needsPermission, deviceId])

  useEffect(() => {
    engineRef.current?.setManualThreshold(thresholdMode === 'manual' ? thresholdDb : undefined)
  }, [thresholdMode, thresholdDb])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !monitorReady) return
    if (!testing) {
      engine.stopMonitoring()
      return
    }
    void engine
      .startMonitoring({
        gated: inputMode === 'voice_activation',
        delayMs: inputMode === 'voice_activation' ? prerollMs : 0,
      })
      .catch((error) => {
        setTesting(false)
        setMicrophoneError(
          error instanceof Error ? error.message : 'Could not play the microphone monitor',
        )
      })
  }, [testing, monitorReady, inputMode, prerollMs])

  const grantAccess = async () => {
    setMicrophoneError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const track of stream.getTracks()) track.stop()
      await refresh()
    } catch (error) {
      setMicrophoneError(
        error instanceof Error ? error.message : 'Microphone permission was not granted',
      )
    }
  }

  const changeDevice = (value: string) => {
    setDeviceId(value)
    if (value) localStorage.setItem(MICROPHONE_DEVICE_KEY, value)
    else localStorage.removeItem(MICROPHONE_DEVICE_KEY)
    applyPreferredMicrophoneToActiveCalls()
  }

  const changeInputMode = (value: VoiceInputMode) => {
    if (value === 'push_to_talk' && !pushToTalkAvailable) return
    setInputMode(value)
    localStorage.setItem(VOICE_INPUT_MODE_KEY, value)
    const activationEnabled = value === 'voice_activation'
    localStorage.setItem(VOICE_ACTIVATION_KEY, String(activationEnabled))
    window.dispatchEvent(new CustomEvent(VOICE_INPUT_MODE_CHANGED_EVENT, { detail: value }))
    window.dispatchEvent(
      new CustomEvent(VOICE_ACTIVATION_CHANGED_EVENT, {
        detail: activationEnabled,
      }),
    )
  }

  const changeThresholdMode = (value: VoiceActivationThresholdMode) => {
    setThresholdMode(value)
    localStorage.setItem(VOICE_ACTIVATION_THRESHOLD_MODE_KEY, value)
    window.dispatchEvent(
      new CustomEvent(VOICE_ACTIVATION_THRESHOLD_CHANGED_EVENT, {
        detail: {
          mode: value,
          thresholdDb,
        },
      }),
    )
  }

  const changeThreshold = (value: number) => {
    setThresholdDb(value)
    localStorage.setItem(VOICE_ACTIVATION_THRESHOLD_KEY, String(value))
    window.dispatchEvent(
      new CustomEvent(VOICE_ACTIVATION_THRESHOLD_CHANGED_EVENT, {
        detail: {
          mode: thresholdMode,
          thresholdDb: value,
        },
      }),
    )
  }

  const changePreroll = (value: number) => {
    setPrerollMs(value)
    localStorage.setItem(VOICE_ACTIVATION_PREROLL_KEY, String(value))
    window.dispatchEvent(
      new CustomEvent(VOICE_ACTIVATION_PREROLL_CHANGED_EVENT, {
        detail: value,
      }),
    )
  }

  const changeShortcut = (value: string) => {
    setShortcut(value)
    localStorage.setItem(PUSH_TO_TALK_SHORTCUT_KEY, value)
    window.dispatchEvent(new CustomEvent(PUSH_TO_TALK_SHORTCUT_CHANGED_EVENT, { detail: value }))
  }

  const displayedThreshold =
    thresholdMode === 'manual' ? thresholdDb : (preview?.threshold ?? thresholdDb)
  const levelPosition = meterPercent(preview?.level)
  const thresholdPosition = meterPercent(displayedThreshold)
  const rejectedNonVoice = !!preview?.aboveThreshold && !preview.voiceLike && !preview.speaking
  const voiceStarting = !!preview?.candidate && !preview.speaking
  const releaseHold = !!preview?.speaking && !preview.candidate

  return (
    <>
      <AntList.Item
        extra={
          needsPermission ? (
            <Button icon={<AudioOutlined />} onClick={() => void grantAccess()}>
              Grant microphone access
            </Button>
          ) : (
            <Select
              style={{ minWidth: 240 }}
              value={deviceId ?? ''}
              onChange={changeDevice}
              options={[
                { value: '', label: 'System default' },
                ...devices.map((device) => ({
                  value: device.deviceId,
                  label: device.label || 'Microphone',
                })),
              ]}
            />
          )
        }
      >
        <AntList.Item.Meta
          title="Microphone"
          description="Choose which microphone to use for voice calls."
        />
      </AntList.Item>

      <AntList.Item>
        <div style={{ width: '100%', display: 'grid', gap: 14 }}>
          <AntList.Item.Meta
            title="Input mode"
            description="Choose when FoxChat sends audio from your microphone."
          />
          <Radio.Group
            value={inputMode}
            onChange={(event) => changeInputMode(event.target.value as VoiceInputMode)}
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'open', label: 'Continuous' },
              { value: 'voice_activation', label: 'Voice activation' },
              {
                value: 'push_to_talk',
                label: 'Push to talk',
                disabled: !pushToTalkAvailable,
              },
            ]}
          />
          {!pushToTalkAvailable && (
            <div style={{ fontSize: 12, opacity: 0.65 }}>
              Push to talk requires the FoxChat desktop app. It is unavailable in browsers and on
              mobile.
            </div>
          )}
          {inputMode === 'push_to_talk' && pushToTalkAvailable && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>Push-to-talk shortcut</div>
                <div style={{ fontSize: 12, opacity: 0.65 }}>
                  Hold this key while speaking. It works while FoxChat is in the background.
                </div>
              </div>
              <Select
                value={shortcut}
                onChange={changeShortcut}
                style={{ width: 160 }}
                options={PUSH_TO_TALK_SHORTCUTS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
              />
            </div>
          )}
        </div>
      </AntList.Item>

      {inputMode === 'voice_activation' && (
        <AntList.Item>
          <div style={{ width: '100%', display: 'grid', gap: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>Activation point</div>
                <div style={{ fontSize: 12, opacity: 0.65 }}>
                  Automatic follows your background noise. Manual lets you place the threshold
                  yourself.
                </div>
              </div>
              <Radio.Group
                size="small"
                value={thresholdMode}
                optionType="button"
                buttonStyle="solid"
                onChange={(event) =>
                  changeThresholdMode(event.target.value as VoiceActivationThresholdMode)
                }
                options={[
                  { value: 'automatic', label: 'Automatic' },
                  { value: 'manual', label: 'Manual' },
                ]}
              />
            </div>

            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 7,
                  fontSize: 12,
                }}
              >
                <span>
                  {preview?.speaking ? (
                    <Tag color={releaseHold ? 'processing' : 'success'}>
                      {releaseHold ? 'Release hold' : 'Voice detected'}
                    </Tag>
                  ) : voiceStarting ? (
                    <Tag color="processing">Voice starting</Tag>
                  ) : rejectedNonVoice ? (
                    <Tag color="warning">Non-voice sound rejected</Tag>
                  ) : (
                    <Tag>Listening for voice</Tag>
                  )}
                </span>
                <span style={{ opacity: 0.7 }}>Threshold {Math.round(displayedThreshold)} dB</span>
              </div>
              <div
                style={{
                  position: 'relative',
                  height: 14,
                  borderRadius: 7,
                  background: 'rgba(127,127,127,.2)',
                  overflow: 'hidden',
                }}
              >
                <div
                  data-testid="microphone-level"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${levelPosition}%`,
                    background: preview?.speaking
                      ? '#35c978'
                      : voiceStarting
                        ? '#36b7c9'
                        : rejectedNonVoice
                          ? '#d89546'
                          : '#3b9dff',
                    transition: 'width 80ms linear',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${thresholdPosition}%`,
                    width: 3,
                    transform: 'translateX(-1px)',
                    background: '#fff',
                    boxShadow: '0 0 0 1px rgba(0,0,0,.35)',
                  }}
                />
              </div>
              <Slider
                min={METER_MIN_DB}
                max={METER_MAX_DB}
                step={1}
                value={displayedThreshold}
                disabled={thresholdMode !== 'manual'}
                tooltip={{ formatter: (value) => `${value} dB` }}
                onChange={changeThreshold}
                marks={{
                  [METER_MIN_DB]: 'More sensitive',
                  [METER_MAX_DB]: 'Less sensitive',
                }}
                style={{ margin: '10px 8px 24px' }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>Speech pre-roll</div>
                <div style={{ fontSize: 12, opacity: 0.65 }}>
                  Retains the beginning and end of speech when the gate changes.
                </div>
              </div>
              <Select
                value={prerollMs}
                onChange={changePreroll}
                style={{ width: 120, flex: 'none' }}
                options={[100, 200, 300, 350, 500].map((value) => ({
                  value,
                  label: value === 350 ? '350 ms · Recommended' : `${value} ms`,
                }))}
              />
            </div>
          </div>
        </AntList.Item>
      )}

      <AntList.Item
        extra={
          <Button
            type={testing ? 'primary' : 'default'}
            danger={testing}
            icon={testing ? <StopOutlined /> : <SoundOutlined />}
            loading={testing && !monitorReady}
            disabled={needsPermission}
            onClick={() => {
              setMicrophoneError('')
              setTesting((current) => !current)
            }}
          >
            {testing ? 'Stop mic test' : 'Test microphone'}
          </Button>
        }
      >
        <AntList.Item.Meta
          title="Microphone test"
          description={
            microphoneError
              ? microphoneError
              : testing
                ? inputMode === 'voice_activation'
                  ? 'You are hearing the filtered, delayed signal after the activation gate. Use headphones to prevent feedback.'
                  : 'You are hearing the filtered outgoing microphone signal. Use headphones to prevent feedback.'
                : 'Hear the outgoing path after echo cancellation, noise suppression, and voice isolation where supported, without gain control amplifying background noise.'
          }
        />
      </AntList.Item>
    </>
  )
}
