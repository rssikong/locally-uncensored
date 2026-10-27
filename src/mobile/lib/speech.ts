/**
 * The voice of the phone, behind ONE door.
 *
 * A phone can read aloud in two ways without LU Cloud: the WebView speaks
 * itself (`speechSynthesis`, there on iOS, missing in the Android System
 * WebView), or the native layer speaks (plugin lu-native: `speak`,
 * `stopSpeaking`, `listVoices` in src/lib/lu-native.ts). Which one a phone
 * has is decided HERE and nowhere else, in this order:
 *
 *   1. `speechSynthesis`, when it lists at least one voice
 *   2. the native bridge, when it lists at least one voice
 *   3. none
 *
 * So the settings page and the chat always agree, and "this phone has no
 * voice" is only ever said when `source` is 'none', which means that BOTH
 * were asked and neither listed a voice.
 *
 * The native functions (mobile-docs/r3/rust.md, section 1):
 *
 *   listVoices(): Promise<{ available: boolean; voices: SystemVoice[] }>
 *   speak(text, { voice?, rate?, lang? }): Promise<string>   the id, as soon as the system took the text
 *   stopSpeaking(): Promise<void>
 *   onSpeech({ onStart, onEnd, onError }): Promise<() => void>   events carry that id
 *
 * They are read tolerantly (`nativeSpeech`): a build whose bridge is older
 * has no such members and step 2 answers "nothing", like a phone without the
 * plugin. The native voice has speed but no pitch (`sourceHasPitch`).
 *
 * Language: a text is read by the picked voice. Without a pick the caller
 * names the language of the text (`lang`), otherwise a phone set to German
 * reads an English answer with its German voice.
 */
import { nativeBridge } from '../platform/bridge'

export type SpeechSource = 'web' | 'native' | 'none'

export interface PhoneVoice {
  /** What is saved as the choice and handed back to `speakOnDevice`. For a web voice this is its name. */
  id: string
  name: string
  /** BCP 47 tag ("en-US"), empty when the source does not say. */
  lang: string
  isDefault: boolean
  /** False for a voice that needs the network to speak. */
  local: boolean
}

export interface PhoneVoices {
  source: SpeechSource
  voices: PhoneVoice[]
}

export interface SpeakOptions {
  /** `PhoneVoice.id`. Left out or unknown: the default voice of the phone. */
  voiceId?: string
  /** 0.5 to 2, 1 is normal. */
  rate?: number
  /** 0.5 to 2, 1 is normal. Only the WebView voice has it (`sourceHasPitch`). */
  pitch?: number
  /**
   * BCP 47 language of the text ("en", "de-DE"). Used when no voice is picked,
   * so the phone reads with a voice of that language instead of the voice of
   * its own system language. With a picked voice that voice speaks.
   */
  lang?: string
}

export interface SpeakResult {
  /** The source that spoke, 'none' when there is no voice. */
  source: SpeechSource
  /** False only when there was no voice to speak with. A stop counts as spoken. */
  spoken: boolean
}

interface NativeSpeechEvent {
  id?: string
  stopped?: boolean
  message?: string
}

interface NativeSpeech {
  speak: (text: string, options?: { voice?: string; rate?: number; lang?: string }) => Promise<unknown>
  stopSpeaking?: () => Promise<unknown>
  listVoices: () => Promise<unknown>
  onSpeech?: (handlers: { onEnd?: (event: NativeSpeechEvent) => void; onError?: (event: NativeSpeechEvent) => void }) => Promise<() => void>
}

/** The speech functions of the bridge, or null while this build does not have them. */
async function nativeSpeech(): Promise<NativeSpeech | null> {
  let bridge: unknown
  try {
    bridge = await nativeBridge()
  } catch {
    return null
  }
  if (!bridge || typeof bridge !== 'object') return null
  const b = bridge as Partial<NativeSpeech>
  if (typeof b.speak !== 'function' || typeof b.listVoices !== 'function') return null
  return {
    speak: b.speak,
    listVoices: b.listVoices,
    stopSpeaking: typeof b.stopSpeaking === 'function' ? b.stopSpeaking : undefined,
    onSpeech: typeof b.onSpeech === 'function' ? b.onSpeech : undefined,
  }
}

/** Does this source take a pitch. The native voice has speed only, so a pitch control would move nothing there. */
export function sourceHasPitch(source: SpeechSource): boolean {
  return source === 'web'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Pure: whatever `listVoices` of the bridge answered, as voices. Entries without an id and a name are dropped. */
export function readNativeVoices(answer: unknown): PhoneVoice[] {
  const list: unknown = Array.isArray(answer) ? answer : answer && typeof answer === 'object' ? (answer as { voices?: unknown }).voices : null
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const voices: PhoneVoice[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const id = text(e.id) || text(e.identifier) || text(e.name)
    if (!id || seen.has(id)) continue
    seen.add(id)
    voices.push({ id, name: text(e.name) || id, lang: text(e.lang) || text(e.language) || text(e.locale), isDefault: e.default === true || e.isDefault === true, local: e.local !== false })
  }
  return voices
}

function synth(): SpeechSynthesis | null {
  try {
    return typeof window !== 'undefined' && window.speechSynthesis && typeof window.speechSynthesis.getVoices === 'function' ? window.speechSynthesis : null
  } catch {
    return null
  }
}

function webVoicesNow(): SpeechSynthesisVoice[] {
  try {
    return synth()?.getVoices() ?? []
  } catch {
    return []
  }
}

/** How long the WebView gets to list its voices. Some fill the list a moment after the first question. */
export const WEB_VOICES_WAIT_MS = 1000
const WEB_VOICES_STEP_MS = 125

async function webVoices(waitMs: number): Promise<SpeechSynthesisVoice[]> {
  if (!synth()) return []
  let voices = webVoicesNow()
  // Asked again a few times: not every WebView fires `voiceschanged`.
  for (let waited = 0; voices.length === 0 && waited < waitMs; waited += WEB_VOICES_STEP_MS) {
    await new Promise((done) => setTimeout(done, WEB_VOICES_STEP_MS))
    voices = webVoicesNow()
  }
  return voices
}

function fromWeb(voices: SpeechSynthesisVoice[]): PhoneVoice[] {
  const seen = new Set<string>()
  const out: PhoneVoice[] = []
  for (const v of voices) {
    if (!v.name || seen.has(v.name)) continue
    seen.add(v.name)
    out.push({ id: v.name, name: v.name, lang: v.lang ?? '', isDefault: v.default === true, local: v.localService !== false })
  }
  return out
}

let cached: PhoneVoices | null = null
let asking: Promise<PhoneVoices> | null = null

async function ask(waitMs: number): Promise<PhoneVoices> {
  const web = fromWeb(await webVoices(waitMs))
  if (web.length > 0) return { source: 'web', voices: web }
  const native = await nativeSpeech()
  if (native) {
    try {
      const voices = readNativeVoices(await native.listVoices())
      if (voices.length > 0) return { source: 'native', voices }
    } catch {
      /* a bridge that cannot list its voices has none to offer */
    }
  }
  return { source: 'none', voices: [] }
}

/**
 * The voices of this phone and where they come from. Asked once per app run
 * and kept, because the answer does not change while the app is open; pass
 * `fresh` after the user came back from the system settings.
 * Never throws: a source that fails counts as "no voice there".
 */
export function listPhoneVoices(options: { fresh?: boolean; waitMs?: number } = {}): Promise<PhoneVoices> {
  if (options.fresh) {
    cached = null
    asking = null
  }
  if (cached) return Promise.resolve(cached)
  if (!asking) {
    const mine = ask(options.waitMs ?? WEB_VOICES_WAIT_MS).then((found) => {
      // A newer question (fresh) may have replaced this one. Its answer wins.
      if (asking === mine) {
        // "None" is not kept: a WebView that was slow to list its voices is asked again next time.
        cached = found.source === 'none' ? null : found
        asking = null
      }
      return found
    })
    asking = mine
  }
  return asking
}

/** Which source reads aloud on this phone. 'none' only when neither listed a voice. */
export async function speechSource(): Promise<SpeechSource> {
  return (await listPhoneVoices()).source
}

/**
 * Pure: the voice to speak with. The saved one when the phone still has it,
 * otherwise the default of the phone, otherwise the first one in the wanted
 * language, otherwise the first. null for an empty list.
 */
export function pickPhoneVoice(voices: readonly PhoneVoice[], savedId: string | null | undefined, lang?: string): PhoneVoice | null {
  if (voices.length === 0) return null
  if (savedId) {
    const saved = voices.find((v) => v.id === savedId)
    if (saved) return saved
  }
  const byDefault = voices.find((v) => v.isDefault)
  if (byDefault) return byDefault
  const want = (lang ?? '').toLowerCase().split('-')[0]
  if (want) {
    const sameLang = voices.find((v) => v.lang.toLowerCase().split(/[-_]/)[0] === want)
    if (sameLang) return sameLang
  }
  return voices[0]
}

/** Pure: voices of the wanted language first (in their own order), then the rest. */
export function sortVoicesFor(voices: readonly PhoneVoice[], lang: string): { near: PhoneVoice[]; rest: PhoneVoice[] } {
  const want = lang.toLowerCase().split('-')[0]
  const near: PhoneVoice[] = []
  const rest: PhoneVoice[] = []
  for (const v of voices) (want && v.lang.toLowerCase().split(/[-_]/)[0] === want ? near : rest).push(v)
  return { near, rest }
}

function clamp(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(2, Math.max(0.5, value)) : 1
}

function speakOnTheWeb(words: string, options: SpeakOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = synth()
    if (!s) {
      reject(new Error('Speech synthesis is not there'))
      return
    }
    s.cancel()
    const utterance = new SpeechSynthesisUtterance(words)
    const voice = options.voiceId ? webVoicesNow().find((v) => v.name === options.voiceId) : undefined
    if (voice) utterance.voice = voice
    // No pick: the language of the text chooses the voice, not the language of the phone.
    else if (options.lang) utterance.lang = options.lang
    utterance.rate = clamp(options.rate)
    utterance.pitch = clamp(options.pitch)
    utterance.onend = () => resolve()
    utterance.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') resolve()
      else reject(new Error(`Speech synthesis error: ${event.error}`))
    }
    s.speak(utterance)
  })
}

/**
 * Speak through the bridge and wait for the end. `speak` of the bridge
 * answers at once with an id; the end, a stop or a failure of that text
 * arrives as an event. The events are followed BEFORE the text is handed
 * over, so an end that comes early is not missed.
 */
async function speakThroughBridge(native: NativeSpeech, words: string, options: { voice?: string; rate: number; lang?: string }): Promise<void> {
  let id: string | null = null
  const early: Array<{ kind: 'end' | 'error'; event: NativeSpeechEvent }> = []
  let finish: (kind: 'end' | 'error', event: NativeSpeechEvent) => void = (kind, event) => void early.push({ kind, event })
  let off: (() => void) | null = null
  try {
    off = native.onSpeech ? await native.onSpeech({ onEnd: (event) => finish('end', event), onError: (event) => finish('error', event) }) : null
  } catch {
    off = null
  }
  try {
    const answer = await native.speak(words, options)
    id = typeof answer === 'string' ? answer : answer && typeof answer === 'object' ? text((answer as { id?: unknown }).id) || null : null
    // A bridge without events, or one that names no id: that the system took the text is all there is to know.
    if (!off || !id) return
    await new Promise<void>((resolve, reject) => {
      finish = (kind, event) => {
        if (event?.id !== id) return
        if (kind === 'end') resolve()
        else reject(new Error(text(event.message) || 'The voice of this phone could not read the text.'))
      }
      for (const seen of early) finish(seen.kind, seen.event)
    })
  } finally {
    off?.()
  }
}

/**
 * Read `words` aloud with the voice of this phone. Resolves when the reading
 * ended or was stopped. `spoken: false` means there is no voice here; a
 * source that has a voice and fails throws, so the caller can say so.
 */
export async function speakOnDevice(words: string, options: SpeakOptions = {}): Promise<SpeakResult> {
  const { source, voices } = await listPhoneVoices()
  if (source === 'none') return { source, spoken: false }
  // An id the phone no longer has is not handed on: the default voice speaks.
  const picked = options.voiceId ? voices.find((v) => v.id === options.voiceId) : undefined
  const voiceId = picked?.id
  // A picked voice speaks its own language. Without a pick the language of the text decides.
  const lang = picked ? picked.lang || undefined : options.lang || undefined
  if (source === 'web') {
    await speakOnTheWeb(words, { ...options, voiceId, lang })
    return { source, spoken: true }
  }
  const native = await nativeSpeech()
  if (!native) return { source: 'none', spoken: false }
  await speakThroughBridge(native, words, { voice: voiceId, rate: clamp(options.rate), lang })
  return { source, spoken: true }
}

/** Stop whatever this door started. Safe to call when nothing is speaking. Never throws. */
export async function stopDeviceSpeech(): Promise<void> {
  try {
    synth()?.cancel()
  } catch {
    /* nothing was speaking */
  }
  // Only the source that is in use is told. A phone that speaks through the WebView never wakes the bridge.
  if (cached?.source !== 'native') return
  try {
    await (await nativeSpeech())?.stopSpeaking?.()
  } catch {
    /* nothing was speaking */
  }
}

/** Only for tests: forget what was asked. */
export function __resetSpeechForTests(): void {
  cached = null
  asking = null
}
