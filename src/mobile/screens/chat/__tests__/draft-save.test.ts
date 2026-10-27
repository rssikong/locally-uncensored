// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../../../stores/chatStore'
import { DRAFT_SAVE_MS, DRAFT_TEXT_KEY, DRAFT_TEXT_MAX, __resetDraftSavingForTests, draftsAlreadyAsked, draftsRestored, dropDraftsAlreadyAsked, flushDrafts, installDraftSaving, parseTextRecords, textRecords } from '../parts/draft-save'
import { EMPTY_DRAFT, useDraftStore } from '../parts/logic/drafts'

const saved = () => parseTextRecords(localStorage.getItem(DRAFT_TEXT_KEY))

describe('textRecords and parseTextRecords', () => {
  it('keep what is typed and leave out what is empty or too long for the storage', () => {
    const records = textRecords({
      a: { ...EMPTY_DRAFT, text: 'Half a thought' },
      b: { ...EMPTY_DRAFT },
      c: { ...EMPTY_DRAFT, text: 'changed', editing: 'm1', textBeforeEdit: 'before' },
      d: { ...EMPTY_DRAFT, text: 'x'.repeat(DRAFT_TEXT_MAX + 1) },
    })
    expect(records).toEqual({ a: { text: 'Half a thought', editing: null, textBeforeEdit: '' }, c: { text: 'changed', editing: 'm1', textBeforeEdit: 'before' } })
    expect(parseTextRecords(JSON.stringify(records))).toEqual(records)
  })
  it('read nothing from anything that is not a record of texts', () => {
    for (const raw of [null, '', 'not json', '[]', '"x"', '{"a":5}', '{"a":{"text":7}}']) expect(parseTextRecords(raw)).toEqual({})
    expect(parseTextRecords('{"a":{"text":"t","editing":3}}')).toEqual({ a: { text: 't', editing: null, textBeforeEdit: '' } })
  })
})

describe('installDraftSaving', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    __resetDraftSavingForTests()
    useDraftStore.setState({ drafts: {} })
    useChatStore.setState({ conversations: [] } as never)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('brings the text of the last run back before anything is drawn', () => {
    localStorage.setItem(DRAFT_TEXT_KEY, JSON.stringify({ c1: { text: 'Half a thought', editing: null, textBeforeEdit: '' }, new: { text: 'A first line', editing: null, textBeforeEdit: '' } }))
    installDraftSaving()
    expect(useDraftStore.getState().drafts.c1.text).toBe('Half a thought')
    expect(useDraftStore.getState().drafts.new.text).toBe('A first line')
    expect(useDraftStore.getState().drafts.c1.images).toEqual([])
  })

  it('writes a moment after the last key, and at once when asked to', async () => {
    installDraftSaving()
    await draftsRestored()
    useDraftStore.getState().setText('c1', 'He')
    useDraftStore.getState().setText('c1', 'Hello')
    expect(saved()).toEqual({})
    vi.advanceTimersByTime(DRAFT_SAVE_MS + 10)
    expect(saved().c1.text).toBe('Hello')
    useDraftStore.getState().setText('c1', 'Hello there')
    flushDrafts()
    expect(saved().c1.text).toBe('Hello there')
  })

  it('writes when the page is hidden, where a timer may never fire again', async () => {
    installDraftSaving()
    await draftsRestored()
    useDraftStore.getState().setText('c1', 'On the way out')
    window.dispatchEvent(new Event('pagehide'))
    expect(saved().c1.text).toBe('On the way out')
  })

  it('a sent or emptied draft leaves nothing behind', async () => {
    installDraftSaving()
    await draftsRestored()
    useDraftStore.getState().setText('c1', 'Hello')
    flushDrafts()
    useDraftStore.getState().clear('c1')
    flushDrafts()
    expect(localStorage.getItem(DRAFT_TEXT_KEY)).toBeNull()
  })

  it('a chat that is deleted takes its draft with it, whoever deleted it', async () => {
    useChatStore.setState({ conversations: [{ id: 'c1', title: 't', messages: [], createdAt: 1, updatedAt: 1 }] } as never)
    installDraftSaving()
    await draftsRestored()
    useDraftStore.getState().setText('c1', 'Hello')
    flushDrafts()
    useChatStore.setState({ conversations: [] } as never)
    expect(useDraftStore.getState().drafts.c1).toBeUndefined()
    flushDrafts()
    expect(saved()).toEqual({})
  })

  it('a storage that refuses does not break typing', async () => {
    installDraftSaving()
    await draftsRestored()
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    useDraftStore.getState().setText('c1', 'Still typing')
    expect(() => flushDrafts()).not.toThrow()
    expect(useDraftStore.getState().drafts.c1.text).toBe('Still typing')
    set.mockRestore()
  })
})

/**
 * Short check on the iPhone, package 8, F1: the app was ended 0.2 to 0.4 s
 * after the tap on Send. The chat held the question, and the same words still
 * stood in the field (new chat 15 of 15, a chat that was there 3 of 3): the
 * draft was only written 400 ms after its last change.
 */
describe('a sent question does not stay behind as a draft (iPhone, package 8, F1)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    __resetDraftSavingForTests()
    useDraftStore.setState({ drafts: {} })
    useChatStore.setState({ conversations: [] } as never)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const chat = (id: string, messages: Array<{ role: string; content: string; finishReason?: string; hidden?: boolean }>) => ({ id, title: id, model: 'm', systemPrompt: '', createdAt: 1, updatedAt: 1, messages: messages.map((m, i) => ({ id: `${id}-${i}`, timestamp: i, ...m })) })

  it('the storage has no draft the moment the field is emptied, without waiting for the timer', async () => {
    installDraftSaving()
    await draftsRestored()
    useDraftStore.getState().setText('new', 'write a long story about a lighthouse')
    useDraftStore.getState().setText('c1', 'and one more question')
    flushDrafts()
    expect(Object.keys(saved()).sort()).toEqual(['c1', 'new'])
    // Send: the draft is cleared. The app is ended right after, no timer runs any more.
    useDraftStore.getState().clear('new')
    expect(saved().new).toBeUndefined()
    useDraftStore.getState().clear('c1')
    expect(saved()).toEqual({})
  })

  it('also while the attachments of the last run are still being read', () => {
    localStorage.setItem(DRAFT_TEXT_KEY, JSON.stringify({ new: { text: 'asked right after the start', editing: null, textBeforeEdit: '' } }))
    installDraftSaving()
    useDraftStore.getState().clear('new')
    expect(saved()).toEqual({})
  })

  it('typing still waits for the timer', async () => {
    installDraftSaving()
    await draftsRestored()
    useDraftStore.getState().setText('c1', 'H')
    expect(saved()).toEqual({})
  })

  it('pure: which drafts repeat a question that got no answer', () => {
    const cut = chat('c1', [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'answer' }, { role: 'user', content: 'tell me more ' }, { role: 'assistant', content: 'LU was closed', finishReason: 'interrupted' }])
    const bare = chat('c2', [{ role: 'user', content: 'a new question' }])
    const done = chat('c3', [{ role: 'user', content: 'continue' }, { role: 'assistant', content: 'Here it goes on.' }])
    const d = (text: string, editing: string | null = null) => ({ ...EMPTY_DRAFT, text, editing })
    // The chat that was there: its own draft with the same words.
    expect(draftsAlreadyAsked({ c1: d('tell me more') }, [cut, bare, done])).toEqual(['c1'])
    // The new chat: the draft of "New chat" against every chat.
    expect(draftsAlreadyAsked({ new: d(' a new question') }, [cut, bare, done])).toEqual(['new'])
    // Other words, an older question, a finished answer, a message that is being changed: all stay.
    expect(draftsAlreadyAsked({ c1: d('tell me more, please'), c2: d('first'), c3: d('continue'), new: d('continue') }, [cut, bare, done])).toEqual([])
    expect(draftsAlreadyAsked({ c1: d('tell me more', 'c1-2') }, [cut])).toEqual([])
    expect(draftsAlreadyAsked({ c1: d('') }, [cut])).toEqual([])
    // The draft of one chat is never judged by another chat.
    expect(draftsAlreadyAsked({ c3: d('a new question') }, [cut, bare, done])).toEqual([])
  })

  it('at the start: the question is in the chat, so the same draft is gone, in memory and in the storage', () => {
    localStorage.setItem(
      DRAFT_TEXT_KEY,
      JSON.stringify({
        new: { text: 'write a long story about a lighthouse', editing: null, textBeforeEdit: '' },
        c1: { text: 'tell me more', editing: null, textBeforeEdit: '' },
        c3: { text: 'half a thought', editing: null, textBeforeEdit: '' },
      }),
    )
    useChatStore.setState({
      conversations: [
        chat('c9', [{ role: 'user', content: 'write a long story about a lighthouse' }, { role: 'assistant', content: 'LU was closed', finishReason: 'interrupted' }]),
        chat('c1', [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello.' }, { role: 'user', content: 'tell me more' }]),
        chat('c3', [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello.' }]),
      ],
    } as never)
    installDraftSaving()
    expect(dropDraftsAlreadyAsked()).toEqual([])
    expect(Object.keys(useDraftStore.getState().drafts)).toEqual(['c3'])
    expect(saved()).toEqual({ c3: { text: 'half a thought', editing: null, textBeforeEdit: '' } })
  })
})
