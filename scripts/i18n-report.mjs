#!/usr/bin/env node
/**
 * Report the state of the Chinese dictionary against the call sites.
 *
 *   node scripts/i18n-report.mjs
 *   node scripts/i18n-report.mjs --strict   # exit 1 when a call site has no entry
 *
 * Answers three questions, in this order:
 *
 *   1. Which `t('…')` call sites have no Chinese entry (they render English);
 *   2. Which dictionary entries nobody asks for (dead weight that survives
 *      every merge and reads as finished work);
 *   3. How much of the UI is covered, as a raw count.
 *
 * The dictionary is imported, not grepped: a regex over a `.ts` object would
 * miss escaped quotes and silently disagree with what ships. Node's type
 * stripping (22.18+, on by default in 23+) reads the file as it is.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SRC = join(root, 'src')
const DICT = join(SRC, 'lib', 'i18n', 'zh-CN.ts')
const strict = process.argv.includes('--strict')

const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '__tests__'])

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name))
      continue
    }
    if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      // The i18n module itself documents `t('New chat')` in prose; counting
      // those as call sites would report the documentation as untranslated UI.
      if (/[\\/]lib[\\/]i18n[\\/]/.test(join(dir, entry.name))) continue
      yield join(dir, entry.name)
    }
  }
}

/**
 * `t('…')` / `tr('…')` at a call site. `tr` is the alias used in files where
 * a local `t` already exists (`Header.tsx` maps `navTargets` with `(t) => …`);
 * both names are the same function. A template literal or a variable is not
 * translatable by this tool, and reporting it as a key would invent strings
 * that do not exist.
 */
const CALL = /(?<![\w.$])(?:t|tr)\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*(?:,|\))/g

async function dictionaryKeys() {
  const mod = await import(pathToFileUrl(DICT))
  return new Set(Object.keys(mod.ZH_CN ?? {}))
}

function pathToFileUrl(p) {
  return new URL(`file://${p.replace(/\\/g, '/')}`).href
}

const keys = await dictionaryKeys()
const used = new Map() // source string -> [file:line, …]

for await (const file of walk(SRC)) {
  const text = await readFile(file, 'utf8')
  for (const match of text.matchAll(CALL)) {
    const source = match[2].replace(/\\(.)/g, '$1')
    const line = text.slice(0, match.index).split('\n').length
    const at = `${relative(root, file)}:${line}`
    if (!used.has(source)) used.set(source, [])
    used.get(source).push(at)
  }
}

const missing = [...used.keys()].filter((k) => !keys.has(k)).sort()
const unused = [...keys].filter((k) => !used.has(k)).sort()

const line = (s) => console.log(s)
line(`翻译覆盖：${used.size - missing.length}/${used.size} 个调用点已有中文`)
line(`字典条目：${keys.size}（其中 ${unused.length} 条没有被引用）`)

if (missing.length) {
  line(`\n缺少中文条目（这些位置显示英文）：${missing.length}`)
  for (const key of missing) {
    line(`  · ${JSON.stringify(key)}`)
    for (const at of used.get(key).slice(0, 3)) line(`      ${at}`)
    if (used.get(key).length > 3) line(`      …共 ${used.get(key).length} 处`)
  }
}

if (unused.length) {
  line(`\n字典里没人引用的条目：${unused.length}`)
  for (const key of unused) line(`  · ${JSON.stringify(key)}`)
}

if (strict && missing.length) {
  line('\n--strict：存在未翻译的调用点，退出码 1')
  process.exit(1)
}
