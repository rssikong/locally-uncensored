/**
 * Reading aloud through the native layer (src/lib/lu-native.ts): what the
 * three functions do outside the phone app, and what they send inside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: { payload: unknown }) => void

const { invoke, listeners } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

/**
 * The event side of Tauri as the webview has it: `listen` registers a
 * callback and names it to `plugin:event|listen`. Rebuilt here at that level,
 * so the real `listen` of @tauri-apps/api runs.
 */
function tauriInternals() {
  const callbacks = new Map<number, Handler>()
  let next = 1
  return {
    transformCallback: (callback: Handler) => {
      callbacks.set(next, callback)
      return next++
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    invoke: async (command: string, args: { event?: string; handler?: number }) => {
      if (command === 'plugin:event|listen' && args.event && args.handler) {
        listeners.set(args.event, callbacks.get(args.handler) as Handler)
        return args.handler
      }
      if (command === 'plugin:event|unlisten' && args.event) listeners.delete(args.event)
      return null
    },
  }
}

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'

function inPhoneApp(on: boolean) {
  const w = globalThis as unknown as { window?: Record<string, unknown>; navigator?: unknown }
  if (on) {
    vi.stubGlobal('window', {
      ...(w.window ?? {}),
      __TAURI_INTERNALS__: tauriInternals(),
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    })
    vi.stubGlobal('navigator', { userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5 })
  } else {
    vi.unstubAllGlobals()
  }
}

beforeEach(() => {
  invoke.mockReset()
  listeners.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reading aloud outside the phone app', () => {
  it('has no system voices, refuses to speak with a clear error and stops without one', async () => {
    const native = await import('../lu-native')
    expect(native.hasNative()).toBe(false)
    expect(await native.listVoices()).toEqual({ available: false, voices: [] })
    await expect(native.speak('Hello')).rejects.toBeInstanceOf(native.LuNativeUnavailableError)
    await expect(native.stopSpeaking()).resolves.toBeUndefined()
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('reading aloud in the phone app', () => {
  beforeEach(() => inPhoneApp(true))

  it('asks the plugin for the voices and survives an answer without a list', async () => {
    const native = await import('../lu-native')
    const voice = { id: 'en-us-x-sfg-local', name: 'English (United States)', lang: 'en-US', local: true, default: true }
    invoke.mockResolvedValueOnce({ available: true, voices: [voice] })
    expect(await native.listVoices()).toEqual({ available: true, voices: [voice] })
    expect(invoke).toHaveBeenCalledWith('plugin:lu-native|tts_voices', undefined)
    invoke.mockResolvedValueOnce({ available: false })
    expect(await native.listVoices()).toEqual({ available: false, voices: [] })
    invoke.mockResolvedValueOnce(null)
    expect(await native.listVoices()).toEqual({ available: false, voices: [] })
  })

  it('sends the text and only the options that were given, and answers the id', async () => {
    const native = await import('../lu-native')
    invoke.mockResolvedValue({ id: 'abc' })
    expect(await native.speak('Hello')).toBe('abc')
    expect(invoke).toHaveBeenLastCalledWith('plugin:lu-native|tts_speak', { text: 'Hello' })
    await native.speak('Hallo', { voice: 'de-de-x-nfh-local', rate: 1.25, lang: 'de-DE' })
    expect(invoke).toHaveBeenLastCalledWith('plugin:lu-native|tts_speak', { text: 'Hallo', voice: 'de-de-x-nfh-local', rate: 1.25, lang: 'de-DE' })
    await native.speak('x', { rate: Number.NaN })
    expect(invoke).toHaveBeenLastCalledWith('plugin:lu-native|tts_speak', { text: 'x' })
  })

  it('passes the sentence of a refused text on', async () => {
    const native = await import('../lu-native')
    invoke.mockRejectedValueOnce('This phone has no voice for reading aloud.')
    await expect(native.speak('Hello')).rejects.toBe('This phone has no voice for reading aloud.')
  })

  it('stops through the plugin', async () => {
    const native = await import('../lu-native')
    invoke.mockResolvedValue({ ok: true })
    await native.stopSpeaking()
    expect(invoke).toHaveBeenCalledWith('plugin:lu-native|tts_stop', undefined)
  })

  it('hands start, end and error to their handlers and stops listening on request', async () => {
    const native = await import('../lu-native')
    const seen: string[] = []
    const off = await native.onSpeech({
      onStart: (e) => seen.push(`start ${e.id}`),
      onEnd: (e) => seen.push(`end ${e.id} ${e.stopped ? 'stopped' : 'done'}`),
      onError: (e) => seen.push(`error ${e.id} ${e.message}`),
    })
    expect([...listeners.keys()].sort()).toEqual(['tts-end', 'tts-error', 'tts-start'])
    listeners.get('tts-start')?.({ payload: { id: 'a' } })
    listeners.get('tts-end')?.({ payload: { id: 'a', stopped: false } })
    listeners.get('tts-end')?.({ payload: { id: 'b', stopped: true } })
    listeners.get('tts-error')?.({ payload: { id: 'c', message: 'The phone could not play the voice.' } })
    expect(seen).toEqual(['start a', 'end a done', 'end b stopped', 'error c The phone could not play the voice.'])
    off()
    await vi.waitFor(() => expect(listeners.size).toBe(0))
  })
})
