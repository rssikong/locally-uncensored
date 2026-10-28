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
/** `--out=x` and `--out x` both work: the workflow writes one, a person the other. */
const outArg = (() => {
  const withEquals = process.argv.find((a) => a.startsWith('--out='))
  if (withEquals) return withEquals
  const index = process.argv.indexOf('--out')
  return index >= 0 ? `--out=${process.argv[index + 1] ?? ''}` : null
})()
const OUT = outArg ? outArg.slice('--out='.length) : null

const SKIP_DIRS = new Set(['__tests__', 'node_modules', 'dist', 'target'])

/** Directories whose English is never shown to the user. One list, one place. */
const NO_TRANSLATE_PATHS = [
  /^src\/api\/agents\//,
  /^src\/api\/mcp\//,
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

/**
 * Catalog files hold model names AND their one-line descriptions. The names
 * must stay as they are (a translated model name stops matching the catalogue);
 * the descriptions are shown to the user and are worth translating. So these
 * files are read, but only through this narrow list of properties.
 */
const CATALOG_FILES = [/^src\/api\/discover\.ts$/, /^src\/api\/model-bundles\.ts$/]
const CATALOG_PROPS = new Set(['description', 'blurb', 'subtitle', 'kind'])

/** Inline elements that only split a sentence; quotes do carry copy. */
const INLINE_TAGS = new Set(['code', 'b', 'strong', 'em', 'i', 'span', 'a', 'kbd', 'small', 'p', 'li', 'td', 'th'])

/** `[[0]]` — kept deliberately unlikely in real copy, and easy to split on. */

function looksLikeCopy(value) {
  const text = value.trim()
  if (text.length < 2) return false
  if (!/[A-Za-z]{2}/.test(text)) return false
  if (/^https?:\/\//i.test(text) || /^[\w.+-]+@[\w.-]+$/.test(text)) return false
  if (/^[.#]?[a-z][\w-]*$/.test(text)) return false
  if (/^[\d\s.,:%+-]+$/.test(text)) return false
  if (/[\\/]/.test(text) && !/\s/.test(text)) return false
  if (/^\.[a-z0-9]{1,5}$/i.test(text)) return false
  if (/^-{1,2}[a-z]/i.test(text)) return false
  // 单个 token 既可能是 UI 标签（Installed / Get / All），也可能是标识符
  // （q4_k_m / foo-bar / modelId / CUDA）。原先一条 `^[a-z0-9]+([-_.][a-z0-9]+)*$`
  // 把两拨全部丢掉了 —— 英文 UI 里大量按钮就是一个词，于是它们从来没进过词典。
  // 现在只丢"有标识符特征"的，剩下的交给上层判断。
  if (!text.includes(' ')) {
    // 连字符要分两种：`Sub-agents` / `Multi-agent` 是英文 UI 里正常的合成词，
    // `foo-bar` / `app-shell` 是 CSS 类和路径。区别在首段是否大写开头且
    // 每一段都是纯小写字母 —— 大写开头说明它是给人读的。
    if (/[-_.:/]/.test(text) && !/^[A-Z][a-z]+(?:-[a-z]+)+$/.test(text)) return false
    if (/\d/.test(text)) return false // q4_k_m, 8B, v2
    if (/^[A-Z]{2,}$/.test(text)) return false // CUDA, GPU, API
    if (/^[a-z]+$/.test(text)) return false // constructor, localhost, textarea
    if (/^[a-z]+[A-Z]/.test(text)) return false // modelId, isInstalled
  }
  return true
}

/**
 * JSX text arrives as SOURCE text, so `Download &amp; install` is what the
 * extractor sees while the DOM shows `Download & install`. Without decoding,
 * the dictionary key and the rendered text never meet.
 */
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', middot: '·', times: '×',
  rarr: '→', larr: '←', uarr: '↑', darr: '↓', check: '✓', copy: '©',
}

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    if (name.startsWith('#')) {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

function normalize(text) {
  return decodeEntities(text.replace(/\s+/g, ' ')).trim()
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

/**
 * A sentence assembled at runtime (`Details for ${name}`) cannot be a
 * dictionary key: the rendered text is different every time. It becomes a
 * PATTERN instead — `Details for {0}` — and the runtime matches the shape.
 *
 * Two things never become patterns:
 *   - prompt paragraphs. A model prompt written as a template is hundreds of
 *     characters long and must not be translated at all; UI copy is short.
 *   - query strings and paths (`&format=json&srlimit={0}`, `?after={0}`).
 */
const MAX_TEMPLATE_LENGTH = 300

function looksLikeTemplate(sentence) {
  const staticText = sentence.replace(/\[\[\d+\]\]/g, ' ')
  if (staticText.length > MAX_TEMPLATE_LENGTH) return false
  if (/:\/\//.test(staticText)) return false
  if (/[?&][a-z_]+=/.test(staticText)) return false
  if (/^[.?&/]/.test(staticText.trim())) return false
  return looksLikeCopy(staticText)
}

function addTemplate(file, line, sentence) {
  const text = normalize(sentence)
  if (!looksLikeTemplate(text)) return
  if (!isTranslatable(text)) return
  if (skip.has(text)) return
  // One marker per interpolation; the sentence already carries them.
  const markers = text.match(/\[\[\d+\]\]/g) ?? []
  if (markers.length === 0) return
  groups.push({ id: `g${++uid}`, file, line, kind: 'template', fragments: [], sentence: text })
}

const seenGroups = new Set()

/**
 * This repository carries German in its comments and, in a few places, in the
 * patterns that recognise what a user typed. None of that is interface copy:
 * translating it would be wrong, and it trips the "no German sentences in the
 * UI" guard. Two signals: an umlaut/ß, or three distinct function words.
 */
const GERMAN_WORDS =
  /\b(der|die|das|den|dem|des|und|oder|nicht|kein|keine|mit|für|auf|ist|sind|wird|werden|kann|können|muss|sollen|bitte|einen|eine|einem|einer|wenn|dass|dieser|diese|dieses|noch|auch|nur|schon|jetzt|hier|dort)\b/gi

function looksGerman(text) {
  if (/[äöüß]/i.test(text)) return true
  const hits = new Set((text.match(GERMAN_WORDS) ?? []).map((word) => word.toLowerCase()))
  return hits.size >= 3
}

/** A string that encodes a regular expression is a matcher, not copy. */
function looksLikeRegex(text) {
  return /\(\?:|\\[bwsd]|\[\^|\\s\+/.test(text)
}

/**
 * A Tailwind class list looks like a sentence to a naive filter: it has spaces
 * and letters. It is style, not copy, and translating it would change layout.
 */
const CSS_TOKEN =
  /(?<![\w-])(?:flex|grid|inline-flex|hidden|absolute|relative|items-(?:center|start|end|stretch)|justify-(?:center|between|start|end)|gap-[0-9.]+|(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|w|h|text|bg|border|ring|from|via|to)-[0-9.[\]a-z/-]+|rounded[\w-]*|border[\w-]*|shadow[\w-]*|font-(?:medium|semibold|bold|mono)|leading-\w+|tracking-\w+|transition[\w-]*|(?:hover|dark|focus|active|disabled):)/g

/** API-key placeholders and licence names: never shown as prose. */
function looksLikePlaceholder(text) {
  return (
    /^(?:sk|gsk|tok|pk|api|xai|hf)[-_][\w.-]*$/i.test(text) ||
    /^(?:Apache|MIT|BSD|GPL|AGPL|LGPL|CC)[-\d.]*\d\.?$/i.test(text) ||
    /^(?:Apache|MIT|BSD)-[\d.]+$/i.test(text)
  )
}

/** A piece that starts or ends mid-sentence came from a split description. */
function looksLikeRemainder(text) {
  return /^[)\].,;:!?]/.test(text) || /[([]$/.test(text)
}

function looksLikeClasses(text) {
  return (text.match(CSS_TOKEN) ?? []).length >= 2
}

/**
 * "Qwen 3.6 35B MoE", "Gemma 4 12B HERETIC" — a name, not copy.
 *
 * 尺寸标记（27B / 1.5B / 744B）是唯一可靠的信号。原先还有一条"每个词都大写
 * 就算型号"，它把 Chat Backup、Cloud API Keys、No GPU、Troubleshoot 这类正常
 * 英文标题全判成了名字 —— 英文 UI 本来就是 Title Case，那条规则的实际效果是
 * "凡标题不译"。这里只删掉那一条，尺寸标记的判据一个字没动：改它会连带把
 * 已经译好的型号重新判死。
 */
function looksLikeName(text) {
  return /\b\d+(?:\.\d+)?\s*[BT]\b/.test(text) && !/[a-z]{4}/.test(text)
}

function isTranslatable(text) {
  return (
    looksLikeCopy(text) &&
    !looksGerman(text) &&
    !looksLikeRegex(text) &&
    !looksLikeClasses(text) &&
    !looksLikeName(text) &&
    !looksLikePlaceholder(text) &&
    !looksLikeRemainder(text)
  )
}

function addGroup(file, line, kind, fragments) {
  const pieces = fragments.map(normalize).filter((f) => f.length > 0)
  if (pieces.length === 0) return
  if (pieces.some((f) => skip.has(f))) return
  if (!pieces.some(isTranslatable)) return
  // One entry per distinct sentence: the same label appears in many places and
  // one translation decision is enough.
  const dedupe = pieces.join('\u0001')
  if (seenGroups.has(dedupe)) return
  seenGroups.add(dedupe)
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

  // Broad collection: a label can reach the screen through a ternary, an array
  // of options or a constant, none of which the rules below see. The gap scan
  // proved the cost of missing them ("Describe your image…", "No chats yet."
  // were never extracted). Length-capped, because a long template in lib/ is a
  // model prompt, not UI copy.
  if (
    (file.startsWith('src/components/') || file.startsWith('src/lib/')) &&
    !inClass &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    const parent = node.parent
    const isWrapped =
      ts.isCallExpression(parent) &&
      ts.isIdentifier(parent.expression) &&
      (parent.expression.text === 't' || parent.expression.text === 'tr')
    const text = normalize(node.text)
    if (!isWrapped && text.length <= 200 && isTranslatable(text)) {
      addGroup(file, sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, 'literal', [text])
    }
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
    // head + [[0]] + tail … in one string, so the translator sees the sentence
    // and apply can turn it into a `{0}` pattern.
    let sentence = node.head.text
    node.templateSpans.forEach((span, index) => {
      sentence += `[[${index}]]${span.literal.text}`
    })
    addTemplate(file, sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, sentence)
  }

  const nextInClass = inClass || (ts.isJsxAttribute(node) && /^(className|class)$/.test(node.name.getText(sf)))
  ts.forEachChild(node, (child) => visit(sf, file, child, nextInClass))
}

/**
 * The Models view does not render a description as one paragraph: it splits it
 * on `·` and on sentence boundaries and shows one piece. A dictionary keyed by
 * the whole paragraph therefore never matches what is on screen, so every piece
 * is collected too.
 */
function catalogPieces(text) {
  const pieces = [text]
  const add = (piece) => {
    const trimmed = piece.trim()
    if (!trimmed) return
    pieces.push(trimmed)
    // The Models view drops the closing period when it shows a sentence on its
    // own; without this variant the key and the screen never meet.
    if (trimmed.endsWith('.')) pieces.push(trimmed.slice(0, -1))
  }
  for (const [index, part] of text.split('·').entries()) {
    // The segment before the first `·` is the vendor's model name
    // ("huihui Qwen 3.8 27B abliterated"), not copy. Translating it would stop
    // it matching the catalogue.
    if (index === 0 && text.includes('·')) continue
    add(part)
    for (const sentence of part.split(/(?<=\.)\s+/)) {
      if (sentence.trim().length > 8) add(sentence)
    }
  }
  return pieces
}

/** Catalog files: only the displayed descriptions, never the model names. */
function visitCatalog(sf, file, node) {
  if (ts.isPropertyAssignment(node)) {
    const name = node.name.getText(sf).replace(/^['"]|['"]$/g, '')
    if (CATALOG_PROPS.has(name)) {
      const init = node.initializer
      if ((ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) && looksLikeCopy(init.text)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        for (const piece of catalogPieces(init.text)) {
          if (looksLikeCopy(piece)) addGroup(file, line, `catalog:${name}`, [piece])
        }
      }
    }
  }
  ts.forEachChild(node, (child) => visitCatalog(sf, file, child))
}

for await (const file of walk(SRC)) {
  const rel = relative(root, file).replace(/\\/g, '/')
  const isCatalog = CATALOG_FILES.some((re) => re.test(rel))
  if (!isCatalog && NO_TRANSLATE_PATHS.some((re) => re.test(rel))) continue
  const text = await readFile(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  if (isCatalog) visitCatalog(sf, rel, sf)
  else visit(sf, rel, sf)
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
