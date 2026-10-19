/**
 * Character cards (Discord feature request D1, 3.0.7).
 *
 * A character card is the file format role play frontends trade characters
 * in. SillyTavern defined it: a JSON object, either on its own or base64
 * encoded inside a PNG text chunk (`chara` for v1/v2, `ccv3` for v3) so the
 * picture of the character IS the file. This module reads such a card into an
 * LU persona, builds the system prompt and the greeting a chat with it starts
 * from, and writes the persona back out as a chara_card_v2 JSON.
 *
 * Deliberately NOT here: lorebooks (character_book), group role play, swipes
 * for every answer. A card that carries a lorebook imports fine, the book is
 * just not used.
 *
 * Everything that reads a file treats it as hostile: sizes are capped before
 * anything is decoded, every chunk length is bounds checked, and every failure
 * ends in a CardError with a sentence the panel can show as is.
 */
import type { CharacterCard, Persona } from '../types/settings'

/** Largest card file we open at all. Cards with big art run to a few MB. */
export const MAX_CARD_FILE_BYTES = 20 * 1024 * 1024
/** Largest card JSON we parse, after base64 decoding. */
export const MAX_CARD_JSON_BYTES = 2 * 1024 * 1024
/** Fallback for `{{user}}` while the app has no user name setting. */
export const DEFAULT_USER_NAME = 'User'
/** What SillyTavern sends when a card brings no system prompt of its own. */
export const DEFAULT_RP_SYSTEM_PROMPT =
  "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}."

const MAX_GREETINGS = 50
const MAX_TAGS = 50

export class CardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CardError'
  }
}

/** A card as read from a file: the persona fields plus the card name. */
export interface ParsedCard {
  name: string
  card: CharacterCard
}

// ── JSON ─────────────────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function strList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, max)
}

/**
 * The stored shape, checked. Used on import and again wherever a stored
 * persona's card is read, so a blob edited by hand or written by a newer build
 * can at worst lose its card, never crash a chat.
 */
export function normalizeCard(raw: unknown): CharacterCard | undefined {
  if (!isObj(raw)) return undefined
  const card: CharacterCard = {
    description: str(raw.description),
    personality: str(raw.personality),
    scenario: str(raw.scenario),
    firstMessage: str(raw.firstMessage),
    exampleMessages: str(raw.exampleMessages),
    alternateGreetings: strList(raw.alternateGreetings, MAX_GREETINGS),
    systemPrompt: str(raw.systemPrompt),
    postHistoryInstructions: str(raw.postHistoryInstructions),
    creatorNotes: str(raw.creatorNotes),
  }
  if (str(raw.creator)) card.creator = str(raw.creator)
  if (str(raw.characterVersion)) card.characterVersion = str(raw.characterVersion)
  const tags = strList(raw.tags, MAX_TAGS)
  if (tags.length) card.tags = tags
  if (isObj(raw.extensions)) card.extensions = raw.extensions
  return card
}

/**
 * Read a card object. Accepts chara_card_v2 and chara_card_v3 (fields under
 * `data`) and v1 (fields at the top level, including the older Pygmalion
 * spellings char_name / char_persona / world_scenario / char_greeting /
 * example_dialogue).
 */
export function parseCardObject(obj: unknown): ParsedCard {
  if (!isObj(obj)) throw new CardError('This file is not a character card.')
  const spec = str(obj.spec)
  let d: Record<string, unknown>
  if (spec === 'chara_card_v2' || spec === 'chara_card_v3') {
    if (!isObj(obj.data)) throw new CardError('This character card has no data section.')
    d = obj.data
  } else if (spec) {
    throw new CardError(`Unknown character card format "${spec.slice(0, 40)}".`)
  } else {
    d = obj
  }
  const name = (str(d.name) || str(d.char_name)).trim()
  if (!name) throw new CardError('This character card has no name.')
  const card = normalizeCard({
    description: str(d.description) || str(d.char_persona),
    personality: str(d.personality),
    scenario: str(d.scenario) || str(d.world_scenario),
    firstMessage: str(d.first_mes) || str(d.char_greeting),
    exampleMessages: str(d.mes_example) || str(d.example_dialogue),
    alternateGreetings: d.alternate_greetings,
    systemPrompt: str(d.system_prompt),
    postHistoryInstructions: str(d.post_history_instructions),
    creatorNotes: str(d.creator_notes) || str(d.creatorcomment),
    creator: str(d.creator),
    characterVersion: str(d.character_version),
    tags: d.tags,
    extensions: d.extensions,
  })!
  return { name: name.slice(0, 200), card }
}

export function parseCardJson(text: string): ParsedCard {
  if (utf8Length(text) > MAX_CARD_JSON_BYTES) throw new CardError('This character card is too large.')
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    throw new CardError('This file is not valid JSON.')
  }
  return parseCardObject(obj)
}

function utf8Length(text: string): number {
  // Upper bound is enough for a cap and avoids encoding a huge string twice.
  return text.length * 3 > MAX_CARD_JSON_BYTES ? new TextEncoder().encode(text).length : text.length
}

// ── PNG ──────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)
}

interface TextChunk {
  keyword: string
  text: string
}

function latin1(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return s
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new CardError('This character card is compressed in a way this app cannot read.')
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_CARD_JSON_BYTES * 2) {
      await reader.cancel()
      throw new CardError('This character card is too large.')
    }
    parts.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** The tEXt and iTXt chunks of a PNG, in file order. CRCs are not checked. */
export async function readPngTextChunks(bytes: Uint8Array): Promise<TextChunk[]> {
  if (!isPng(bytes)) throw new CardError('This file is not a PNG image.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunks: TextChunk[] = []
  let pos = 8
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos)
    const type = latin1(bytes.subarray(pos + 4, pos + 8))
    const start = pos + 8
    const end = start + len
    if (end + 4 > bytes.length) throw new CardError('This PNG file is damaged.')
    const data = bytes.subarray(start, end)
    if (type === 'tEXt') {
      const nul = data.indexOf(0)
      if (nul > 0) chunks.push({ keyword: latin1(data.subarray(0, nul)), text: latin1(data.subarray(nul + 1)) })
    } else if (type === 'iTXt') {
      const chunk = await readITxt(data)
      if (chunk) chunks.push(chunk)
    } else if (type === 'IEND') {
      break
    }
    pos = end + 4
  }
  return chunks
}

async function readITxt(data: Uint8Array): Promise<TextChunk | null> {
  // keyword \0 compressionFlag compressionMethod languageTag \0 translatedKeyword \0 text
  const k = data.indexOf(0)
  if (k <= 0 || k + 3 > data.length) return null
  const keyword = latin1(data.subarray(0, k))
  const compressed = data[k + 1] === 1
  const lang = data.indexOf(0, k + 3)
  if (lang < 0) return null
  const trans = data.indexOf(0, lang + 1)
  if (trans < 0) return null
  let body = data.subarray(trans + 1)
  if (compressed) {
    // Only decompress the chunks a card can live in.
    if (keyword !== 'chara' && keyword !== 'ccv3') return { keyword, text: '' }
    body = await inflate(body)
  }
  return { keyword, text: new TextDecoder('utf-8', { fatal: false }).decode(body) }
}

function decodeBase64Json(text: string): string {
  const clean = text.replace(/\s+/g, '')
  if (clean.length * 0.75 > MAX_CARD_JSON_BYTES) throw new CardError('This character card is too large.')
  let bin: string
  try {
    bin = atob(clean)
  } catch {
    throw new CardError('The card data in this image is damaged.')
  }
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

/** The card inside a PNG. A v3 chunk wins over a v2 one, as in SillyTavern. */
export async function parseCardPng(bytes: Uint8Array): Promise<ParsedCard> {
  const chunks = await readPngTextChunks(bytes)
  const found = chunks.find((c) => c.keyword === 'ccv3') ?? chunks.find((c) => c.keyword === 'chara')
  if (!found) throw new CardError('This image has no character card inside.')
  const json = decodeBase64Json(found.text)
  if (found.keyword === 'ccv3') {
    try {
      return parseCardJson(json)
    } catch (err) {
      // A broken v3 chunk next to a good v2 one: fall back like SillyTavern.
      const v2 = chunks.find((c) => c.keyword === 'chara')
      if (!v2) throw err
      return parseCardJson(decodeBase64Json(v2.text))
    }
  }
  return parseCardJson(json)
}

/** Read a picked file, PNG or JSON, by its bytes rather than its name. */
export async function parseCardFile(bytes: Uint8Array): Promise<ParsedCard> {
  if (bytes.length === 0) throw new CardError('This file is empty.')
  if (bytes.length > MAX_CARD_FILE_BYTES) throw new CardError('This file is larger than 20 MB.')
  if (isPng(bytes)) return parseCardPng(bytes)
  if (bytes.length > MAX_CARD_JSON_BYTES) throw new CardError('This character card is too large.')
  return parseCardJson(new TextDecoder('utf-8', { fatal: false }).decode(bytes))
}

// ── Prompt and greeting ──────────────────────────────────────────────────

/**
 * Replace the macros a card uses. `{{char}}` and `{{user}}`, plus the v1
 * spellings `<BOT>` and `<USER>`, all case insensitive.
 */
export function substituteMacros(text: string, charName: string, userName: string): string {
  return text
    .replace(/\{\{\s*char\s*\}\}|<bot>/gi, () => charName)
    .replace(/\{\{\s*user\s*\}\}|<user>/gi, () => userName)
}

/** Example dialogue blocks split on SillyTavern's `<START>` marker. */
function exampleBlocks(mesExample: string): string[] {
  return mesExample
    .split(/<START>/i)
    .map((b) => b.trim())
    .filter(Boolean)
}

/**
 * The persona's system prompt, built once on import and kept with its macros
 * so the user can still edit it like any other persona. Order as in
 * SillyTavern's default story string: system prompt (or the standard
 * sentence), description, personality, scenario, example dialogue. The
 * post history instructions close the prompt, since LU has no slot after the
 * history; see the report of the change.
 */
export function buildCardSystemPrompt(card: CharacterCard): string {
  const system = card.systemPrompt.trim()
    ? card.systemPrompt.replace(/\{\{\s*original\s*\}\}/gi, DEFAULT_RP_SYSTEM_PROMPT).trim()
    : DEFAULT_RP_SYSTEM_PROMPT
  const parts = [system]
  if (card.description.trim()) parts.push(card.description.trim())
  if (card.personality.trim()) parts.push(`{{char}}'s personality: ${card.personality.trim()}`)
  if (card.scenario.trim()) parts.push(`Scenario: ${card.scenario.trim()}`)
  const examples = exampleBlocks(card.exampleMessages)
  if (examples.length) {
    parts.push(`Example dialogue between {{char}} and {{user}}:\n\n${examples.join('\n\n')}`)
  }
  const post = card.postHistoryInstructions.replace(/\{\{\s*original\s*\}\}/gi, '').trim()
  if (post) parts.push(post)
  return parts.join('\n\n')
}

/** The greetings a new chat can open with: first_mes, then the alternates. */
export function cardGreetings(card: CharacterCard, charName: string, userName: string): string[] {
  return [card.firstMessage, ...card.alternateGreetings]
    .filter((g) => g.trim() !== '')
    .map((g) => substituteMacros(g, charName, userName))
}

/**
 * What a new chat with this persona starts from, or null for a persona that
 * is not a character card (or whose stored card is unreadable).
 */
export function cardChatStart(
  persona: Pick<Persona, 'name' | 'systemPrompt' | 'card'>,
  userName: string = DEFAULT_USER_NAME,
): { systemPrompt: string; greetings: string[] } | null {
  const card = normalizeCard(persona.card)
  if (!card) return null
  return {
    systemPrompt: substituteMacros(persona.systemPrompt, persona.name, userName),
    greetings: cardGreetings(card, persona.name, userName),
  }
}

/** A new persona from a parsed card. */
export function personaFromCard(parsed: ParsedCard, id: string, imageDataUrl?: string): Persona {
  const persona: Persona = {
    id,
    name: parsed.name,
    icon: 'MessageCircle',
    systemPrompt: buildCardSystemPrompt(parsed.card),
    isBuiltIn: false,
    card: parsed.card,
  }
  if (imageDataUrl) persona.imageDataUrl = imageDataUrl
  // GH #181: SillyTavern's character depth prompt is the same thing as a
  // persona's reminder, so a card that carries one brings it along. The
  // depth is clamped where it is used (lib/persona-note.ts).
  const depthPrompt = parsed.card.extensions?.depth_prompt
  if (isObj(depthPrompt) && typeof depthPrompt.prompt === 'string' && depthPrompt.prompt.trim()) {
    persona.note = depthPrompt.prompt.trim()
    if (typeof depthPrompt.depth === 'number' && Number.isFinite(depthPrompt.depth)) persona.noteDepth = Math.round(depthPrompt.depth)
  }
  return persona
}

// ── Export ───────────────────────────────────────────────────────────────

/** GH #181: the persona's reminder goes out as the card's depth prompt, so
 *  an edit in LU travels with the card. Without a reminder the card's own
 *  extensions go out as they came in. */
function withDepthPrompt(
  extensions: Record<string, unknown>,
  persona: Pick<Persona, 'note' | 'noteDepth'>,
): Record<string, unknown> {
  const note = persona.note?.trim()
  if (!note) return extensions
  const prev = isObj(extensions.depth_prompt) ? extensions.depth_prompt : {}
  return { ...extensions, depth_prompt: { role: 'system', ...prev, prompt: note, depth: persona.noteDepth ?? 4 } }
}

/** The persona as a chara_card_v2 object. The lorebook is not carried. */
export function personaToCardV2(persona: Pick<Persona, 'name' | 'systemPrompt' | 'card' | 'note' | 'noteDepth'>): Record<string, unknown> {
  const card = normalizeCard(persona.card)
  if (!card) throw new CardError('This persona is not a character card.')
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: persona.name,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      first_mes: card.firstMessage,
      mes_example: card.exampleMessages,
      creator_notes: card.creatorNotes,
      system_prompt: card.systemPrompt,
      post_history_instructions: card.postHistoryInstructions,
      alternate_greetings: card.alternateGreetings,
      tags: card.tags ?? [],
      creator: card.creator ?? '',
      character_version: card.characterVersion ?? '',
      extensions: withDepthPrompt(card.extensions ?? {}, persona),
    },
  }
}

export function personaToCardJson(persona: Pick<Persona, 'name' | 'systemPrompt' | 'card'>): string {
  return JSON.stringify(personaToCardV2(persona), null, 2)
}

/** A file name for the export: the character's name, safe on every OS. */
export function cardFileName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_').slice(0, 60)
  return `${safe || 'character'}.json`
}
