/**
 * Extra provider slots for backends that speak the OpenAI protocol.
 *
 * The store used to have exactly one such slot (`openai`), shared by the
 * built-in engine, LM Studio and every hosted API. A phone pins that slot to
 * the on device engine, so a hosted provider with the user's own key
 * (OpenRouter, Groq, ...) had no place at all. An extra slot has an id of
 * the form `openai-<slug>`: the prefix says which protocol it speaks, the
 * slug says which saved provider it is.
 *
 * No runtime import on purpose, like model-name.ts: every module that only
 * needs to ask "which kind of slot is this" can do so without pulling in the
 * store or a client class.
 */

export type CompatProviderId = `openai-${string}`

const COMPAT_ID = /^openai-[a-z0-9][a-z0-9-]{0,47}$/

/** True for the id of an extra OpenAI-compatible slot, never for `openai`. */
export function isCompatProviderId(id: string): id is CompatProviderId {
  return COMPAT_ID.test(id)
}

/**
 * The slot id for a slug. The slug is lower-cased and everything outside
 * a to z, 0 to 9 and the hyphen becomes a hyphen. Returns null when nothing
 * usable is left, so a caller can never create a slot named `openai-`.
 */
export function compatProviderId(slug: string): CompatProviderId | null {
  const clean = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  if (!clean) return null
  return `openai-${clean}`
}

/**
 * Which wire protocol a slot speaks. Everything that branches on "is this
 * the OpenAI protocol" asks here instead of comparing with `openai`, so an
 * extra slot takes the same path as the shared one.
 */
export function speaksOpenAIProtocol(id: string): boolean {
  return id === 'openai' || id === 'lu-cloud' || isCompatProviderId(id)
}
