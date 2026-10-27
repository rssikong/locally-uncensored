/**
 * Point 6 of the mobile groundwork: one function hands content to the user.
 * Save As on a desktop, exactly as each call site did it before; the share
 * sheet on a phone.
 *
 * The audit (sections 2.4 and 7): the dialog commands answer "This device has
 * no file dialog" on a phone, a blob anchor saves nothing there, and
 * ChatArtifactCard showed "Saved" after the command had failed.
 *
 * Run: npx vitest run src/lib/__tests__/save-or-share.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEVICES, standOn, type DeviceName } from '../../test-support/devices'

const backend = vi.hoisted(() => ({ tauri: true, backendCall: vi.fn(), downloadComfyFile: vi.fn() }))
vi.mock('../../api/backend', () => ({
  isTauri: () => backend.tauri,
  backendCall: backend.backendCall,
  downloadComfyFile: backend.downloadComfyFile,
  isMacOS: () => false,
}))
vi.mock('../../api/cloud/jobs', () => ({ refreshResultUrl: vi.fn(async () => 'https://cdn.test/fresh.png') }))
vi.mock('../chat-attachments', () => ({
  originalAttachment: async <T,>(x: T) => x,
}))

import {
  NO_SHARE_AVAILABLE_MESSAGE, __resetSaveOrShareForTests, mobileShare, saveOrShare, saveSucceeded,
  setMobileShareHandler, type MobileShareRequest,
} from '../save-or-share'
import { exportAllConversations, exportConversation } from '../chat-export'
import { saveStateAfter } from '../../components/chat/ChatArtifactCard'
import { downloadGalleryItem } from '../../components/create/experimental/galleryDownload'
import { useCreateStore, type GalleryItem } from '../../stores/createStore'
import type { Conversation } from '../../types/chat'

const src = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8')

/** A phone whose WebView has the Web Share API. */
function phoneWithShare(device: DeviceName = 'android', share = vi.fn(async (_data: ShareData) => undefined)) {
  vi.stubGlobal('navigator', { ...DEVICES[device], share, canShare: () => true })
  return share
}

/** A document that records anchor downloads. */
function pageWithAnchors(): { downloads: { name: string; href: string }[] } {
  const downloads: { name: string; href: string }[] = []
  vi.stubGlobal('document', {
    createElement: () => {
      const a = { href: '', download: '', click: () => downloads.push({ name: a.download, href: a.href }) }
      return a
    },
    body: { appendChild: () => {}, removeChild: () => {} },
  })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }))
  return { downloads }
}

const CONV = {
  id: 'c1', title: 'My chat', model: 'm', createdAt: 1, updatedAt: 1,
  messages: [{ id: 'u', role: 'user', content: 'hello', timestamp: 1 }],
} as unknown as Conversation

beforeEach(() => {
  backend.tauri = true
  backend.backendCall.mockReset()
  backend.downloadComfyFile.mockReset()
  __resetSaveOrShareForTests()
  useCreateStore.getState().setError(null)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('on a phone', () => {
  it('text goes to the share sheet as a file with its name and type, and no dialog command is called', async () => {
    const share = phoneWithShare('android')
    const outcome = await saveOrShare({ filename: 'report.md', mime: 'text/markdown', text: '# Hi' })
    expect(outcome).toEqual({ status: 'shared' })
    const file = share.mock.calls[0][0].files![0]
    expect(file.name).toBe('report.md')
    expect(file.type).toBe('text/markdown')
    expect(await file.text()).toBe('# Hi')
    expect(backend.backendCall).not.toHaveBeenCalled()
  })

  it('closing the sheet is a cancel, not an error', async () => {
    phoneWithShare('iphone', vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) }))
    expect(await saveOrShare({ filename: 'a.txt', mime: 'text/plain', text: 'a' })).toEqual({ status: 'cancelled' })
  })

  it('no share sheet at all is a clear sentence, never a silent nothing', async () => {
    standOn('android')
    const outcome = await saveOrShare({ filename: 'a.txt', mime: 'text/plain', text: 'a' })
    expect(outcome).toEqual({ status: 'error', error: NO_SHARE_AVAILABLE_MESSAGE })
    expect(NO_SHARE_AVAILABLE_MESSAGE).not.toMatch(/[\u2013\u2014]|click|computer|folder/i)
    await expect(mobileShare({ filename: 'a.txt', mime: 'text/plain', text: 'a' })).rejects.toThrow(NO_SHARE_AVAILABLE_MESSAGE)
  })

  it('the native handler, once the shell sets it, takes over and gets the bytes as bytes', async () => {
    const share = phoneWithShare('iphone')
    const native = vi.fn(async (_r: MobileShareRequest) => 'shared' as const)
    setMobileShareHandler(native)
    const bytes = new Uint8Array([1, 2, 3])
    expect(await saveOrShare({ filename: 'a.png', mime: 'image/png', bytes })).toEqual({ status: 'shared' })
    expect(native.mock.calls[0][0].bytes).toBe(bytes)
    expect(share).not.toHaveBeenCalled()
  })

  it('a chat export goes to the share sheet in both formats and never to a dialog command', async () => {
    const share = phoneWithShare('android')
    expect(await exportConversation(CONV, 'markdown')).toEqual({ status: 'saved' })
    expect(await exportConversation(CONV, 'json')).toEqual({ status: 'saved' })
    expect((await exportAllConversations([CONV])).status).toBe('saved')
    expect(share.mock.calls.map((c) => c[0].files![0].name)).toEqual([
      'My_chat.md', 'My_chat.json', 'locally-uncensored-chats-1.json',
    ])
    expect(JSON.parse(await share.mock.calls[1][0].files![0].text()).id).toBe('c1')
    expect(backend.backendCall).not.toHaveBeenCalled()
  })

  it('a chat export without a share sheet says so', async () => {
    standOn('iphone')
    expect(await exportConversation(CONV, 'markdown')).toEqual({ status: 'error', error: NO_SHARE_AVAILABLE_MESSAGE })
  })

  it('a gallery download shares the fetched bytes, no dialog command and no byte array through IPC', async () => {
    phoneWithShare('android')
    const native = vi.fn(async (_r: MobileShareRequest) => 'shared' as const)
    setMobileShareHandler(native)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([9, 8, 7]), { status: 200, headers: { 'content-type': 'image/png' } })))
    await downloadGalleryItem({ id: 'g1', type: 'image', filename: '', jobId: 'job-1', remoteUrl: 'https://cdn.test/old.png' } as unknown as GalleryItem)
    const request = native.mock.calls[0][0]
    expect(request.filename).toBe('lu-g1.png')
    expect(request.mime).toBe('image/png')
    expect(request.bytes).toBeInstanceOf(Uint8Array)
    expect([...request.bytes!]).toEqual([9, 8, 7])
    expect(backend.backendCall).not.toHaveBeenCalled()
    expect(useCreateStore.getState().error).toBeFalsy()
  })

  it('a handler that can fetch an address gets the address, the video never enters the WebView', async () => {
    standOn('iphone')
    const native = vi.fn(async (_r: MobileShareRequest) => 'shared' as const)
    setMobileShareHandler(native, { acceptsUrl: true })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await downloadGalleryItem({ id: 'v1', type: 'video', filename: '', jobId: 'job-2', remoteUrl: 'https://cdn.test/old.mp4' } as unknown as GalleryItem)
    expect(native.mock.calls[0][0]).toMatchObject({ url: 'https://cdn.test/fresh.png', filename: 'lu-v1.mp4', mime: 'video/mp4' })
    expect(native.mock.calls[0][0].bytes).toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a gallery download that cannot be shared reports it', async () => {
    standOn('android')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/png' } })))
    await downloadGalleryItem({ id: 'g2', type: 'image', filename: '', remoteUrl: 'https://cdn.test/a.png' } as unknown as GalleryItem)
    expect(useCreateStore.getState().error).toBe(`Download failed: ${NO_SHARE_AVAILABLE_MESSAGE}`)
  })
})

describe('on a desktop, the packaged app', () => {
  beforeEach(() => { standOn('windows'); backend.tauri = true })

  it('text: the Save As dialog with the same arguments as before', async () => {
    backend.backendCall.mockResolvedValue('C:/out/report.md')
    const outcome = await saveOrShare({ filename: 'report.md', mime: 'text/markdown', text: '# Hi' })
    expect(outcome).toEqual({ status: 'saved', path: 'C:/out/report.md' })
    expect(backend.backendCall).toHaveBeenCalledWith('save_text_file_dialog', {
      content: '# Hi', defaultName: 'report.md', extension: 'md', extLabel: 'MD',
    })
  })

  it('bytes: the binary dialog, bytes as a JSON array as the command expects', async () => {
    backend.backendCall.mockResolvedValue('C:/out/a.png')
    await saveOrShare({ filename: 'a.png', mime: 'image/png', bytes: new Uint8Array([1, 2]) }, { extension: 'png', extLabel: 'Image' })
    expect(backend.backendCall).toHaveBeenCalledWith('save_binary_file_dialog', {
      bytes: [1, 2], defaultName: 'a.png', extension: 'png', extLabel: 'Image',
    })
  })

  it('a closed dialog is a cancel', async () => {
    backend.backendCall.mockResolvedValue(null)
    expect(await saveOrShare({ filename: 'a.txt', mime: 'text/plain', text: 'a' })).toEqual({ status: 'cancelled' })
  })

  it('a failing dialog falls back to a download only where the call site did', async () => {
    const page = pageWithAnchors()
    backend.backendCall.mockRejectedValue(new Error('boom'))
    expect(await saveOrShare({ filename: 'a.txt', mime: 'text/plain', text: 'a' })).toEqual({ status: 'error', error: 'boom' })
    expect(page.downloads).toHaveLength(0)
    expect(await saveOrShare({ filename: 'a.txt', mime: 'text/plain', text: 'a' }, { anchorOnDialogFailure: true }))
      .toEqual({ status: 'downloaded', error: 'Error: boom' })
    expect(page.downloads).toEqual([{ name: 'a.txt', href: 'blob:x' }])
  })

  it("via 'anchor' never asks the dialog, which is what Memory and Benchmark always did", async () => {
    const page = pageWithAnchors()
    expect(await saveOrShare({ filename: 'memory.md', mime: 'text/markdown', text: 'm' }, { via: 'anchor' })).toEqual({ status: 'downloaded' })
    expect(page.downloads).toEqual([{ name: 'memory.md', href: 'blob:x' }])
    expect(backend.backendCall).not.toHaveBeenCalled()
  })

  it('a share handler set by mistake changes nothing', async () => {
    const native = vi.fn(async () => 'shared' as const)
    setMobileShareHandler(native)
    backend.backendCall.mockResolvedValue('C:/x')
    await saveOrShare({ filename: 'a.txt', mime: 'text/plain', text: 'a' })
    expect(native).not.toHaveBeenCalled()
  })

  it('chat export: Markdown through the text dialog, JSON through the native export, as before', async () => {
    backend.backendCall.mockImplementation(async (cmd: string) => (cmd === 'export_chats_dialog' ? { path: 'C:/c.json', missing: 0 } : 'C:/c.md'))
    expect(await exportConversation(CONV, 'markdown')).toEqual({ status: 'saved', path: 'C:/c.md' })
    expect(backend.backendCall.mock.calls[0]).toEqual(['save_text_file_dialog', {
      content: expect.stringContaining('hello'), defaultName: 'My_chat.md', extension: 'md', extLabel: 'Markdown',
    }])
    expect(await exportConversation(CONV, 'json')).toEqual({ status: 'saved', path: 'C:/c.json', missing: 0 })
    expect(backend.backendCall.mock.calls[1][0]).toBe('export_chats_dialog')
    expect((await exportAllConversations([CONV])).status).toBe('saved')
    expect(backend.backendCall.mock.calls[2][0]).toBe('export_chats_dialog')
  })

  it('chat export: a failing dialog still ends in a download with the reason', async () => {
    const page = pageWithAnchors()
    backend.backendCall.mockRejectedValue(new Error('no dialog'))
    expect(await exportConversation(CONV, 'markdown')).toEqual({ status: 'downloaded', error: 'Error: no dialog' })
    expect(page.downloads).toEqual([{ name: 'My_chat.md', href: 'blob:x' }])
  })

  it('gallery download: the binary dialog with the bytes as an array', async () => {
    backend.backendCall.mockResolvedValue('C:/g.png')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([4, 5]), { status: 200, headers: { 'content-type': 'image/png' } })))
    await downloadGalleryItem({ id: 'g1', type: 'image', filename: '', remoteUrl: 'https://cdn.test/a.png' } as unknown as GalleryItem)
    expect(backend.backendCall).toHaveBeenCalledWith('save_binary_file_dialog', {
      bytes: [4, 5], defaultName: 'lu-g1.png', extension: 'png', extLabel: 'PNG',
    })
  })
})

describe('in the browser build', () => {
  it('everything is an anchor download', async () => {
    standOn('linux')
    backend.tauri = false
    const page = pageWithAnchors()
    expect(await saveOrShare({ filename: 'a.txt', mime: 'text/plain', text: 'a' })).toEqual({ status: 'downloaded' })
    expect(await exportConversation(CONV, 'json')).toEqual({ status: 'downloaded' })
    expect(page.downloads.map((d) => d.name)).toEqual(['a.txt', 'My_chat.json'])
    expect(backend.backendCall).not.toHaveBeenCalled()
  })
})

describe('"Saved" only when it was', () => {
  it('the artifact card says Saved for a real save, Not saved for a failure, nothing for a cancel', () => {
    expect(saveStateAfter({ status: 'saved', path: '/x' })).toBe('done')
    expect(saveStateAfter({ status: 'shared' })).toBe('done')
    expect(saveStateAfter({ status: 'downloaded' })).toBe('done')
    expect(saveStateAfter({ status: 'cancelled' })).toBe('idle')
    expect(saveStateAfter({ status: 'error', error: 'This device has no file dialog' })).toBe('failed')
    expect(saveSucceeded({ status: 'cancelled' })).toBe(false)
  })

  it('the card sets its state from the outcome', () => {
    const card = src('components/chat/ChatArtifactCard.tsx')
    expect(card).toContain('setSaveState(saveStateAfter(outcome))')
    expect(card).not.toMatch(/setSaveState\('done'\)/)
    expect(card).not.toContain('save_text_file_dialog')
  })
})

describe('every caller goes through the one door', () => {
  it('no private blob anchors and no private dialog calls are left in the six call sites', () => {
    for (const file of [
      'components/settings/MemorySettings.tsx',
      'components/models/BenchmarkView.tsx',
      'components/chat/ChatArtifactCard.tsx',
      'components/chat/ChatAttachment.tsx',
      'components/create/experimental/galleryDownload.ts',
    ]) {
      const s = src(file)
      expect(s, file).toContain('saveOrShare(')
      expect(s, file).not.toMatch(/\.download = /)
      expect(s, file).not.toContain("'save_binary_file_dialog'")
      expect(s, file).not.toContain("'save_text_file_dialog'")
    }
    expect(src('lib/chat-export.ts')).not.toContain("'save_text_file_dialog'")
    expect(src('components/settings/MemorySettings.tsx')).toContain("{ via: 'anchor' }")
    expect(src('components/models/BenchmarkView.tsx')).toContain("{ via: 'anchor' }")
  })

  it('the attachment keeps its native dialog on the desktop and shares the original on a phone', () => {
    const s = src('components/chat/ChatAttachment.tsx')
    expect(s).toContain('if (isTauri() && !isMobile()) {')
    expect(s).toContain("await backendCall('save_chat_attachment_dialog'")
    expect(s).toContain('const original = await originalAttachment(image)')
  })
})
