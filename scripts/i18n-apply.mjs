#!/usr/bin/env node
/**
 * Write translated groups back into the dictionary.
 *
 *   node scripts/i18n-apply.mjs --in=translations.json
 *   node scripts/i18n-apply.mjs --in=translations.json --dry-run
 *
 * `translations.json` is what `i18n-translate.mjs` (or a person) produces:
 *
 *   { "results": [ { "id": "g3", "text": "LU 在这里读取每一个 [[0]] 你设置的文件夹里" } ] }
 *
 * The `[[n]]` markers are split back apart, so one translated sentence becomes
 * one dictionary entry per fragment — which is exactly what the runtime bridge
 * replaces, one text node at a time.
 *
 * Everything is validated before a single byte is written: a group whose answer
 * has the wrong number of pieces, an empty piece, or a lost placeholder is
 * skipped and reported, never merged. The app keeps its English for that one
 * sentence, which is the safe outcome.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DICT = join(root, 'src', 'lib', 'i18n', 'zh-CN.ts')
const SLOT = /\[\[(\d+)\]\]/g

const inArg = process.argv.find((a) => a.startsWith('--in='))
if (!inArg) {
  console.error('用法: node scripts/i18n-apply.mjs --in=translations.json [--dry-run]')
  process.exit(2)
}
const dryRun = process.argv.includes('--dry-run')

const groups = JSON.parse(await readFile(inArg.slice('--in='.length), 'utf8'))
const results = groups.results ?? groups

const dictUrl = new URL(`file://${DICT.replace(/\\/g, '/')}`).href
const current = await import(dictUrl)
  .then((m) => ({ ...(m.ZH_CN ?? {}) }))
  .catch(() => ({}))

const placeholderTokens = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join(',')

let added = 0
let updated = 0
const skipped = []

for (const result of results) {
  const group = (groups.groups ?? []).find?.((g) => g.id === result.id)
  if (!group) {
    // A bare map of sentence → sentence is also accepted: no group context.
    if (typeof result.source === 'string' && typeof result.text === 'string') {
      current[result.source] = result.text
      added += 1
      continue
    }
    skipped.push({ id: result.id, why: 'unknown group id' })
    continue
  }

  const parts = String(result.text ?? '').split(SLOT).filter((_, i) => i % 2 === 0)
  if (parts.length !== group.fragments.length) {
    skipped.push({ id: result.id, why: `expected ${group.fragments.length} pieces, got ${parts.length}` })
    continue
  }

  const next = {}
  let bad = false
  group.fragments.forEach((fragment, index) => {
    const piece = parts[index].trim()
    if (!piece) {
      skipped.push({ id: result.id, why: `empty piece ${index}` })
      bad = true
      return
    }
    if (placeholderTokens(fragment) !== placeholderTokens(piece)) {
      skipped.push({ id: result.id, why: `placeholder mismatch in "${fragment}"` })
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

// Fragment artefacts: a sentence cut around an inline value can leave pieces
// that are only punctuation (",") or a sentence stub ("(The"). Storing a
// translation for those either does nothing useful or silently drops content
// — and the runtime bridge would then apply it everywhere that fragment
// appears. Keep the English instead; it is the safe direction.
const CJK = /[\u3400-\u9fff]/
const pruned = []
for (const [key, value] of Object.entries(current)) {
  if (CJK.test(value)) continue
  if (!/[A-Za-z]/.test(key)) continue
  if (value === key) continue
  pruned.push(`${JSON.stringify(key)} → ${JSON.stringify(value)}`)
  delete current[key]
}

const keys = Object.keys(current).sort()
const body = keys.map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(current[k]) + ',').join('\n')
const file = `// GENERATED FILE — do not edit by hand.\n// Written by scripts/i18n-apply.mjs. Keys are the English text the app renders,\n// values are the Chinese copy. A key that is missing here stays English at\n// runtime (the bridge never guesses), which is why adding a translation is\n// never able to break a screen.\nexport const ZH_CN: Record<string, string> = {\n${body}\n}\n\n/**\n * Dynamic strings. \`{0}\`, \`{1}\` … are captured from the rendered text and\n * substituted back, so a count or a name inside a sentence still matches.\n */\nexport const ZH_PATTERNS: ReadonlyArray<readonly [string, string]> = []\n`

console.log(`新增 ${added}  更新 ${updated}  跳过 ${skipped.length}  剔除片段伪译 ${pruned.length}  合计 ${keys.length}`)
for (const s of skipped.slice(0, 20)) console.log(`  跳过 ${s.id}: ${s.why}`)
if (skipped.length > 20) console.log(`  …还有 ${skipped.length - 20} 条`)
for (const line of pruned.slice(0, 12)) console.log(`  剔除 ${line}`)
if (pruned.length > 12) console.log(`  …还有 ${pruned.length - 12} 条`)

if (dryRun) {
  console.log('--dry-run：未写入')
} else {
  await writeFile(DICT, file, 'utf8')
  console.log(`已写入 ${DICT}`)
}
