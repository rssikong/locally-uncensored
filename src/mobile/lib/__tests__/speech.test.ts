/**
 * The voice of the phone behind one door (lib/speech.ts), against a fake
 * WebView voice and a fake native bridge. What must hold: one source at a
 * time, the WebView first, the bridge second, and "none" only when both were
 * asked and neither listed a voice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __setBridgeForTests, type LuNativeBridge } from '../../platform/bridge'
import { __resetSpeechForTests, listPhoneVoices, pickPhoneVoice, readNativeVoices, sortVoicesFor, sourceHasPitch, speakOnDevice, speechSource, stopDeviceSpeech, type PhoneVoice } from '../speech'

interface FakeUtterance {
  text: string
  voice?: { name: string }
  rate: number
  pitch: number
  onend?: () => void
  onerror?: (event: { error: string }) => void
}

/** A WebView that can speak: `names` are its voices, `spoken` records what it was asked to say. */
function fakeWebView(names: string[], behave: 'end' | 'fail' | 'hang' = 'end') {
  const spoken: FakeUtterance[] = []
  const cancel = vi.fn()
  const voices = names.map((name, i) => ({ name, lang: name.startsWith('Anna') ? 'de-DE' : 'en-US', default: i === 0, voiceURI: name, localService: true }))
  const speechSynthesis = {
    getVoices: () => voices,
    cancel,
    speak: (u: FakeUtterance) => {
      spoken.push(u)
      if (behave === 'end') queueMicrotask(() => u.onend?.())
      if (behave === 'fail') queueMicrotask(() => u.onerror?.({ error: 'synthesis-failed' }))
    },
  }
  vi.stubGlobal('window', { speechSynthesis })
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string
      rate = 1
      pitch = 1
      constructor(text: string) {
        this.text = text
      }
    },
  )
  return { spoken, cancel }
}

type Handlers = { onEnd?: (e: { id: string; stopped?: boolean }) => void; onError?: (e: { id: string; message?: string }) => void }

/**
 * A native bridge that speaks as the plugin does (mobile-docs/r3/rust.md): `speak` answers at once with an id,
 * and the end of that text arrives as an event. `behave` says what the system does with a text.
 */
function fakeBridge(answer: unknown, behave: 'end' | 'error' | 'hang' | 'early-end' = 'end') {
  const handlers = new Set<Handlers>()
  let count = 0
  const emitEnd = (id: string, stopped = false) => handlers.forEach((h) => h.onEnd?.({ id, stopped }))
  const speak = vi.fn(async (_text: string, _options?: unknown) => {
    const id = `tts-${++count}`
    // An end of some other text must never end this one.
    emitEnd('someone-else')
    if (behave === 'early-end') emitEnd(id)
    if (behave === 'end') setTimeout(() => emitEnd(id), 5)
    if (behave === 'error') setTimeout(() => handlers.forEach((h) => h.onError?.({ id, message: 'The speech engine stopped.' })), 5)
    return id
  })
  const stopSpeaking = vi.fn(async () => {
    emitEnd(`tts-${count}`, true)
  })
  const listVoices = vi.fn(async () => answer)
  const off = vi.fn()
  const onSpeech = vi.fn(async (h: Handlers) => {
    handlers.add(h)
    return () => {
      handlers.delete(h)
      off()
    }
  })
  __setBridgeForTests({ speak, stopSpeaking, listVoices, onSpeech } as unknown as LuNativeBridge)
  return { speak, stopSpeaking, listVoices, onSpeech, off, listening: () => handlers.size }
}

/** The answer of `tts_voices` for a phone with these voices. */
const systemVoices = (...voices: Array<Record<string, unknown>>) => ({ available: voices.length > 0, voices })

afterEach(() => {
  __resetSpeechForTests()
  __setBridgeForTests(undefined)
  vi.unstubAllGlobals()
})

describe('one source', () => {
  it('the WebView speaks when it lists a voice, and the bridge is not even asked', async () => {
    fakeWebView(['Samantha', 'Anna'])
    const bridge = fakeBridge(systemVoices({ id: 'native-1', name: 'Native', lang: 'en-US', local: true, default: true }))
    const found = await listPhoneVoices({ waitMs: 0 })
    expect(found.source).toBe('web')
    expect(found.voices.map((v) => v.id)).toEqual(['Samantha', 'Anna'])
    expect(found.voices[0]).toMatchObject({ name: 'Samantha', lang: 'en-US', isDefault: true, local: true })
    expect(bridge.listVoices).not.toHaveBeenCalled()
  })

  it('no speechSynthesis (Android System WebView): the bridge is the source', async () => {
    vi.stubGlobal('window', {})
    fakeBridge(systemVoices({ id: 'en-us-x-sfg-local', name: 'English (US)', lang: 'en-US', local: true, default: true }, { id: 'en-us-x-sfg-network', name: 'English (US) online', lang: 'en-US', local: false, default: false }))
    const found = await listPhoneVoices({ waitMs: 0 })
    expect(found).toEqual({
      source: 'native',
      voices: [
        { id: 'en-us-x-sfg-local', name: 'English (US)', lang: 'en-US', isDefault: true, local: true },
        { id: 'en-us-x-sfg-network', name: 'English (US) online', lang: 'en-US', isDefault: false, local: false },
      ],
    })
    expect(await speechSource()).toBe('native')
  })

  it('a speechSynthesis that lists no voice does not count: the bridge is asked next', async () => {
    fakeWebView([])
    fakeBridge(systemVoices({ id: 'v1', name: 'Voice one', lang: 'en-GB' }))
    expect((await listPhoneVoices({ waitMs: 0 })).source).toBe('native')
  })

  it('"none" only when neither lists a voice', async () => {
    fakeWebView([])
    const bridge = fakeBridge({ available: false, voices: [] })
    expect(await listPhoneVoices({ waitMs: 0 })).toEqual({ source: 'none', voices: [] })
    expect(bridge.listVoices).toHaveBeenCalledTimes(1)
  })

  it('"none" without a WebView voice and without a bridge, or with a bridge that has no speech yet', async () => {
    vi.stubGlobal('window', {})
    __setBridgeForTests(null)
    expect((await listPhoneVoices({ waitMs: 0 })).source).toBe('none')
    __resetSpeechForTests()
    // The bridge of today: it shares files, it does not speak.
    __setBridgeForTests({ shareFile: async () => ({ presented: true }) })
    expect((await listPhoneVoices({ waitMs: 0 })).source).toBe('none')
  })

  it('a bridge whose list fails has no voice to offer, and nothing throws', async () => {
    vi.stubGlobal('window', {})
    __setBridgeForTests({ speak: async () => undefined, listVoices: async () => Promise.reject(new Error('Command plugin:lu-native|list_voices not found')) } as unknown as LuNativeBridge)
    expect((await listPhoneVoices({ waitMs: 0 })).source).toBe('none')
  })

  it('waits a moment for a WebView that fills its list late', async () => {
    const late: Array<{ name: string; lang: string; default: boolean }> = []
    vi.stubGlobal('window', { speechSynthesis: { getVoices: () => late, cancel: () => {}, speak: () => {} } })
    __setBridgeForTests(null)
    setTimeout(() => late.push({ name: 'Late voice', lang: 'en-US', default: true }), 60)
    const found = await listPhoneVoices({ waitMs: 1000 })
    expect(found.source).toBe('web')
    expect(found.voices[0].id).toBe('Late voice')
  })

  it('a found source is kept, "none" is asked again, and fresh forgets', async () => {
    vi.stubGlobal('window', {})
    const first = fakeBridge(systemVoices())
    expect((await listPhoneVoices({ waitMs: 0 })).source).toBe('none')
    expect((await listPhoneVoices({ waitMs: 0 })).source).toBe('none')
    expect(first.listVoices).toHaveBeenCalledTimes(2)

    const second = fakeBridge(systemVoices({ id: 'a', name: 'A' }))
    expect((await listPhoneVoices({ waitMs: 0 })).source).toBe('native')
    await listPhoneVoices({ waitMs: 0 })
    expect(second.listVoices).toHaveBeenCalledTimes(1)
    await listPhoneVoices({ waitMs: 0, fresh: true })
    expect(second.listVoices).toHaveBeenCalledTimes(2)
  })
})

describe('speakOnDevice and stopDeviceSpeech', () => {
  it('speaks through the WebView with the picked voice, speed and pitch', async () => {
    const web = fakeWebView(['Samantha', 'Anna'])
    __setBridgeForTests(null)
    const result = await speakOnDevice('Hello there', { voiceId: 'Anna', rate: 1.4, pitch: 0.8 })
    expect(result).toEqual({ source: 'web', spoken: true })
    expect(web.spoken).toHaveLength(1)
    expect(web.spoken[0]).toMatchObject({ text: 'Hello there', rate: 1.4, pitch: 0.8 })
    expect(web.spoken[0].voice?.name).toBe('Anna')
  })

  it('speaks through the bridge when that is the source, waits for the end of ITS text, and stops listening', async () => {
    vi.stubGlobal('window', {})
    const bridge = fakeBridge(systemVoices({ id: 'v1', name: 'One', lang: 'en-US' }, { id: 'v2', name: 'Zwei', lang: 'de-DE' }))
    expect(await speakOnDevice('Hallo', { voiceId: 'v2', rate: 3, pitch: 0.1, lang: 'en' })).toEqual({ source: 'native', spoken: true })
    // The picked voice speaks, in its own language. Speed is brought into the range; the native voice has no pitch.
    expect(bridge.speak).toHaveBeenCalledWith('Hallo', { voice: 'v2', rate: 2, lang: 'de-DE' })
    expect(bridge.onSpeech).toHaveBeenCalledTimes(1)
    expect(bridge.off).toHaveBeenCalledTimes(1)
    expect(bridge.listening()).toBe(0)
    expect(sourceHasPitch('native')).toBe(false)
    expect(sourceHasPitch('web')).toBe(true)
  })

  it('without a picked voice the language of the text is handed on, so a German phone reads English with an English voice', async () => {
    vi.stubGlobal('window', {})
    const bridge = fakeBridge(systemVoices({ id: 'de', name: 'Anna', lang: 'de-DE', default: true }, { id: 'en', name: 'Samantha', lang: 'en-US' }))
    await speakOnDevice('Hello', { lang: 'en-US' })
    expect(bridge.speak).toHaveBeenCalledWith('Hello', { voice: undefined, rate: 1, lang: 'en-US' })
    // No pick and no language named: the system decides, and nothing is made up.
    await speakOnDevice('Hello')
    expect(bridge.speak).toHaveBeenLastCalledWith('Hello', { voice: undefined, rate: 1, lang: undefined })
  })

  it('the WebView gets the language of the text too when no voice is picked', async () => {
    const web = fakeWebView(['Anna', 'Samantha'])
    __setBridgeForTests(null)
    await speakOnDevice('Hello', { lang: 'en-US' })
    expect((web.spoken[0] as unknown as { lang?: string }).lang).toBe('en-US')
    expect(web.spoken[0].voice).toBeUndefined()
  })

  it('a saved voice the phone no longer has is not handed on: the default speaks', async () => {
    vi.stubGlobal('window', {})
    const bridge = fakeBridge(systemVoices({ id: 'v1', name: 'One' }))
    await speakOnDevice('Hello', { voiceId: 'gone' })
    expect(bridge.speak).toHaveBeenCalledWith('Hello', { voice: undefined, rate: 1, lang: undefined })
  })

  it('an end that arrives before speak answered is not missed', async () => {
    vi.stubGlobal('window', {})
    fakeBridge(systemVoices({ id: 'v1', name: 'One' }), 'early-end')
    await expect(speakOnDevice('Hello')).resolves.toEqual({ source: 'native', spoken: true })
  })

  it('a stop ends the wait: the text that was stopped resolves', async () => {
    vi.stubGlobal('window', {})
    const bridge = fakeBridge(systemVoices({ id: 'v1', name: 'One' }), 'hang')
    const reading = speakOnDevice('A long text')
    await vi.waitFor(() => expect(bridge.speak).toHaveBeenCalled())
    await stopDeviceSpeech()
    await expect(reading).resolves.toEqual({ source: 'native', spoken: true })
    expect(bridge.listening()).toBe(0)
  })

  it('a text the system could not speak throws the sentence of the system', async () => {
    vi.stubGlobal('window', {})
    const bridge = fakeBridge(systemVoices({ id: 'v1', name: 'One' }), 'error')
    await expect(speakOnDevice('Hello')).rejects.toThrow('The speech engine stopped.')
    expect(bridge.listening()).toBe(0)
  })

  it('a refused request throws and leaves no listener behind', async () => {
    vi.stubGlobal('window', {})
    const bridge = fakeBridge(systemVoices({ id: 'v1', name: 'One' }))
    bridge.speak.mockRejectedValueOnce(new Error('There is no text to read aloud.'))
    await expect(speakOnDevice('')).rejects.toThrow('There is no text to read aloud.')
    expect(bridge.listening()).toBe(0)
  })

  it('a bridge without events: that the system took the text is all there is to know', async () => {
    vi.stubGlobal('window', {})
    __setBridgeForTests({ speak: async () => 'tts-1', listVoices: async () => systemVoices({ id: 'v1', name: 'One' }) } as unknown as LuNativeBridge)
    await expect(speakOnDevice('Hello')).resolves.toEqual({ source: 'native', spoken: true })
  })

  it('without any voice nothing is spoken, and it says so instead of throwing', async () => {
    vi.stubGlobal('window', {})
    __setBridgeForTests(null)
    expect(await speakOnDevice('Hello')).toEqual({ source: 'none', spoken: false })
  })

  it('a voice that fails throws, so the caller can say that it failed', async () => {
    fakeWebView(['Samantha'], 'fail')
    __setBridgeForTests(null)
    await expect(speakOnDevice('Hello')).rejects.toThrow('synthesis-failed')
  })

  it('stop cancels the WebView and leaves a bridge alone that is not the source', async () => {
    const web = fakeWebView(['Samantha'])
    const bridge = fakeBridge(systemVoices({ id: 'v1', name: 'One' }))
    await speakOnDevice('Hello')
    await stopDeviceSpeech()
    expect(web.cancel).toHaveBeenCalled()
    expect(bridge.stopSpeaking).not.toHaveBeenCalled()
  })

  it('stop tells the bridge when the bridge is the source, and never throws', async () => {
    vi.stubGlobal('window', {})
    const bridge = fakeBridge(systemVoices({ id: 'v1', name: 'One' }))
    await speakOnDevice('Hello')
    bridge.stopSpeaking.mockRejectedValueOnce(new Error('nothing was speaking'))
    await expect(stopDeviceSpeech()).resolves.toBeUndefined()
    await stopDeviceSpeech()
    expect(bridge.stopSpeaking).toHaveBeenCalledTimes(2)
  })

  it('stop with nothing asked and nothing there is quiet', async () => {
    vi.stubGlobal('window', {})
    __setBridgeForTests(null)
    await expect(stopDeviceSpeech()).resolves.toBeUndefined()
  })
})

describe('pure helpers', () => {
  const voices: PhoneVoice[] = [
    { id: 'a', name: 'Alpha', lang: 'en-US', isDefault: false, local: true },
    { id: 'b', name: 'Berta', lang: 'de-DE', isDefault: true, local: true },
    { id: 'c', name: 'Carla', lang: 'de_AT', isDefault: false, local: true },
  ]

  it('readNativeVoices takes a list or { voices }, drops what has no name, and never throws', () => {
    expect(readNativeVoices(null)).toEqual([])
    expect(readNativeVoices('voices')).toEqual([])
    expect(readNativeVoices({ voices: 'none' })).toEqual([])
    expect(readNativeVoices([null, 4, {}, { name: ' ' }, { name: 'Only name', language: 'en' }, { id: 'x', name: 'X' }, { id: 'x', name: 'Twice' }])).toEqual([
      { id: 'Only name', name: 'Only name', lang: 'en', isDefault: false, local: true },
      { id: 'x', name: 'X', lang: '', isDefault: false, local: true },
    ])
  })

  it('pickPhoneVoice: the saved one, else the default, else the language, else the first', () => {
    expect(pickPhoneVoice([], 'a')).toBeNull()
    expect(pickPhoneVoice(voices, 'a')?.id).toBe('a')
    expect(pickPhoneVoice(voices, 'gone')?.id).toBe('b')
    const noDefault = voices.map((v) => ({ ...v, isDefault: false }))
    expect(pickPhoneVoice(noDefault, '', 'de-CH')?.id).toBe('b')
    expect(pickPhoneVoice(noDefault, '', 'fr-FR')?.id).toBe('a')
  })

  it('sortVoicesFor puts the voices of the language of the phone first', () => {
    const { near, rest } = sortVoicesFor(voices, 'de-DE')
    expect(near.map((v) => v.id)).toEqual(['b', 'c'])
    expect(rest.map((v) => v.id)).toEqual(['a'])
    expect(sortVoicesFor(voices, '').near).toEqual([])
  })
})
