#!/usr/bin/env node
/**
 * Write translated groups back into the dictionary.
 *
 *   node scripts/i18n-apply.mjs --in=translations.json
 *   node scripts/i18n-apply.mjs --in=translations.json --dry-run
 *
 * Two kinds of group arrive here:
 *
 *   sentence  — fixed copy. The translated sentence is split on `[[n]]` and one
 *               dictionary entry is written per fragment, because the runtime
 *               bridge replaces one text node at a time.
 *   template  — assembled at runtime (`Details for ${name}`). It cannot be a
 *               key; it becomes a pattern `Details for {0}` and the runtime
 *               matches the shape.
 *
 * Everything is validated before a single byte is written: a group whose answer
 * has the wrong number of pieces, an empty piece, or a lost placeholder is
 * skipped and reported, never merged. The app keeps its English for that one
 * sentence, which is the safe outcome.
 */
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DICT = join(root, 'src', 'lib', 'i18n', 'zh-CN.ts')
const SLOT = /\[\[(\d+)\]\]/g

/** `--in=x` and `--in x` both work: the workflow writes one, a person the other. */
const arg = (name) => {
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (withEquals) return withEquals.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}
const IN = arg('in')
if (!IN) {
  console.error('用法: node scripts/i18n-apply.mjs --in=translations.json [--dry-run]')
  process.exit(2)
}
const dryRun = process.argv.includes('--dry-run')

const payload = JSON.parse(await readFile(IN, 'utf8'))
const results = payload.results ?? []
const groupList = payload.groups ?? []
const byId = new Map(groupList.map((group) => [group.id, group]))

const dictUrl = new URL(`file://${DICT.replace(/\\/g, '/')}`).href
const module = await import(dictUrl).catch(() => ({}))
const current = { ...(module.ZH_CN ?? {}) }
const patterns = new Map(module.ZH_PATTERNS ?? [])

/**
 * A pattern is applied to every text node, so a bad one is worse than a
 * missing one. Same rules as the extractor: short UI copy only, never a
 * prompt paragraph, never a query string or a path.
 */
function isUsablePattern(key, value) {
  const staticText = key.replace(/\{\d+\}/g, ' ')
  if (staticText.length > 300) return false
  if (/:\/\//.test(staticText)) return false
  if (/[?&][a-z_]+=/.test(staticText)) return false
  if (/^[.?&/]/.test(staticText.trim())) return false
  if (!/[A-Za-z]{2}/.test(staticText)) return false
  // A pattern that maps a string to itself does nothing at runtime: the bridge
  // writes the same text back. It also costs real money in review: every entry
  // sits in `src/lib/i18n/zh-CN.ts`, and that file is scanned as UI copy by
  // `die-typo-leiter-und-ihre-umgehung.test.ts` — `text-[0.55rem] {0}` was the
  // 821st arbitrary font size in a tree upstream caps at 820, and it failed the
  // 3.0.8 release gate.
  if (key === value) return false
  // The same reasoning for a pattern that is nothing but a Tailwind arbitrary
  // value plus a slot: not copy, never displayed as a sentence.
  const cssOnly = /^\s*(?:[a-z-]+:)?(?:text|bg|border|rounded|p[xytrbl]?|m[xytrbl]?|w|h|gap|inset|z|top|left|right|bottom|opacity|shadow|ring|leading|tracking|font)-\[[^\]]*\]\s*$/
  if (cssOnly.test(staticText)) return false
  return placeholders(key) === placeholders(value)
}

const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join(',')
const toPattern = (text) => text.replace(SLOT, (_, index) => `{${index}}`).trim()

/** A translation that carries no Chinese at all, for a source that does carry
 *  letters, is a fragment artefact ("(The" → "（"): the model translated a
 *  sentence stub and dropped content. Keeping the English is the safe call. */
const CJK = /[\u3400-\u9fff]/
function isFragmentArtefact(key, value) {
  if (CJK.test(value)) return false
  if (!/[A-Za-z]/.test(key)) return false
  return value !== key
}

const skipped = []
let added = 0
let updated = 0
let patternsAdded = 0
let patternsUpdated = 0
let patternsPruned = 0
let pruned = 0

for (const result of results) {
  const group = byId.get(result.id)
  if (!group) {
    skipped.push({ id: result.id, why: 'unknown group id' })
    continue
  }
  const answer = String(result.text ?? '').trim()
  if (!answer) {
    skipped.push({ id: result.id, why: 'empty answer' })
    continue
  }

  // ── template: a pattern, not a dictionary entry ────────────────────────
  if (group.kind === 'template') {
    const key = toPattern(group.sentence)
    const value = toPattern(answer)
    if (!key.includes('{')) {
      skipped.push({ id: result.id, why: 'template without a slot' })
      continue
    }
    if (!isUsablePattern(key, value)) {
      skipped.push({ id: result.id, why: `unusable pattern: ${key.slice(0, 60)}` })
      continue
    }
    if (isFragmentArtefact(key, value)) {
      skipped.push({ id: result.id, why: 'fragment artefact' })
      continue
    }
    if (patterns.has(key)) patternsUpdated += 1
    else patternsAdded += 1
    patterns.set(key, value)
    continue
  }

  // ── sentence: one entry per fragment ───────────────────────────────────
  const pieces = answer.split(SLOT).filter((_, index) => index % 2 === 0)
  if (pieces.length !== group.fragments.length) {
    skipped.push({ id: result.id, why: `expected ${group.fragments.length} pieces, got ${pieces.length}` })
    continue
  }

  const next = {}
  let bad = false
  group.fragments.forEach((fragment, index) => {
    const piece = pieces[index].trim()
    if (!piece) {
      skipped.push({ id: result.id, why: `empty piece ${index}` })
      bad = true
      return
    }
    if (placeholders(fragment) !== placeholders(piece)) {
      skipped.push({ id: result.id, why: `placeholder mismatch in "${fragment}"` })
      bad = true
      return
    }
    if (isFragmentArtefact(fragment, piece)) {
      skipped.push({ id: result.id, why: `fragment artefact: "${fragment}" → "${piece}"` })
      bad = true
      return
    }
    next[fragment] = piece
  })
  if (bad) continue

  for (const [key, value] of Object.entries(next)) {
    if (current[key] === value) continue
    if (key in current) updated += 1
    else added += 1
    current[key] = value
  }
}

// Entries written by earlier runs keep the artefact rule too: a dictionary that
// already contains "(The" → "（" would keep applying it everywhere.
for (const [key, value] of Object.entries(current)) {
  if (!isFragmentArtefact(key, value)) continue
  delete current[key]
  pruned += 1
}

/**
 * This repository carries German in comments and in the patterns that read what
 * a user typed. Such a string is a matcher, not interface copy: translating it
 * is wrong and it trips the "no German sentences in the UI" guard.
 */
const GERMAN_WORDS =
  /\b(der|die|das|den|dem|des|und|oder|nicht|kein|keine|mit|für|auf|ist|sind|wird|werden|kann|können|muss|sollen|bitte|einen|eine|einem|einer|wenn|dass|dieser|diese|dieses|noch|auch|nur|schon|jetzt|hier|dort)\b/gi

function looksGerman(text) {
  if (/[äöüß]/i.test(text)) return true
  const hits = new Set((text.match(GERMAN_WORDS) ?? []).map((word) => word.toLowerCase()))
  return hits.size >= 3
}

function isMatcher(text) {
  return /\(\?:|\\[bwsd]|\[\^|\\s\+/.test(text)
}

const CSS_TOKEN =
  /(?<![\w-])(?:flex|grid|inline-flex|hidden|absolute|relative|items-(?:center|start|end|stretch)|justify-(?:center|between|start|end)|gap-[0-9.]+|(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|w|h)-[0-9.[\]a-z-]+|rounded[\w-]*|border[\w-]*|shadow[\w-]*|font-(?:medium|semibold|bold|mono)|leading-\w+|tracking-\w+|transition[\w-]*|(?:hover|dark|focus|active|disabled):)/g

function looksLikeClasses(text) {
  return (text.match(CSS_TOKEN) ?? []).length >= 2
}

/** "Qwen 3.6 35B MoE" is a model name; translating it breaks the catalogue. */
function looksLikeName(text) {
  if (/^(?:[A-Z0-9][\w.+-]*)(?:\s+[A-Z0-9][\w.+-]*)+$/.test(text)) return true
  return /\b\d+(?:\.\d+)?\s*[BT]\b/.test(text) && !/[a-z]{4}/.test(text)
}

function isUsableKey(key) {
  return !looksGerman(key) && !isMatcher(key) && !looksLikeClasses(key) && !looksLikeName(key)
}

// Entries written by an earlier run are held to today's rules as well.
for (const [key, value] of Object.entries(current)) {
  // A translation identical to its key does nothing at runtime (the bridge
  // would write the same text back) and only bloats the table.
  if (key === value) {
    delete current[key]
    pruned += 1
    continue
  }
  if (isUsableKey(key)) continue
  delete current[key]
  pruned += 1
}

for (const [key, value] of [...patterns]) {
  if (isUsablePattern(key, value) && isUsableKey(key)) continue
  patterns.delete(key)
  patternsPruned += 1
}

const keys = Object.keys(current).sort()
const body = keys.map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(current[k]) + ',').join('\n')
const patternKeys = [...patterns.keys()].sort()
const patternBody = patternKeys
  .map((key) => `  [${JSON.stringify(key)}, ${JSON.stringify(patterns.get(key))}],`)
  .join('\n')

const file = `// GENERATED FILE — do not edit by hand.
// Written by scripts/i18n-apply.mjs. Keys are the English text the app renders,
// values are the Chinese copy. A key that is missing here stays English at
// runtime (the bridge never guesses), which is why adding a translation is
// never able to break a screen.
export const ZH_CN: Record<string, string> = {
${body}
}

/**
 * Dynamic strings. \`{0}\`, \`{1}\` … are captured from the rendered text and
 * substituted back, so a count or a name inside a sentence still matches.
 */
export const ZH_PATTERNS: ReadonlyArray<readonly [string, string]> = [
${patternBody}
]
`

console.log(
  `新增 ${added}  更新 ${updated}  跳过 ${skipped.length}  剔除 ${pruned}  ` +
    `模式 +${patternsAdded}/~${patternsUpdated}/-${patternsPruned}  合计词条 ${keys.length}，模式 ${patternKeys.length}`,
)
for (const s of skipped.slice(0, 15)) console.log(`  跳过 ${s.id}: ${s.why}`)
if (skipped.length > 15) console.log(`  …还有 ${skipped.length - 15} 条`)

if (dryRun) {
  console.log('--dry-run：未写入')
} else {
  // Write next to the target and rename over it. Writing the target directly
  // truncates it first, and on Windows a locked file (an editor, a virus
  // scanner) then leaves an empty dictionary behind — the app would boot with
  // no translations at all.
  const tmp = `${DICT}.tmp`
  let written = false
  let lastError = null
  for (let attempt = 1; attempt <= 6 && !written; attempt += 1) {
    try {
      await writeFile(tmp, file, 'utf8')
      await rename(tmp, DICT)
      written = true
    } catch (error) {
      lastError = error
      await unlink(tmp).catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt))
    }
  }
  if (!written) throw lastError
  console.log(`已写入 ${DICT}`)
}
