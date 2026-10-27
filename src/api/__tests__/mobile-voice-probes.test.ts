/**
 * Point 8 of the mobile groundwork, the probes: a phone has no faster-whisper
 * and no Piper. The commands behind the probes are stubs there, so the answer
 * is known without asking, and nothing is called.
 *
 * Also: a refused cloud read-aloud carries the server's code, because 429
 * alone does not say whether the wallet is empty.
 *
 * Run: npx vitest run src/api/__tests__/mobile-voice-probes.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOPS, HANDHELDS, standOn } from '../../test-support/devices'

const backend = vi.hoisted(() => ({ backendCall: vi.fn(), cloudFetch: vi.fn() }))
vi.mock('../backend', () => ({ isTauri: () => true, backendCall: backend.backendCall }))
vi.mock('../cloud/client', async (orig) => ({ ...((await orig()) as object), cloudFetch: backend.cloudFetch }))

import {
  checkTtsAvailable, checkWhisperAvailable, listInstalledPiperVoices, recheckTtsAvailable,
  recheckWhisperAvailable, synthesizeCloud,
} from '../voice'
import { CloudJobError } from '../cloud/client'

beforeEach(() => {
  backend.backendCall.mockReset()
  backend.cloudFetch.mockReset()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('the local probes', () => {
  for (const device of HANDHELDS) {
    it(`${device}: answer "not here" at once and call nothing`, async () => {
      standOn(device)
      expect(await checkWhisperAvailable()).toEqual({ available: false, backend: null })
      expect(await checkTtsAvailable('en_US-lessac-medium')).toEqual({ available: false })
      expect(await recheckWhisperAvailable()).toBe(false)
      expect(await recheckTtsAvailable('en_US-lessac-medium')).toBe(false)
      expect(await listInstalledPiperVoices()).toEqual([])
      expect(backend.backendCall).not.toHaveBeenCalled()
    })
  }

  for (const device of DESKTOPS) {
    it(`DESKTOP UNCHANGED ${device}: ask the backend, with the selected voice`, async () => {
      standOn(device)
      backend.backendCall.mockImplementation(async (cmd: string) => {
        if (cmd === 'whisper_status') return { available: true, backend: 'faster-whisper' }
        if (cmd === 'tts_status') return { available: true, piper: true, voice: true }
        if (cmd === 'installed_piper_voices') return ['en_US-lessac-medium']
        return null
      })
      expect(await checkWhisperAvailable()).toEqual({ available: true, backend: 'faster-whisper' })
      expect(await checkTtsAvailable('en_US-lessac-medium')).toEqual({ available: true, piper: true, voice: true })
      expect(await listInstalledPiperVoices()).toEqual(['en_US-lessac-medium'])
      expect(backend.backendCall.mock.calls).toEqual([
        ['whisper_status'],
        ['tts_status', { voice: 'en_US-lessac-medium' }],
        ['installed_piper_voices'],
      ])
    })
  }
})

describe('a refused cloud read-aloud', () => {
  it('carries the code of the server', async () => {
    backend.cloudFetch.mockResolvedValue({
      ok: false, status: 429,
      json: async () => ({ error: 'monthly credit budget exhausted', code: 'credits_exhausted' }),
    })
    const err = await synthesizeCloud('Hello').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CloudJobError)
    expect((err as CloudJobError).status).toBe(429)
    expect((err as CloudJobError).code).toBe('credits_exhausted')
    expect((err as CloudJobError).message).toBe('monthly credit budget exhausted')
  })

  it('UNCHANGED: an answer without a code has none, and keeps status and sentence', async () => {
    backend.cloudFetch.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('no json') } })
    const err = await synthesizeCloud('Hello').catch((e: unknown) => e)
    expect((err as CloudJobError).status).toBe(502)
    expect((err as CloudJobError).code).toBeUndefined()
    expect((err as CloudJobError).message).toBe('cloud TTS failed (502)')
  })
})
