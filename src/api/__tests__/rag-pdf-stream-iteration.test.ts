/**
 * Re-check on Android 8 GB, A-04: a PDF could not be read on Android System
 * WebView 113, 2 of 2:
 *
 *   Failed to extract text from "harrowgate-logbook.pdf": t is not async iterable
 *
 * pdf.js collects the text of a page with `for await` over a ReadableStream
 * (PDFPageProxy.getTextContent). A stream can be walked that way from
 * Chromium 124 on, and the floor of the app is 111
 * (src/dev/webview-target.ts). The two functions that were installed for the
 * first report (B5) got pdf.js past opening the document, and this was the
 * next thing missing.
 *
 * This file takes exactly that one thing away from the test runtime, which is
 * what a web view from 119 to 123 looks like, and reads a real small PDF. The
 * whole floor at once is held in rag-pdf-old-webview.test.ts.
 *
 * Run: npx vitest run src/api/__tests__/rag-pdf-stream-iteration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const proto = ReadableStream.prototype as unknown as Record<string | symbol, unknown>
const kept: Array<[string | symbol, PropertyDescriptor]> = []

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

describe('reading a PDF where a stream cannot be walked with for await', () => {
  beforeAll(async () => {
    for (const key of [Symbol.asyncIterator, 'values'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, key)
      if (!descriptor) continue
      kept.push([key, descriptor])
      delete proto[key]
    }
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const onDisk = pathToFileURL(resolve(__dirname, '../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')).href
    Object.defineProperty(pdfjsLib.GlobalWorkerOptions, 'workerSrc', { configurable: true, get: () => onDisk, set: () => undefined })
  })
  afterAll(() => {
    for (const [key, descriptor] of kept) Object.defineProperty(proto, key, descriptor)
  })

  it('the runtime of this test is missing it, and pdf.js did not bring it along', () => {
    expect(kept.map(([key]) => key)).toContain(Symbol.asyncIterator)
    expect(Symbol.asyncIterator in proto).toBe(false)
  })

  it('cross-check: without it pdf.js opens the file and fails at the text, with the sentence of the report', async () => {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(await textPdf(PAGES).arrayBuffer())
    const task = pdfjsLib.getDocument({ data })
    const doc = await task.promise
    const page = await doc.getPage(1)
    let message = ''
    try {
      await page.getTextContent()
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).toContain('is not async iterable')
    await task.destroy()
  })

  it('through the path of the app the text of every page comes out', async () => {
    const { __resetWebViewPolyfillsForTests, ensureWebViewPolyfills } = await import('../../lib/webview-polyfills')
    __resetWebViewPolyfillsForTests()
    const { extractText } = await import('../rag')
    const text = await extractText(textPdf(PAGES))
    for (const page of PAGES) expect(text).toContain(page)
    expect(text.split('\n\n')).toHaveLength(PAGES.length)
    // Installed by the read itself, and nothing else was missing here.
    expect(ensureWebViewPolyfills()).toEqual(['readable-stream-async-iterator'])
    expect(typeof proto[Symbol.asyncIterator]).toBe('function')
  })
})
