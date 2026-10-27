/**
 * Mobile round 44: a dictation that LU Cloud did not write down says why.
 *
 * Found on an Android phone: a short take ended in "transcription is
 * unavailable right now, tap retry in a moment" for every 5xx the route gives,
 * also for the one where its speech service refused the recording, which no
 * retry a moment later changes. 4xx answers showed the bare server string, or
 * nothing at all when the take was not kept.
 *
 * The server below answers in the shape of the transcription route of the
 * web app (status plus `{ error }`, `{ error, code }` for an empty wallet).
 * The real cloud fetch and the real transcribeTake run against it.
 *
 * After the server correction (r44b) the route gives a 503 for two different
 * things, "busy" after its own tries and "unavailable" on the LU Cloud side,
 * and a 422 for a recording it could not read. Neither 503 means dictation
 * was switched off.
 *
 * Run: npx vitest run src/hooks/__tests__/mobile-dictation-errors.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOPS, standOn } from '../../test-support/devices'

vi.mock('../../api/cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))
vi.mock('../../lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { transcribeTake } from '../useVoice'
import { useVoiceStore } from '../../stores/voiceStore'
import { discardFailedTake, failedTake } from '../../lib/dictation-retry'
import { DICTATION_TEXT, wavDurationMs } from '../../lib/dictation-errors'

/** A take as the recorder of the app writes it: 16 kHz mono 16-bit WAV. */
function wav(ms: number): Blob {
  const rate = 16000
  const samples = Math.round((rate * ms) / 1000)
  const buf = new ArrayBuffer(44 + samples * 2)
  const v = new DataView(buf)
  const put = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  put(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); put(8, 'WAVE'); put(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  put(36, 'data'); v.setUint32(40, samples * 2, true)
  return new Blob([buf], { type: 'audio/wav' })
}

interface Sent { url: string; contentType: string | null; auth: string | null; bytes: number }
let sent: Sent[] = []

/** The transcription route, answering `status` with `body`. */
function server(status: number, body: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    sent.push({ url, contentType: headers.get('content-type'), auth: headers.get('authorization'), bytes: (init.body as Blob).size })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }))
}

beforeEach(() => {
  sent = []
  useVoiceStore.setState({ isTranscribing: false, transcript: '', sttError: null, retryTakeReady: false })
})
afterEach(() => {
  discardFailedTake()
  vi.unstubAllGlobals()
})

const said = () => useVoiceStore.getState().sttError
const kept = () => useVoiceStore.getState().retryTakeReady

describe('android: what the route answered is what the line says', () => {
  beforeEach(() => standOn('android'))

  it('the request is the one the route reads: raw WAV body, audio/wav, bearer', async () => {
    server(200, { text: 'one two three test' })
    expect(await transcribeTake(wav(2000), true)).toBe('one two three test')
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('https://lu-labs.ai/api/voice/transcribe')
    expect(sent[0].contentType).toBe('audio/wav')
    expect(sent[0].auth).toBe('Bearer session-token-abc')
    expect(sent[0].bytes).toBe(44 + 2 * 32000)
    expect(said()).toBeNull()
  })

  it('502 "transcription failed": the speech service refused it, not "unavailable, in a moment"', async () => {
    server(502, { error: 'transcription failed', detail: 'upstream said no' })
    await transcribeTake(wav(2000), true)
    expect(said()).toBe(DICTATION_TEXT.speechServiceFailed.replace('{status}', '502'))
    expect(said()).not.toMatch(/unavailable/i)
    expect(said()).not.toContain('upstream said no')
    expect(kept()).toBe(true)
  })

  it('502 "unreachable" says its own thing', async () => {
    server(502, { error: 'transcription backend unreachable' })
    await transcribeTake(wav(2000), true)
    expect(said()).toBe(DICTATION_TEXT.speechServiceDown.replace('{status}', '502'))
    expect(kept()).toBe(true)
  })

  it('503 "transcription is busy": busy, kept, retry in a moment, not "switched off"', async () => {
    server(503, { error: 'transcription is busy, try again in a moment' })
    await transcribeTake(wav(2000), true)
    expect(said()).toBe('LU Cloud transcription is busy. Your recording is kept, tap retry in a moment.')
    expect(said()).not.toMatch(/switched off/i)
    expect(kept()).toBe(true)
    expect(failedTake()).not.toBeNull()
  })

  it('503 "cloud transcription is unavailable right now": on the LU Cloud side, kept, retry', async () => {
    server(503, { error: 'cloud transcription is unavailable right now' })
    await transcribeTake(wav(2000), true)
    expect(said()).toBe(DICTATION_TEXT.cloudUnavailable.replace('{status}', '503'))
    expect(said()).toMatch(/LU Cloud side/)
    expect(said()).toMatch(/recording is kept/)
    expect(said()).toMatch(/retry/)
    expect(said()).not.toMatch(/switched off/i)
    expect(kept()).toBe(true)
  })

  it('any other 503 says the same as "unavailable", never "switched off"', async () => {
    for (const error of ['voice backend not configured', 'something new', '']) {
      server(503, { error })
      await transcribeTake(wav(2000), true)
      expect(said()).toBe(DICTATION_TEXT.cloudUnavailable.replace('{status}', '503'))
      expect(kept()).toBe(true)
    }
    server(503, {})
    await transcribeTake(wav(2000), true)
    expect(said()).toBe(DICTATION_TEXT.cloudUnavailable.replace('{status}', '503'))
  })

  it('422 "this recording could not be read": record it again, the take is let go', async () => {
    server(422, { error: 'this recording could not be read, record it again' })
    await transcribeTake(wav(2000), true)
    expect(said()).toBe('This recording could not be read. Record it again.')
    expect(kept()).toBe(false)
    expect(failedTake()).toBeNull()
  })

  // The answers of the route with their fixed `code` (server correction r44b,
  // final shape): `code` is stable, `error` only its English sentence. The app
  // goes by the code; the text and then the status are only the fallback.
  describe('by code, exactly as the route answers', () => {
    const answer = async (status: number, body: Record<string, unknown>) => {
      server(status, body)
      return transcribeTake(wav(2000), true)
    }

    it('200 { text }: the text, no line', async () => {
      expect(await answer(200, { text: 'one two three test' })).toBe('one two three test')
      expect(said()).toBeNull()
    })

    it('503 upstream_busy: busy, kept, retry in a moment', async () => {
      await answer(503, { error: 'transcription is busy, try again in a moment', code: 'upstream_busy' })
      expect(said()).toBe('LU Cloud transcription is busy. Your recording is kept, tap retry in a moment.')
      expect(kept()).toBe(true)
    })

    it('503 upstream_unavailable: on the LU Cloud side, kept, retry', async () => {
      await answer(503, { error: 'cloud transcription is unavailable right now', code: 'upstream_unavailable' })
      expect(said()).toBe(DICTATION_TEXT.cloudUnavailable.replace('{status}', '503'))
      expect(said()).not.toMatch(/switched off/i)
      expect(kept()).toBe(true)
    })

    it('422 unsupported_audio: could not be read, record it again, the take is let go', async () => {
      await answer(422, { error: 'this recording could not be read, record it again', code: 'unsupported_audio' })
      expect(said()).toBe('This recording could not be read. Record it again.')
      expect(kept()).toBe(false)
      expect(failedTake()).toBeNull()
    })

    it('415 unsupported_audio: the format is not supported, record it again, the take is let go', async () => {
      await answer(415, { error: 'this audio format is not supported, record it again', code: 'unsupported_audio' })
      expect(said()).toBe(DICTATION_TEXT.unsupported.replace('{status}', '415'))
      expect(said()).toMatch(/format/)
      expect(said()).toMatch(/Record it again/)
      expect(kept()).toBe(false)
    })

    it('422 audio_too_short: the same sentence as a take the app itself finds too short, not kept', async () => {
      await answer(422, { error: 'recording too short, record it again', code: 'audio_too_short' })
      expect(said()).toBe(DICTATION_TEXT.tooShort)
      expect(kept()).toBe(false)
      expect(failedTake()).toBeNull()
    })

    it('413 audio_too_large: too long, not kept', async () => {
      await answer(413, { error: 'audio too large (max about 6 minutes)', code: 'audio_too_large' })
      expect(said()).toBe(DICTATION_TEXT.tooLong)
      expect(kept()).toBe(false)
    })

    it('502 upstream_unreadable: the answer could not be read, nothing charged, kept for a retry', async () => {
      await answer(502, { error: 'transcription failed, try again', code: 'upstream_unreadable' })
      expect(said()).toBe('LU Cloud could not read the answer. Nothing was charged. Tap retry.')
      expect(kept()).toBe(true)
      expect(failedTake()).not.toBeNull()
    })

    it('429 credits_exhausted: out of credits, kept', async () => {
      vi.stubGlobal('window', new EventTarget())
      await answer(429, { error: "You're out of credits for this month.", code: 'credits_exhausted' })
      expect(said()).toBe(DICTATION_TEXT.outOfCredits)
      expect(kept()).toBe(true)
    })

    it('429 without code: the rate limit, wait a minute, kept', async () => {
      await answer(429, { error: 'too many requests' })
      expect(said()).toBe(DICTATION_TEXT.busy)
      expect(kept()).toBe(true)
    })

    it('403 without code: the plan has no cloud voice, not kept', async () => {
      await answer(403, { error: 'your plan does not include cloud voice' })
      expect(said()).toBe(DICTATION_TEXT.noPlan)
      expect(kept()).toBe(false)
    })

    it('401 without code: signed out, kept', async () => {
      await answer(401, { error: 'unauthorized' })
      expect(said()).toBe('Signed out. Sign in to your LU Cloud account again, then tap retry. Your recording is kept.')
      expect(kept()).toBe(true)
    })

    it('the code wins over the text', async () => {
      await answer(503, { error: 'busy or not, the code decides', code: 'upstream_unavailable' })
      expect(said()).toBe(DICTATION_TEXT.cloudUnavailable.replace('{status}', '503'))
      await answer(422, { error: 'this recording could not be read', code: 'audio_too_short' })
      expect(said()).toBe(DICTATION_TEXT.tooShort)
    })
  })

  it('400 "empty audio body": named, and the take is not kept behind a useless retry', async () => {
    server(400, { error: 'empty audio body' })
    await transcribeTake(wav(2000), true)
    expect(said()).toBe(DICTATION_TEXT.empty)
    expect(kept()).toBe(false)
    expect(failedTake()).toBeNull()
  })

  it('415: the format is named, the take is let go', async () => {
    server(415, { error: 'unsupported media type' })
    await transcribeTake(wav(2000), true)
    expect(said()).toBe(DICTATION_TEXT.unsupported.replace('{status}', '415'))
    expect(kept()).toBe(false)
  })

  it('413, 403 plan, 403 other, 429 burst, 429 wallet, 401', async () => {
    server(413, { error: 'audio too large (max ~2 minutes)' })
    await transcribeTake(wav(2000), true)
    expect(said()).toBe(DICTATION_TEXT.tooLong)
    expect(kept()).toBe(false)

    server(403, { error: 'your plan does not include cloud voice' })
    await transcribeTake(wav(2000), true)
    expect(said()).toBe(DICTATION_TEXT.noPlan)
    expect(kept()).toBe(false)

    server(403, { error: 'cross-origin denied' })
    await transcribeTake(wav(2000), true)
    expect(said()).toBe(DICTATION_TEXT.refused.replace('{status}', '403'))
    expect(kept()).toBe(true)

    server(429, { error: 'too many requests' })
    await transcribeTake(wav(2000), true)
    expect(said()).toBe(DICTATION_TEXT.busy)

    server(429, { error: "You're out of credits for this month.", code: 'credits_exhausted' })
    vi.stubGlobal('window', new EventTarget())
    await transcribeTake(wav(2000), true)
    expect(said()).toBe(DICTATION_TEXT.outOfCredits)

    server(401, { error: 'unauthorized' })
    await transcribeTake(wav(2000), true)
    expect(said()).toBe('Signed out. Sign in to your LU Cloud account again, then tap retry. Your recording is kept.')
  })

  it('an unknown 5xx keeps the old sentence', async () => {
    server(500, { error: 'boom' })
    await transcribeTake(wav(2000), true)
    expect(said()).toBe('LU Cloud transcription is unavailable right now. Your recording is kept, tap retry in a moment.')
  })

  it('a take under 0.4 s is not sent at all, and says so', async () => {
    server(200, { text: 'x' })
    expect(await transcribeTake(wav(150), true)).toBe('')
    expect(sent).toHaveLength(0)
    expect(said()).toBe(DICTATION_TEXT.tooShort)
    expect(kept()).toBe(false)
  })

  it('every sentence is a phone sentence: ends with a period, no dashes', () => {
    for (const s of Object.values(DICTATION_TEXT)) {
      expect(s.endsWith('.')).toBe(true)
      expect(s).not.toMatch(/[–—]|click|this computer|System Settings/)
    }
  })
})

describe('the length of a take', () => {
  it('is read from the WAV header, and anything else is not judged', async () => {
    expect(await wavDurationMs(wav(1000))).toBeCloseTo(1000, 0)
    expect(await wavDurationMs(new Blob([new Uint8Array(2048)], { type: 'audio/wav' }))).toBeNull()
    expect(await wavDurationMs(new Blob([], { type: 'audio/wav' }))).toBeNull()
  })
})

describe('DESKTOP UNCHANGED', () => {
  for (const device of DESKTOPS) {
    it(`${device}: the old sentences, a short take is still sent`, async () => {
      standOn(device)
      server(502, { error: 'transcription failed' })
      await transcribeTake(wav(2000), true)
      expect(said()).toBe('Cloud transcription is unavailable right now, try again')
      server(503, { error: 'transcription is busy, try again in a moment' })
      await transcribeTake(wav(2000), true)
      expect(said()).toBe('Cloud transcription is unavailable right now, try again')
      server(422, { error: 'this recording could not be read, record it again' })
      await transcribeTake(wav(2000), true)
      expect(said()).toBe('this recording could not be read, record it again')
      server(502, { error: 'transcription failed, try again', code: 'upstream_unreadable' })
      await transcribeTake(wav(2000), true)
      expect(said()).toBe('Cloud transcription is unavailable right now, try again')
      server(422, { error: 'recording too short, record it again', code: 'audio_too_short' })
      await transcribeTake(wav(2000), true)
      expect(said()).toBe('recording too short, record it again')
      server(400, { error: 'empty audio body' })
      await transcribeTake(wav(2000), true)
      expect(said()).toBe('empty audio body')
      server(200, { text: 'x' })
      expect(await transcribeTake(wav(150), true)).toBe('x')
      expect(sent.at(-1)?.bytes).toBe(44 + 2 * 2400)
    })
  }
})
