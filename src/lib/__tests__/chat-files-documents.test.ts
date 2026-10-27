/**
 * Check on the iPhone, round 23, N15: a normal PDF (compressed content) attached with Plus, "File" was handed to
 * the model as a hex dump, and the answer came from nothing. The attachment of a PDF or Word file is now read
 * the way the documents of a chat are read, and a document that cannot be read says so in one sentence and
 * never hands over its bytes.
 *
 * Run: npx vitest run src/lib/__tests__/chat-files-documents.test.ts
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { deflateSync } from 'node:zlib'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TEXT_HOLD_CHARS, UNREADABLE_DOCUMENT_SUMMARY, composeFileMessage, describeDocumentText, prepareChatFile } from '../chat-files'
import { extractText } from '../../api/rag'

/** A PDF whose page content is Flate-compressed, as the PDFs people have are. */
function flatePdf(text: string): Uint8Array {
  const body = deflateSync(Buffer.from(`BT /F1 12 Tf 20 200 Td (${text}) Tj ET`, 'latin1'))
  const parts: Array<string | Buffer> = []
  const offsets: number[] = []
  let length = 0
  const add = (piece: string | Buffer) => {
    parts.push(piece)
    length += typeof piece === 'string' ? Buffer.byteLength(piece, 'latin1') : piece.length
  }
  add('%PDF-1.7\n')
  const object = (n: number, content: Array<string | Buffer>) => {
    offsets.push(length)
    add(`${n} 0 obj\n`)
    content.forEach(add)
    add('\nendobj\n')
  }
  object(1, ['<</Type/Catalog/Pages 2 0 R>>'])
  object(2, ['<</Type/Pages/Kids[3 0 R]/Count 1>>'])
  object(3, ['<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>'])
  object(4, [`<</Filter/FlateDecode/Length ${body.length}>>\nstream\n`, body, '\nendstream'])
  object(5, ['<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'])
  const xref = length
  add(`xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`)
  add(`trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`)
  return new Uint8Array(Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p))))
}

// Vitest runs the node module graph: the worker path of rag.ts points at nothing there, so pdf.js gets the file on disk.
beforeAll(async () => {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const onDisk = pathToFileURL(resolve(__dirname, '../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')).href
  Object.defineProperty(pdfjsLib.GlobalWorkerOptions, 'workerSrc', { configurable: true, get: () => onDisk, set: () => undefined })
})

const pdfFile = (bytes: Uint8Array, name = 'harbour.pdf') => new File([bytes as unknown as BlobPart], name, { type: 'application/pdf' })

describe('a PDF attached to a message', () => {
  it('a compressed PDF is read, and the model gets its words, not a hex dump', async () => {
    const input = await prepareChatFile(pdfFile(flatePdf('The ship in the harbour is called Pelican')), { readDocument: extractText })
    expect(input.attachment.summary).toContain('Pelican')
    expect(input.attachment.summary).not.toMatch(/hex dump|binary file/i)
    expect(input.attachment.kind).toBe('PDF document')
    expect(input.notice).toBeUndefined()
    const message = composeFileMessage('What is the ship called?', [input.attachment])
    expect(message).toContain('Pelican')
  })

  it('without the reader the file keeps the old summary (the desktop is unchanged)', async () => {
    const input = await prepareChatFile(pdfFile(flatePdf('Pelican')))
    expect(input.attachment.summary).toMatch(/binary file/i)
  })

  it('a document that cannot be read says so in a sentence and hands over no bytes', async () => {
    const reader = vi.fn(async () => {
      throw new Error('bad xref')
    })
    const input = await prepareChatFile(pdfFile(flatePdf('Pelican')), { readDocument: reader })
    expect(reader).toHaveBeenCalledTimes(1)
    expect(input.attachment.summary).toBe(UNREADABLE_DOCUMENT_SUMMARY)
    expect(input.attachment.summary).not.toMatch(/hex dump|0000000/)
    expect(input.notice).toBe('The text of "harbour.pdf" could not be read. The model only gets its name.')
  })

  it('a document with no text at all (scanned pages) is unreadable too', async () => {
    const input = await prepareChatFile(pdfFile(flatePdf('x')), { readDocument: async () => '   \n \n ' })
    expect(input.attachment.summary).toBe(UNREADABLE_DOCUMENT_SUMMARY)
    expect(input.notice).toBeTruthy()
  })

  // GH #171 (3.0.8): a document is held like a text file, whole up to
  // TEXT_HOLD_CHARS; the cut for the model's window is made at send time.
  it('a long document is held up to the size of a text file and says when it is cut', () => {
    expect(describeDocumentText('word '.repeat(5000), 'PDF')).toMatch(/^The whole text of the PDF:/)
    const summary = describeDocumentText('x'.repeat(TEXT_HOLD_CHARS + 10), 'PDF') ?? ''
    expect(summary).toMatch(/longer than this excerpt/)
    expect(summary.length).toBeLessThan(TEXT_HOLD_CHARS + 200)
    expect(describeDocumentText('short   text\n\n\n\nhere', 'PDF')).toBe('The whole text of the PDF:\nshort text\n\nhere')
  })

  it('a text file is not touched by the reader', async () => {
    const reader = vi.fn(async () => 'never')
    const input = await prepareChatFile(new File(['HARLEKIN'], 'note.txt', { type: 'text/plain' }), { readDocument: reader })
    expect(reader).not.toHaveBeenCalled()
    expect(input.attachment.summary).toContain('HARLEKIN')
  })
})
