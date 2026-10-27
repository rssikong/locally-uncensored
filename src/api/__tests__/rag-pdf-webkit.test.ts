/**
 * PDF text extraction on an engine without ReadableStream async iteration.
 *
 * The Mac app (3.0.7, macOS 26 WKWebView) failed on every PDF in the Documents
 * panel with "undefined is not a function (near '...e of t...')": pdf.js 6's
 * `page.getTextContent()` reads its stream with `for await`, and WebKit has no
 * `ReadableStream.prototype[Symbol.asyncIterator]`. Node has it, so
 * rag-pdf-eval.test.ts stayed green. This file takes it away the way WebKit
 * lacks it and reads a PDF anyway.
 *
 * Run: npx vitest run src/api/__tests__/rag-pdf-webkit.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractText } from '../rag'

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

const stream = (dict: string, body: string) => `<<${dict}/Length ${body.length}>>\nstream\n${body}\nendstream`

function textPdf(text: string): Uint8Array {
  return buildPdf([
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[4 0 R]/Count 1>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents 5 0 R/Resources<</Font<</F1 3 0 R>>>>>>',
    stream('', `BT /F1 12 Tf 20 200 Td (${text}) Tj ET`),
  ])
}

/** What a scanner produces: a page that paints one picture and has no text. */
function scannedPdf(): Uint8Array {
  return buildPdf([
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents 4 0 R/Resources<</XObject<</Im0 5 0 R>>>>>>',
    stream('', 'q 300 0 0 300 0 0 cm /Im0 Do Q'),
    stream('/Type/XObject/Subtype/Image/Width 2/Height 2/ColorSpace/DeviceGray/BitsPerComponent 8', '\x00\xff\xff\x00'),
  ])
}

const asFile = (bytes: Uint8Array, name: string) =>
  new File([bytes as unknown as BlobPart], name, { type: 'application/pdf' })

const proto = ReadableStream.prototype as unknown as Record<PropertyKey, unknown>
const saved = {
  asyncIterator: Object.getOwnPropertyDescriptor(proto, Symbol.asyncIterator),
  values: Object.getOwnPropertyDescriptor(proto, 'values'),
}

beforeAll(async () => {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // Same worker hand-off as rag-pdf-eval.test.ts: Vite rewrites the worker URL
  // for the client build only, so point pdf.js at the copy on disk.
  const onDisk = pathToFileURL(
    resolve(__dirname, '../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
  ).href
  Object.defineProperty(pdfjsLib.GlobalWorkerOptions, 'workerSrc', {
    configurable: true,
    get: () => onDisk,
    set: () => {},
  })
  // WebKit as measured in the packaged app: both typeof checks said "undefined".
  delete proto[Symbol.asyncIterator]
  delete proto.values
})

afterAll(() => {
  if (saved.asyncIterator) Object.defineProperty(proto, Symbol.asyncIterator, saved.asyncIterator)
  if (saved.values) Object.defineProperty(proto, 'values', saved.values)
})

describe('PDF extraction without ReadableStream async iteration (WKWebView)', () => {
  it('runs with the iterator really gone', () => {
    expect(proto[Symbol.asyncIterator]).toBeUndefined()
  })

  it('reads the text out of a text PDF', async () => {
    const text = await extractText(asFile(textPdf('Beitrag 4712 Euro KORMORAN'), 'vertrag.pdf'))
    expect(text).toContain('Beitrag 4712 Euro KORMORAN')
  })

  it('says a scanned PDF has no text instead of sending nothing to the embedder', async () => {
    await expect(extractText(asFile(scannedPdf(), 'scan.pdf'))).rejects.toThrow(
      /"scan\.pdf": the PDF has no text layer, so it is probably a scan\. Run it through text recognition \(OCR\)/,
    )
  })
})
