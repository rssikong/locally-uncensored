/**
 * Acceptance on Android 8 GB, find B5: a PDF could not be read on Android
 * System WebView 113, "Failed to extract text ...: Promise.withResolvers is
 * not a function". The same holds for iOS before 17.4.
 *
 * This file takes away from the test runtime what a web view on the floor of
 * the app (Chromium 111, src/dev/webview-target.ts) does not have, and reads
 * a PDF through the real path of the app. Without a worker in the runtime
 * pdf.js loads its worker code into the same realm, so both halves of pdf.js
 * run against the same missing functions.
 *
 * Two claims are held here:
 *   - with the functions of lib/webview-polyfills.ts the text comes out,
 *   - everything else pdf.js needs above the floor it brings along (the
 *     exemptions "BRINGS" in src/dev/webview-target.ts rest on this).
 * And the cross-check: without our two functions the same read fails with
 * the sentence from the report.
 *
 * Run: npx vitest run src/api/__tests__/rag-pdf-old-webview.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type Bag = Record<string, unknown>
const taken: Array<{ owner: object; key: string | symbol; descriptor: PropertyDescriptor }> = []

function take(owner: unknown, ...keys: Array<string | symbol>): void {
  if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')) return
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key)
    if (!descriptor) continue
    if (!descriptor.configurable) continue
    taken.push({ owner: owner as object, key, descriptor })
    delete (owner as Record<string | symbol, unknown>)[key]
  }
}

/** Everything that came to Chromium after version 111 and that pdf.js could reach for. */
function standOnChromium111(): void {
  const g = globalThis as unknown as Bag
  take(Promise, 'withResolvers', 'try')
  take(Array, 'fromAsync')
  take(Object, 'groupBy')
  take(Map, 'groupBy')
  take(Set.prototype, 'union', 'intersection', 'difference', 'symmetricDifference', 'isSubsetOf', 'isSupersetOf', 'isDisjointFrom')
  take(URL, 'parse', 'canParse')
  take(AbortSignal, 'any')
  // Walking a stream with `for await` came with Chromium 124 (re-check on
  // Android 8 GB, A-04: "t is not async iterable" on web view 113).
  take(ReadableStream.prototype, Symbol.asyncIterator, 'values')
  take(Response.prototype, 'bytes')
  take(Blob.prototype, 'bytes')
  take(ArrayBuffer.prototype, 'transfer', 'transferToFixedLength', 'detached')
  take(Uint8Array.prototype, 'toHex', 'toBase64', 'setFromHex', 'setFromBase64')
  take(Uint8Array, 'fromHex', 'fromBase64')
  take(Math, 'sumPrecise', 'f16round')
  take(Map.prototype, 'getOrInsert', 'getOrInsertComputed')
  take(WeakMap.prototype, 'getOrInsert', 'getOrInsertComputed')
  take(RegExp, 'escape')
  take(Error, 'isError')
  const iteratorProto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))
  take(iteratorProto, 'map', 'filter', 'take', 'drop', 'flatMap', 'reduce', 'toArray', 'forEach', 'some', 'every', 'find')
  take(g, 'Iterator', 'Float16Array')
}

function giveBack(): void {
  for (const { owner, key, descriptor } of taken.reverse()) Object.defineProperty(owner, key, descriptor)
  taken.length = 0
}

function buildPdf(objects: string[]): Uint8Array {
  let out = '%PDF-1.7\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

function textPdf(pages: string[]): File {
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')
  const objects = ['<</Type/Catalog/Pages 2 0 R>>', `<</Type/Pages/Kids[${kids}]/Count ${pages.length}>>`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>']
  pages.forEach((text, i) => {
    const body = `BT /F1 12 Tf 20 200 Td (${text}) Tj ET`
    objects.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents ${5 + i * 2} 0 R/Resources<</Font<</F1 3 0 R>>>>>>`)
    objects.push(`<</Length ${body.length}>>\nstream\n${body}\nendstream`)
  })
  return new File([buildPdf(objects) as unknown as BlobPart], 'harrowgate-logbook.pdf', { type: 'application/pdf' })
}

const PAGES = ['The Harrowgate logbook opens in March.', 'The keeper of the light is called Imre Vantongeren.', 'Page three ends the log.']

describe('reading a PDF on a web view at the floor of the app', () => {
  beforeAll(async () => {
    standOnChromium111()
    // pdf.js is evaluated here, with the functions gone: what it brings along it installs now.
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    // The worker file rag.ts asks for is resolved by the bundler in the app. In this runtime the copy on disk is handed in.
    const onDisk = pathToFileURL(resolve(__dirname, '../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')).href
    Object.defineProperty(pdfjsLib.GlobalWorkerOptions, 'workerSrc', { configurable: true, get: () => onDisk, set: () => undefined })
  })
  afterAll(giveBack)

  it('the runtime of this test really is missing what the report named', () => {
    expect(typeof (Promise as unknown as Bag).withResolvers).toBe('undefined')
    expect(typeof (AbortSignal as unknown as Bag).any).toBe('undefined')
    expect(Symbol.asyncIterator in ReadableStream.prototype).toBe(false)
    // Response.bytes and Blob.bytes were taken away as well. pdf.js put its own in place while it loaded.
    expect(typeof (Blob.prototype as unknown as Bag).bytes).toBe('function')
  })

  it('cross-check: without our functions pdf.js fails with the sentence of the report', async () => {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(await textPdf(PAGES).arrayBuffer())
    let message = ''
    try {
      await pdfjsLib.getDocument({ data }).promise
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).toContain('Promise.withResolvers is not a function')
  })

  it('with them the text of every page comes out, through the path of the app', async () => {
    const { __resetWebViewPolyfillsForTests } = await import('../../lib/webview-polyfills')
    __resetWebViewPolyfillsForTests()
    const { extractText } = await import('../rag')
    const text = await extractText(textPdf(PAGES))
    for (const page of PAGES) expect(text).toContain(page)
    expect(text.split('\n\n')).toHaveLength(PAGES.length)
    // The two were installed by the read itself, nothing else stood in for them.
    expect(typeof (Promise as unknown as Bag).withResolvers).toBe('function')
    const { ensureWebViewPolyfills } = await import('../../lib/webview-polyfills')
    expect(ensureWebViewPolyfills()).toEqual(['promise-with-resolvers', 'abort-signal-any', 'readable-stream-async-iterator'])
  })
})
