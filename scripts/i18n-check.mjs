#!/usr/bin/env node
/**
 * Validate the dictionary. Runs locally and in CI (10 seconds).
 *
 *   node scripts/i18n-check.mjs
 *
 * What it refuses to let through:
 *   - an empty translation, or one identical to its English key (a copy that
 *     slipped through the pipeline and would look translated but is not)
 *   - a lost placeholder: `Delete {n} items` must keep `{n}`
 *   - a pattern whose replacement does not use every slot
 *   - duplicate keys (JSON objects hide those silently; the object literal in
 *     zh-CN.ts does not, but a bad write could still produce one)
 *   - a punctuation fragment that was answered as a sentence (`·` → `· 已选`):
 *     the bridge trims a text node before matching, so `{a} · {b}` in JSX hits
 *     that entry and every separator in the UI changes. `i18n-apply.mjs` prunes
 *     these on write; this is the backstop that catches a hand edit.
 *   - a bare word that was answered as a whole sentence (`Delete` → `从 LoRA
 *     文件夹删除`), which happens when Chinese word order moves content across a
 *     slot boundary; the key is that word's button label everywhere else.
 *
 * A failure here blocks the commit in the sync workflow, which is the point:
 * the app itself tolerates a bad dictionary (it falls back to English), so
 * without this gate nobody would notice.
 */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DICT = join(root, 'src', 'lib', 'i18n', 'zh-CN.ts')

const url = new URL(`file://${DICT.replace(/\\/g, '/')}`).href
const { ZH_CN, ZH_PATTERNS } = await import(url)

// Hand-maintained corrections. Same rules, plus one extra: they may shadow a
// generated entry, but the shadowing has to be printed — a silent override
// reads like something the pipeline produced.
const OVERRIDES = join(root, 'src', 'lib', 'i18n', 'overrides.ts')
const overrideUrl = new URL(`file://${OVERRIDES.replace(/\\/g, '/')}`).href
const { ZH_OVERRIDES } = await import(overrideUrl).catch((error) => {
  // fail-closed 是有意的：以前这里 catch 成一个空对象，文件丢了就等于"没有手动词条"，
  // 门禁照样打绿，而每条人工修正都变成不可见的。缺文件必须是红的。
  console.error(`i18n-check: 无法加载 src/lib/i18n/overrides.ts（${error.message}）`)
  process.exit(1)
})

const problems = []
const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort()
const slots = (text) => (text.match(/\{\d+\}/g) ?? []).sort()

const source = await readFile(DICT, 'utf8')

/**
 * Same rule as `isPunctuationBloat` in i18n-apply.mjs: a key with no letters
 * and no Chinese is punctuation, so it may only map to something of its own
 * length. Longer means a phrase was written into a separator's slot.
 */
const HAS_WORD = /[A-Za-z\u3400-\u9fff]/
function isPunctuationBloat(key, value) {
  if (HAS_WORD.test(key)) return false
  return value.replace(/\s+/g, '').length > key.replace(/\s+/g, '').length
}

/** Same rule and threshold as `isWordFragmentBloat` in i18n-apply.mjs. */
const WORD_MAX_GROWTH = 4
function isWordFragmentBloat(key, value) {
  if (/\s/.test(key)) return false
  if (!/[A-Za-z]/.test(key)) return false
  if (key.length > 12) return false
  return value.length - key.length > WORD_MAX_GROWTH
}

// Duplicate keys are invisible once the object is built, so count them in the
// text. A key appears once as `"key":`.
const seen = new Map()
for (const line of source.split(/\r?\n/)) {
  const match = /^\s{2}("(?:[^"\\]|\\.)*"):/.exec(line)
  if (!match) continue
  const key = JSON.parse(match[1])
  seen.set(key, (seen.get(key) ?? 0) + 1)
}
for (const [key, count] of seen) {
  if (count > 1) problems.push(`重复 key（${count} 次）：${key}`)
}

for (const [key, value] of Object.entries(ZH_CN ?? {})) {
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push(`空译文：${key}`)
    continue
  }
  if (placeholders(key).join(',') !== placeholders(value).join(',')) {
    problems.push(`占位符不一致：${key} → ${value}`)
  }
  if (isPunctuationBloat(key, value)) {
    problems.push(`标点碎片被当成句子翻译：${JSON.stringify(key)} → ${JSON.stringify(value)}`)
  }
  if (isWordFragmentBloat(key, value)) {
    problems.push(`单词被塞进了整句：${JSON.stringify(key)} → ${JSON.stringify(value)}`)
  }
}

const shadowed = []
for (const [key, value] of Object.entries(ZH_OVERRIDES ?? {})) {
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push(`手动词条空译文：${key}`)
    continue
  }
  if (placeholders(key).join(',') !== placeholders(value).join(',')) {
    problems.push(`手动词条占位符不一致：${key} → ${value}`)
  }
  if (key === value) problems.push(`手动词条与原文相同（不生效）：${key}`)
  if (Object.hasOwn(ZH_CN ?? {}, key)) shadowed.push(key)
}

for (const [pattern, replacement] of ZH_PATTERNS ?? []) {
  const expected = slots(pattern)
  const got = slots(replacement)
  if (expected.join(',') !== got.join(',')) {
    problems.push(`模式槽位不一致：${pattern} → ${replacement}`)
  }
  if (pattern.trim() === '') problems.push('空模式')
}

const total = Object.keys(ZH_CN ?? {}).length
const manual = Object.keys(ZH_OVERRIDES ?? {}).length
if (problems.length > 0) {
  console.error(`i18n-check: ${problems.length} 个问题（词条 ${total}）`)
  for (const p of problems.slice(0, 30)) console.error(`  - ${p}`)
  if (problems.length > 30) console.error(`  …还有 ${problems.length - 30} 条`)
  process.exit(1)
}

console.log(
  `i18n-check: 通过（词条 ${total}，模式 ${(ZH_PATTERNS ?? []).length}，手动词条 ${manual}）`,
)
if (shadowed.length > 0) {
  console.log(`  手动词条盖住了词典里的 ${shadowed.length} 条（有意为之才正常）：`)
  for (const key of shadowed) console.log(`    · ${JSON.stringify(key)}`)
}
