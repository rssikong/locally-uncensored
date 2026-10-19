// D26 (3.0.8): a ChatGPT export becomes real chats.
//
// The fixture is a hand-built export in the shape "Settings, Data controls,
// Export" produces: a .zip with a dated top folder, conversations.json next
// to user.json, chat.html and the uploaded picture as file-<id>-<name>. The
// first conversation has everything the converter must get right: a hidden
// system message, a visible system prompt, an uploaded image that is both an
// asset pointer and an attachment, a regenerated answer (two branches, only
// current_node's is the visible one), a PDF attachment, a reasoning trace, a
// tool call to the image tool and its picture, and inline citation markers.

import { describe, it, expect, beforeEach } from 'vitest'
import JSZip from 'jszip'
import { parseExportFile, parseJsonText, IMPORT_HINT, type NormalisedConversation, type ParseProgress } from '../parsers/chatbot-export'
import { parseExportFileOffThread } from '../parsers/chatbot-export-offthread'
import { importAsChats, importState, importedChatId, separateChatId, toChatConversation, SEPARATE_TITLE_SUFFIX } from '../chat-import'
import { useChatStore } from '../../stores/chatStore'

const T0 = 1_760_000_000 // seconds, 2025-10-09

function node(id: string, parent: string | null, children: string[], message: Record<string, unknown> | null) {
  return { id, parent, children, message: message ? { id, ...message } : null }
}

const lisbon = {
  title: 'Trip to Lisbon',
  create_time: T0,
  update_time: T0 + 600,
  conversation_id: '6801-lisbon-uuid',
  id: '6801-lisbon-uuid',
  current_node: 'a3',
  default_model_slug: 'gpt-4o',
  mapping: {
    'client-created-root': node('client-created-root', null, ['sys-hidden'], null),
    'sys-hidden': node('sys-hidden', 'client-created-root', ['sys'], {
      author: { role: 'system', name: null, metadata: {} },
      create_time: null,
      content: { content_type: 'text', parts: [''] },
      metadata: { is_visually_hidden_from_conversation: true },
      recipient: 'all',
    }),
    sys: node('sys', 'sys-hidden', ['u1'], {
      author: { role: 'system' },
      create_time: T0,
      content: { content_type: 'text', parts: ['You are ChatGPT, a large language model. SYSTEM SECRET'] },
      recipient: 'all',
    }),
    u1: node('u1', 'sys', ['a1', 'a2'], {
      author: { role: 'user' },
      create_time: T0 + 10,
      content: {
        content_type: 'multimodal_text',
        parts: [
          { content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-abc123', size_bytes: 1234, width: 800, height: 600 },
          'Where was this photo taken?',
        ],
      },
      metadata: { attachments: [{ id: 'file-abc123', name: 'beach.jpg', mime_type: 'image/jpeg', size: 1234 }] },
      recipient: 'all',
    }),
    a1: node('a1', 'u1', [], {
      author: { role: 'assistant' },
      create_time: T0 + 20,
      content: { content_type: 'text', parts: ['ABANDONED first answer'] },
      recipient: 'all',
    }),
    a2: node('a2', 'u1', ['u2'], {
      author: { role: 'assistant' },
      create_time: T0 + 30,
      content: { content_type: 'text', parts: ['Looks like Praia da Rainha in Cascais.'] },
      recipient: 'all',
    }),
    u2: node('u2', 'a2', ['think'], {
      author: { role: 'user' },
      create_time: T0 + 40,
      content: { content_type: 'text', parts: ['Make a poster from my itinerary.'] },
      metadata: { attachments: [{ id: 'file-pdf9', name: 'itinerary.pdf', mime_type: 'application/pdf' }] },
      recipient: 'all',
    }),
    think: node('think', 'u2', ['call'], {
      author: { role: 'assistant' },
      create_time: T0 + 45,
      content: { content_type: 'thoughts', thoughts: [{ summary: 'Planning', content: 'REASONING TRACE' }] },
      recipient: 'all',
    }),
    call: node('call', 'think', ['tool'], {
      author: { role: 'assistant' },
      create_time: T0 + 50,
      content: { content_type: 'code', language: 'json', text: '{"prompt":"TOOL CALL PROMPT"}' },
      recipient: 'dalle.text2im',
    }),
    tool: node('tool', 'call', ['a3'], {
      author: { role: 'tool', name: 'dalle.text2im' },
      create_time: T0 + 60,
      content: {
        content_type: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_00000000gen', width: 1024, height: 1024 }],
      },
      recipient: 'all',
    }),
    a3: node('a3', 'tool', [], {
      author: { role: 'assistant' },
      create_time: T0 + 70,
      content: { content_type: 'text', parts: ['Here is your poster.citeturn0search0 Enjoy Lisbon【4†source】!'] },
      recipient: 'all',
    }),
  },
}

const second = {
  title: 'Second chat',
  create_time: T0 + 1000,
  update_time: T0 + 1100,
  id: '6802-second-uuid',
  current_node: 'b2',
  mapping: {
    root: node('root', null, ['b1'], null),
    b1: node('b1', 'root', ['b2'], { author: { role: 'user' }, create_time: T0 + 1010, content: { content_type: 'text', parts: ['Hello'] }, recipient: 'all' }),
    b2: node('b2', 'b1', [], { author: { role: 'assistant' }, create_time: T0 + 1020, content: { content_type: 'text', parts: ['Hi there'] }, recipient: 'all' }),
  },
}

async function makeExportZip(conversations: unknown[]): Promise<File> {
  const zip = new JSZip()
  const folder = '6f1e2d3c4b5a-2026-10-14-10-00-00'
  zip.file(`${folder}/conversations.json`, JSON.stringify(conversations))
  zip.file(`${folder}/user.json`, JSON.stringify({ id: 'user-x' }))
  zip.file(`${folder}/message_feedback.json`, '[]')
  zip.file(`${folder}/chat.html`, '<html></html>')
  zip.file(`${folder}/file-abc123-beach.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))
  const buf = await zip.generateAsync({ type: 'uint8array' })
  // vitest env is node: no File, so tag the bytes with a name (JSZip reads them).
  return Object.assign(buf, { name: 'chatgpt-export.zip' }) as unknown as File
}

async function parsed(): Promise<NormalisedConversation[]> {
  return (await parseExportFile(await makeExportZip([lisbon, second]))).conversations
}

describe('ChatGPT export: conversations with their visible thread', () => {
  it('finds both conversations in the zip with stable ids, titles and create_time', async () => {
    const convs = await parsed()
    expect(convs.map(c => c.title)).toEqual(['Trip to Lisbon', 'Second chat'])
    expect(convs.map(c => c.id)).toEqual(['chatgpt-6801-lisbon-uuid', 'chatgpt-6802-second-uuid'])
    expect(convs[0].createdAt).toBe(T0 * 1000)
    expect(convs[0].updatedAt).toBe((T0 + 600) * 1000)
  })

  it('follows current_node, keeps user/assistant in order and leaves out system, reasoning and tool calls', async () => {
    const [c] = await parsed()
    expect(c.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'assistant'])
    expect(c.messageCount).toBe(5)
    const all = c.messages.map(m => m.content).join('\n')
    expect(all).not.toContain('ABANDONED')
    expect(all).not.toContain('SYSTEM SECRET')
    expect(all).not.toContain('REASONING TRACE')
    expect(all).not.toContain('TOOL CALL PROMPT')
    expect(c.messages[1].content).toBe('Looks like Praia da Rainha in Cascais.')
    expect(c.messages[0].timestamp).toBe((T0 + 10) * 1000)
  })

  it('writes a hint line for pictures and files instead of a broken pointer, naming each upload once', async () => {
    const [c] = await parsed()
    expect(c.messages[0].content).toBe(`Where was this photo taken?\n\n${IMPORT_HINT.attachment('beach.jpg', true)}`)
    expect(c.messages[2].content).toBe(`Make a poster from my itinerary.\n\n${IMPORT_HINT.attachment('itinerary.pdf', false)}`)
    expect(c.messages[3].content).toBe(IMPORT_HINT.generatedImage)
    const all = c.messages.map(m => m.content).join('\n')
    expect(all).not.toMatch(/asset_pointer|file-service|sediment:/)
  })

  it('drops inline citation markers', async () => {
    const [c] = await parsed()
    expect(c.messages[4].content).toBe('Here is your poster. Enjoy Lisbon!')
  })

  it('an image pointer without an attachment entry still gets a hint', () => {
    const conv = {
      title: 'Pointer only', create_time: T0, id: 'p1', current_node: 'u',
      mapping: {
        r: node('r', null, ['u'], null),
        u: node('u', 'r', [], { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-zzz' }, 'look'] } }),
      },
    }
    const [c] = parseJsonText(JSON.stringify([conv])).conversations
    expect(c.messages[0].content).toBe(`${IMPORT_HINT.image}\nlook`)
  })

  it('reports progress while converting', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ ...second, id: `s-${i}`, title: `Chat ${i}` }))
    const seen: ParseProgress[] = []
    const r = parseJsonText(JSON.stringify(many), p => seen.push(p))
    expect(r.conversations).toHaveLength(120)
    expect(seen.length).toBeGreaterThanOrEqual(3)
    expect(seen.at(-1)).toEqual({ stage: 'converting', done: 120, total: 120 })
  })

  it('keeps ids unique when an export repeats a conversation', () => {
    const r = parseJsonText(JSON.stringify([second, second]))
    expect(r.conversations.map(c => c.id)).toEqual(['chatgpt-6802-second-uuid', 'chatgpt-6802-second-uuid~2'])
  })

  it('parses on the main thread where there is no Worker (tests, fallback)', async () => {
    const r = await parseExportFileOffThread(await makeExportZip([lisbon, second]))
    expect(r.conversations).toHaveLength(2)
  })
})

describe('ChatGPT export: into the chat store as real chats', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [], activeConversationId: null })
  })

  it('builds an ordinary chat with title, original dates and the messages', async () => {
    const [c] = await parsed()
    const chat = toChatConversation(c, 'llama3.2:3b', 5)
    expect(chat.id).toBe('import-chatgpt-6801-lisbon-uuid')
    expect(chat.title).toBe('Trip to Lisbon')
    expect(chat.createdAt).toBe(T0 * 1000)
    expect(chat.updatedAt).toBe((T0 + 600) * 1000)
    expect(chat.mode).toBe('lu')
    expect(chat.model).toBe('llama3.2:3b')
    expect(chat.messages).toHaveLength(5)
    expect(chat.messages[0]).toMatchObject({ id: 'import-chatgpt-6801-lisbon-uuid-m0', role: 'user' })
    expect(new Set(chat.messages.map(m => m.id)).size).toBe(5)
  })

  it('imports each conversation as its own chat and recognises them on the second import', async () => {
    const convs = await parsed()
    const store = () => useChatStore.getState()
    const first = await importAsChats(convs, { model: 'm', getConversations: () => useChatStore.getState().conversations, importConversations: store().importConversations, yieldToUi: async () => {} })
    expect(first).toEqual({ added: 2, skipped: 0, separate: 0 })
    expect(store().conversations.map(c => c.title).sort()).toEqual(['Second chat', 'Trip to Lisbon'])
    // The open chat is not changed by an import.
    expect(store().activeConversationId).toBeNull()

    const existing = new Map(store().conversations.map(c => [c.id, c]))
    expect(convs.map(c => importState(c, existing))).toEqual(['present', 'present'])
    const again = await importAsChats(convs, { model: 'm', getConversations: () => useChatStore.getState().conversations, importConversations: store().importConversations, yieldToUi: async () => {} })
    expect(again).toEqual({ added: 0, skipped: 2, separate: 0 })
    expect(store().conversations).toHaveLength(2)
  })

  it('a later export with the conversation continued counts as newer and refreshes it', async () => {
    const convs = await parsed()
    await importAsChats(convs, { model: 'm', getConversations: () => useChatStore.getState().conversations, importConversations: useChatStore.getState().importConversations, yieldToUi: async () => {} })
    const continued = { ...second, update_time: T0 + 5000, current_node: 'b3', mapping: {
      ...second.mapping,
      b2: { ...second.mapping.b2, children: ['b3'] },
      b3: node('b3', 'b2', [], { author: { role: 'user' }, create_time: T0 + 4990, content: { content_type: 'text', parts: ['One more thing'] }, recipient: 'all' }),
    } }
    const [newer] = parseJsonText(JSON.stringify([continued])).conversations
    const existing = new Map(useChatStore.getState().conversations.map(c => [c.id, c]))
    expect(importState(newer, existing)).toBe('newer')
    const r = await importAsChats([newer], { model: 'm', getConversations: () => useChatStore.getState().conversations, importConversations: useChatStore.getState().importConversations, yieldToUi: async () => {} })
    expect(r).toEqual({ added: 1, skipped: 0, separate: 0 })
    const chat = useChatStore.getState().conversations.find(c => c.id === importedChatId(newer))
    expect(chat?.messages.at(-1)?.content).toBe('One more thing')
    expect(useChatStore.getState().conversations).toHaveLength(2)
  })

  it('goes into the store in batches with progress, yielding between them', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...second, id: `batch-${i}`, title: `Chat ${i}` }))
    const convs = parseJsonText(JSON.stringify(many)).conversations
    const progress: number[] = []
    let yields = 0
    const r = await importAsChats(convs, {
      model: 'm',
      getConversations: () => useChatStore.getState().conversations,
      importConversations: useChatStore.getState().importConversations,
      batchSize: 10,
      onProgress: p => progress.push(p.done),
      yieldToUi: async () => { yields++ },
    })
    expect(r.added).toBe(25)
    expect(progress).toEqual([0, 10, 20, 25])
    expect(yields).toBe(3)
    expect(useChatStore.getState().conversations).toHaveLength(25)
  })
})

describe('ChatGPT export: a chat continued in LU is never replaced by a newer export', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [], activeConversationId: null })
  })

  const opts = () => ({
    model: 'm',
    getConversations: () => useChatStore.getState().conversations,
    importConversations: useChatStore.getState().importConversations,
    yieldToUi: async () => {},
  })

  /**
   * The same conversation, exported later after it went on in ChatGPT. Its
   * update_time lies an hour in the FUTURE, i.e. after the LU message below:
   * the user wrote in LU on one day, in ChatGPT the next, then exported. A
   * merge by updatedAt alone takes this copy as the newer one.
   */
  function laterExport(): NormalisedConversation {
    const later = Math.floor(Date.now() / 1000) + 3600
    const continued = { ...second, update_time: later, current_node: 'b3', mapping: {
      ...second.mapping,
      b2: { ...second.mapping.b2, children: ['b3'] },
      b3: node('b3', 'b2', [], { author: { role: 'user' }, create_time: later - 10, content: { content_type: 'text', parts: ['Asked in ChatGPT later'] }, recipient: 'all' }),
    } }
    return parseJsonText(JSON.stringify([continued])).conversations[0]
  }

  async function importSecondAndContinueInLu(change: 'add' | 'edit' | 'delete'): Promise<string> {
    const [first] = parseJsonText(JSON.stringify([second])).conversations
    await importAsChats([first], opts())
    const id = importedChatId(first)
    const s = useChatStore.getState()
    const chat = s.conversations.find(c => c.id === id)!
    if (change === 'add') s.addMessage(id, { id: 'lu-1', role: 'user', content: 'Written in LU', timestamp: Date.now() })
    if (change === 'edit') s.updateMessageContent(id, chat.messages[1].id, 'Edited in LU')
    if (change === 'delete') s.deleteMessage(id, chat.messages[1].id)
    return id
  }

  it('keeps the LU continuation and adds the newer export as a separate chat', async () => {
    const id = await importSecondAndContinueInLu('add')
    const newer = laterExport()
    const existing = new Map(useChatStore.getState().conversations.map(c => [c.id, c]))
    expect(importState(newer, existing)).toBe('continued')

    const r = await importAsChats([newer], opts())
    const chats = useChatStore.getState().conversations
    // First what the user wrote in LU, then the counts: the old merge
    // replaced this chat with the export's copy and the line was gone.
    const mine = chats.find(c => c.id === id)!
    expect(mine.messages.map(m => m.content)).toEqual(['Hello', 'Hi there', 'Written in LU'])
    expect(r).toEqual({ added: 0, skipped: 0, separate: 1 })
    expect(chats).toHaveLength(2)
    const copy = chats.find(c => c.id === separateChatId(newer))!
    expect(copy.title).toBe(`Second chat${SEPARATE_TITLE_SUFFIX}`)
    expect(copy.messages.map(m => m.content)).toEqual(['Hello', 'Hi there', 'Asked in ChatGPT later'])
  })

  it.each(['edit', 'delete'] as const)('treats a message changed in LU (%s) the same way', async (change) => {
    const id = await importSecondAndContinueInLu(change)
    const before = useChatStore.getState().conversations.find(c => c.id === id)!.messages.map(m => m.content)
    const r = await importAsChats([laterExport()], opts())
    expect(useChatStore.getState().conversations.find(c => c.id === id)!.messages.map(m => m.content)).toEqual(before)
    expect(r.separate).toBe(1)
  })

  it('a third import of the same later export finds the separate chat and adds nothing', async () => {
    await importSecondAndContinueInLu('add')
    const newer = laterExport()
    await importAsChats([newer], opts())
    const existing = new Map(useChatStore.getState().conversations.map(c => [c.id, c]))
    expect(importState(newer, existing)).toBe('present')
    const r = await importAsChats([newer], opts())
    expect(r).toEqual({ added: 0, skipped: 1, separate: 0 })
    expect(useChatStore.getState().conversations).toHaveLength(2)
  })

  it('a chat continued in LU and an export with nothing newer: skipped, no copy', async () => {
    await importSecondAndContinueInLu('add')
    const [same] = parseJsonText(JSON.stringify([second])).conversations
    const r = await importAsChats([same], opts())
    expect(r).toEqual({ added: 0, skipped: 1, separate: 0 })
    expect(useChatStore.getState().conversations).toHaveLength(1)
  })

  it('an untouched chat is still replaced by the newer export, in place', async () => {
    const [first] = parseJsonText(JSON.stringify([second])).conversations
    await importAsChats([first], opts())
    const newer = laterExport()
    expect(importState(newer, new Map(useChatStore.getState().conversations.map(c => [c.id, c])))).toBe('newer')
    const r = await importAsChats([newer], opts())
    expect(r).toEqual({ added: 1, skipped: 0, separate: 0 })
    const chats = useChatStore.getState().conversations
    expect(chats).toHaveLength(1)
    expect(chats[0].messages.at(-1)?.content).toBe('Asked in ChatGPT later')
  })
})
