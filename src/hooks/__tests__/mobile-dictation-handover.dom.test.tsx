// @vitest-environment jsdom
/**
 * Mobile round 48: the end of a dictation hands over from "recording" to
 * "transcribing" without a moment with neither.
 *
 * Before: stopRecording cleared isRecording, then transcribeTake awaited the
 * length check of the WAV (mobile round 44) and only then set isTranscribing.
 * In that gap the chat showed the empty field with the microphone; the text of
 * the take landed a moment later and turned the same button into Send. A tap
 * meant for the microphone sent the dictation as a message (e2e r47 under
 * load, twice red: "Hello from dictation" sent, no toast of the refused
 * microphone).
 *
 * Run: npx vitest run src/hooks/__tests__/mobile-dictation-handover.dom.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { standOn } from '../../test-support/devices'

const voice = vi.hoisted(() => ({
  transcribeAudioCloud: vi.fn(),
  transcribeAudio: vi.fn(),
  createAudioRecorder: vi.fn(),
}))
vi.mock('../../api/voice', async (orig) => ({ ...((await orig()) as object), ...voice }))
vi.mock('../../lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('../../lib/cloud-content-gate', () => ({ cloudContentAllowed: async () => true, cloudContentConsented: () => true }))
vi.mock('../../stores/cloudAuthStore', async (orig) => ({ ...((await orig()) as object), deriveCloudAvailable: () => true }))

import { transcribeTake, useVoice } from '../useVoice'
import { useVoiceStore } from '../../stores/voiceStore'
import { discardFailedTake } from '../../lib/dictation-retry'

/** A 16 kHz mono 16 bit WAV of `ms` milliseconds, with a real header (the length check reads it). */
function wav(ms: number): Blob {
  const data = Math.round((ms / 1000) * 32000)
  const head = new DataView(new ArrayBuffer(44))
  const tag = (offset: number, text: string) => [...text].forEach((c, i) => head.setUint8(offset + i, c.charCodeAt(0)))
  tag(0, 'RIFF')
  head.setUint32(4, 36 + data, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  head.setUint32(16, 16, true)
  head.setUint16(20, 1, true)
  head.setUint16(22, 1, true)
  head.setUint32(24, 16000, true)
  head.setUint32(28, 32000, true)
  head.setUint16(32, 2, true)
  head.setUint16(34, 16, true)
  tag(36, 'data')
  head.setUint32(40, data, true)
  return new Blob([head.buffer, new Uint8Array(data)], { type: 'audio/wav' })
}

/** Every state of the voice store from now on, as "rec/tr". */
function watchStates(): string[] {
  const seen: string[] = []
  const unsubscribe = useVoiceStore.subscribe((s) => {
    const key = `${s.isRecording ? 'rec' : '-'}/${s.isTranscribing ? 'tr' : '-'}`
    if (seen[seen.length - 1] !== key) seen.push(key)
  })
  onTestFinished(unsubscribe)
  return seen
}

beforeEach(() => {
  standOn('iphone')
  voice.transcribeAudioCloud.mockReset()
  voice.createAudioRecorder.mockReset()
  useVoiceStore.setState({ isRecording: false, isTranscribing: false, transcript: '', sttError: null, retryTakeReady: false })
})
afterEach(() => {
  cleanup()
  discardFailedTake()
  vi.unstubAllGlobals()
})

describe('the end of a dictation on a phone', () => {
  it('transcribeTake is busy from its first step, the length check included', async () => {
    let answer!: (text: string) => void
    voice.transcribeAudioCloud.mockImplementationOnce(() => new Promise<string>((resolve) => (answer = resolve)))
    const done = transcribeTake(wav(1500), true)
    // Synchronously, before the WAV header has been read.
    expect(useVoiceStore.getState().isTranscribing).toBe(true)
    await vi.waitFor(() => expect(voice.transcribeAudioCloud).toHaveBeenCalled())
    expect(useVoiceStore.getState().isTranscribing).toBe(true)
    answer('hello')
    expect(await done).toBe('hello')
    expect(useVoiceStore.getState().isTranscribing).toBe(false)
  })

  it('a take too short to send ends busy too (no stuck spinner)', async () => {
    expect(await transcribeTake(wav(100), true)).toBe('')
    expect(voice.transcribeAudioCloud).not.toHaveBeenCalled()
    expect(useVoiceStore.getState().isTranscribing).toBe(false)
    expect(useVoiceStore.getState().sttError).toMatch(/too short/)
  })

  it('stopRecording goes from recording to transcribing without a moment with neither', async () => {
    const take = wav(1500)
    voice.createAudioRecorder.mockReturnValue({
      start: async () => {},
      stop: async () => take,
      snapshot: () => null,
      isRecording: () => true,
    })
    voice.transcribeAudioCloud.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return 'Hello from dictation'
    })
    const { result } = renderHook(() => useVoice())
    await act(async () => {
      expect(await result.current.startRecording()).toBe(true)
    })
    expect(useVoiceStore.getState().isRecording).toBe(true)

    const seen = watchStates()
    let text = ''
    await act(async () => {
      text = await result.current.stopRecording()
    })
    expect(text).toBe('Hello from dictation')
    // Only at the very end, with the text in hand, is nothing going on.
    expect(seen).toEqual(['rec/tr', '-/tr', '-/-'])
  })

  it('an empty take ends at once, without a spinner', async () => {
    voice.createAudioRecorder.mockReturnValue({
      start: async () => {},
      stop: async () => new Blob([]),
      snapshot: () => null,
      isRecording: () => true,
    })
    const { result } = renderHook(() => useVoice())
    await act(async () => {
      await result.current.startRecording()
    })
    const seen = watchStates()
    await act(async () => {
      expect(await result.current.stopRecording()).toBe('')
    })
    expect(seen).toEqual(['-/-'])
    expect(voice.transcribeAudioCloud).not.toHaveBeenCalled()
  })
})
