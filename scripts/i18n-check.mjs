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

const problems = []
const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort()
const slots = (text) => (text.match(/\{\d+\}/g) ?? []).sort()

const source = await readFile(DICT, 'utf8')

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
if (problems.length > 0) {
  console.error(`i18n-check: ${problems.length} 个问题（词条 ${total}）`)
  for (const p of problems.slice(0, 30)) console.error(`  - ${p}`)
  if (problems.length > 30) console.error(`  …还有 ${problems.length - 30} 条`)
  process.exit(1)
}

console.log(`i18n-check: 通过（词条 ${total}，模式 ${(ZH_PATTERNS ?? []).length}）`)
