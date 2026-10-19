#!/usr/bin/env node
/**
 * Find every user-visible English string and group it the way a human reads it.
 *
 *   node scripts/i18n-extract.mjs                 # human summary
 *   node scripts/i18n-extract.mjs --out=X.json    # machine-readable groups
 *   node scripts/i18n-extract.mjs --all           # list every group
 *
 * Why groups and not single strings: React splits a sentence the moment it
 * puts a value inside it —
 *
 *     LU reads every <code>.gguf</code> in the folder you set
 *
 * is three text nodes at runtime. Translating them one by one produces broken
 * Chinese word order. So a group carries:
 *
 *   fragments: ["LU reads every", "in the folder you set"]   ← dictionary keys
 *   sentence:  "LU reads every [[0]] in the folder you set"  ← what the model sees
 *
 * The translator translates the SENTENCE and must keep the `[[n]]` markers.
 * `i18n-apply` splits the answer on them and writes one dictionary entry per
 * fragment, which is exactly what the runtime bridge replaces per text node.
 *
 * Everything the app does NOT show to a user is excluded by path (agent
 * prompts, model catalogue, cloud price tables, release notes) — translating
 * those would change model behaviour and turn upstream tests red.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SRC = join(root, 'src')
const SKIP_FILE = join(SRC, 'lib', 'i18n', 'skip.json')

const showAll = process.argv.includes('--all')
const outArg = process.argv.find((a) => a.startsWith('--out='))
const OUT = outArg ? outArg.slice('--out='.length) : null

const SKIP_DIRS = new Set(['__tests__', 'node_modules', 'dist', 'target'])

/** Directories whose English is never shown to the user. One list, one place. */
const NO_TRANSLATE_PATHS = [
  /^src\/api\/agents\//,
  /^src\/api\/mcp\//,
  /^src\/api\/discover\.ts$/,
  /^src\/api\/model-bundles\.ts$/,
  /^src\/lib\/render\//,
  /^src\/lib\/release-notes\.ts$/,
  /^src\/lib\/no-refusals/,
  /^src\/lib\/i18n\//,
  // Prompt builders. Their English goes to the model, never to a screen;
  // translating them would change behaviour and is not a UI decision.
  /^src\/api\/agent-context\.ts$/,
  /^src\/api\/hermes-tool-calling\.ts$/,
  /^src\/api\/qwen-enhancer-prompts\.ts$/,
  /^src\/lib\/system-prompt\.ts$/,
  /^src\/lib\/codex-plan-prompt\.ts$/,
  /^src\/lib\/computer\/prompt\.ts$/,
  /^src\/lib\/memory-extraction\.ts$/,
]

const TEXT_ATTRS = new Set([
  'placeholder', 'title', 'aria-label', 'ariaLabel', 'aria-description',
  'alt', 'label', 'description', 'confirmLabel', 'cancelLabel', 'emptyText',
  'helperText', 'tooltip',
])

const DATA_PROPS = new Set(['label', 'placeholder', 'title', 'ariaLabel', 'description', 'emptyText', 'helperText'])

/** Inline elements that only split a sentence; quotes do carry copy. */
const INLINE_TAGS = new Set(['code', 'b', 'strong', 'em', 'i', 'span', 'a', 'kbd', 'small', 'p', 'li', 'td', 'th'])

/** `[[0]]` — kept deliberately unlikely in real copy, and easy to split on. */

function looksLikeCopy(value) {
  const text = value.trim()
  if (text.length < 2) return false
  if (!/[A-Za-z]{2}/.test(text)) return false
  if (/^https?:\/\//i.test(text) || /^[\w.+-]+@[\w.-]+$/.test(text)) return false
  if (/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/i.test(text) && !text.includes(' ')) return false
  if (/^[.#]?[a-z][\w-]*$/.test(text)) return false
  if (/^[\d\s.,:%+-]+$/.test(text)) return false
  if (/[\\/]/.test(text) && !/\s/.test(text)) return false
  if (/^\.[a-z0-9]{1,5}$/i.test(text)) return false
  if (/^-{1,2}[a-z]/i.test(text)) return false
  return true
}

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim()
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    if (/\.(test|spec)\./.test(entry.name)) continue
    yield full
  }
}

const skip = new Set()
try {
  const raw = JSON.parse(await readFile(SKIP_FILE, 'utf8'))
  for (const key of raw.keys ?? []) skip.add(key)
} catch {
  // No skip list yet.
}

const groups = []
const wrapped = new Set() // strings already handled by an explicit t('…') call
let uid = 0

function addGroup(file, line, kind, fragments) {
  const pieces = fragments.map(normalize).filter((f) => f.length > 0)
  if (pieces.length === 0) return
  if (pieces.some((f) => skip.has(f))) return
  if (!pieces.some((f) => looksLikeCopy(f))) return
  const sentence = pieces.map((p, i) => (i === 0 ? p : `[[${i - 1}]] ${p}`)).join(' ')
  groups.push({ id: `g${++uid}`, file, line, kind, fragments: pieces, sentence })
}

function visit(sf, file, node, inClass = false) {
  // An explicit `t('…')` / `tr('…')` call is already translated; count it so
  // the coverage number is not blind to the strings a human wrapped by hand.
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === 't' || node.expression.text === 'tr') &&
    node.arguments.length > 0
  ) {
    const arg = node.arguments[0]
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) wrapped.add(arg.text)
  }
  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    const pieces = []
    let hasText = false
    let line = 0
    for (const child of node.children) {
      if (ts.isJsxText(child)) {
        const text = normalize(child.getText(sf))
        if (!text) continue
        if (!hasText) line = sf.getLineAndCharacterOfPosition(child.getStart(sf)).line + 1
        hasText = true
        pieces.push(text)
        continue
      }
      if (ts.isJsxExpression(child) && child.expression) {
        const expr = child.expression
        if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
          const text = normalize(expr.text)
          if (text) {
            if (!hasText) line = sf.getLineAndCharacterOfPosition(child.getStart(sf)).line + 1
            hasText = true
            pieces.push(text)
          }
        }
        continue
      }
      if (ts.isJsxElement(child) && INLINE_TAGS.has(child.openingElement.tagName.getText(sf))) {
        // An inline node between two pieces of copy: it becomes a marker, not
        // an entry. Its own children are visited below like any other element.
        if (hasText) pieces.push('\u0000')
      }
    }
    if (hasText && pieces.some((p) => p !== '\u0000')) {
      // `\u0000` was only there to keep the split; the sentence builder below
      // needs real text, so drop the markers and let `sentence` mark the gaps.
      addGroup(file, line, 'sentence', pieces.filter((p) => p !== '\u0000'))
    }
  }

  if (ts.isJsxAttribute(node) && node.initializer) {
    const name = node.name.getText(sf)
    if (TEXT_ATTRS.has(name)) {
      const init = node.initializer
      const literal = ts.isStringLiteral(init)
        ? init
        : ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)
          ? init.expression
          : null
      if (literal && looksLikeCopy(literal.text)) {
        addGroup(file, sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, `attr:${name}`, [literal.text])
      }
    }
  }

  if (ts.isPropertyAssignment(node)) {
    const name = node.name.getText(sf).replace(/^['"]|['"]$/g, '')
    if (DATA_PROPS.has(name)) {
      const init = node.initializer
      if ((ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) && looksLikeCopy(init.text)) {
        addGroup(file, sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, `prop:${name}`, [init.text])
      }
    }
  }

  if (ts.isTemplateExpression(node) && !inClass) {
    const head = normalize(node.head.text)
    if (looksLikeCopy(head)) {
      addGroup(file, sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, 'template-head', [head])
    }
  }

  const nextInClass = inClass || (ts.isJsxAttribute(node) && /^(className|class)$/.test(node.name.getText(sf)))
  ts.forEachChild(node, (child) => visit(sf, file, child, nextInClass))
}

for await (const file of walk(SRC)) {
  const rel = relative(root, file).replace(/\\/g, '/')
  if (NO_TRANSLATE_PATHS.some((re) => re.test(rel))) continue
  const text = await readFile(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  visit(sf, rel, sf)
}

const unique = new Map()
for (const g of groups) for (const f of g.fragments) if (!unique.has(f)) unique.set(f, g.file)

const dictUrl = new URL(`file://${join(SRC, 'lib', 'i18n', 'zh-CN.ts').replace(/\\/g, '/')}`).href
const dictionary = await import(dictUrl).then((m) => m.ZH_CN ?? {}).catch(() => ({}))
const known = new Set(Object.keys(dictionary))
const coveredFragments = [...unique.keys()].filter((f) => known.has(f))
const universe = new Set([...unique.keys(), ...wrapped])
const handled = new Set([...wrapped, ...coveredFragments])
const percent = universe.size === 0 ? 100 : (handled.size / universe.size) * 100

const payload = {
  generatedAt: new Date().toISOString(),
  groups: groups.length,
  uniqueFragments: unique.size,
  wrapped: wrapped.size,
  dictionary: known.size,
  coveragePercent: Number(percent.toFixed(1)),
  skippedKeys: skip.size,
  items: groups,
}

if (OUT) {
  await writeFile(OUT, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`已写入 ${OUT}`)
}
console.log(
  `分组：${groups.length}    唯一片段：${unique.size}    已有译文：${handled.size}/${universe.size}（${percent.toFixed(1)}%）    跳过清单：${skip.size}`,
)

const byFile = new Map()
for (const g of groups) byFile.set(g.file, (byFile.get(g.file) ?? 0) + 1)
for (const [file, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(4)}  ${file}`)
}

const shown = showAll ? groups : groups.slice(0, 15)
for (const g of shown) {
  const sentence = g.sentence.length > 90 ? `${g.sentence.slice(0, 90)}…` : g.sentence
  console.log(`  ${g.file}:${g.line}  [${g.kind}]  ${JSON.stringify(sentence)}`)
}
if (!showAll && groups.length > shown.length) console.log(`  …还有 ${groups.length - shown.length} 组，用 --all 查看`)
