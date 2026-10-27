/**
 * The ONE list of spellings by which a name says "this model does not
 * refuse": abliterated, uncensored and what else the model hubs call it.
 *
 * A model from outside the phone catalogue carries no mark of ours, so a
 * store build can only read its name: the repository of a search hit, a file
 * name, an address. Whatever needs that reading asks `namesUnfiltered` here
 * and keeps no list of its own (held by policy/__tests__/unfiltered-names.test.ts,
 * which also goes through the rest of src/mobile and looks for a second list).
 *
 * Second check on Android, F10: the list knew "abliterated" and not
 * "lorablated", so three such repositories were offered in a store build.
 * A list of names is a net and stays one. A name that says nothing passes;
 * that is closed by the catalogue (`customModelUrl`), not by this file.
 *
 * Imports nothing, so everything may import it.
 */

export interface UnfilteredSpelling {
  /** What the spelling stands for, in the words of the hubs. */
  what: string
  /** Found anywhere in the name, whatever stands around it. Lower case, as a regular expression. */
  part?: string
  /** Found only as a word of its own, between separators ("ERP" in "Foo-ERP-7B", not in "Serpent"). Lower case. */
  word?: string
  /** A name that carries it, the way a hub writes it. The tests and both store guards are held against these. */
  sample: string
  /**
   * Also an everyday word ("unlocked", "no limits") or the proper name of a
   * model line ("Dolphin"). A name is still judged by it. The guards that
   * read the text on screen (e2e/mobile/store-rules.ts,
   * mobile-tests/checks/storeworte.mjs) do not look for it, or every page
   * that says "unlocked" would be a finding.
   */
  everyday?: true
}

export const UNFILTERED_SPELLINGS: readonly UnfilteredSpelling[] = [
  // ---- the refusal direction taken out of the weights ----
  { what: 'abliterated, abliteration', part: 'abliterat', sample: 'huihui-ai/Qwen3-4B-abliterated-GGUF' },
  { what: 'ablated, ablation, lorablated (abliteration as a LoRA), orthoablated', part: 'ablat', sample: 'mlabonne/Hermes-3-Llama-3.1-8B-lorablated-GGUF' },
  { what: 'abl, the short form in file names', word: 'abl', sample: 'gemma-3-4b-it-abl.Q4_K_M.gguf' },
  { what: 'obliterated, Obliteratus', part: 'obliterat', sample: 'x/Llama-3.2-3B-OBLITERATED-GGUF' },
  { what: 'orthogonalized (the same method under its first name)', part: 'orthogonal', sample: 'x/Phi-3-mini-4k-instruct-orthogonalized-GGUF' },
  { what: 'ortho, its short form', word: 'ortho', sample: 'x/Llama-3-8B-Instruct-ortho-v2-GGUF' },
  { what: 'Heretic (a tool that does it), heretic builds', part: 'heretic', sample: 'x/gemma-3-12b-it-heretic-GGUF' },
  { what: 'derestricted', part: 'derestrict', sample: 'x/Gemma-3-27B-Derestricted-GGUF' },
  { what: 'refusal direction removed, refusal free, zero refusal', part: 'refusal[-_ .]?(free|removed)|(zero|non|un)[-_ .]?refus', sample: 'x/Qwen3-4B-refusal-free-GGUF' },
  // ---- said as a property ----
  { what: 'uncensored, uncensor, un-censored', part: 'un[-_ .]?censor', sample: 'x/WizardLM-7B-Uncensored-GGUF' },
  { what: 'decensored, de-censored', part: 'de[-_ .]?censor', sample: 'x/gemma-3-4b-it-decensored-GGUF' },
  { what: 'unfiltered, un-filtered', part: 'un[-_ .]?filter', sample: 'x/Mistral-7B-Unfiltered-GGUF' },
  { what: 'no-refusals, no_refusal, norefuse (also written with a blank)', part: 'no[-_ .]?refus', sample: 'x/Llama-3.2-3B-no-refusals-GGUF' },
  { what: 'no filter, nofilter', part: 'no[-_ .]?filter', sample: 'x/Qwen3-4B-NoFilter-GGUF' },
  { what: 'no limits, no restrictions, no guardrails, no censorship', part: 'no[-_ .]?(limit|restrict|guardrail|censor)', sample: 'x/Llama-3-8B-NoLimits-GGUF', everyday: true },
  { what: 'unrestricted', part: 'unrestrict', sample: 'x/Qwen3-8B-Unrestricted-GGUF', everyday: true },
  { what: 'unaligned', part: 'unalign', sample: 'x/Mistral-7B-unaligned-GGUF', everyday: true },
  { what: 'unhinged', part: 'unhinged', sample: 'x/L3-8B-Unhinged-GGUF', everyday: true },
  { what: 'unchained', part: 'unchain', sample: 'x/Llama-3-Unchained-8B-GGUF', everyday: true },
  { what: 'unshackled', part: 'unshackl', sample: 'x/Phi-4-unshackled-GGUF', everyday: true },
  { what: 'unlocked', part: 'unlocked', sample: 'x/Gemma-2-2b-unlocked-GGUF', everyday: true },
  { what: 'jailbroken, jailbreak', part: 'jail[-_ .]?br', sample: 'x/Llama-3.2-1B-Jailbroken-GGUF' },
  // ---- adult content named in the name ----
  { what: 'NSFW', part: 'nsfw', sample: 'x/Mistral-Nemo-NSFW-12B-GGUF' },
  { what: 'ERP (erotic role play)', word: 'erp', sample: 'x/Llama-3-8B-ERP-GGUF' },
  { what: 'erotic, erotica', part: 'erotic', sample: 'x/Erotica-Writer-7B-GGUF' },
  { what: 'lewd', part: 'lewd', sample: 'x/L3-8B-Lewd-Maid-GGUF' },
  { what: 'smut', word: 'smut', sample: 'x/Smut-Writer-7B-GGUF' },
  { what: 'hentai', part: 'hentai', sample: 'x/Hentai-Story-3B-GGUF' },
  { what: 'porn', part: 'porn', sample: 'x/Porn-Writer-3B-GGUF' },
  { what: 'XXX', word: 'xxx', sample: 'x/Llama-3-XXX-8B-GGUF' },
  // ---- model lines that are trained or tuned not to refuse ----
  { what: 'Dolphin', part: 'dolphin', sample: 'bartowski/Dolphin3.0-Llama3.2-1B-GGUF', everyday: true },
  { what: 'Lexi', word: 'lexi', sample: 'x/Llama-3-8B-Lexi-V2-GGUF', everyday: true },
  { what: 'JOSIEFIED', part: 'josiefied', sample: 'x/JOSIEFIED-Qwen3-4B-GGUF', everyday: true },
  { what: 'Tiger Gemma', part: 'tiger[-_ .]?gemma', sample: 'x/Tiger-Gemma-9B-v3-GGUF', everyday: true },
  { what: 'DarkIdol', part: 'darkidol', sample: 'x/Llama-3.1-8B-DarkIdol-GGUF', everyday: true },
  { what: 'Lumimaid', part: 'lumimaid', sample: 'x/Lumimaid-v0.2-8B-GGUF', everyday: true },
]

const PARTS = new RegExp(UNFILTERED_SPELLINGS.flatMap((s) => (s.part ? [`(?:${s.part})`] : [])).join('|'), 'i')
const WORDS: ReadonlySet<string> = new Set(UNFILTERED_SPELLINGS.flatMap((s) => (s.word ? [s.word] : [])))

/**
 * Pure: does this name say that the model is abliterated, uncensored or
 * unfiltered. Judged by the name alone: a repository, a file name, an
 * address, the name a catalogue shows.
 */
export function namesUnfiltered(name: string | null | undefined): boolean {
  if (!name) return false
  if (PARTS.test(name)) return true
  // "Foo-ERP-7B", "foo_erp.Q4_K_M.gguf", "FooERP": a word of its own, also where only the case sets it off.
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
  return words.some((word) => WORDS.has(word))
}

const STRICT = UNFILTERED_SPELLINGS.filter((s) => !s.everyday)
/** The whole word a spelling stands in: "Abliterated", "no-refusals", "Un-Censored", "decensored". */
const STRICT_PARTS = new RegExp(`[a-z0-9]*(?:${STRICT.flatMap((s) => (s.part ? [`(?:${s.part})`] : [])).join('|')})[a-z0-9]*`, 'gi')
// No lookbehind: an old WebView does not know it. The character in front is matched and put back.
const STRICT_WORDS = new RegExp(`(^|[^a-z0-9])(?:${STRICT.flatMap((s) => (s.word ? [s.word] : [])).join('|')})(?![a-z0-9])`, 'gi')

/**
 * Pure: does this text carry one of the spellings no store build may show.
 * Narrower than `namesUnfiltered`: the everyday words and the proper names
 * of model lines ("unlocked", "Dolphin") do not count, exactly as the store
 * guards do not look for them.
 */
export function carriesUnfilteredWord(text: string | null | undefined): boolean {
  if (!text) return false
  STRICT_PARTS.lastIndex = 0
  STRICT_WORDS.lastIndex = 0
  if (STRICT_PARTS.test(text) || STRICT_WORDS.test(text)) return true
  // "FooERP": a word that only the case sets off.
  const split = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  STRICT_WORDS.lastIndex = 0
  return STRICT_WORDS.test(split)
}

/**
 * Pure: a display name without the words, tidied: no doubled blanks, no
 * empty brackets, no separator left hanging at an end or doubled in the
 * middle. "Qwen3 8B Abliterated" reads "Qwen3 8B", "Llama 3 (Uncensored) 8B"
 * reads "Llama 3 8B", "NSFW-Flux XL" reads "Flux XL".
 *
 * Empty when nothing of the name is left, or when a word is still in it that
 * this tidy cut cannot take out. The caller then shows a name of its own.
 */
export function withoutUnfilteredWords(name: string): string {
  let out = name
  out = out.replace(STRICT_PARTS, ' ').replace(STRICT_WORDS, '$1 ')
  // Brackets that held nothing else, then separators that lost a neighbour.
  out = out.replace(/[([{][\s,;:._/|+-]*[)\]}]/g, ' ')
  out = out.replace(/\s+([,;:.)\]}])/g, '$1').replace(/([([{])\s+/g, '$1')
  out = out.replace(/([-_/|+,;:])(?:\s*[-_/|+,;:])+/g, '$1')
  out = out.replace(/\s[-_/|+,;:]+(?=\s|$)/g, ' ').replace(/(^|\s)[-_/|+,;:]+\s/g, '$1')
  out = out.replace(/\s+/g, ' ').replace(/^[\s\-_/|+,;:.]+|[\s\-_/|+,;:]+$/g, '').trim()
  return out && !carriesUnfilteredWord(out) ? out : ''
}
