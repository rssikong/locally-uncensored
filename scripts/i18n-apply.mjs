#!/usr/bin/env node
/**
 * Write translated groups back into the dictionary.
 *
 *   node scripts/i18n-apply.mjs --in=translations.json
 *   node scripts/i18n-apply.mjs --in=translations.json --dry-run
 *   node scripts/i18n-apply.mjs --sweep [--dry-run]      只做术语归一与裁剪，不接译文
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
import { readFileSync } from 'node:fs'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadTerms, normalizeValue } from './lib/i18n-terms.mjs'

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
const sweepOnly = process.argv.includes('--sweep')
if (!IN && !sweepOnly) {
  console.error('用法: node scripts/i18n-apply.mjs --in=translations.json [--dry-run]')
  console.error('      node scripts/i18n-apply.mjs --sweep [--dry-run]   只做术语归一与裁剪')
  process.exit(2)
}
const dryRun = process.argv.includes('--dry-run')

const payload = IN ? JSON.parse(await readFile(IN, 'utf8')) : { results: [], groups: [] }
const results = payload.results ?? []
const groupList = payload.groups ?? []
const byId = new Map(groupList.map((group) => [group.id, group]))

const dictUrl = new URL(`file://${DICT.replace(/\\/g, '/')}`).href
const module = await import(dictUrl).catch(() => ({}))
const current = { ...(module.ZH_CN ?? {}) }
const patterns = new Map(module.ZH_PATTERNS ?? [])

/**
 * Hand-maintained corrections. This script never writes them: a key that lives
 * in `overrides.ts` is skipped here, so the pipeline cannot retranslate it away
 * or prune it. Reading the file only to stay out of its way is the point.
 */
const overridesUrl = new URL(
  `file://${join(root, 'src', 'lib', 'i18n', 'overrides.ts').replace(/\\/g, '/')}`,
).href
let overrideModule
try {
  overrideModule = await import(overridesUrl)
} catch (error) {
  // fail-closed，和 i18n-check 同一个理由：文件缺失不能退化成空对象 ——
  // 那会让流水线以为没有手动词条，下一次翻译把它们全部覆盖掉。
  console.error(`i18n-apply: 无法加载 src/lib/i18n/overrides.ts（${error.message}）`)
  process.exit(1)
}
const overrides = new Set(Object.keys(overrideModule.ZH_OVERRIDES ?? {}))

/**
 * 术语表。加载失败就停：一张被读成空的表会让归一悄悄失效，而门禁仍然是绿的 ——
 * 和 overrides 的 fail-closed 同一个理由。
 */
const TERMS = join(root, 'src', 'lib', 'i18n', 'terms.json')
let terms
try {
  terms = loadTerms(readFileSync, TERMS)
} catch (error) {
  console.error(`i18n-apply: ${error.message}`)
  process.exit(1)
}

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

/**
 * Letters or Chinese — what makes a fragment a *word* rather than a separator.
 *
 * The mirror image of the rule above. A fragment with no word of its own is
 * punctuation (`·`, `(`, `…`), and the model still answers it as if it were a
 * sentence: `·` came back as `· 已选`, `.` as `的文件。`. Written into the
 * dictionary that is worse than a mistranslation, because the bridge matches a
 * text node on its trimmed content and `{a} · {b}` in JSX renders exactly the
 * text node `" · "` — trimmed to `·`. Every separator in the UI would read
 * `· 已选`. Punctuation may become its full-width twin and nothing more, so
 * length is the honest test: one character in, one character out, or no entry.
 */
const HAS_WORD = /[A-Za-z\u3400-\u9fff]/
function isPunctuationBloat(key, value) {
  if (HAS_WORD.test(key)) return false
  return value.replace(/\s+/g, '').length > key.replace(/\s+/g, '').length
}

/**
 * A single word may not come back as a phrase.
 *
 * Fragment groups are split at the DOM slots, and Chinese word order moves
 * content across those boundaries: `Delete [[0]] from the LoRA folder?` puts the
 * whole verb phrase into the slot that held "Delete". Correct for that sentence,
 * wrong for the dictionary — the key is the bare word, the bridge matches it on
 * every screen, and "Delete" is a button label and a tooltip in eight places.
 * All eight read "从 LoRA 文件夹删除".
 *
 * The cut is measured, not aesthetic: of the 185 keys with no whitespace, four
 * grew by five characters or more and all four were this artefact.
 */
const WORD_MAX_GROWTH = 4
function isWordFragmentBloat(key, value) {
  if (/\s/.test(key)) return false
  if (!/[A-Za-z]/.test(key)) return false
  if (key.length > 12) return false
  return value.length - key.length > WORD_MAX_GROWTH
}

function isFragmentArtefact(key, value) {
  if (isPunctuationBloat(key, value)) return true
  if (isWordFragmentBloat(key, value)) return true
  if (CJK.test(value)) return false
  if (!/[A-Za-z]/.test(key)) return false
  return value !== key
}

const skipped = []
const prunedKeys = []
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
    // 归一放在 artefact 判定之后重新跑一次：改写可能改变长度，
    // 而长度正是 isWordFragmentBloat 的判据。
    const normalizedPattern = normalizeValue(key, value, terms).value
    if (isFragmentArtefact(key, normalizedPattern)) {
      skipped.push({ id: result.id, why: 'fragment artefact（归一后）' })
      continue
    }
    if (patterns.has(key)) patternsUpdated += 1
    else patternsAdded += 1
    patterns.set(key, normalizedPattern)
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
    // 术语归一发生在落盘之前，所以新译文产出即合规，不需要事后补救。
    // 归一后必须重跑那两条判定：改写会改长度（代理→智能体），也可能碰上占位符。
    const normalizedPiece = normalizeValue(fragment, piece, terms).value
    if (normalizedPiece !== piece) {
      if (placeholders(fragment) !== placeholders(normalizedPiece)) {
        skipped.push({ id: result.id, why: `归一后占位符不一致: "${fragment}"` })
        bad = true
        return
      }
      if (isFragmentArtefact(fragment, normalizedPiece)) {
        skipped.push({ id: result.id, why: `归一后成了碎片: "${fragment}"` })
        bad = true
        return
      }
    }
    next[fragment] = normalizedPiece
  })
  if (bad) continue

  for (const [key, value] of Object.entries(next)) {
    // A hand-maintained translation wins at runtime, so writing the machine's
    // version underneath it would only leave a line that never takes effect.
    if (overrides.has(key)) {
      skipped.push({ id: result.id, why: `opts out: "${key}" is hand-maintained` })
      continue
    }
    if (current[key] === value) continue
    if (key in current) updated += 1
    else added += 1
    current[key] = value
  }
}

/**
 * 术语归一（存量）。新译文在落盘前已经归一过，这一段是让历史数据自愈：
 * 改了 terms.json 不需要有人记得手动跑 `--sweep`，也不依赖"上次跑是什么时候"。
 * 幂等 —— 归一后的值里不再含变体，再跑一次不会有任何改动。
 */
let normalizedEntries = 0
const normalizedKeys = []
for (const [key, value] of Object.entries(current)) {
  const result = normalizeValue(key, value, terms)
  if (result.changes.length === 0) continue
  current[key] = result.value
  normalizedEntries += 1
  normalizedKeys.push({ key, from: value, to: result.value })
}

let normalizedPatterns = 0
for (const [key, value] of [...patterns]) {
  const result = normalizeValue(key, value, terms)
  if (result.changes.length === 0) continue
  patterns.set(key, result.value)
  normalizedPatterns += 1
}

// Entries written by earlier runs keep the artefact rule too: a dictionary that
// already contains "(The" → "（" would keep applying it everywhere.
for (const [key, value] of Object.entries(current)) {
  if (!isFragmentArtefact(key, value)) continue
  delete current[key]
  prunedKeys.push(key)
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
    prunedKeys.push(key)
    pruned += 1
    continue
  }
  if (isUsableKey(key)) continue
  delete current[key]
  prunedKeys.push(key)
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
    `归一 ${normalizedEntries}+${normalizedPatterns}  ` +
    `模式 +${patternsAdded}/~${patternsUpdated}/-${patternsPruned}  合计词条 ${keys.length}，模式 ${patternKeys.length}`,
)
for (const s of skipped.slice(0, 15)) console.log(`  跳过 ${s.id}: ${s.why}`)
if (skipped.length > 15) console.log(`  …还有 ${skipped.length - 15} 条`)

// 归一必须点名。界面上某句话被改得别扭时，这段日志是唯一能定位到"是被规则改的
// 还是模型翻的"的线索；只报一个数字等于没报。
for (const n of normalizedKeys.slice(0, 15)) {
  console.log(`  归一 ${JSON.stringify(n.key)}: ${n.from} → ${n.to}`)
}
if (normalizedKeys.length > 15) console.log(`  …还有 ${normalizedKeys.length - 15} 条被归一`)

// 剔除必须点名：一条人工写进去的词条被某条规则判死时，计数是唯一会消失得
// 无影无踪的东西。日志里说清楚是哪一条，才知道该修规则还是改词条。
for (const key of prunedKeys.slice(0, 15)) console.log(`  剔除 ${JSON.stringify(key)}`)
if (prunedKeys.length > 15) console.log(`  …还有 ${prunedKeys.length - 15} 条被剔除`)

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
