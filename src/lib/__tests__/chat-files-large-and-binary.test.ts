/**
 * 3.0.7, a wish from Discord: attach a ROM, or any binary.
 *
 * What changed on top of 3.0.5: files up to 256 MB, never held in memory
 * whole; in Agent and Code a binary reaches the model as facts plus a path,
 * not as a dump; in plain chat the user is told that the model only gets a
 * summary and where it gets the file itself.
 *
 * Run: npx vitest run src/lib/__tests__/chat-files-large-and-binary.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_CHAT_FILE_BYTES,
  STRINGS_SCAN_BYTES,
  WHOLE_READ_BYTES,
  binarySummaryOnlyMessage,
  describeFileBytes,
  fileBlock,
  isBinaryAttachment,
  prepareChatFile,
} from '../chat-files'
import { DEV_WRITE_BYTES_CAP } from '../dev-fs-jail'
import { Sha256, sha256OfBlob } from '../sha256-stream'
import type { FileAttachment } from '../../types/chat'

async function webCryptoHex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}

function pattern(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + (i >> 8)) & 0xff
  return bytes
}

describe('SHA-256 in slices', () => {
  it('the known vectors', () => {
    expect(new Sha256().hex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(new Sha256().update(new TextEncoder().encode('abc')).hex())
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('matches WebCrypto at every padding edge, fed in uneven pieces', async () => {
    for (const length of [1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 70_001]) {
      const bytes = pattern(length)
      const hash = new Sha256()
      for (let at = 0, step = 1; at < length; at += step, step = (step * 7) % 97 + 1) hash.update(bytes.subarray(at, at + step))
      expect(hash.hex(), `length ${length}`).toBe(await webCryptoHex(bytes))
    }
  })

  it('a blob read in small slices gives the same hash as the whole', async () => {
    const bytes = pattern(10_007)
    expect(await sha256OfBlob(new Blob([bytes]), 1000)).toBe(await webCryptoHex(bytes))
  })
})

describe('the limit is 256 MB, and the same on every side', () => {
  it('composer, dev server and the Tauri command agree', () => {
    expect(MAX_CHAT_FILE_BYTES).toBe(256 * 1024 * 1024)
    expect(DEV_WRITE_BYTES_CAP).toBe(MAX_CHAT_FILE_BYTES)
    const rust = readFileSync(resolve(__dirname, '../../../src-tauri/src/commands/filesystem.rs'), 'utf8')
    expect(rust).toMatch(/const WRITE_BYTES_CAP: u64 = 256 \* 1024 \* 1024;/)
  })
})

describe('a file above the whole-read size', () => {
  it('is described from its start, hashed in slices, and says the strings go on', async () => {
    const size = WHOLE_READ_BYTES + 4096
    const bytes = pattern(size)
    bytes.set([0x4e, 0x45, 0x53, 0x1a], 0)
    const file = new File([bytes], 'big.nes')
    const { attachment } = await prepareChatFile(file)
    expect(attachment.size).toBe(size)
    expect(attachment.kind).toBe('NES ROM (iNES)')
    expect(attachment.binary).toBe(true)
    expect(attachment.sha256).toBe(await webCryptoHex(bytes))
  }, 30_000)

  it('the summary of only the start never claims to be complete', () => {
    const head = new Uint8Array(64).fill(0x41)
    head[0] = 0
    const { summary } = describeFileBytes(head, 'x.bin', STRINGS_SCAN_BYTES * 4)
    expect(summary).toContain('(the first ones, there are more)')
  })
})

const rom: FileAttachment = {
  name: 'emerald.gba',
  size: 16 * 1024 * 1024,
  kind: 'Game Boy Advance ROM',
  sha256: 'ab'.repeat(32),
  summary: 'This is a binary file. Its bytes cannot be shown to you, so this is a summary of it.\n\nHEX-MARKER',
  binary: true,
}

describe('what the model reads about a binary', () => {
  it('Agent and Code: name, type, size, hash and path, no dump, and nothing is run unasked', () => {
    expect(fileBlock({ ...rom, workspacePath: 'emerald.gba' }, 'workspace')).toBe([
      '[Attached file: emerald.gba]',
      'Type: Game Boy Advance ROM',
      'Size: 16.0 MB (16777216 bytes)',
      `SHA-256: ${'ab'.repeat(32)}`,
      'Path in your working folder: emerald.gba',
      'This is a binary file, so its bytes are not shown here. Inspect it with your file and shell tools on that path, for example a hex dump or a short Python script. Do not run the file or open it as a program unless the user asks you to.',
      '[End of attached file: emerald.gba]',
    ].join('\n'))
  })

  it('a text file in the folder keeps its excerpt', () => {
    const notes: FileAttachment = { name: 'n.txt', size: 5, kind: 'Plain text', sha256: 'cd'.repeat(32), summary: 'The whole text of the file:\nhello', workspacePath: 'n.txt' }
    expect(fileBlock(notes, 'workspace')).toContain('The whole text of the file:\nhello')
  })

  it('plain chat: the summary, and the model may point the user to Agent or Code', () => {
    const block = fileBlock(rom, 'chat')
    expect(block).toContain('HEX-MARKER')
    expect(block).toContain('tell them to turn on Agent mode or use Code')
  })

  it('an attachment stored before the flag is still known as binary by its summary', () => {
    const { binary: _gone, ...legacy } = rom
    expect(isBinaryAttachment(legacy)).toBe(true)
    expect(isBinaryAttachment({ ...legacy, summary: 'The whole text of the file:\nx' })).toBe(false)
  })
})

describe('the line for the user in plain chat', () => {
  it('names each binary with its type and size, and says nothing for text', () => {
    expect(binarySummaryOnlyMessage([{ ...rom, binary: false, summary: 'The whole text' }])).toBeNull()
    expect(binarySummaryOnlyMessage([rom, { ...rom, name: 'b.bin', kind: 'Unknown binary', size: 2048 }])).toBe(
      'Models cannot read binary files. "emerald.gba" (Game Boy Advance ROM, 16.0 MB), "b.bin" (Unknown binary, 2.0 KB) reach the model as short summaries only. To let it work on the file itself, turn on Agent mode or use Code: the file is then put into the working folder, where the model\'s tools can open it.',
    )
  })
})
