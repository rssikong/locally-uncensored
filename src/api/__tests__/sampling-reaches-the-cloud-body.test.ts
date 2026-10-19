/**
 * Which of the sampling values really reach an LU Cloud request.
 *
 * A project note said "the temperature slider writes to settings.n and has no
 * effect in the cloud". Both halves are wrong, and the note is what sent this
 * check out: there is no `n` anywhere in the app (not in the `Settings`
 * interface in types/settings.ts:49-52, not in DEFAULT_SETTINGS in
 * lib/constants.ts:12-15, and `OpenAIChatRequest` in openai-provider.ts:86-100
 * has no member it could be assigned to), and temperature goes on the wire,
 * when it differs from the app default.
 *
 * R5-10/R5-11 (3.0.1-Liste), Entscheid vom 18.09.2026: since then a
 * field NEITHER this chat NOR the Settings page ever moved away from the app
 * default is left off the request entirely (src/lib/sampling.ts,
 * `buildSamplingRequest`), so the model gets the upstream's own default
 * instead of a number LU picked for every model at once. This file used to
 * assert the opposite (defaults always sent); that assertion is what changed,
 * not the fact that a moved slider reaches the wire.
 *
 * The value that has no effect in the cloud regardless is TOP K. The OpenAI
 * compatible body has no field for it: it is read by ollama-provider.ts:150
 * and anthropic-provider.ts:320 and dropped by openai-provider, which never
 * looks at `options.topK` at all, so it works on Ollama and Anthropic and is
 * inert on every OpenAI-protocol backend, LU Cloud and this app's own engine
 * included. Since R5-13 it is not in the per-chat popup at all, only a
 * Settings-page control that useChat.ts still forwards unconditionally.
 *
 * Asserted on the JSON body of a real request, because a note about a slider
 * is exactly the kind of claim that source-reading gets wrong twice.
 *
 * Run: npx vitest run src/api/__tests__/sampling-reaches-the-cloud-body.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { LuCloudProvider } from '../providers/lu-cloud-provider'
import type { OpenAIChatRequest } from '../providers/openai-provider'
import type { ProviderConfig } from '../providers/types'
import { sentJson } from './provider-test-support'
import { useSettingsStore } from '../../stores/settingsStore'
import { normalizeMaxTokens } from '../../components/chat/SamplingControls'
import { buildSamplingRequest, type SamplingOverrides } from '../../lib/sampling'
import { DEFAULT_SETTINGS } from '../../lib/constants'

vi.mock('../cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))

const config: ProviderConfig = {
  id: 'lu-cloud', name: 'LU Cloud', enabled: true,
  baseUrl: 'https://lu-labs.ai/api/inference/v1', apiKey: '', isLocal: false,
}

const okStream = () =>
  new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', { status: 200 })

const src = (rel: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8')

/**
 * The option object useChat.ts builds for ONE conversation, read out of the
 * live settings store plus that conversation's own overrides, the same
 * `buildSamplingRequest(...)` spread useChat.ts uses, with `topK` forwarded
 * unconditionally alongside it (F3/R5-13: it never was subject to the
 * untouched-omission rule, only the popup that used to show it).
 */
function chatOptsFromSettings(overrides?: SamplingOverrides) {
  const s = useSettingsStore.getState().settings
  return {
    ...buildSamplingRequest(s, overrides),
    topK: s.topK,
  }
}

/** One cloud turn, and the JSON body it put on the wire. */
async function cloudBody(overrides?: SamplingOverrides): Promise<OpenAIChatRequest> {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okStream())
  const gen = new LuCloudProvider(config).chatStream(
    'zai-org/GLM-5.3',
    [{ role: 'user' as const, content: 'hello' }],
    chatOptsFromSettings(overrides),
  )
  for await (const _ of gen) { /* the fetch only fires on the first next() */ }
  return sentJson<OpenAIChatRequest>(spy.mock.calls)
}

/** Move the SETTINGS PAGE sliders. */
function sliders(patch: Partial<typeof DEFAULT_SETTINGS>) {
  useSettingsStore.getState().updateSettings(patch)
}

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
})
afterEach(() => vi.restoreAllMocks())

describe('what a moved slider puts on the wire', () => {
  it('carries temperature, top_p and max_tokens under the OpenAI names, moved on the Settings page', async () => {
    sliders({ temperature: 1.35, topP: 0.42, topK: 7, maxTokens: 512 })
    const body = await cloudBody()
    expect(body.temperature).toBe(1.35)
    expect(body.top_p).toBe(0.42)
    expect(body.max_tokens).toBe(512)
  })

  it('carries the same three when it is THIS CHAT that moved them, not the Settings page', async () => {
    // The Settings page stays at the shipped default the whole time.
    const body = await cloudBody({ temperature: 1.35, topP: 0.42, maxTokens: 512 })
    expect(body.temperature).toBe(1.35)
    expect(body.top_p).toBe(0.42)
    expect(body.max_tokens).toBe(512)
    expect(useSettingsStore.getState().settings.temperature).toBe(DEFAULT_SETTINGS.temperature)
  })

  it('carries a temperature of zero, which a truthiness test would eat', async () => {
    // The guard is `!== undefined`, and 0 is a value a user picks on purpose:
    // it is the whole point of the left end of the slider.
    sliders({ temperature: 0 })
    expect((await cloudBody()).temperature).toBe(0)
  })

  it('leaves top_k off the body, because the protocol has no such field', async () => {
    sliders({ topK: 7 })
    const body = await cloudBody()
    expect('top_k' in body).toBe(false)
    expect(JSON.stringify(body)).not.toContain('top_k')
  })

  it('and invents no `n` for any of them', async () => {
    // The claim that started this. There is nothing named `n` on the wire, in
    // the settings, or in the request interface.
    sliders({ temperature: 1.35 })
    const body = await cloudBody() as unknown as Record<string, unknown>
    expect('n' in body).toBe(false)
    expect(Object.keys(useSettingsStore.getState().settings)).not.toContain('n')
  })

  it('puts the NUMBER on the wire for the text the box used to keep', async () => {
    // The field kept `0512` on screen while the store already held 512 (T1
    // nebenfund 5), so the one thing worth proving on a real body is that what
    // leaves the app is a number and not the text somebody typed. `0512` is
    // the exact string the old field produced.
    const body = await cloudBody({ maxTokens: normalizeMaxTokens('0512') })
    expect(body.max_tokens).toBe(512)
    expect(typeof body.max_tokens).toBe('number')
  })
})

/**
 * R5-10/R5-11: the rule the fixliste and the owner's decision ask for. Nothing
 * NEITHER the chat NOR the Settings page ever moved reaches the wire.
 */
describe('what an UNTOUCHED value does NOT put on the wire', () => {
  it('sends no temperature or top_p at all while both are still at the shipped default', async () => {
    const body = await cloudBody()
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
    expect('temperature' in body).toBe(false)
    expect('top_p' in body).toBe(false)
  })

  it('sends no max_tokens at all on the auto default of 0', async () => {
    // 0 means "let the server decide", so the field has to be absent rather
    // than present as a zero budget, which would answer nothing.
    expect(DEFAULT_SETTINGS.maxTokens).toBe(0)
    expect((await cloudBody()).max_tokens).toBeUndefined()
  })

  it('NEGATIVKONTROLLE: a chat with its OWN override still sends it, only the untouched fields are omitted', async () => {
    // Counter-check for the two cases above: a body that dropped every
    // sampling field unconditionally would pass them by coincidence.
    const body = await cloudBody({ temperature: 1.9 })
    expect(body.temperature).toBe(1.9)
    expect(body.top_p).toBeUndefined() // still untouched
  })

  it('NEGATIVKONTROLLE: a Settings-page value that really moved is not mistaken for untouched', async () => {
    sliders({ topP: 0.42 })
    const body = await cloudBody()
    expect(body.top_p).toBe(0.42)
    expect(DEFAULT_SETTINGS.topP).not.toBe(0.42)
  })
})

describe('the panel writes to the conversation the send reads', () => {
  it('the two sliders and the number field write through one setter, keyed off the FIELDS table', () => {
    const panel = src('../../components/chat/SamplingControls.tsx')
    expect(panel).toMatch(/key: 'temperature'/)
    expect(panel).toMatch(/key: 'topP'/)
    expect(panel).toMatch(/write\(\{ maxTokens:/)
    // The slider setter is keyed off the FIELDS table, so it cannot write a
    // name that is not in it.
    expect(panel).toMatch(/write\(\{ \[f\.key\]: Number\(e\.target\.value\) \}\)/)
  })

  /**
   * R5-13. The dead control is gone from the popup, and this is the guard that
   * keeps it from coming back: the popup writes nothing the OpenAI-compatible
   * body has no field for. Mirrors the web guard in
   * the web app.
   */
  it('R5-13: the popup offers no Top K, and names itself the way the web app does', () => {
    const panel = src('../../components/chat/SamplingControls.tsx')
    expect(panel).not.toContain("key: 'topK'")
    expect(panel).toContain('title="Sampling for this chat"')
  })

  it('R5-13 NEGATIVKONTROLLE: Top K is still offered on the settings page', () => {
    // Removed from the popup, not from the app. Ollama and Anthropic read it,
    // and that is where it is set.
    const page = src('../../components/settings/SettingsPage.tsx')
    expect(page).toContain('topK')
    expect(src('../providers/ollama-provider.ts')).toContain('top_k')
  })

  it('and the send reads sampling through buildSamplingRequest, topK straight from settings', () => {
    // GH #175: useChat goes through speakerSamplingOptions, which adds the
    // speaker's persona preset under the chat's own values.
    const chat = src('../../hooks/useChat.ts')
    expect(chat).toMatch(/speakerSamplingOptions\(settings, conv,/)
    const speaker = src('../../lib/chat-persona.ts')
    expect(speaker).toMatch(/buildSamplingRequest\(settings, conv\.sampling, preset\)/)
    expect(speaker).toMatch(/topK: settings\.topK/)
  })
})
