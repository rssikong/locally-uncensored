// The oldest web view the phone app is built for, and the check that holds
// the bundle to it.
//
// WHY THIS FILE EXISTS (acceptance on Android 8 GB, find B5). The emulator
// image carried Android System WebView 113, and reading a PDF ended in
// "Promise.withResolvers is not a function". The build lowers SYNTAX to its
// target, but nobody lowers a missing FUNCTION: a call to something the web
// view does not have yet compiles fine and breaks on the phone. Nothing in
// the repository said which web view the app needs, so nothing could notice.
//
// Two things live here:
//   - WEBVIEW_FLOOR: the versions the app promises to run on.
//   - a table of functions and CSS features that are newer than a common
//     web view, each with the version that brought it, and a scan that finds
//     them in built files. A find above the floor fails the phone build
//     (vite.config.ts, webviewTargetPlugin) unless the app carries a polyfill
//     or the call is guarded (POLYFILLED, GUARDED below, each with its proof).
//
// The scan reads text, not a syntax tree: a minified bundle keeps the names
// of built-in methods, and a name is all there is to find. Names that a
// library may also use for a method of its own (`.union(` in a schema
// library) are left out on purpose and listed under NOT_SCANNED.

export interface WebViewFloor {
  /** Android System WebView, the Chromium major version. */
  chrome: number
  /** WKWebView, as the iOS version it ships with (major.minor as a number: 17.4). */
  safari: number
}

/**
 * The floor.
 *
 * iOS 17.0 is what the package declares (src-tauri/tauri.ios.conf.json,
 * minimumSystemVersion). WKWebView is part of the system, so the web view is
 * exactly Safari 17.0 there.
 *
 * Android System WebView 111: the style sheet is the limit. Tailwind 4 builds
 * on `@property`, `color-mix()` and cascade layers, and `color-mix()` came
 * with Chromium 111. Below that the app has no colours. Android itself goes
 * back to version 7 (minSdk 24), but the web view updates through the Play
 * Store on its own and is far newer than the system on any phone that has
 * seen a store. public/webview-check.js tells the user when it is not.
 *
 * The Android number is repeated in public/webview-check.js (plain old
 * script, cannot import). The test src/dev/__tests__/webview-target.test.ts
 * holds the two together, and the iOS number to the package.
 */
export const WEBVIEW_FLOOR: WebViewFloor = { chrome: 111, safari: 17.0 }

/** The same floor as the build target of the phone bundle (vite.config.ts): syntax is lowered to it. */
export const WEBVIEW_BUILD_TARGET: string[] = [`chrome${WEBVIEW_FLOOR.chrome}`, `safari${WEBVIEW_FLOOR.safari.toFixed(1)}`]

export interface Feature {
  id: string
  /** Matched against the text of a built file. */
  pattern: RegExp
  /** First Chromium major version that has it. Infinity: no Chromium has it. */
  chrome: number
  /** First Safari version that has it. Infinity: no Safari has it. */
  safari: number
}

const N = Number.POSITIVE_INFINITY

/** Functions of the language and the platform that came after Chromium 90. */
export const JS_FEATURES: Feature[] = [
  { id: 'Promise.withResolvers', pattern: /\bPromise\.withResolvers\b/g, chrome: 119, safari: 17.4 },
  { id: 'Promise.try', pattern: /\bPromise\.try\(/g, chrome: 128, safari: 18.2 },
  { id: 'Array.fromAsync', pattern: /\bArray\.fromAsync\b/g, chrome: 121, safari: 16.4 },
  { id: 'Object.groupBy', pattern: /\b(?:Object|Map)\.groupBy\b/g, chrome: 117, safari: 17.4 },
  { id: 'Object.hasOwn', pattern: /\bObject\.hasOwn\(/g, chrome: 93, safari: 15.4 },
  { id: 'Set methods', pattern: /\.(?:isSubsetOf|isSupersetOf|isDisjointFrom|symmetricDifference)\(/g, chrome: 122, safari: 17.0 },
  { id: 'Array copy methods', pattern: /\.(?:toSorted|toReversed|toSpliced)\(/g, chrome: 110, safari: 16.0 },
  { id: 'Array.findLast', pattern: /\.(?:findLast|findLastIndex)\(/g, chrome: 97, safari: 15.4 },
  { id: 'Array.at', pattern: /\.at\(-?\d/g, chrome: 92, safari: 15.4 },
  { id: 'structuredClone', pattern: /\bstructuredClone\(/g, chrome: 98, safari: 15.4 },
  { id: 'String.isWellFormed', pattern: /\.(?:isWellFormed|toWellFormed)\(/g, chrome: 111, safari: 16.4 },
  { id: 'Intl.Segmenter', pattern: /\bIntl\.Segmenter\b/g, chrome: 87, safari: 14.1 },
  { id: 'Intl.DurationFormat', pattern: /\bIntl\.DurationFormat\b/g, chrome: 129, safari: 16.4 },
  { id: 'RegExp.escape', pattern: /\bRegExp\.escape\(/g, chrome: 136, safari: 18.2 },
  { id: 'RegExp v flag', pattern: /new RegExp\([^()]{0,200},\s*["'`][dgimsuy]*v[dgimsuy]*["'`]\)/g, chrome: 112, safari: 17.0 },
  { id: 'URL.canParse', pattern: /\bURL\.canParse\(/g, chrome: 120, safari: 17.0 },
  { id: 'URL.parse', pattern: /\bURL\.parse\(/g, chrome: 126, safari: 18.0 },
  { id: 'AbortSignal.any', pattern: /\bAbortSignal\.any\(/g, chrome: 116, safari: 17.4 },
  { id: 'AbortSignal.timeout', pattern: /\bAbortSignal\.timeout\(/g, chrome: 103, safari: 16.0 },
  { id: 'Iterator helpers', pattern: /\bIterator\.(?:from|prototype)\b/g, chrome: 122, safari: 18.4 },
  { id: 'Uint8Array hex and base64', pattern: /\.(?:toHex|setFromHex|setFromBase64)\(|\bUint8Array\.(?:fromHex|fromBase64)\(/g, chrome: 140, safari: 18.2 },
  { id: 'Math.sumPrecise', pattern: /\bMath\.sumPrecise\(/g, chrome: 147, safari: 26.2 },
  { id: 'Map.getOrInsert', pattern: /\.(?:getOrInsert|getOrInsertComputed)\(/g, chrome: 145, safari: 26.2 },
  // Not a name one calls: `for await` itself is old (Chromium 63), walking a
  // ReadableStream with it is new, and the text cannot tell the two apart. So
  // every `for await` is a find, and the exemption below says why none of
  // them breaks (re-check on Android 8 GB, A-04: "t is not async iterable").
  { id: 'ReadableStream async iteration', pattern: /\bfor await\s*\(/g, chrome: 124, safari: N },
  { id: 'ReadableStream.from', pattern: /\bReadableStream\.from\(/g, chrome: N, safari: N },
  { id: 'requestIdleCallback', pattern: /\brequestIdleCallback\(/g, chrome: 47, safari: N },
  { id: 'scheduler', pattern: /\bscheduler\.(?:postTask|yield)\(/g, chrome: 94, safari: N },
  { id: 'navigator.userAgentData', pattern: /\bnavigator\.userAgentData\b/g, chrome: 90, safari: N },
  { id: 'Blob.bytes', pattern: /\.bytes\(\)/g, chrome: 132, safari: 18.0 },
  { id: 'View Transitions', pattern: /\.startViewTransition\(/g, chrome: 111, safari: 18.0 },
  { id: 'Popover', pattern: /\.(?:showPopover|hidePopover|togglePopover)\(/g, chrome: 114, safari: 17.0 },
  { id: 'Element.checkVisibility', pattern: /\.checkVisibility\(/g, chrome: 105, safari: 17.4 },
  { id: 'Element.moveBefore', pattern: /\.moveBefore\(/g, chrome: 133, safari: N },
  { id: 'CSS highlights', pattern: /\bCSS\.highlights\b/g, chrome: 105, safari: 17.2 },
  { id: 'Symbol.dispose', pattern: /\bSymbol\.(?:dispose|asyncDispose)\b/g, chrome: 134, safari: N },
  { id: 'Error.isError', pattern: /\bError\.isError\(/g, chrome: 134, safari: 26.0 },
  { id: 'Array.with', pattern: /\.with\(-?\d+\s*,/g, chrome: 110, safari: 16.0 },
  { id: 'crypto.randomUUID', pattern: /\bcrypto\.randomUUID\(/g, chrome: 92, safari: 15.4 },
  { id: 'Response.json static', pattern: /\bResponse\.json\(/g, chrome: 105, safari: 17.0 },
  { id: 'Temporal', pattern: /\bTemporal\.(?:Now|Instant|PlainDate|ZonedDateTime|Duration)\b/g, chrome: 144, safari: N },
]

/** CSS that came after Chromium 90. */
export const CSS_FEATURES: Feature[] = [
  { id: ':has()', pattern: /:has\(/g, chrome: 105, safari: 15.4 },
  { id: '@container', pattern: /@container\b/g, chrome: 105, safari: 16.0 },
  { id: 'dynamic viewport units', pattern: /\d(?:dvh|dvw|svh|svw|lvh|lvw)\b/g, chrome: 108, safari: 15.4 },
  { id: 'color-mix()', pattern: /\bcolor-mix\(/g, chrome: 111, safari: 16.2 },
  { id: '@layer', pattern: /@layer\b/g, chrome: 99, safari: 15.4 },
  { id: '@property', pattern: /@property\b/g, chrome: 85, safari: 16.4 },
  { id: 'oklch and oklab', pattern: /\bokl(?:ch|ab)\(/g, chrome: 111, safari: 15.4 },
  { id: 'relative colour', pattern: /\b(?:rgb|hsl|oklch|oklab|lab|lch|color)\(from\s/g, chrome: 119, safari: 16.4 },
  { id: 'text-wrap: balance', pattern: /text-wrap(?:-style)?\s*:\s*balance/g, chrome: 114, safari: 17.5 },
  { id: 'text-wrap: pretty', pattern: /text-wrap(?:-style)?\s*:\s*pretty/g, chrome: 117, safari: 26.0 },
  { id: '@starting-style', pattern: /@starting-style\b/g, chrome: 117, safari: 17.5 },
  { id: 'popover', pattern: /:popover-open\b/g, chrome: 114, safari: 17.0 },
  { id: 'anchor positioning', pattern: /\banchor-name\s*:|\bposition-anchor\s*:|\banchor\(/g, chrome: 125, safari: 26.0 },
  { id: 'light-dark()', pattern: /\blight-dark\(/g, chrome: 123, safari: 17.5 },
  { id: 'field-sizing', pattern: /\bfield-sizing\s*:/g, chrome: 123, safari: 26.2 },
  { id: '@scope', pattern: /@scope\b/g, chrome: 118, safari: 17.4 },
  { id: 'transition-behavior', pattern: /\btransition-behavior\s*:|allow-discrete/g, chrome: 117, safari: 17.4 },
  { id: 'interpolate-size', pattern: /\binterpolate-size\s*:|\bcalc-size\(/g, chrome: 129, safari: N },
  { id: 'view transitions', pattern: /\bview-transition-name\s*:|@view-transition\b|::view-transition/g, chrome: 111, safari: 18.0 },
  { id: 'scroll driven animation', pattern: /\b(?:animation-timeline|view-timeline|scroll-timeline)(?:-name|-axis)?\s*:/g, chrome: 115, safari: 26.0 },
  { id: 'linear() easing', pattern: /[:,\s]linear\(/g, chrome: 113, safari: 17.2 },
  { id: 'subgrid', pattern: /:\s*subgrid\b/g, chrome: 117, safari: 16.0 },
  { id: 'scrollbar-width', pattern: /\bscrollbar-width\s*:/g, chrome: 121, safari: 18.2 },
  { id: 'scrollbar-color', pattern: /\bscrollbar-color\s*:/g, chrome: 121, safari: 26.2 },
  { id: 'scrollbar-gutter', pattern: /\bscrollbar-gutter\s*:/g, chrome: 94, safari: 18.2 },
  { id: 'content-visibility', pattern: /\bcontent-visibility\s*:/g, chrome: 85, safari: 18.0 },
  { id: 'text-box-trim', pattern: /\btext-box(?:-trim|-edge)?\s*:/g, chrome: 133, safari: 18.2 },
  { id: 'CSS nesting', pattern: /[{;}]\s*&[\s.:#[>+~]/g, chrome: 112, safari: 16.5 },
  { id: 'range media query', pattern: /@media[^{]*\((?:width|height)\s*[<>]=?/g, chrome: 104, safari: 16.4 },
  { id: 'lh unit', pattern: /\d(?:lh|rlh)\b/g, chrome: 109, safari: 16.4 },
  { id: 'round() mod() rem()', pattern: /[:\s(,](?:round|mod|rem)\(/g, chrome: 125, safari: 15.4 },
  { id: ':user-valid', pattern: /:user-(?:valid|invalid)\b/g, chrome: 119, safari: 16.5 },
]

export interface Find {
  feature: Feature
  count: number
  /** A little of the text around the first match, for the report. */
  sample: string
}

export function scanText(text: string, features: Feature[]): Find[] {
  const finds: Find[] = []
  for (const feature of features) {
    const pattern = new RegExp(feature.pattern.source, feature.pattern.flags.includes('g') ? feature.pattern.flags : `${feature.pattern.flags}g`)
    let count = 0
    let sample = ''
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      if (count === 0) sample = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, ' ')
      count += 1
      if (m[0].length === 0) pattern.lastIndex += 1
    }
    if (count > 0) finds.push({ feature, count, sample })
  }
  return finds
}

export const scanJs = (text: string): Find[] => scanText(text, JS_FEATURES)
export const scanCss = (text: string): Find[] => scanText(text, CSS_FEATURES)

/** Is the feature missing somewhere on or above the floor? */
export function aboveFloor(feature: Feature, floor: WebViewFloor = WEBVIEW_FLOOR): boolean {
  return feature.chrome > floor.chrome || feature.safari > floor.safari
}

// ── What may stand in the bundle although it is above the floor ─────────────

export interface Exemption {
  /** Feature id, as in the tables above. */
  feature: string
  /** Which built files it covers (path inside the output, e.g. assets/pdf-abc.js). */
  file: RegExp
  /** Why the find does not break an old web view. */
  why: string
}

/** The built files of pdf.js: its page half, its worker as it comes, and our worker around it. */
export const PDFJS_FILES = /(?:^|\/)pdf(?:[.-]worker)?(?:[.-](?:min|compat))?-[\w-]+\.m?js$/

const pdfjs = (feature: string, why: string): Exemption => ({ feature, file: PDFJS_FILES, why })
const BRINGS = 'pdf.js legacy carries core-js for it (measured: src/api/__tests__/rag-pdf-old-webview.test.ts)'
const OURS = 'installed where missing, on the page and in the worker (src/lib/webview-polyfills.ts, src/lib/pdf-worker-compat.ts)'
const DEGRADES = 'style only: without it the page looks slightly different and works the same'

export const EXEMPTIONS: Exemption[] = [
  pdfjs('Math.sumPrecise', BRINGS),
  pdfjs('Map.getOrInsert', BRINGS),
  pdfjs('Uint8Array hex and base64', BRINGS),
  pdfjs('Promise.try', BRINGS),
  pdfjs('URL.parse', BRINGS),
  pdfjs('Iterator helpers', BRINGS),
  pdfjs('Promise.withResolvers', OURS),
  pdfjs('AbortSignal.any', OURS),
  {
    feature: 'ReadableStream async iteration',
    file: /\.m?js$/,
    why: 'over an async generator the loop is as old as Chromium 63; over a stream it is installed where missing: in the first step of the start of the phone app (src/mobile/boot/index.tsx), before a PDF is read (src/api/rag.ts) and in the worker of pdf.js (src/lib/pdf-worker-compat.ts). Measured: src/api/__tests__/rag-pdf-stream-iteration.test.ts',
  },
  pdfjs('Blob.bytes', 'pdf.js legacy sets Response.bytes and Blob.bytes itself where they are missing'),
  // Code the phone shares with the desktop joins abort signals this way. The phone installs the function
  // as the first step of its start (src/mobile/boot/index.tsx, bootMobile), before any of that code runs.
  { feature: 'AbortSignal.any', file: /\.m?js$/, why: 'installed where missing as the first step of the phone start (src/mobile/boot/index.tsx)' },
  // The voice surface of the desktop. The phone never loads it (components/layout/AppShell.tsx is its only
  // importer), and the find is a method of the call client's own reader, not of Blob.
  { feature: 'Blob.bytes', file: /(?:^|\/)VoiceView-[\w-]+\.js$/, why: 'the voice surface of the desktop, never loaded by the phone' },
  { feature: 'scrollbar-width', file: /\.css$/, why: `${DEGRADES} (the ::-webkit-scrollbar rules beside it hide the bar)` },
  { feature: 'scrollbar-color', file: /\.css$/, why: DEGRADES },
  { feature: 'text-wrap: balance', file: /\.css$/, why: DEGRADES },
  { feature: 'content-visibility', file: /\.css$/, why: 'a speed hint for long chats, no effect on what is shown' },
  { feature: 'relative colour', file: /\.css$/, why: 'only inside an @supports test of the Tailwind base layer' },
]

export interface BuiltFile {
  /** Path inside the output. */
  name: string
  text: string
}

export interface Violation {
  file: string
  feature: string
  chrome: number
  safari: number
  count: number
  sample: string
}

/**
 * `backdrop-filter` needs its `-webkit-` twin before Safari 18. True when a
 * style sheet declares it more often without the twin than with it.
 */
export function backdropFilterWithoutPrefix(css: string): boolean {
  const all = css.match(/(?:^|[;{\s])(?:-webkit-)?backdrop-filter\s*:/g) ?? []
  const prefixed = all.filter((m) => m.includes('-webkit-')).length
  return all.length - prefixed > prefixed
}

/** Everything in the built files that an old web view on the floor does not have and nothing covers. */
export function checkBundle(files: BuiltFile[], floor: WebViewFloor = WEBVIEW_FLOOR, exemptions: Exemption[] = EXEMPTIONS): Violation[] {
  const out: Violation[] = []
  for (const file of files) {
    const css = /\.css$/.test(file.name)
    if (!css && !/\.m?js$/.test(file.name)) continue
    for (const find of css ? scanCss(file.text) : scanJs(file.text)) {
      if (!aboveFloor(find.feature, floor)) continue
      if (exemptions.some((e) => e.feature === find.feature.id && e.file.test(file.name))) continue
      out.push({ file: file.name, feature: find.feature.id, chrome: find.feature.chrome, safari: find.feature.safari, count: find.count, sample: find.sample })
    }
    if (css && floor.safari < 18 && backdropFilterWithoutPrefix(file.text)) {
      out.push({ file: file.name, feature: 'backdrop-filter without -webkit-', chrome: 76, safari: 18, count: 1, sample: '' })
    }
  }
  return out
}

export function describeViolations(violations: Violation[], floor: WebViewFloor = WEBVIEW_FLOOR): string {
  const version = (n: number) => (Number.isFinite(n) ? String(n) : 'never')
  const lines = violations.map((v) => `  ${v.file}: ${v.feature} (Chromium ${version(v.chrome)}, Safari ${version(v.safari)}), ${v.count}x${v.sample ? `, near "${v.sample.slice(0, 100)}"` : ''}`)
  return [
    `The phone bundle uses ${violations.length === 1 ? 'something' : 'things'} that the oldest web view the app is built for does not have`,
    `(Android System WebView ${floor.chrome}, iOS ${floor.safari.toFixed(1)}; src/dev/webview-target.ts):`,
    ...lines,
    'Use something older, add a polyfill to src/lib/webview-polyfills.ts, or, when the call is guarded or harmless, add an exemption with its reason.',
  ].join('\n')
}
