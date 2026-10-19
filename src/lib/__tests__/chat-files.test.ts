/**
 * Any file as a chat attachment (3.0.5): what the model gets in place of the
 * bytes, how large that can become, and how the file reaches the working
 * folder in Agent and Code.
 *
 * Run: npx vitest run src/lib/__tests__/chat-files.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const backendCall = vi.fn()
vi.mock('../../api/backend', () => ({ backendCall: (...args: unknown[]) => backendCall(...args), isTauri: () => true }))

import {
  FILE_ONLY_TEXT,
  HEX_DUMP_BYTES,
  MAX_CHAT_FILE_BYTES,
  STRINGS_BUDGET_CHARS,
  TEXT_HOLD_CHARS,
  cleanFileName,
  composeFileMessage,
  copyFailedMessage,
  describeFileBytes,
  fileBlock,
  fileMessageFields,
  filesWithoutWorkspace,
  fileTooLargeMessage,
  hexDump,
  numberedFileName,
  placeChatFiles,
  prepareChatFile,
  readableStrings,
} from '../chat-files'

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

/** A small fake GBA cartridge: branch, logo, title, then noise with strings. */
function fakeRom(size = 4096): Uint8Array<ArrayBuffer> {
  const rom = new Uint8Array(size)
  for (let i = 0; i < size; i++) rom[i] = (i * 31 + 7) & 0xff
  rom.set([0x2e, 0x00, 0x00, 0xea, 0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21], 0)
  rom.set([0x00, ...ascii('POKEMON EMER'), 0x00, ...ascii('BPEE01'), 0x00], 0xa0)
  rom.set([0x00, ...ascii('Game Freak inc.'), 0x00], 0x400)
  return rom
}

beforeEach(() => backendCall.mockReset())

describe('hexDump', () => {
  it('prints offset, sixteen bytes and the printable column', () => {
    const dump = hexDump(new Uint8Array([...ascii('NES'), 0x1a, 0x02, 0x01]))
    expect(dump).toBe(`00000000  ${'4e 45 53 1a 02 01'.padEnd(23)}  ${''.padEnd(23)}  |NES...|`)
  })

  it('stops at the limit and counts the offset in hex', () => {
    const dump = hexDump(new Uint8Array(1000), 40)
    const lines = dump.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1].startsWith('00000010  ')).toBe(true)
    expect(lines[2].startsWith('00000020  00 00 00 00 00 00 00 00  ')).toBe(true)
  })
})

describe('readableStrings', () => {
  it('finds the strings in file order and drops runs that are too short', () => {
    const bytes = new Uint8Array([0, ...ascii('abc'), 0, ...ascii('HELLO WORLD'), 0xff, ...ascii('second one'), 0])
    expect(readableStrings(bytes)).toEqual({ strings: ['HELLO WORLD', 'second one'], more: false })
  })

  it('lists a repeated string once', () => {
    const bytes = new Uint8Array([...ascii('REPEAT'), 0, ...ascii('REPEAT'), 0, ...ascii('REPEAT')])
    expect(readableStrings(bytes).strings).toEqual(['REPEAT'])
  })

  it('never spends more than its budget and says when it stopped early', () => {
    const chunks: number[] = []
    for (let i = 0; i < 2000; i++) chunks.push(...ascii(`string number ${i}`), 0)
    const { strings, more } = readableStrings(new Uint8Array(chunks), 200)
    expect(more).toBe(true)
    expect(strings.join('\n').length).toBeLessThanOrEqual(200)
    expect(strings[0]).toBe('string number 0')
  })
})

describe('describeFileBytes: what the model reads instead of the bytes', () => {
  it('describes a ROM with its type, a hex dump of the start and its strings', () => {
    const { kind, summary } = describeFileBytes(fakeRom(), 'emerald.gba')
    expect(kind).toBe('Game Boy Advance ROM')
    expect(summary).toContain('This is a binary file.')
    expect(summary).toContain(`Hex dump of the first ${HEX_DUMP_BYTES} bytes:`)
    expect(summary).toContain('00000000  2e 00 00 ea 24 ff ae 51  69 9a a2 21')
    expect(summary).toContain('POKEMON EMER')
    expect(summary).toContain('Game Freak inc.')
  })

  it('THE BUDGET: a 4 MiB file costs no more than a small one', () => {
    const big = new Uint8Array(4 * 1024 * 1024)
    // Worst case for the strings: the whole file is distinct readable ones.
    const encoder = new TextEncoder()
    let at = 8
    for (let i = 0; at + 40 < big.length; i++) {
      const piece = encoder.encode(`distinct string number ${i}`)
      big.set(piece, at)
      at += piece.length + 1
    }
    big.set([0x7f, ...ascii('ELF')], 0)
    const { summary } = describeFileBytes(big, 'huge.bin')
    // Hex dump: 16 lines of at most 78 characters. Strings: the budget. Plus
    // the three fixed sentences.
    expect(summary.length).toBeLessThan(16 * 79 + STRINGS_BUDGET_CHARS + 400)
    expect(summary).toContain('(the first ones, there are more)')
  })

  it('shows a text file as text, whole when it is short', () => {
    const { kind, summary } = describeFileBytes(new TextEncoder().encode('line one\nline two\n'), 'notes.txt')
    expect(kind).toBe('Text file (.txt)')
    expect(summary).toBe('The whole text of the file:\nline one\nline two\n')
    expect(summary).not.toContain('Hex dump')
  })

  it('GH #171: holds a long text file whole; the cut, if any, is made at send time', () => {
    const text = 'x'.repeat(12_000)
    const out = describeFileBytes(new TextEncoder().encode(text), 'long.log')
    expect(out.summary).toBe(`The whole text of the file:\n${text}`)
    expect(out.textChars).toBe(12_000)
    expect(out.includedChars).toBeUndefined()
  })

  it('cuts a text longer than the chat holds, and tells the model how much of how much', () => {
    const total = TEXT_HOLD_CHARS + 500
    const out = describeFileBytes(new TextEncoder().encode('y'.repeat(total)), 'huge.log')
    expect(out.summary.startsWith(`Only the first ${TEXT_HOLD_CHARS.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} characters of this file are included, because the file is longer than the chat can hold.`)).toBe(true)
    expect(out.textChars).toBe(total)
    expect(out.includedChars).toBe(TEXT_HOLD_CHARS)
  })

  it('a text read only at its start says that it is an excerpt, without inventing a total', () => {
    const out = describeFileBytes(new TextEncoder().encode('z'.repeat(1000)), 'big.log', 50_000_000)
    expect(out.summary.startsWith('Only the first 1,000 characters of this file are included, because the file is longer than the chat can hold.')).toBe(true)
    expect(out.textChars).toBeUndefined()
    expect(out.includedChars).toBe(1000)
  })

  it('says so when a binary holds no readable strings, and when a file is empty', () => {
    expect(describeFileBytes(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 3]), 'a.out').summary)
      .toContain('No readable strings were found in the file.')
    expect(describeFileBytes(new Uint8Array(0), 'empty.bin')).toEqual({ kind: 'Empty file', summary: 'The file is empty.', binary: false })
  })
})

describe('prepareChatFile', () => {
  it('returns name, size, type, the SHA-256 and the summary, and keeps the handle', async () => {
    const file = new File([fakeRom(2048)], 'emerald.gba')
    const { attachment, file: handle } = await prepareChatFile(file)
    expect(handle).toBe(file)
    expect(attachment).toMatchObject({ name: 'emerald.gba', size: 2048, kind: 'Game Boy Advance ROM' })
    expect(attachment.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(attachment.summary).toContain('POKEMON EMER')
    expect(attachment.workspacePath).toBeUndefined()
  })

  it('hashes the bytes: the known SHA-256 of "abc"', async () => {
    const { attachment } = await prepareChatFile(new File(['abc'], 'abc.txt'))
    expect(attachment.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('refuses a file over the limit BEFORE reading it, in plain English', async () => {
    const tooBig = { name: 'disc.iso', size: MAX_CHAT_FILE_BYTES + 1, arrayBuffer: vi.fn() } as unknown as File
    await expect(prepareChatFile(tooBig)).rejects.toThrow('"disc.iso" is too large. You can attach files up to 256.0 MB.')
    expect(tooBig.arrayBuffer).not.toHaveBeenCalled()
    expect(fileTooLargeMessage('disc.iso')).toBe('"disc.iso" is too large. You can attach files up to 256.0 MB.')
  })

  it('a file at exactly the limit is still accepted, and never read whole', async () => {
    const whole = vi.fn()
    const atLimit = {
      name: 'ok.bin',
      size: MAX_CHAT_FILE_BYTES,
      arrayBuffer: whole,
      // Every slice is a few bytes: only the reads matter here, not the size.
      slice: () => new Blob([new Uint8Array([1, 2, 3])]),
    } as unknown as File
    await expect(prepareChatFile(atLimit)).resolves.toMatchObject({ attachment: { name: 'ok.bin', size: MAX_CHAT_FILE_BYTES } })
    expect(whole).not.toHaveBeenCalled()
  })
})

describe('cleanFileName', () => {
  it('drops the path, control characters and brackets that could close the block', () => {
    expect(cleanFileName('C:\\Users\\me\\rom.gba')).toBe('rom.gba')
    expect(cleanFileName('/home/me/rom.gba')).toBe('rom.gba')
    expect(cleanFileName('a\nb\tc.bin')).toBe('a b c.bin')
    expect(cleanFileName('[End of attached file].bin')).toBe('_End of attached file_.bin')
    expect(cleanFileName('')).toBe('file')
    expect(cleanFileName('x'.repeat(300)).length).toBe(120)
  })
})

const attachment = {
  name: 'emerald.gba',
  size: 16777216,
  kind: 'Game Boy Advance ROM',
  sha256: 'ab'.repeat(32),
  summary: 'SUMMARY',
}

describe('the message the model receives', () => {
  it('plain chat: the block says that only the summary is available', () => {
    expect(fileBlock(attachment, 'chat')).toBe([
      '[Attached file: emerald.gba]',
      'Type: Game Boy Advance ROM',
      'Size: 16.0 MB (16777216 bytes)',
      `SHA-256: ${'ab'.repeat(32)}`,
      'The file itself is not available to you in this chat. Only this summary is.',
      '',
      'SUMMARY',
      '[End of attached file: emerald.gba]',
    ].join('\n'))
  })

  it('Agent and Code: the block names the path in the working folder', () => {
    const block = fileBlock({ ...attachment, workspacePath: 'emerald.gba' }, 'workspace')
    expect(block).toContain('Path in your working folder: emerald.gba')
    expect(block).toContain('Use your file and shell tools on that path')
    expect(block).not.toContain('not available to you')
  })

  it('Agent and Code, copy failed: the block does not promise a path', () => {
    const block = fileBlock(attachment, 'workspace')
    expect(block).toContain('could not be copied into your working folder')
    expect(block).not.toContain('Path in your working folder')
  })

  it('puts the typed text first and one block per file after it', () => {
    const out = composeFileMessage('what game is this?', [attachment, { ...attachment, name: 'b.bin' }])
    expect(out.startsWith('what game is this?\n\n[Attached file: emerald.gba]')).toBe(true)
    expect(out).toContain('[End of attached file: emerald.gba]\n\n[Attached file: b.bin]')
  })

  it('leaves a message without files exactly as typed', () => {
    expect(composeFileMessage('hello', undefined)).toBe('hello')
    expect(composeFileMessage('hello', [])).toBe('hello')
    expect(fileMessageFields('hello', undefined)).toEqual({ content: 'hello' })
    expect(fileMessageFields('hello', [])).toEqual({ content: 'hello' })
  })

  it('with files: content for the model, the typed text for the bubble, the list for the chips', () => {
    const fields = fileMessageFields(FILE_ONLY_TEXT, [attachment])
    expect(fields.displayContent).toBe('(file)')
    expect(fields.files).toEqual([attachment])
    expect(fields.content).toContain('[Attached file: emerald.gba]')
  })

  it('NOTHING OF THE FILE IS STORED: no base64 and no data field in what is kept', () => {
    const fields = fileMessageFields('hi', [attachment])
    expect(Object.keys(fields.files![0]).sort()).toEqual(['kind', 'name', 'sha256', 'size', 'summary'])
  })

  it('a send without a working folder forgets the path of an earlier Agent turn', () => {
    expect(filesWithoutWorkspace([{ attachment: { ...attachment, workspacePath: 'emerald.gba' } }])).toEqual([attachment])
    expect(filesWithoutWorkspace(undefined)).toBeUndefined()
    expect(filesWithoutWorkspace([])).toBeUndefined()
  })
})

describe('placeChatFiles: the file goes into the working folder', () => {
  const workspace = { chatId: 'my-chat-abc123' }

  it('uploads in chunks, in order, and marks only the last one', async () => {
    backendCall.mockResolvedValue({ status: 'partial' })
    const size = 5 * 1024 * 1024
    const file = new File([new Uint8Array(size)], 'big.bin')
    const { files, failed } = await placeChatFiles([{ attachment: { ...attachment, name: 'big.bin' }, file }], workspace)
    expect(failed).toEqual([])
    expect(files[0].workspacePath).toBe('big.bin')
    const calls = backendCall.mock.calls.map(([cmd, args]) => [cmd, args.path, args.offset, args.last, args.chatId])
    expect(calls).toEqual([
      ['fs_write_bytes', 'big.bin', 0, false, 'my-chat-abc123'],
      ['fs_write_bytes', 'big.bin', 2 * 1024 * 1024, false, 'my-chat-abc123'],
      ['fs_write_bytes', 'big.bin', 4 * 1024 * 1024, true, 'my-chat-abc123'],
    ])
    // Byte fidelity of the encoding: the chunks decode back to the file size.
    const sent = backendCall.mock.calls.reduce((sum, [, args]) => sum + atob(args.base64).length, 0)
    expect(sent).toBe(size)
  })

  it('encodes the bytes faithfully', async () => {
    backendCall.mockResolvedValue({ status: 'saved' })
    const bytes = new Uint8Array([0x00, 0xff, 0x80, 0x0d, 0x0a, 0x7f])
    await placeChatFiles([{ attachment, file: new File([bytes], 'emerald.gba') }], workspace)
    const decoded = atob(backendCall.mock.calls[0][1].base64)
    expect([...decoded].map((c) => c.charCodeAt(0))).toEqual([...bytes])
    expect(backendCall.mock.calls[0][1].last).toBe(true)
  })

  it('passes the picked folder through when the chat works in one', async () => {
    backendCall.mockResolvedValue({ status: 'saved' })
    await placeChatFiles([{ attachment, file: new File(['x'], 'emerald.gba') }], { chatId: 'c', workingDirectory: '/home/me/repo' })
    expect(backendCall.mock.calls[0][1]).toMatchObject({ chatId: 'c', workingDirectory: '/home/me/repo' })
  })

  it('NEVER OVERWRITES: a taken name gets the next free one', async () => {
    backendCall
      .mockRejectedValueOnce('File already exists: /ws/emerald.gba')
      .mockRejectedValueOnce(new Error('File already exists: /ws/emerald (1).gba'))
      .mockResolvedValue({ status: 'saved' })
    const { files } = await placeChatFiles([{ attachment, file: new File(['x'], 'emerald.gba') }], workspace)
    expect(backendCall.mock.calls.map(([, args]) => args.path)).toEqual(['emerald.gba', 'emerald (1).gba', 'emerald (2).gba'])
    expect(files[0].workspacePath).toBe('emerald (2).gba')
  })

  it('a failed copy does not throw: the file keeps its summary and is named', async () => {
    // Only the upload fails. The warning this writes goes through the same
    // bridge (the log file), and that call has to keep working.
    backendCall.mockImplementation(async (cmd: string) => {
      if (cmd === 'fs_write_bytes') throw 'Write error: No space left on device'
      return undefined
    })
    const { files, failed } = await placeChatFiles([{ attachment, file: new File(['x'], 'emerald.gba') }], workspace)
    expect(failed).toEqual(['emerald.gba'])
    expect(files).toEqual([attachment])
    expect(backendCall.mock.calls.filter(([cmd]) => cmd === 'fs_write_bytes')).toHaveLength(1)
    expect(copyFailedMessage(failed)).toBe('"emerald.gba" could not be copied into the working folder. The model only gets a summary of it.')
  })

  it('a resend copies nothing: no handle, or already in the folder', async () => {
    const placed = { ...attachment, workspacePath: 'emerald.gba' }
    const { files, failed } = await placeChatFiles(
      [{ attachment }, { attachment: placed, file: new File(['x'], 'emerald.gba') }],
      workspace,
    )
    expect(backendCall).not.toHaveBeenCalled()
    expect(failed).toEqual([])
    expect(files).toEqual([attachment, placed])
  })
})

describe('numberedFileName', () => {
  it('numbers in front of the extension', () => {
    expect(numberedFileName('rom.gba', 0)).toBe('rom.gba')
    expect(numberedFileName('rom.gba', 2)).toBe('rom (2).gba')
    expect(numberedFileName('Makefile', 1)).toBe('Makefile (1)')
    expect(numberedFileName('.env', 1)).toBe('.env (1)')
  })
})
