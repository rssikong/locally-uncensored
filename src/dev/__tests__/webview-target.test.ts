/**
 * The oldest web view the phone app is built for, held in one place.
 *
 * Acceptance on Android 8 GB, find B5: Android System WebView 113 and
 * "Promise.withResolvers is not a function" in the middle of reading a PDF.
 * Nothing said which web view the app needs, so nothing noticed.
 *
 * What this file holds:
 *   - the floor and every place that repeats it say the same,
 *   - the scan finds what it is meant to find and the phone build asks it,
 *   - the app's own source uses nothing above the floor,
 *   - the one dependency that does (pdf.js) uses nothing that is not covered,
 *     and its worker file, which the bundler copies as it is, parses as the
 *     syntax a web view at the floor reads.
 * The built bundle itself is checked in every phone build (vite.config.ts,
 * webviewTargetPlugin): `VITE_LU_STORE_PRESET=open npx vite build`.
 *
 * Run: npx vitest run src/dev/__tests__/webview-target.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { parse } from 'acorn'
import {
  CSS_FEATURES, EXEMPTIONS, JS_FEATURES, PDFJS_FILES, WEBVIEW_BUILD_TARGET, WEBVIEW_FLOOR,
  aboveFloor, backdropFilterWithoutPrefix, checkBundle, describeViolations, scanCss, scanJs,
} from '../webview-target'

const root = resolve(__dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('the floor', () => {
  it('is Android System WebView 111 and iOS 17.0', () => {
    expect(WEBVIEW_FLOOR).toEqual({ chrome: 111, safari: 17.0 })
    expect(WEBVIEW_BUILD_TARGET).toEqual(['chrome111', 'safari17.0'])
  })

  it('iOS: the package installs from the same version on', () => {
    const conf = JSON.parse(read('src-tauri/tauri.ios.conf.json')) as { bundle: { iOS: { minimumSystemVersion: string } } }
    expect(Number.parseFloat(conf.bundle.iOS.minimumSystemVersion)).toBe(WEBVIEW_FLOOR.safari)
  })

  it('Android: the notice for a web view that is too old names the same version', () => {
    expect(read('public/webview-check.js')).toContain(`var FLOOR = ${WEBVIEW_FLOOR.chrome}\n`)
  })

  it('the style sheet is the reason for 111: color-mix() came with it, and the app is full of it', () => {
    const colorMix = CSS_FEATURES.find((f) => f.id === 'color-mix()')
    expect(colorMix?.chrome).toBe(WEBVIEW_FLOOR.chrome)
    expect(read('src/mobile/styles/components.css')).toMatch(/color-mix\(/)
  })

  it('the phone build is built for it and checked against it, the desktop package is left alone', () => {
    const config = read('vite.config.ts')
    expect(config).toContain("const PHONE_BUNDLE = process.env.VITE_LU_BUILD_TARGET === 'mobile'")
    // The same spread hands the phone bundle its version (src/dev/phone-version.ts); the desktop gets neither.
    expect(config).toContain('...(PHONE_BUNDLE ? { build: { target: WEBVIEW_BUILD_TARGET }, define: PHONE_DEFINE } : {})')
    expect(config).toContain('if (!PHONE_BUNDLE) return')
    expect(config).toMatch(/plugins: \[[^\]]*webviewTargetPlugin\(\)/)
  })
})

describe('the scan', () => {
  it('finds the functions the task named, in minified text', () => {
    const js = 'let{promise:a,resolve:b}=Promise.withResolvers();x.toSorted();Object.groupBy(l,f);s.isSubsetOf(t);structuredClone(o);l.at(-1);l.findLast(f);new Intl.Segmenter;document.startViewTransition(f);e.showPopover();AbortSignal.any([a,b]);URL.canParse(u);new RegExp(p,"v")'
    expect(scanJs(js).map((f) => f.feature.id).sort()).toEqual([
      'AbortSignal.any', 'Array copy methods', 'Array.at', 'Array.findLast', 'Intl.Segmenter', 'Object.groupBy', 'Popover',
      'Promise.withResolvers', 'RegExp v flag', 'Set methods', 'URL.canParse', 'View Transitions', 'structuredClone',
    ])
    const css = '.a:has(.b){height:100dvh;color:color-mix(in srgb,red,blue)}@container (width>=10rem){.c{}}@layer x{}@starting-style{.d{}}.e:popover-open{}.f{view-transition-name:g;text-wrap:balance}'
    expect(scanCss(css).map((f) => f.feature.id).sort()).toEqual([
      ':has()', '@container', '@layer', '@starting-style', 'color-mix()', 'dynamic viewport units', 'popover', 'text-wrap: balance', 'view transitions',
    ].sort())
  })

  it('finds a for await, which is how a stream is walked (A-04), and counts it above the floor', () => {
    const finds = scanJs('for await(const t of e){i.push(t)}')
    expect(finds.map((f) => f.feature.id)).toEqual(['ReadableStream async iteration'])
    expect(aboveFloor(finds[0].feature)).toBe(true)
    expect(aboveFloor(finds[0].feature, { chrome: 124, safari: Number.POSITIVE_INFINITY })).toBe(false)
  })

  it('a name alone is not a call', () => {
    expect(scanJs('t.push(`promise-with-resolvers`);typeof n.withResolvers!=`function`')).toEqual([])
    expect(scanJs('z.union([a,b]);i.toBase64(x)')).toEqual([])
  })

  it('what is above the floor fails the bundle with the file, the feature and the versions', () => {
    const violations = checkBundle([
      { name: 'assets/ChatPage-abc.js', text: 'const{promise:p}=Promise.withResolvers();l.at(-1)' },
      { name: 'assets/boot-abc.css', text: '.a{color:color-mix(in srgb,red,blue)}@starting-style{.a{opacity:0}}' },
      { name: 'assets/logo.svg', text: 'Promise.withResolvers()' },
    ])
    expect(violations.map((v) => `${v.file}: ${v.feature}`)).toEqual(['assets/ChatPage-abc.js: Promise.withResolvers', 'assets/boot-abc.css: @starting-style'])
    const text = describeViolations(violations)
    expect(text).toContain('Android System WebView 111, iOS 17.0')
    expect(text).toContain('assets/ChatPage-abc.js: Promise.withResolvers (Chromium 119, Safari 17.4), 1x')
  })

  it('an exemption covers its files only', () => {
    const call = 'let{promise:a}=Promise.withResolvers()'
    expect(checkBundle([{ name: 'assets/pdf-C6QIdXXT.js', text: call }, { name: 'assets/pdf.worker.min-BmVo14Nb.mjs', text: call }, { name: 'assets/pdf-worker-compat-BjSu16nx.js', text: call }])).toEqual([])
    expect(checkBundle([{ name: 'assets/pdfview-abc.js', text: call }])).toHaveLength(1)
    for (const name of ['assets/index-abc.js', 'assets/ChatPage-abc.js', 'assets/boot-abc.js']) expect(PDFJS_FILES.test(name), name).toBe(false)
    for (const e of EXEMPTIONS) {
      expect(e.why.length, e.feature).toBeGreaterThan(20)
      expect([...JS_FEATURES, ...CSS_FEATURES].some((f) => f.id === e.feature), e.feature).toBe(true)
    }
  })

  it('backdrop-filter needs its -webkit- twin before Safari 18', () => {
    expect(backdropFilterWithoutPrefix('.a{-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}')).toBe(false)
    expect(backdropFilterWithoutPrefix('.a{backdrop-filter:blur(4px)}')).toBe(true)
    expect(checkBundle([{ name: 'assets/x.css', text: '.a{backdrop-filter:blur(4px)}' }]).map((v) => v.feature)).toEqual(['backdrop-filter without -webkit-'])
  })
})

/**
 * Every source file of the app that ends up in a bundle, with '/' between the
 * parts on every system: the checks below compare the names as the repo writes
 * them (`src/mobile/`, `src/dev/webview-target.js`). With the separator of a
 * Windows host none of them matched, and `startsWith('src/mobile/')` held
 * without having looked. The prefix is cut off by length, so `root` keeps its own.
 */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'test-support' || name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.(?:tsx?|css)$/.test(name) && !/\.(?:test|d)\.tsx?$/.test(name)) out.push(path.split(sep).join('/'))
  }
  return out
}

/** Source without its comment lines: a comment may name what the code avoids. */
function withoutCommentLines(text: string): string {
  return text.split('\n').filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line)).join('\n')
}

/**
 * Source the phone never loads, with a find above the floor. Each entry names
 * the only place that imports the file, and the test below checks that this
 * is still so.
 */
const DESKTOP_ONLY: Array<{ file: string; feature: string; onlyImportedBy: string }> = []

describe("the app's own source", () => {
  it('the phone installs the missing functions as the first step of its start, and the voice surface is the desktop\'s alone', () => {
    // The exemption for AbortSignal.any in shared code rests on this line standing first in bootMobile.
    const boot = readFileSync(resolve(root, 'src/mobile/boot/index.tsx'), 'utf8')
    const start = boot.indexOf('export async function bootMobile()')
    expect(start).toBeGreaterThan(0)
    const firstStatement = boot.slice(start).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).slice(1, 3)
    expect(firstStatement).toEqual(['try {', 'ensureWebViewPolyfills()'])
    // The exemption for the voice chunk rests on the phone not importing it.
    const importers = sources(resolve(root, 'src'))
      .filter((path) => !path.includes('__tests__'))
      .filter((path) => /from ['"][^'"]*\/VoiceView['"]|import\(['"][^'"]*\/VoiceView['"]\)/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(root.length + 1))
    expect(importers.length).toBeGreaterThan(0)
    for (const path of importers) expect(path.startsWith('src/mobile/'), path).toBe(false)
  })

  const paths = sources(resolve(root, 'src'))

  it('uses nothing above the floor', () => {
    const files = paths.map((path) => ({
      // Named as the built file would be, so the same rules apply: script or style sheet.
      name: path.slice(root.length + 1).replace(/\.tsx?$/, '.js'),
      text: withoutCommentLines(readFileSync(path, 'utf8')),
    }))
    expect(files.length).toBeGreaterThan(500)
    // The table and the polyfills name what they are about.
    const own = files.filter((f) => !/^src\/dev\/webview-target\.js$|^src\/lib\/webview-polyfills\.js$/.test(f.name))
    const violations = checkBundle(own)
      // Nested rules in a source style sheet are flattened by the build for its target.
      .filter((v) => v.feature !== 'CSS nesting')
      .filter((v) => !DESKTOP_ONLY.some((d) => d.file === v.file && d.feature === v.feature))
    expect(violations.map((v) => `${v.file}: ${v.feature} near "${v.sample}"`)).toEqual([])
  })

  it('what is left out as desktop only is imported by the desktop only', () => {
    for (const entry of DESKTOP_ONLY) {
      const base = entry.file.replace(/^.*\//, '').replace(/\.js$/, '')
      const importers = paths
        .filter((path) => new RegExp(`from ['"][^'"]*/${base}['"]|import\\(['"][^'"]*/${base}['"]\\)`).test(readFileSync(path, 'utf8')))
        .map((path) => path.slice(root.length + 1))
      expect(importers, entry.file).toEqual([entry.onlyImportedBy])
      expect(entry.onlyImportedBy.startsWith('src/mobile/')).toBe(false)
    }
  })
})

describe('pdf.js, the one dependency that reaches above the floor', () => {
  const dir = 'node_modules/pdfjs-dist/legacy/build'
  const page = read(`${dir}/pdf.mjs`)
  const worker = read(`${dir}/pdf.worker.min.mjs`)

  it('uses above the floor only what is covered, and the list of exemptions has no dead entry', () => {
    const used = new Set<string>()
    for (const text of [page, worker]) for (const find of scanJs(text)) if (aboveFloor(find.feature)) used.add(find.feature.id)
    const covered = new Set(EXEMPTIONS.filter((e) => e.file.test('assets/pdf-abc.js')).map((e) => e.feature))
    expect([...used].filter((id) => !covered.has(id))).toEqual([])
    expect([...covered].filter((id) => !used.has(id))).toEqual([])
  })

  it('the app asks for the legacy build and installs its two functions before pdf.js loads, on the page and in the worker', () => {
    const rag = read('src/api/rag.ts')
    const install = rag.indexOf('const missing = ensureWebViewPolyfills()')
    const load = rag.indexOf('await import("pdfjs-dist/legacy/build/pdf.mjs")')
    expect(install).toBeGreaterThan(0)
    expect(load).toBeGreaterThan(install)
    expect(rag).toContain('new Worker(new URL("../lib/pdf-worker-compat.ts", import.meta.url), { type: "module" })')
    // Imports run in the order they stand in.
    const compat = read('src/lib/pdf-worker-compat.ts').split('\n').filter((line) => line.startsWith('import '))
    expect(compat).toEqual(["import './pdf-worker-compat-install'", "import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'"])
    expect(read('src/lib/pdf-worker-compat-install.ts')).toContain('installWebViewPolyfills()')
  })

  it('walks a stream with for await on the page and in the worker, and what covers that is installed first in all three places', () => {
    // The exemption for this covers every script, so its three claims are held here.
    for (const text of [page, worker]) expect(scanJs(text).some((f) => f.feature.id === 'ReadableStream async iteration')).toBe(true)
    const polyfills = read('src/lib/webview-polyfills.ts')
    expect(polyfills).toContain("Object.defineProperty(S, Symbol.asyncIterator, { configurable: true, writable: true, value: values })")
    // 1. The start of the phone app: the first statement of bootMobile.
    const boot = read('src/mobile/boot/index.tsx')
    const body = boot.slice(boot.indexOf('export async function bootMobile()'))
    const firstStatement = body.split('\n').slice(1).map((line) => line.trim()).filter((line) => line && !line.startsWith('//') && line !== 'try {')[0]
    expect(firstStatement).toBe('ensureWebViewPolyfills()')
    // 2. Before a PDF is read and 3. in the worker: the test above.
    expect(read('src/api/rag.ts')).toContain('const missing = ensureWebViewPolyfills()')
    expect(read('src/lib/pdf-worker-compat-install.ts')).toContain('installWebViewPolyfills()')
  })

  it('its files parse as the syntax a web view at the floor reads (ECMAScript 2022)', () => {
    // The worker file is copied into the package as it is: no build step lowers it.
    for (const text of [worker, page]) expect(() => parse(text, { ecmaVersion: 2022, sourceType: 'module' })).not.toThrow()
    // The parser does tell: a regular expression with the v flag came with Chromium 112.
    expect(() => parse('const r = /[\\p{L}--[a-z]]/v', { ecmaVersion: 2022, sourceType: 'module' })).toThrow()
  })
})
