/**
 * durchsicht-mobile M1: the consent to LU Cloud covers every way content
 * leaves the phone, not only the chat send. Dictation, read-aloud through the
 * cloud voice and the memory sync all ask the same gate
 * (lib/cloud-content-gate.ts), which the phone shell fills with
 * ensureAiConsent() at boot.
 *
 * Run: npx vitest run src/hooks/__tests__/mobile-cloud-consent-voice.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { standOn } from '../../test-support/devices'

const voice = vi.hoisted(() => ({
  synthesizeCloud: vi.fn(async () => 'blob:voice'),
  playNeuralAudio: vi.fn(async () => {}),
  stopNeuralAudio: vi.fn(),
  stopSpeaking: vi.fn(),
  isSpeechSynthesisSupported: vi.fn(() => true),
  speak: vi.fn(async () => {}),
  speakStreaming: vi.fn(async (_text: string, ..._rest: unknown[]) => {}),
  getVoicesAsync: vi.fn(async () => []),
}))
const client = vi.hoisted(() => ({ cloudFetch: vi.fn() }))
vi.mock('../../api/voice', async (orig) => ({ ...((await orig()) as object), ...voice }))
vi.mock('../../api/cloud/client', async (orig) => ({ ...((await orig()) as object), cloudFetch: client.cloudFetch }))
vi.mock('../../lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { speakOnPhone, stopSpeechPlayback } from '../useVoice'
import { useVoiceStore } from '../../stores/voiceStore'
import { MOBILE_TEXT } from '../../lib/platform-text'
import { CloudConsentError, cloudContentAllowed, cloudContentConsented, installCloudContentGate } from '../../lib/cloud-content-gate'
import { MemorySyncError, withMemorySyncSession } from '../../api/cloud/memory-sync'

const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')

let agreed = false
let asked = 0
let answer = false
let uninstall: (() => void) | null = null
function installGate() {
  uninstall = installCloudContentGate({
    has: () => agreed,
    ensure: async () => {
      if (agreed) return true
      asked += 1
      agreed = answer
      return answer
    },
  })
}

beforeEach(() => {
  agreed = false
  asked = 0
  answer = false
  for (const fn of Object.values(voice)) fn.mockClear()
  client.cloudFetch.mockReset()
  voice.isSpeechSynthesisSupported.mockReturnValue(true)
  useVoiceStore.setState({ isSpeaking: false, ttsFallbackReason: null, ttsEnabled: true, ttsVoice: '' })
  standOn('iphone')
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => {
  uninstall?.()
  uninstall = null
  stopSpeechPlayback()
  vi.unstubAllGlobals()
})

describe('the gate', () => {
  it('nothing installed (desktop): always yes, nobody is asked', async () => {
    expect(cloudContentConsented()).toBe(true)
    expect(await cloudContentAllowed()).toBe(true)
  })

  it('a gate that throws is a no', async () => {
    uninstall = installCloudContentGate({ has: () => { throw new Error('x') }, ensure: async () => { throw new Error('x') } })
    expect(cloudContentConsented()).toBe(false)
    expect(await cloudContentAllowed()).toBe(false)
  })

  it('the phone shell installs its consent at boot', () => {
    expect(read('../../mobile/boot/index.tsx')).toMatch(/installCloudContentGate\(\{ has: hasAiConsent, ensure: ensureAiConsent \}\)/)
  })
})

describe('read aloud through LU Cloud', () => {
  it('a tap without consent asks; a no sends nothing and the system voice reads', async () => {
    installGate()
    await speakOnPhone('Hello there.', false, true)
    expect(asked).toBe(1)
    expect(voice.synthesizeCloud).not.toHaveBeenCalled()
    expect(voice.speak).toHaveBeenCalledTimes(1)
  })

  it('a no without a system voice says why, and still sends nothing', async () => {
    installGate()
    voice.isSpeechSynthesisSupported.mockReturnValue(false)
    await speakOnPhone('Hello there.', false, true)
    expect(voice.synthesizeCloud).not.toHaveBeenCalled()
    expect(useVoiceStore.getState().ttsFallbackReason).toBe(MOBILE_TEXT.readAloudNeedsConsent)
  })

  it('a yes sends', async () => {
    installGate()
    answer = true
    await speakOnPhone('Hello there.', false, true)
    expect(asked).toBe(1)
    expect(voice.synthesizeCloud).toHaveBeenCalledTimes(1)
  })

  it('an answer that is read by itself never opens the sheet', async () => {
    installGate()
    await speakOnPhone('Hello there.', true, true)
    expect(asked).toBe(0)
    expect(voice.synthesizeCloud).not.toHaveBeenCalled()
  })
})

describe('the calls themselves refuse without consent', () => {
  it('dictation: no request leaves', async () => {
    installGate()
    const { transcribeAudioCloud } = await vi.importActual<typeof import('../../api/voice')>('../../api/voice')
    await expect(transcribeAudioCloud(new Blob(['x']))).rejects.toBeInstanceOf(CloudConsentError)
    expect(client.cloudFetch).not.toHaveBeenCalled()
  })

  it('cloud voice: no request leaves', async () => {
    installGate()
    const { synthesizeCloud } = await vi.importActual<typeof import('../../api/voice')>('../../api/voice')
    await expect(synthesizeCloud('Hello')).rejects.toBeInstanceOf(CloudConsentError)
    expect(client.cloudFetch).not.toHaveBeenCalled()
  })

  it('memory sync: asks, and a no ends before the session or any request', async () => {
    installGate()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const work = vi.fn()
    const err = await withMemorySyncSession('user-1', work).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MemorySyncError)
    expect((err as MemorySyncError).kind).toBe('consent')
    expect(asked).toBe(1)
    expect(work).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the microphone is asked for before it opens, in the hook and on the chat page', () => {
    const hook = read('../useVoice.ts')
    const start = hook.slice(hook.indexOf('const startRecording = useCallback('))
    expect(start.indexOf('cloudContentAllowed()')).toBeGreaterThan(0)
    expect(start.indexOf('cloudContentAllowed()')).toBeLessThan(start.indexOf('createAudioRecorder()'))
    const page = read('../../mobile/screens/chat/ChatPage.tsx')
    const dictate = page.slice(page.indexOf('const dictate = async'))
    expect(dictate.indexOf('ensureAiConsent()')).toBeGreaterThan(0)
    expect(dictate.indexOf('ensureAiConsent()')).toBeLessThan(dictate.indexOf('voice.startRecording()'))
  })
})
