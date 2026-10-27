/**
 * Round 2 of the chat strand: the parts that are pure, and the two calls
 * other strands use (sendFromOutside, continueReply).
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navCalls = vi.hoisted(() => ({ resetTo: [] as unknown[], openSheet: [] as unknown[], top: null as null | { route: string; params: Record<string, string> } }))
const consent = vi.hoisted(() => ({ answer: true }))
const ready = vi.hoisted(() => ({ answer: true }))

vi.mock('../../../nav', () => ({
  nav: {
    resetTo: (...args: unknown[]) => navCalls.resetTo.push(args),
    openSheet: (...args: unknown[]) => navCalls.openSheet.push(args),
    getState: () => ({ flow: null, flowStack: [], tab: 'chat', stacks: { chat: [{ route: '/chats', params: {} }, ...(navCalls.top ? [navCalls.top] : [])] } }),
  },
}))
vi.mock('../../../ui', () => ({ toast: vi.fn() }))
vi.mock('../../../policy', () => ({ ensureAiConsent: async () => consent.answer, openReport: vi.fn(), storePolicy: () => ({}) }))
vi.mock('../../../../lib/chat-model-ready', () => ({ chatModelReady: () => ready.answer }))
vi.mock('../../../platform', () => ({ getFitDevice: vi.fn() }))

import type { Message } from '../../../../types/chat'
import { useChatStore } from '../../../../stores/chatStore'
import { useGenerationStore } from '../../../../stores/generationStore'
import { useModelStore } from '../../../../stores/modelStore'
import { isCloudModel } from '../parts/consent'
import { continueReply, registerChatController, replyToContinue, sendFromOutside, takePendingContinue, type ChatController } from '../parts/controller'
import { takePendingSend } from '../parts/logic/drafts'
import { decodeFileRef, encodeFileRef } from '../parts/logic/messages'
import { reportForAnswer } from '../parts/logic/policy'
import { imagesFromClipboard } from '../parts/paste'
import { preloadFit } from '../parts/preload'
import { mimeOfName, workspaceRows } from '../parts/workspace-files'

const here = dirname(fileURLToPath(import.meta.url))

const msg = (over: Partial<Message>): Message => ({ id: 'm', role: 'assistant', content: '', timestamp: 1, ...over }) as Message

describe('the adapters round 2 was to remove', () => {
  it('engine-state.ts is gone and nothing in the strand names it', () => {
    expect(existsSync(resolve(here, '../parts/adapters/engine-state.ts'))).toBe(false)
    for (const file of ['../ChatPage.tsx', '../ModelSheet.tsx']) {
      expect(readFileSync(resolve(here, file), 'utf8')).not.toMatch(/adapters\/engine-state/)
    }
  })
  it('run-error.ts only hands on what the logic layer reads from the field', () => {
    const code = readFileSync(resolve(here, '../parts/adapters/run-error.ts'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('/**') && !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    expect(code).toHaveLength(1)
    // Since round 21 the reading that also cleans the text for a reader (lib/reader-text.ts, which reads the field through lib/message-error.ts).
    expect(code[0]).toMatch(/^export \{.*\} from '.*lib\/(message-error|reader-text)'$/)
  })
})

describe('isCloudModel', () => {
  it('goes by the provider in the name', () => {
    expect(isCloudModel('lu-cloud::some-model')).toBe(true)
    expect(isCloudModel('openai::qwen')).toBe(false)
    expect(isCloudModel('plain')).toBe(false)
    expect(isCloudModel(null)).toBe(false)
  })
})

describe('preloadFit', () => {
  const gb = 1024 ** 3
  it('does not know without a reading of the phone or the file', () => {
    expect(preloadFit(null, 2 * gb)).toBe('unknown')
    expect(preloadFit({ ramGb: 0 } as never, 2 * gb)).toBe('unknown')
    expect(preloadFit({ ramGb: 8 } as never, 0)).toBe('unknown')
  })
  it('holds back only what is too large for the device', () => {
    expect(preloadFit({ platform: 'android', ramGb: 12 } as never, 0.5 * gb)).toBe('fits')
    expect(preloadFit({ platform: 'android', ramGb: 3 } as never, 20 * gb)).toBe('no-room')
  })
})

describe('files of the agent folder', () => {
  it('lists files below the folder, newest first, without housekeeping', () => {
    const rows = workspaceRows([
      { name: 'ws', path: '/data/ws', isDir: true, size: 0, modified: 0 },
      { name: 'notes.md', path: '/data/ws/notes.md', isDir: false, size: 12, modified: 100 },
      { name: 'sub', path: '/data/ws/sub', isDir: true, size: 0, modified: 0 },
      { name: 'plot.png', path: '/data/ws/sub/plot.png', isDir: false, size: 900, modified: 200 },
      { name: '.tmp1', path: '/data/ws/.tmp1', isDir: false, size: 1, modified: 300 },
      { name: 'x', path: '/data/ws/.git/x', isDir: false, size: 1, modified: 300 },
    ] as never)
    expect(rows.map((r) => r.path)).toEqual(['sub/plot.png', 'notes.md'])
    expect(rows[0]).toMatchObject({ name: 'plot.png', size: 900, modified: 200 })
  })
  it('reads Windows paths as well', () => {
    const rows = workspaceRows([
      { name: 'ws', path: 'C:\\ws', isDir: true, size: 0, modified: 0 },
      { name: 'a.txt', path: 'C:\\ws\\out\\a.txt', isDir: false, size: 1, modified: 1 },
      { name: 'out', path: 'C:\\ws\\out', isDir: true, size: 0, modified: 0 },
    ] as never)
    expect(rows.map((r) => r.path)).toEqual(['out/a.txt'])
  })
  it('knows the type by the ending', () => {
    expect(mimeOfName('a.PNG')).toBe('image/png')
    expect(mimeOfName('notes.md')).toBe('text/markdown')
    expect(mimeOfName('thing')).toBe('application/octet-stream')
  })
  it('a reference keeps the path and never leaves the folder', () => {
    const id = encodeFileRef({ kind: 'workspace', path: 'out/my notes~1.md' })
    expect(id.split('~')).toHaveLength(2)
    expect(decodeFileRef(id)).toEqual({ kind: 'workspace', path: 'out/my notes~1.md' })
    for (const bad of ['../secret', 'a/../../b', '/etc/passwd', 'C:\\x', 'a\\..\\b']) {
      expect(decodeFileRef(`ws~${encodeURIComponent(bad)}`)).toBeNull()
    }
    expect(decodeFileRef('ws~')).toBeNull()
    expect(decodeFileRef('ws~%E0%A4%A')).toBeNull()
  })
})

describe('imagesFromClipboard', () => {
  const file = (name: string, type: string) => new File(['x'], name, { type, lastModified: 5 })
  it('takes pictures and leaves text alone', () => {
    expect(imagesFromClipboard(null)).toEqual([])
    expect(imagesFromClipboard({ files: [], items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] })).toEqual([])
    const png = file('a.png', 'image/png')
    expect(imagesFromClipboard({ files: [png, file('a.txt', 'text/plain')] })).toEqual([png])
  })
  it('counts a picture once when the paste names it in both places', () => {
    const png = file('a.png', 'image/png')
    const out = imagesFromClipboard({ files: [png], items: [{ kind: 'file', type: 'image/png', getAsFile: () => png }] })
    expect(out).toHaveLength(1)
  })
  it('reads a picture that only the items carry, and survives one that cannot be read', () => {
    const png = file('b.png', 'image/png')
    const out = imagesFromClipboard({
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => png },
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => {
            throw new Error('no')
          },
        },
      ],
    })
    expect(out).toEqual([png])
  })
})

describe('reportForAnswer', () => {
  it('names the model the way the user sees it', () => {
    const nameOf = (id: string) => (id === 'openai::qwen-0.5b-q4' ? 'Qwen 0.5B' : '')
    expect(reportForAnswer({ id: 'a', modelId: 'openai::qwen-0.5b-q4' }, 'text', false, '', nameOf).model).toBe('Qwen 0.5B')
    // A model the list no longer knows keeps its id rather than an empty name.
    expect(reportForAnswer({ id: 'a', modelId: 'gone::x' }, 'text', false, '', nameOf).model).toBe('gone::x')
    expect(reportForAnswer({ id: 'a' }, 'text', true, 'openai::qwen-0.5b-q4', nameOf).model).toBe('Qwen 0.5B')
    expect(reportForAnswer({ id: 'a' }, 'text', true).model).toBe('')
  })
})

describe('replyToContinue', () => {
  it('is the last answer when it was cut or failed', () => {
    const cut = msg({ id: 'a2', content: 'Half', error: { kind: 'interrupted', detail: '', at: 1 } })
    expect(replyToContinue([msg({ id: 'u', role: 'user', content: 'hi' }), cut])?.id).toBe('a2')
    expect(replyToContinue([msg({ id: 'a3', content: '', error: { kind: 'network', detail: 'x', at: 1 } })])?.id).toBe('a3')
  })
  it('is nothing for a whole answer, a question, or an error asking again cannot repair', () => {
    expect(replyToContinue([])).toBeNull()
    expect(replyToContinue([msg({ content: 'All good.' })])).toBeNull()
    expect(replyToContinue([msg({ role: 'user', content: 'hi' })])).toBeNull()
    expect(replyToContinue([msg({ error: { kind: 'credits', detail: '', at: 1 } })])).toBeNull()
    expect(replyToContinue([msg({ error: { kind: 'session', detail: '', at: 1 } })])).toBeNull()
  })
})

describe('sendFromOutside and continueReply', () => {
  const controller = (chatId: string, busy = false) => {
    const calls = { send: [] as string[], regenerate: [] as string[] }
    const c: ChatController = {
      chatId,
      isBusy: () => busy,
      regenerate: () => {},
      // "Continue answer" goes on from the part that is there (round 3, H2 of the button acceptance).
      continueAnswer: (id) => calls.regenerate.push(id),
      editInComposer: () => {},
      speak: () => {},
      isSpeaking: () => false,
      send: (text) => calls.send.push(text),
    }
    return { c, calls }
  }
  beforeEach(() => {
    navCalls.resetTo.length = 0
    navCalls.openSheet.length = 0
    navCalls.top = { route: '/chat/:id', params: { id: 'c1' } }
    consent.answer = true
    ready.answer = true
    useGenerationStore.setState({ generating: {} } as never)
    useModelStore.setState({ activeModel: 'openai::qwen' } as never)
    useChatStore.setState({
      conversations: [
        { id: 'c1', title: 'One', messages: [msg({ id: 'u1', role: 'user', content: 'hi' }), msg({ id: 'a1', content: 'Half', error: { kind: 'interrupted', detail: '', at: 1 } })], createdAt: 1, updatedAt: 1 },
        { id: 'c2', title: 'Two', messages: [msg({ id: 'a9', content: 'Fine.' })], createdAt: 1, updatedAt: 1 },
      ],
    } as never)
    takePendingSend('c1')
    takePendingContinue('c1')
  })

  it('sends through the page that is open', async () => {
    const { c, calls } = controller('c1')
    const off = registerChatController(c)
    expect(await sendFromOutside('c1', '  Do it  ')).toBe('sent')
    expect(calls.send).toEqual(['Do it'])
    expect(navCalls.resetTo).toHaveLength(0)
    off()
  })
  it('opens the chat and leaves the message for its page when the page is not there', async () => {
    navCalls.top = null
    expect(await sendFromOutside('c1', 'Do it')).toBe('opened')
    expect(navCalls.resetTo).toEqual([['chat', [{ route: '/chat/:id', params: { id: 'c1' } }]]])
    expect(takePendingSend('c1')).toMatchObject({ text: 'Do it', images: [], files: [] })
  })
  it('a page that is mounted but not the one on screen does not answer where nobody looks', async () => {
    const { c, calls } = controller('c1')
    const off = registerChatController(c)
    navCalls.top = { route: '/chat/:id/tasks', params: { id: 'c1' } }
    expect(await sendFromOutside('c1', 'Do it')).toBe('opened')
    expect(continueReply('c1')).toBe('opened')
    expect(calls).toEqual({ send: [], regenerate: [] })
    expect(navCalls.resetTo).toHaveLength(2)
    takePendingSend('c1')
    takePendingContinue('c1')
    off()
  })
  it('sends nothing without a text, a chat, a model, a yes to the cloud, or into a running answer', async () => {
    expect(await sendFromOutside('c1', '   ')).toBe('empty')
    expect(await sendFromOutside('nope', 'x')).toBe('no-chat')
    useGenerationStore.setState({ generating: { c1: true } } as never)
    expect(await sendFromOutside('c1', 'x')).toBe('busy')
    useGenerationStore.setState({ generating: {} } as never)
    ready.answer = false
    expect(await sendFromOutside('c1', 'x')).toBe('no-model')
    expect(navCalls.openSheet).toEqual([['model']])
    ready.answer = true
    useModelStore.setState({ activeModel: 'lu-cloud::big' } as never)
    consent.answer = false
    expect(await sendFromOutside('c1', 'x')).toBe('declined')
    expect(takePendingSend('c1')).toBeNull()
    expect(navCalls.resetTo).toHaveLength(0)
  })
  it('continues the cut answer in the open page, or opens the chat for it', () => {
    const { c, calls } = controller('c1')
    const off = registerChatController(c)
    expect(continueReply('c1')).toBe('continued')
    expect(calls.regenerate).toEqual(['a1'])
    off()
    navCalls.top = null
    expect(continueReply('c1')).toBe('opened')
    expect(navCalls.resetTo).toHaveLength(1)
    expect(takePendingContinue('c1')).toBe('a1')
    expect(takePendingContinue('c1')).toBeNull()
  })
  it('does nothing for a whole answer, an unknown chat or a busy one', () => {
    expect(continueReply('c2')).toBe('nothing')
    expect(continueReply('nope')).toBe('no-chat')
    const { c, calls } = controller('c1', true)
    const off = registerChatController(c)
    expect(continueReply('c1')).toBe('busy')
    expect(calls.regenerate).toEqual([])
    off()
  })
})
