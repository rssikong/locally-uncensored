// Create in chat: the files the desktop shares with the web app.
//
// The web app owns the contract of Create in chat: the two tools, the check
// of an order, the texts the model reads, the order card. The desktop does not
// write any of that a second time. Every file in MIRRORED is the web file with
// three changes: its import paths point at the desktop's modules, the places
// under PATCHES and CLASSES differ, and its comments are left behind. The
// comments of the web file are written for the people who run the server;
// what a line does is the same without them, and the parity test proves that
// by comparing the compiled output with and without. Where the desktop has no
// module of the same shape, a small bridge under src/lib/create/bridge gives
// the web code what it asks for from the desktop's own sources (the live
// catalogue, cloudFetch).
//
// Run `node scripts/create-chat-mirror.mjs <path to the web repo>` to take
// over a newer web state. src/lib/create/__tests__/web-parity.test.ts runs the
// same transform and fails when a mirrored file and its web source differ.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** web path (under the web app) -> desktop path (under the repo root). */
export const MIRRORED = {
  'lib/create/chat-origin.ts': 'src/lib/create/chat-origin.ts',
  'lib/create/handles.ts': 'src/lib/create/handles.ts',
  'lib/create/media-wish.ts': 'src/lib/create/media-wish.ts',
  'lib/create/chat-control.ts': 'src/lib/create/chat-control.ts',
  'lib/create/chat-attachments.ts': 'src/lib/create/chat-attachments.ts',
  'lib/create/chat-catalog.ts': 'src/lib/create/chat-catalog.ts',
  'lib/create/chat-tools.ts': 'src/lib/create/chat-tools.ts',
  'lib/create/chat-run.ts': 'src/lib/create/chat-run.ts',
  'lib/create/engine.ts': 'src/lib/create/engine.ts',
  'lib/create/order.ts': 'src/lib/create/order.ts',
  'lib/render/input-limit.ts': 'src/lib/render/input-limit.ts',
  'stores/createOrderStore.ts': 'src/stores/createOrderStore.ts',
  'components/chat/create/types.ts': 'src/components/chat/create/types.ts',
  'components/chat/create/format.ts': 'src/components/chat/create/format.ts',
  'components/chat/create/CreateOrder.tsx': 'src/components/chat/create/CreateOrder.tsx',
  'components/chat/create/CreateMedia.tsx': 'src/components/chat/create/CreateMedia.tsx',
}

/** Where a web module lives on the desktop. Web path without extension (as an
 *  `@/` import names it) -> desktop path without extension. A web module that
 *  is mirrored itself needs no line here. */
export const MODULES = {
  'stores/createStore': 'src/lib/create/bridge/create-store',
  'lib/create/chat-context': 'src/lib/create/chat-context',
  'types/chat': 'src/types/chat',
  'lib/storage-quota': 'src/lib/storage-quota',
  'lib/credits-exhausted': 'src/lib/credits-exhausted',
  'lib/billing/credits': 'src/lib/create/bridge/credits',
  'lib/render/provider': 'src/lib/render/cloud-jobs',
  'lib/render/cloud-jobs': 'src/lib/create/bridge/cloud-jobs',
  'lib/render/cloud-models': 'src/lib/create/bridge/cloud-models',
  'lib/render/create-studio': 'src/lib/render/create-studio',
  'lib/render/studio-catalog': 'src/lib/render/studio-contract',
  'lib/render/preset-models': 'src/lib/create/bridge/preset-models',
  'lib/render/create-presets': 'src/lib/render/create-presets',
  'lib/render/video-duration': 'src/lib/render/video-duration',
  'lib/render/safety': 'src/lib/render/safety',
  'lib/render/data-url': 'src/lib/render/data-url',
  'types/json-guards': 'src/types/json-guards',
  'components/create/experimental/PromptDetails': 'src/components/create/experimental/PromptDetails',
}

/** Modules that exist only on the desktop and are imported by a patch. */
const DESKTOP_ONLY = new Set(['components/chat/create/save-media', 'components/chat/create/OverTheApp'])

const stripExt = (p) => p.replace(/\.tsx?$/, '')
const MIRRORED_MODULES = Object.fromEntries(Object.entries(MIRRORED).map(([web, desk]) => [stripExt(web), stripExt(desk)]))

/** The few places where a mirrored file cannot be the web's text. Each entry
 *  replaces `from` (which must occur exactly `times` times in the web file,
 *  once unless it says otherwise) by `to`,
 *  and says why. A web change to one of these places stops the mirror and the
 *  parity test until someone has looked at it. */
export const PATCHES = {
  'components/chat/create/CreateMedia.tsx': [
    {
      why: 'A WebView does not save a file from a blob link. The card saves through the native dialog of the Create tab (save-media.ts).',
      from: "async function download(url: string, name: string) {\n  try {\n    const res = await fetch(url)\n    const blob = await res.blob()\n    const href = URL.createObjectURL(blob)\n    const a = document.createElement('a')\n    a.href = href\n    a.download = name\n    a.click()\n    URL.revokeObjectURL(href)\n  } catch {\n    window.open(url, '_blank', 'noopener,noreferrer')\n  }\n}\n\n",
      to: '',
    },
    {
      why: 'The imports of the function that replaces download() and of the place the big view is drawn at.',
      from: "import { formatClock, formatCredits } from './format'\n",
      to: "import { formatClock, formatCredits } from './format'\nimport { saveChatMedia as download } from './save-media'\nimport { OverTheApp } from './OverTheApp'\n",
    },
    {
      why: 'The thread is painted under the title bar and the composer, and a big view drawn inside it lost its Close button and its prompt behind them. It is drawn over the whole app (OverTheApp.tsx).',
      from: '<Lightbox src={media.url} prompt={media.prompt} onClose={() => setZoom(false)} />',
      to: '<OverTheApp><Lightbox src={media.url} prompt={media.prompt} onClose={() => setZoom(false)} /></OverTheApp>',
    },
  ],
  'lib/create/order.ts': [
    {
      why: 'On the desktop a caught value can be a string (a refused Tauri call rejects with one), so nothing reads .message off an unchecked value (hooks/__tests__/der-absendeweg-sagt-denselben-grund.test.ts). errorText reads both.',
      from: '(err as Error).message',
      to: 'errorText(err)',
      times: 4,
    },
    {
      why: 'The import of errorText.',
      from: "import { dataUrlToBlob } from '@/lib/render/data-url'\n",
      to: "import { dataUrlToBlob } from '@/lib/render/data-url'\nimport { errorText } from '@/types/json-guards'\n",
    },
    {
      why: "A13: the catch-up after a lost answer follows a run with the deadline of its own kind, so this is read outside the file.",
      from: "function timeoutFor(run: OrderRun): number {",
      to: "export function timeoutFor(run: OrderRun): number {",
    },
    {
      why: "A13: a run whose job is with the server, but whose answer did not arrive (the poll ran out of time or the network went away), is marked as such, so its settling note says what happened.",
      from: "  stoppedLate?: boolean\n  refunded?: boolean\n",
      to: "  stoppedLate?: boolean\n  lostTrack?: boolean\n  refunded?: boolean\n",
    },
    {
      why: "A13: settling a lost run clears its mark with the others.",
      from: "interrupted: undefined, stoppedLate: undefined",
      to: "interrupted: undefined, stoppedLate: undefined, lostTrack: undefined",
      times: 3,
    },
    {
      why: "A13: a lost run that settles says that it settled, not that the page was reloaded.",
      from: "  return {\n    ...next,\n    state: 'stopped',\n    note: finished\n      ? 'The page was reloaded while this order ran.",
      to: "  if (run.lostTrack) {\n    return {\n      ...next,\n      state: 'stopped',\n      note: finished\n        ? `Item ${n} has finished on LU Cloud after all and was charged.`\n        : `Item ${n} did not finish on LU Cloud and was refunded.`,\n    }\n  }\n  return {\n    ...next,\n    state: 'stopped',\n    note: finished\n      ? 'The page was reloaded while this order ran.",
    },
    {
      why: "A13: a stop between the submit and the first poll asks the server whether the job was taken back, instead of reporting a refund nobody confirmed.",
      from: "          if (jobId && polling) {\n            try {\n              const res = await deps.cancelJob(jobId)",
      to: "          if (jobId) {\n            try {\n              const res = await deps.cancelJob(jobId)",
    },
    {
      why: "A13: a job the server has (it was sent and polled) whose answer did not arrive is not \"could not start\": it keeps rendering. It is marked lost, and the store follows it to its end (catchUp), as after a reload.",
      from: "        const text = err instanceof HandleError ? err.message : failure.text ?? 'Could not start this item.'\n",
      to: "        const sentId = order.items.find((i) => i.n === item.n)!.runs[index].jobId\n        if (polling && sentId) {\n          emit({\n            ...replaceRun(order, item.n, index, { status: 'failed', refunded: false, error: LOST_TRACK_ERROR, interrupted: true, lostTrack: true }),\n            state: 'stopped',\n            note: `Item ${item.n} is with LU Cloud, but its answer did not arrive (${failure.text ?? 'no reply'}). LU keeps checking; it is charged only if it finishes.`,\n          })\n          return order\n        }\n        const text = err instanceof HandleError ? err.message : failure.text ?? 'Could not start this item.'\n",
    },
    {
      why: "A13: the text of a lost run.",
      from: "export const INTERRUPTED_NOTE =",
      to: "export const LOST_TRACK_ERROR = 'Still with LU Cloud: its answer did not arrive yet.'\nexport const INTERRUPTED_NOTE =",
    },
  ],
  'lib/create/engine.ts': [
    {
      why: 'The desktop compiles with noUnusedParameters; the web does not read this parameter either.',
      from: '  quoteImages?: number,\n): Promise<PresetQuote> {\n  if (measuredByServer(r))',
      to: '  _quoteImages?: number,\n): Promise<PresetQuote> {\n  if (measuredByServer(r))',
    },
  ],
  'stores/createOrderStore.ts': [
    {
      why: "A13: the catch-up follows a run with the deadline of its kind (45 minutes for a clip, 125 for a preset) instead of the 15 minute default, and it can be stopped.",
      from: "  orderIdFromToolResult, resumeInterrupted, settleInterrupted,\n",
      to: "  orderIdFromToolResult, resumeInterrupted, settleInterrupted, timeoutFor,\n",
    },
    {
      why: "A13: the catch-up after a run takes the cancel as well.",
      from: "  catchUp: (orderId: string, deps?: Pick<ExecuteDeps, 'getJob' | 'pollJob'>) => Promise<void>",
      to: "  catchUp: (orderId: string, deps?: Pick<ExecuteDeps, 'getJob' | 'pollJob'> & Partial<Pick<ExecuteDeps, 'cancelJob'>>) => Promise<void>",
    },
    {
      why: "A13: the catch-up after a run takes the cancel as well.",
      from: "void get().catchUp(orderId, { getJob: deps.getJob, pollJob: deps.pollJob })",
      to: "void get().catchUp(orderId, { getJob: deps.getJob, pollJob: deps.pollJob, cancelJob: deps.cancelJob })",
    },
    {
      why: "A13: a followed run has a controller, so the card shows Stop and Stop reaches the server; before, a run resumed after a reload could not be stopped at all.",
      from: "        if (catchingUp.has(orderId) || controllers.has(orderId)) return\n        catchingUp.add(orderId)\n        try {",
      to: "        if (catchingUp.has(orderId) || controllers.has(orderId)) return\n        catchingUp.add(orderId)\n        const controller = new AbortController()\n        controllers.set(orderId, controller)\n        try {",
    },
    {
      why: "A13: the deadline of the run and its Stop.",
      from: "                job = await deps.pollJob(jobId, {})\n",
      to: "                const run = locate(get(), orderId)?.items.find((i) => i.n === n)?.runs[index]\n                try {\n                  job = await deps.pollJob(jobId, { timeoutMs: run ? timeoutFor(run) : undefined, signal: controller.signal })\n                } catch (err) {\n                  if (!controller.signal.aborted) throw err\n                  await (deps.cancelJob ?? cancelJob)(jobId).catch(() => null)\n                  job = await deps.getJob(jobId)\n                }\n",
    },
    {
      why: "A13: the controller goes with the catch-up.",
      from: "        } finally {\n          catchingUp.delete(orderId)\n        }",
      to: "        } finally {\n          catchingUp.delete(orderId)\n          if (controllers.get(orderId) === controller) controllers.delete(orderId)\n        }",
    },
  ],
}

/** The card speaks the desktop's design tokens.
 *
 *  The web and the desktop each have their own ladder for type, control
 *  heights, surfaces and state colours, and the desktop guards its own with
 *  tests (components/__tests__: die-typo-leiter, radius-schatten-hoehe,
 *  zwei-akzente-und-eine-leinwand). A card copied class for class would bring
 *  the web's ladder into the desktop. So the two mirrored components get this
 *  one translation, class by class, everywhere a class occurs; the structure,
 *  the texts and the logic stay the web's. A class listed here that the web
 *  file no longer carries stops the mirror, like a patch.
 *
 *  - type: everything that rounds to 10 px is `.t-micro`; the three sizes
 *    between 11 and 12 px take the 12 px step.
 *  - heights: a control names one of the three control heights; the square
 *    thumbnail tile is no control and is sized as a square.
 *  - surface: the card stands on the panel step.
 *  - done and failed: the greens and reds the desktop uses for state
 *    (lib/hinweis.ts), in both themes. */
export const CLASSES = {
  'components/chat/create/CreateOrder.tsx': [
    ['text-[0.55rem]', 't-micro'],
    ['text-[0.6rem]', 't-micro'],
    ['text-[0.62rem]', 't-micro'],
    ['text-[0.64rem]', 't-micro'],
    ['text-[0.68rem]', 't-micro'],
    ['text-[0.7rem]', 'text-xs'],
    ['text-[0.72rem]', 'text-xs'],
    ['text-[0.74rem]', 'text-xs'],
    ['h-10 w-10', 'size-10'],
    ['h-8', 'h-[var(--control-h-md)]'],
    ['dark:bg-[#1b1b1b]', 'dark:bg-lu-panel'],
    ['text-lu-success', 'text-emerald-600 dark:text-emerald-400'],
    ['bg-lu-success/10', 'bg-emerald-500/10'],
    ['border-lu-success/40', 'border-emerald-500/40'],
    ['text-lu-danger/80', 'text-red-600 dark:text-red-400'],
    ['text-lu-danger', 'text-red-600 dark:text-red-400'],
  ],
  'components/chat/create/CreateMedia.tsx': [
    ['text-[0.62rem]', 't-micro'],
    ['text-[0.64rem]', 't-micro'],
    ['h-9 w-9', 'h-[var(--control-h-md)] w-[var(--control-h-md)]'],
    ['h-9', 'h-[var(--control-h-md)]'],
    ['dark:bg-[#1b1b1b]', 'dark:bg-lu-panel'],
  ],
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** Replaces every listed class, as a whole class only. One pass over the
 *  text, longest name first, so `h-9 w-9` wins over `h-9` and
 *  `text-lu-danger/80` over `text-lu-danger`, and no result is translated a
 *  second time. */
function translateClasses(webPath, text) {
  const pairs = CLASSES[webPath]
  if (!pairs) return text
  const byName = new Map(pairs)
  const names = [...byName.keys()].sort((a, b) => b.length - a.length)
  const seen = new Set()
  const out = text.replace(new RegExp(`(?<![\\w:/\\[-])(?:${names.map(escapeRe).join('|')})(?![\\w/\\]-])`, 'g'), (hit) => {
    seen.add(hit)
    return byName.get(hit)
  })
  const stale = names.filter((n) => !seen.has(n))
  if (stale.length) throw new Error(`${webPath}: a translated class is gone: ${stale.join(', ')}`)
  return out
}

export const HEADER = (webPath) =>
  `// MIRRORED from the web app (${webPath}), without its comments. Do not edit here.\n`
  + '// scripts/create-chat-mirror.mjs writes this file, and web-parity.test.ts\n'
  + '// holds it to its source. Only the import paths differ, the places listed\n'
  + '// under PATCHES in that script, and the classes under CLASSES.\n'

/** A comment the compiler or the linter reads. It stays. */
const DIRECTIVE = /eslint-(disable|enable)|@ts-(expect-error|ignore|nocheck)|@vite-ignore|prettier-ignore|istanbul ignore|v8 ignore|[#@]__PURE__/

/** `text` without its comments. Code, strings and JSX text are untouched: the
 *  comment ranges come from the TypeScript parser, never from a pattern. A
 *  line that held nothing but a comment goes as a whole, and so does a JSX
 *  expression that held nothing but a comment. */
export function stripComments(fileName, text) {
  const tsx = fileName.endsWith('.tsx')
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ESNext, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const ranges = new Map()
  const jsxText = []
  const take = (list) => {
    for (const r of list ?? []) {
      if (!DIRECTIVE.test(text.slice(r.pos, r.end))) ranges.set(r.pos, r.end)
    }
  }
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      jsxText.push([node.pos, node.end])
      return
    }
    if (node.kind === ts.SyntaxKind.JsxExpression && !node.expression) {
      // `{/* ... */}`: nothing is rendered, so the braces go with the comment.
      if (!DIRECTIVE.test(node.getText(sf))) ranges.set(node.getStart(sf), node.getEnd())
      return
    }
    take(ts.getLeadingCommentRanges(text, node.getFullStart()))
    take(ts.getTrailingCommentRanges(text, node.getEnd()))
    for (const child of node.getChildren(sf)) visit(child)
  }
  visit(sf)
  const MARK = '\u0000'
  let out = ''
  let at = 0
  for (const [pos, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (pos < at) continue
    if (jsxText.some(([from, to]) => pos >= from && pos < to)) continue
    out += text.slice(at, pos) + MARK
    at = end
  }
  out += text.slice(at)
  const lines = []
  for (const line of out.split('\n')) {
    if (!line.includes(MARK)) lines.push(line)
    else if (line.split(MARK).join('').trim() !== '') lines.push(line.split(MARK).join('').replace(/\s+$/, ''))
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '')
}

/** The desktop text of one web file. Throws on an import it cannot place.
 *  `comments: true` keeps the web file's comments; only the parity test asks
 *  for that, to compare the two compiled. */
export function mirror(webPath, webText, { comments = false } = {}) {
  const deskPath = MIRRORED[webPath]
  if (!deskPath) throw new Error(`Not a mirrored file: ${webPath}`)
  const fromDir = dirname(deskPath)
  const webDir = dirname(webPath)
  const place = (spec) => {
    let webModule
    if (spec.startsWith('@/')) webModule = spec.slice(2)
    else if (spec.startsWith('.')) webModule = relative('/', resolve('/', webDir, spec))
    else return spec // a package
    const target = MIRRORED_MODULES[webModule] ?? MODULES[webModule]
    if (!target && DESKTOP_ONLY.has(webModule)) return spec
    if (!target) throw new Error(`${webPath}: no desktop module for "${spec}" (${webModule})`)
    const rel = relative(fromDir, target)
    return rel.startsWith('.') ? rel : `./${rel}`
  }
  let patched = webText
  for (const { from, to, times = 1 } of PATCHES[webPath] ?? []) {
    if (patched.split(from).length !== times + 1) throw new Error(`${webPath}: a patched place is gone or no longer occurs ${times} time(s): ${JSON.stringify(from.slice(0, 60))}`)
    patched = patched.split(from).join(to)
  }
  patched = translateClasses(webPath, patched)
  const body = patched
    .replace(/^'use client'\n/, '')
    .replace(/(\bfrom\s+)(['"])([^'"]+)\2/g, (_m, lead, quote, spec) => `${lead}${quote}${place(spec)}${quote}`)
    .replace(/(\bimport\(\s*)(['"])([^'"]+)\2/g, (_m, lead, quote, spec) => `${lead}${quote}${place(spec)}${quote}`)
  return HEADER(webPath) + (comments ? body : stripComments(webPath, body))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const web = process.argv[2] && resolve(process.argv[2], 'apps', 'web')
  if (!web || !existsSync(resolve(web, 'lib/create/order.ts'))) {
    process.stderr.write('Usage: node scripts/create-chat-mirror.mjs <path to the web repo with Create in chat>\n')
    process.exit(1)
  }
  for (const [webPath, deskPath] of Object.entries(MIRRORED)) {
    const out = resolve(DESKTOP_ROOT, deskPath)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, mirror(webPath, readFileSync(resolve(web, webPath), 'utf8')))
    process.stdout.write(`${deskPath}\n`)
  }
}
