/**
 * @vitest-environment jsdom
 *
 * Finding F2 of the check on Android with 4 GB: a new chat, the app killed in
 * the first 150 ms after Send, chat and question gone. The first question of
 * a new chat is now written before the app shows it as sent, and a record
 * that is still there at the next start puts chat and question back
 * (lib/first-question.ts).
 *
 * The backend of the storage is replaced: a disk that lands at once, one
 * that lands when the test says so, and one that fails.
 *
 * Run: npx vitest run src/mobile/lib/__tests__/first-question.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => ({
  mode: 'ok' as 'ok' | 'held' | 'fails',
  data: {} as Record<string, string>,
  waiting: {} as Record<string, string>,
  held: [] as { key: string; land: () => void }[],
  /** Every step in the order it happened: writes that landed, removals, and what the test notes itself. */
  log: [] as string[],
}))
vi.mock('../../../lib/idbStorage', () => ({
  // The value of a write that failed waits to be written again (lib/idbStorage.ts, phone only).
  dropPendingStorageWrite: (key: string, only?: (value: string) => boolean) => {
    const waiting = disk.waiting[key]
    if (waiting === undefined || (only && !only(waiting))) return false
    delete disk.waiting[key]
    disk.log.push(`dropped:${key}`)
    return true
  },
  idbStorage: {
    getItem: (key: string) => disk.data[key] ?? null,
    setItem: (key: string, value: string) => {
      if (disk.mode === 'fails') {
        disk.waiting[key] = value
        return Promise.reject(new Error('disk full'))
      }
      const land = () => {
        disk.data[key] = value
        disk.log.push(`landed:${key}`)
      }
      if (disk.mode === 'ok') {
        land()
        return Promise.resolve()
      }
      return new Promise<void>((done) => {
        disk.held.push({ key, land: () => { land(); done() } })
      })
    },
    removeItem: (key: string) => {
      delete disk.data[key]
      disk.log.push(`removed:${key}`)
      return Promise.resolve()
    },
  },
}))

import { INTERRUPTED_EMPTY_TEXT, INTERRUPTED_FINISH_REASON } from '../../../lib/interrupted-runs'
import { flushChatPersist, useChatStore } from '../../../stores/chatStore'
import { FIRST_QUESTION_KEY, handOverFirstQuestion, parseFirstQuestion, releaseFirstQuestion, restoreFirstQuestion, type FirstQuestion } from '../first-question'

const CHATS_KEY = 'chat-conversations'
const QUESTION = 'What is the cargo code of the ship Zephyr-15?'
const record = (over: Partial<FirstQuestion> = {}): FirstQuestion => ({ chatId: 'chat-1', text: QUESTION, model: 'qwen', systemPrompt: '', attachments: 0, at: 1000, ...over })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const settle = async () => {
  for (let i = 0; i < 5; i++) await wait(0)
}

beforeEach(async () => {
  disk.mode = 'ok'
  useChatStore.setState({ conversations: [], activeConversationId: null })
  await flushChatPersist()
  disk.data = {}
  disk.waiting = {}
  disk.held.length = 0
  disk.log.length = 0
})

afterEach(async () => {
  disk.mode = 'ok'
  for (const w of disk.held.splice(0)) w.land()
  await flushChatPersist()
  vi.useRealTimers()
})

describe('handOverFirstQuestion: written first, shown as sent after', () => {
  it('does not show the question as sent while its write has not landed', async () => {
    disk.mode = 'held'
    const shown = vi.fn(() => disk.log.push('shown'))
    const done = handOverFirstQuestion(record(), shown, 5000)
    await settle()
    expect(shown).not.toHaveBeenCalled()
    expect(disk.data[FIRST_QUESTION_KEY]).toBeUndefined()
    disk.held.splice(0).forEach((w) => w.land())
    await done
    expect(shown).toHaveBeenCalledTimes(1)
    // The order is the whole point.
    expect(disk.log).toEqual([`landed:${FIRST_QUESTION_KEY}`, 'shown'])
    expect(parseFirstQuestion(disk.data[FIRST_QUESTION_KEY])).toEqual(record())
  })

  it('a storage that hangs holds the send back for the cap and no longer, and the late write does not show it twice', async () => {
    disk.mode = 'held'
    const shown = vi.fn()
    const started = Date.now()
    await handOverFirstQuestion(record(), shown, 60)
    expect(Date.now() - started).toBeGreaterThanOrEqual(55)
    expect(shown).toHaveBeenCalledTimes(1)
    disk.held.splice(0).forEach((w) => w.land())
    await settle()
    expect(shown).toHaveBeenCalledTimes(1)
  })

  it('a write that fails does not keep the send from going on', async () => {
    disk.mode = 'fails'
    const shown = vi.fn()
    await handOverFirstQuestion(record(), shown, 5000)
    expect(shown).toHaveBeenCalledTimes(1)
  })
})

describe('restoreFirstQuestion: what a kill after the write left behind', () => {
  it('puts the chat and its question back, says that no answer came, and removes the record after the chat is written', async () => {
    disk.data[FIRST_QUESTION_KEY] = JSON.stringify(record())
    const restored = await restoreFirstQuestion()
    const chats = useChatStore.getState().conversations
    expect(chats).toHaveLength(1)
    expect(restored).toBe(chats[0].id)
    expect(chats[0].model).toBe('qwen')
    expect(chats[0].title).toContain('cargo code')
    expect(chats[0].messages.map((m) => [m.role, m.content, m.finishReason])).toEqual([
      ['user', QUESTION, undefined],
      ['assistant', INTERRUPTED_EMPTY_TEXT, INTERRUPTED_FINISH_REASON],
    ])
    // The app opens where it was, not inside the restored chat.
    expect(useChatStore.getState().activeConversationId).toBeNull()
    expect(disk.data[FIRST_QUESTION_KEY]).toBeUndefined()
    expect(disk.data[CHATS_KEY]).toContain(QUESTION)
    expect(disk.log.indexOf(`landed:${CHATS_KEY}`)).toBeGreaterThanOrEqual(0)
    expect(disk.log.indexOf(`landed:${CHATS_KEY}`)).toBeLessThan(disk.log.indexOf(`removed:${FIRST_QUESTION_KEY}`))
  })

  it('a chat that was written with its question is left alone: no second question', async () => {
    const id = useChatStore.getState().createConversation('qwen', '')
    useChatStore.getState().addMessage(id, { id: 'm1', role: 'user', content: QUESTION, timestamp: 1 })
    useChatStore.getState().addMessage(id, { id: 'a1', role: 'assistant', content: '', timestamp: 2 })
    disk.data[FIRST_QUESTION_KEY] = JSON.stringify(record({ chatId: id }))
    expect(await restoreFirstQuestion()).toBeNull()
    expect(useChatStore.getState().conversations).toHaveLength(1)
    expect(useChatStore.getState().conversations[0].messages).toHaveLength(2)
    expect(disk.data[FIRST_QUESTION_KEY]).toBeUndefined()
  })

  // Short check on Android, package 8, N2: killed 0.3 s after the tap, one start of five showed the question and
  // nothing under it. The chat was written with the question, the place of the answer was not.
  it('a chat that was written with its question and nothing behind it gets the word that no answer came, once', async () => {
    const id = useChatStore.getState().createConversation('qwen', '')
    useChatStore.getState().addMessage(id, { id: 'm1', role: 'user', content: QUESTION, timestamp: 1 })
    disk.data[FIRST_QUESTION_KEY] = JSON.stringify(record({ chatId: id }))
    expect(await restoreFirstQuestion()).toBe(id)
    const messages = useChatStore.getState().conversations[0].messages
    expect(messages.map((m) => m.content)).toEqual([QUESTION, INTERRUPTED_EMPTY_TEXT])
    expect(messages[1].finishReason).toBe(INTERRUPTED_FINISH_REASON)
    expect(disk.data[FIRST_QUESTION_KEY]).toBeUndefined()
    expect(disk.data[CHATS_KEY]).toContain(INTERRUPTED_EMPTY_TEXT)
    // The next start has no record and adds nothing.
    expect(await restoreFirstQuestion()).toBeNull()
    expect(useChatStore.getState().conversations[0].messages).toHaveLength(2)
  })

  it('a chat that was written without its question gets the question', async () => {
    const id = useChatStore.getState().createConversation('qwen', '')
    disk.data[FIRST_QUESTION_KEY] = JSON.stringify(record({ chatId: id }))
    expect(await restoreFirstQuestion()).toBe(id)
    expect(useChatStore.getState().conversations).toHaveLength(1)
    expect(useChatStore.getState().conversations[0].messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('no record, a broken record and a record without text restore nothing', async () => {
    expect(await restoreFirstQuestion()).toBeNull()
    for (const raw of ['not json', '[]', '{"chatId":5}', JSON.stringify(record({ text: '  ', attachments: 2 }))]) {
      disk.data[FIRST_QUESTION_KEY] = raw
      expect(await restoreFirstQuestion()).toBeNull()
      expect(useChatStore.getState().conversations).toHaveLength(0)
    }
  })
})

describe('releaseFirstQuestion: the record goes when the chat store has written the question', () => {
  it('keeps the record until the question is in the chat and on the disk', async () => {
    const id = useChatStore.getState().createConversation('qwen', '')
    await flushChatPersist()
    disk.data[FIRST_QUESTION_KEY] = JSON.stringify(record({ chatId: id }))
    disk.log.length = 0
    releaseFirstQuestion(id)
    await settle()
    expect(disk.data[FIRST_QUESTION_KEY]).toBeDefined()
    useChatStore.getState().addMessage(id, { id: 'm1', role: 'user', content: QUESTION, timestamp: 1 })
    await settle()
    await flushChatPersist()
    await settle()
    // The question alone is not enough (N2): a chat that ends with it says nothing about the answer.
    expect(disk.data[FIRST_QUESTION_KEY]).toBeDefined()
    useChatStore.getState().addMessage(id, { id: 'a1', role: 'assistant', content: '', timestamp: 2 })
    await settle()
    await flushChatPersist()
    await settle()
    expect(disk.data[FIRST_QUESTION_KEY]).toBeUndefined()
    expect(disk.data[CHATS_KEY]).toContain(QUESTION)
    expect(disk.log.lastIndexOf(`landed:${CHATS_KEY}`)).toBeLessThan(disk.log.indexOf(`removed:${FIRST_QUESTION_KEY}`))
  })

  it('never removes the record of another chat', async () => {
    const id = useChatStore.getState().createConversation('qwen', '')
    useChatStore.getState().addMessage(id, { id: 'm1', role: 'user', content: 'Hello', timestamp: 1 })
    disk.data[FIRST_QUESTION_KEY] = JSON.stringify(record({ chatId: 'a-later-chat' }))
    releaseFirstQuestion(id)
    await settle()
    await flushChatPersist()
    await settle()
    expect(parseFirstQuestion(disk.data[FIRST_QUESTION_KEY])?.chatId).toBe('a-later-chat')
  })
})

describe('releaseFirstQuestion on a full phone', () => {
  it('a record that never reached the disk is let go with the question: it is not written later, and the record of another chat keeps waiting', async () => {
    const id = useChatStore.getState().createConversation('qwen', '')
    disk.mode = 'fails'
    let sent = false
    await handOverFirstQuestion(record({ chatId: id }), () => { sent = true })
    expect(sent).toBe(true)
    expect(parseFirstQuestion(disk.waiting[FIRST_QUESTION_KEY])?.chatId).toBe(id)
    useChatStore.getState().addMessage(id, { id: 'm1', role: 'user', content: 'Hello', timestamp: 1 })
    useChatStore.getState().addMessage(id, { id: 'a1', role: 'assistant', content: '', timestamp: 2 })
    releaseFirstQuestion(id)
    await settle()
    await flushChatPersist().catch(() => {})
    await settle()
    expect(disk.waiting[FIRST_QUESTION_KEY]).toBeUndefined()
    expect(disk.log).toContain(`dropped:${FIRST_QUESTION_KEY}`)

    disk.waiting[FIRST_QUESTION_KEY] = JSON.stringify(record({ chatId: 'a-later-chat' }))
    releaseFirstQuestion(id)
    await settle()
    await settle()
    expect(parseFirstQuestion(disk.waiting[FIRST_QUESTION_KEY])?.chatId).toBe('a-later-chat')
  })
})

// Round 21, the rest of F2: a question into a chat that is already there.
describe('a question into a chat that is already there', () => {
  const seed = (): string => {
    const id = useChatStore.getState().createConversation('qwen', '')
    useChatStore.getState().addMessage(id, { id: 'old-q', role: 'user', content: 'An older question', timestamp: 500 })
    useChatStore.getState().addMessage(id, { id: 'old-a', role: 'assistant', content: 'An older answer', timestamp: 600 })
    return id
  }

  it('killed after the record and before the chat was written: the question comes back into that chat, behind what was there', async () => {
    const id = seed()
    disk.data[FIRST_QUESTION_KEY] = JSON.stringify(record({ chatId: id, existing: true }))
    expect(await restoreFirstQuestion()).toBe(id)
    const messages = useChatStore.getState().conversations[0].messages
    expect(messages.map((m) => m.content)).toEqual(['An older question', 'An older answer', QUESTION, INTERRUPTED_EMPTY_TEXT])
    expect(messages[3].finishReason).toBe(INTERRUPTED_FINISH_REASON)
    expect(useChatStore.getState().conversations).toHaveLength(1)
    expect(disk.data[FIRST_QUESTION_KEY]).toBeUndefined()
  })

  it('the older question of the chat does not count as this one, a message from the moment of the tap on does', async () => {
    const id = seed()
    useChatStore.getState().addMessage(id, { id: 'new-q', role: 'user', content: QUESTION, timestamp: 1000 })
    useChatStore.getState().addMessage(id, { id: 'new-a', role: 'assistant', content: '', timestamp: 1001 })
    disk.data[FIRST_QUESTION_KEY] = JSON.stringify(record({ chatId: id, existing: true }))
    expect(await restoreFirstQuestion()).toBeNull()
    expect(useChatStore.getState().conversations[0].messages).toHaveLength(4)
    expect(disk.data[FIRST_QUESTION_KEY]).toBeUndefined()
  })

  it('written with the question and nothing behind it: the chat that was there gets the word too, and no second question (N2)', async () => {
    const id = seed()
    useChatStore.getState().addMessage(id, { id: 'new-q', role: 'user', content: QUESTION, timestamp: 1000 })
    disk.data[FIRST_QUESTION_KEY] = JSON.stringify(record({ chatId: id, existing: true }))
    expect(await restoreFirstQuestion()).toBe(id)
    expect(useChatStore.getState().conversations[0].messages.map((m) => m.content)).toEqual(['An older question', 'An older answer', QUESTION, INTERRUPTED_EMPTY_TEXT])
  })

  it('a chat that was deleted meanwhile does not come back', async () => {
    disk.data[FIRST_QUESTION_KEY] = JSON.stringify(record({ chatId: 'gone', existing: true }))
    expect(await restoreFirstQuestion()).toBeNull()
    expect(useChatStore.getState().conversations).toHaveLength(0)
    expect(disk.data[FIRST_QUESTION_KEY]).toBeUndefined()
  })

  it('the record stays until this question is written, and the record of the next question into the same chat is not removed', async () => {
    const id = seed()
    await flushChatPersist()
    disk.data[FIRST_QUESTION_KEY] = JSON.stringify(record({ chatId: id, existing: true }))
    releaseFirstQuestion(id, 1000)
    await settle()
    // The older question is in the chat: that is not enough.
    expect(disk.data[FIRST_QUESTION_KEY]).toBeDefined()
    useChatStore.getState().addMessage(id, { id: 'new-q', role: 'user', content: QUESTION, timestamp: 1001 })
    // Meanwhile the next question wrote its own record.
    disk.data[FIRST_QUESTION_KEY] = JSON.stringify(record({ chatId: id, existing: true, at: 2000, text: 'The next one' }))
    useChatStore.getState().addMessage(id, { id: 'new-a', role: 'assistant', content: '', timestamp: 1002 })
    await settle()
    await flushChatPersist()
    await settle()
    expect(parseFirstQuestion(disk.data[FIRST_QUESTION_KEY])?.text).toBe('The next one')
    releaseFirstQuestion(id, 2000)
    useChatStore.getState().addMessage(id, { id: 'next-q', role: 'user', content: 'The next one', timestamp: 2001 })
    useChatStore.getState().addMessage(id, { id: 'next-a', role: 'assistant', content: '', timestamp: 2002 })
    await settle()
    await flushChatPersist()
    await settle()
    expect(disk.data[FIRST_QUESTION_KEY]).toBeUndefined()
  })

  it('the wiring: in a chat that is there the field is emptied and the question sent only inside the hand over', () => {
    const page = readFileSync(resolve(__dirname, '../../screens/chat/ChatPage.tsx'), 'utf8')
    const from = page.indexOf('const sendNow = () => {')
    const to = page.indexOf('// Anything that breaks between the tap and the hand over')
    expect(from).toBeGreaterThan(0)
    expect(to).toBeGreaterThan(from)
    const branch = page.slice(from, to)
    // One place clears the draft and sends: sendNow. It runs at once only for a message without text.
    expect(branch.split('useDraftStore.getState().clear(draftKey)')).toHaveLength(2)
    expect(branch.split('sendNow()')).toHaveLength(3)
    expect(branch).toMatch(/if \(!text\.trim\(\)\) return sendNow\(\)/)
    expect(branch).toMatch(/void handOverFirstQuestion\(\s*\{ chatId, [^}]*existing: true \},\s*\(\) => \{[\s\S]*?sendNow\(\)\s*releaseFirstQuestion\(chatId, at\)/)
  })
})

describe('the wiring: the tap that creates a chat goes through the hand over', () => {
  const page = readFileSync(resolve(__dirname, '../../screens/chat/ChatPage.tsx'), 'utf8')
  const boot = readFileSync(resolve(__dirname, '../../boot/wiring.ts'), 'utf8')

  it('the draft is cleared and the page swapped only inside the hand over', () => {
    const swap = "nav.replace('/chat/:id', { id: newId })"
    expect(page.split(swap)).toHaveLength(2)
    const from = page.indexOf('void handOverFirstQuestion(')
    expect(from).toBeGreaterThan(0)
    const to = page.indexOf(swap)
    const between = page.slice(from, to)
    expect(to).toBeGreaterThan(from)
    // Nothing leaves the call before the swap, and the draft goes in the same step.
    expect(between).not.toMatch(/\n {12}\)\n/)
    expect(between).toContain('useDraftStore.getState().clear(draftKey)')
    // Before the hand over, in the branch of a new chat, nothing clears the draft.
    const branch = page.slice(page.indexOf('const newId = startChat('), from)
    expect(branch).not.toContain('.clear(')
    expect(branch).not.toContain('nav.replace')
  })

  it('the page that sends releases the record, and the start of the app restores one', () => {
    expect(page).toMatch(/takePendingSend\(chatId\)[\s\S]{0,400}releaseFirstQuestion\(chatId\)/)
    expect(boot).toMatch(/void restoreFirstQuestion\(\)/)
  })
})
