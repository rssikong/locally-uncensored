// @vitest-environment jsdom
/**
 * Check on the iPhone, round 22, N2: "File" in the sheet "Add to message"
 * opened a menu of iOS first ("Photo Library", "Choose Files"). On an
 * iPhone the row now asks the Files app through the bridge; everywhere else
 * it keeps the file field.
 *
 * Run: npx vitest run src/mobile/platform/__tests__/pick-documents.dom.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __setBridgeForTests, type LuNativeBridge } from '../bridge'
import { pickDocuments } from '../files'

afterEach(() => {
  __setBridgeForTests(undefined)
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const doc = (name: string, bytes: number, mime = 'text/plain') => ({ path: `/tmp/lu-native-tmp/${name}/file.txt`, name, bytes, mime })

/** The file field the fallback puts into the page, if it did. */
const field = () => document.querySelector<HTMLInputElement>('input[type="file"]')

describe('pickDocuments on an iPhone (the bridge has the picker)', () => {
  it('asks the Files app, reads each file from the temp folder, removes the copy, and puts no file field into the page', async () => {
    const readTempFile = vi.fn(async (path: string, mime?: string) => new Blob([`text of ${path}`], { type: mime }))
    const deleteTempFile = vi.fn(async () => true)
    const pick = vi.fn(async () => [doc('notes.txt', 30), doc('code.ts', 31, '')])
    __setBridgeForTests({ pickDocuments: pick, readTempFile, deleteTempFile } satisfies LuNativeBridge)

    const picked = await pickDocuments({ multiple: true, maxFiles: 4, accept: '.txt' })
    expect(pick).toHaveBeenCalledWith({ maxFiles: 4 })
    expect(field()).toBeNull()
    expect(picked.map((p) => p.name)).toEqual(['notes.txt', 'code.ts'])
    expect(picked[0].mime).toBe('text/plain')
    expect(await picked[0].file.text()).toBe('text of /tmp/lu-native-tmp/notes.txt/file.txt')
    expect(picked[0].file.name).toBe('notes.txt')
    expect(picked[0].size).toBe(picked[0].file.size)
    // A TypeScript file is a file like any other here (the file field took it for a video).
    expect(picked[1].file.name).toBe('code.ts')
    await vi.waitFor(() => expect(deleteTempFile).toHaveBeenCalledTimes(2))
    expect(deleteTempFile).toHaveBeenCalledWith('/tmp/lu-native-tmp/notes.txt/file.txt')
  })

  it('one file unless many are asked for', async () => {
    const pick = vi.fn(async () => [])
    __setBridgeForTests({ pickDocuments: pick, readTempFile: async () => new Blob([]), deleteTempFile: async () => true })
    await pickDocuments()
    expect(pick).toHaveBeenCalledWith({ maxFiles: 1 })
    await pickDocuments({ multiple: true })
    expect(pick).toHaveBeenLastCalledWith({ maxFiles: 20 })
  })

  it('closing the picker is an empty list, and still no file field', async () => {
    __setBridgeForTests({ pickDocuments: async () => null })
    expect(await pickDocuments({ multiple: true })).toEqual([])
    expect(field()).toBeNull()
  })

  it('a file above the limit is named with its real size and never read into the page', async () => {
    const readTempFile = vi.fn(async () => new Blob(['x']))
    const deleteTempFile = vi.fn(async () => true)
    __setBridgeForTests({ pickDocuments: async () => [doc('film.bin', 5_000_000_000, 'application/octet-stream')], readTempFile, deleteTempFile })
    const [big] = await pickDocuments({ maxBytes: 64 * 1024 * 1024 })
    expect(big.size).toBe(5_000_000_000)
    expect(big.name).toBe('film.bin')
    expect(readTempFile).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(deleteTempFile).toHaveBeenCalledWith('/tmp/lu-native-tmp/film.bin/file.txt'))
  })

  it('a file that cannot be read is a failure the sheet can show, and its copy is removed all the same', async () => {
    const deleteTempFile = vi.fn(async () => true)
    __setBridgeForTests({ pickDocuments: async () => [doc('broken.txt', 3)], readTempFile: async () => { throw new Error('The temporary file could not be read.') }, deleteTempFile })
    await expect(pickDocuments()).rejects.toThrow('The temporary file could not be read.')
    await vi.waitFor(() => expect(deleteTempFile).toHaveBeenCalledTimes(1))
  })

  it('a picker that fails is a failure, not a second picker on top', async () => {
    __setBridgeForTests({ pickDocuments: async () => { throw new Error('The file picker could not be shown.') } })
    await expect(pickDocuments()).rejects.toThrow('The file picker could not be shown.')
    expect(field()).toBeNull()
  })
})

describe('pickDocuments everywhere else (Android, a browser, an app older than the command)', () => {
  const viaField = async (bridge: LuNativeBridge | null) => {
    __setBridgeForTests(bridge)
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      queueMicrotask(() => this.dispatchEvent(new Event('cancel')))
    })
    const result = pickDocuments({ multiple: true, accept: '.txt,.md' })
    await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    const input = click.mock.instances[0] as unknown as HTMLInputElement
    expect(input.accept).toBe('.txt,.md')
    expect(input.multiple).toBe(true)
    expect(await result).toEqual([])
  }

  it('no bridge: the file field, with accept and multiple as given', () => viaField(null))
  it('a bridge without the picker (Android): the file field', () => viaField({}))
  it('a bridge whose command is missing (an older app): the file field', () =>
    viaField({ pickDocuments: () => Promise.reject(new Error('Command plugin:lu-native|pick_documents not found')) }))
})
