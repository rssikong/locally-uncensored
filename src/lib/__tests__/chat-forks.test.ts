/**
 * Kept versions of a chat (GH #172, #174): the pure part.
 *
 * Run: npx vitest run src/lib/__tests__/chat-forks.test.ts
 */
import { describe, it, expect } from 'vitest'
import type { Conversation, Message } from '../../types/chat'
import { FORK_ROOT, copyConversation, forgetForkKey, forkFrom, forkMarks, restoreEmptyFork, switchFork } from '../chat-forks'
import { editableText, savedUserEdit } from '../message-edit'

const m = (id: string, role: Message['role'], content: string, extra: Partial<Message> = {}): Message =>
  ({ id, role, content, timestamp: 1, ...extra })

function chat(messages: Message[], extra: Partial<Conversation> = {}): Conversation {
  return { id: 'c', title: 'Story', messages, model: 'm', systemPrompt: '', mode: 'lu', createdAt: 1, updatedAt: 1, ...extra }
}

const base = () => chat([
  m('u1', 'user', 'Q1'), m('a1', 'assistant', 'A1'),
  m('u2', 'user', 'Q2'), m('a2', 'assistant', 'A2'),
  m('u3', 'user', 'Q3'), m('a3', 'assistant', 'A3'),
])
const ids = (c: Conversation) => c.messages.map((x) => x.id)

describe('forkFrom keeps what a resend used to delete', () => {
  it('moves the tail aside under the id of the message before it', () => {
    const c = forkFrom(base(), 'u2')
    expect(ids(c)).toEqual(['u1', 'a1'])
    expect(c.forks?.a1.versions).toHaveLength(2)
    expect(c.forks?.a1.versions[0]?.map((x) => x.id)).toEqual(['u2', 'a2', 'u3', 'a3'])
    expect(c.forks?.a1.versions[1]).toBeNull()
  })

  it('a change of the very first message is kept under FORK_ROOT', () => {
    const c = forkFrom(base(), 'u1')
    expect(c.messages).toEqual([])
    expect(c.forks?.[FORK_ROOT].versions[0]).toHaveLength(6)
  })

  it('a second resend at the same point adds a third version', () => {
    let c = forkFrom(base(), 'u2')
    c = { ...c, messages: [...c.messages, m('u2b', 'user', 'Q2 edited'), m('a2b', 'assistant', 'B')] }
    c = forkFrom(c, 'u2b')
    expect(c.forks?.a1.versions).toHaveLength(3)
    expect(c.forks?.a1.versions[1]?.map((x) => x.id)).toEqual(['u2b', 'a2b'])
    expect(c.forks?.a1.versions[2]).toBeNull()
  })

  it('an unknown id changes nothing', () => {
    const c = base()
    expect(forkFrom(c, 'nope')).toBe(c)
  })
})

describe('switchFork swaps versions without losing either', () => {
  const twoVersions = () => {
    const c = forkFrom(base(), 'u2')
    return { ...c, messages: [...c.messages, m('u2b', 'user', 'Q2 edited'), m('a2b', 'assistant', 'B')] }
  }

  it('goes back and forth, and every message is still somewhere', () => {
    const c = twoVersions()
    const back = switchFork(c, 'a1', 0)
    expect(ids(back)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3'])
    expect(back.forks?.a1.versions[1]?.map((x) => x.id)).toEqual(['u2b', 'a2b'])
    const forth = switchFork(back, 'a1', 1)
    expect(ids(forth)).toEqual(['u1', 'a1', 'u2b', 'a2b'])
  })

  it('nested versions inside a version come back with it', () => {
    let c = twoVersions()
    // A regenerate inside the second version.
    c = forkFrom(c, 'u2b')
    c = { ...c, messages: [...c.messages, m('u2c', 'user', 'Q2 edited'), m('a2c', 'assistant', 'C')] }
    expect(Object.keys(c.forks ?? {}).sort()).toEqual(['a1'])
    // u2b's fork key is a1 as well, so it is the same point: three versions.
    expect(c.forks?.a1.versions).toHaveLength(3)
    // A fork further down, inside the shown version.
    c = forkFrom({ ...c, messages: [...c.messages, m('u4', 'user', 'Q4'), m('a4', 'assistant', 'A4')] }, 'u4')
    c = { ...c, messages: [...c.messages, m('u4b', 'user', 'Q4'), m('a4b', 'assistant', 'A4b')] }
    const away = switchFork(c, 'a1', 0)
    expect(forkMarks(away).has('a4b')).toBe(false)
    const home = switchFork(away, 'a1', 2)
    expect(ids(home)).toEqual(['u1', 'a1', 'u2c', 'a2c', 'u4b', 'a4b'])
    expect(forkMarks(home).get('a4b')).toEqual({ key: 'a2c', index: 1, total: 2 })
  })

  it('out of range or the shown one changes nothing', () => {
    const c = twoVersions()
    expect(switchFork(c, 'a1', 1)).toBe(c)
    expect(switchFork(c, 'a1', 5)).toBe(c)
    expect(switchFork(c, 'zz', 0)).toBe(c)
  })
})

describe('restoreEmptyFork undoes a resend that wrote nothing', () => {
  it('brings the old continuation back and drops the empty slot', () => {
    const c = forkFrom(base(), 'u2')
    const back = restoreEmptyFork(c, 'a1')
    expect(ids(back)).toEqual(ids(base()))
    expect(back.forks).toBeUndefined()
  })

  it('leaves a resend that did write alone', () => {
    const c = forkFrom(base(), 'u2')
    const sent = { ...c, messages: [...c.messages, m('u2b', 'user', 'Q2')] }
    expect(restoreEmptyFork(sent, 'a1')).toBe(sent)
  })
})

describe('forkMarks puts "< 1/2 >" where people look for it', () => {
  it('an edit: on the question', () => {
    const c = forkFrom(base(), 'u2')
    const shown = { ...c, messages: [...c.messages, m('u2b', 'user', 'other question'), m('a2b', 'assistant', 'B')] }
    expect(forkMarks(shown).get('u2b')).toEqual({ key: 'a1', index: 1, total: 2 })
    expect(forkMarks(shown).has('a2b')).toBe(false)
  })

  it('a regenerate: on the answer', () => {
    const c = forkFrom(base(), 'u2')
    const shown = { ...c, messages: [...c.messages, m('u2b', 'user', 'Q2'), m('a2b', 'assistant', 'B')] }
    expect(forkMarks(shown).get('a2b')).toEqual({ key: 'a1', index: 1, total: 2 })
    expect(forkMarks(shown).has('u2b')).toBe(false)
  })

  it('skips hidden tool messages of an agent turn', () => {
    const c = forkFrom(base(), 'u2')
    const shown = { ...c, messages: [...c.messages, m('u2b', 'user', 'Q2'), m('t', 'tool', 'x', { hidden: true }), m('a2b', 'assistant', 'B')] }
    expect(forkMarks(shown).get('a2b')?.total).toBe(2)
  })

  it('a chat from before versions existed has no marks', () => {
    expect(forkMarks(base()).size).toBe(0)
  })
})

describe('forgetForkKey: deleting the message a fork hangs on', () => {
  it('moves the fork to the message before', () => {
    const c = forkFrom(base(), 'u2')
    const moved = forgetForkKey(c, 'a1')
    expect(moved.forks?.a1).toBeUndefined()
    expect(moved.forks?.u1?.versions).toHaveLength(2)
  })

  it('joins a fork that is already there, keeping every version', () => {
    let c = forkFrom(base(), 'a1') // regenerate-like fork at u1
    c = { ...c, messages: [...c.messages, m('a1b', 'assistant', 'A1b')] }
    c = forkFrom({ ...c, messages: [...c.messages, m('u2x', 'user', 'Q2x'), m('a2x', 'assistant', 'A2x')] }, 'u2x')
    c = { ...c, messages: [...c.messages, m('u2y', 'user', 'Q2y')] }
    const joined = forgetForkKey(c, 'a1b')
    expect(joined.forks?.a1b).toBeUndefined()
    expect(joined.forks?.u1.versions).toHaveLength(3)
    expect(joined.forks?.u1.versions.filter((v) => v === null)).toHaveLength(1)
  })
})

describe('copyConversation (GH #174)', () => {
  it('a duplicate is a deep, independent copy with every setting', () => {
    const msgs = base().messages
    msgs[1] = { ...msgs[1], modelId: 'b', groupPersonaId: 'p1', groupSpeakerName: 'Captain' }
    msgs[0] = { ...msgs[0], files: [{ name: 'a.txt', size: 9, kind: 'Text', sha256: 'x', summary: 's', textChars: 9000, includedChars: 4000 }] }
    const src = forkFrom(chat(msgs, {
      personaId: 'pirate',
      personaEnabled: true, systemPrompt: 'be a pirate', groupModels: ['a', 'b'], groupPersonas: { a: 'p1' },
      sampling: { temperature: 0.3 }, memoryScope: 'novel',
    }), 'u3')
    const copy = copyConversation(src, 'new', { title: 'Story (copy)', now: 5 })!
    expect(copy.id).toBe('new')
    expect(copy.title).toBe('Story (copy)')
    expect(copy.createdAt).toBe(5)
    expect(copy.personaEnabled).toBe(true)
    expect(copy.systemPrompt).toBe('be a pirate')
    expect(copy.groupModels).toEqual(['a', 'b'])
    expect(copy.groupPersonas).toEqual({ a: 'p1' })
    expect(copy.sampling).toEqual({ temperature: 0.3 })
    expect(copy.memoryScope).toBe('novel')
    expect(copy.forks?.a2.versions).toHaveLength(2)
    expect(copy.personaId).toBe('pirate')
    expect(copy.messages[0].files?.[0]).toMatchObject({ textChars: 9000, includedChars: 4000 })
    // Group speaker fields of the messages come along (#165/#169).
    expect(copy.messages[1]).toMatchObject({ modelId: 'b', groupPersonaId: 'p1', groupSpeakerName: 'Captain' })
    // Independent: changing the copy leaves the source alone.
    copy.messages[0].content = 'changed'
    copy.groupModels!.push('c')
    expect(src.messages[0].content).toBe('Q1')
    expect(src.groupModels).toEqual(['a', 'b'])
  })

  it('a branch ends with the message, carries no versions and only its own compactions', () => {
    const src = forkFrom(chat(base().messages, {
      compactions: [
        { id: 'k1', summary: 's', upToMessageId: 'a1', replaced: 2, atMessageCount: 2, tokensBefore: 1, tokensAfter: 1, trigger: 'manual', at: 1 },
        { id: 'k2', summary: 's', upToMessageId: 'a3', replaced: 2, atMessageCount: 6, tokensBefore: 1, tokensAfter: 1, trigger: 'manual', at: 2 },
      ],
    }), 'u3')
    const branch = copyConversation(src, 'b', { endAt: 'u2', title: 'Story (branch)', now: 5 })!
    expect(ids(branch)).toEqual(['u1', 'a1', 'u2'])
    expect(copyConversation(chat([m('u1', 'user', 'Q'), m('a1', 'assistant', 'A', { groupPersonaId: 'p', groupSpeakerName: 'Mate' })]), 'z', { endAt: 'a1', title: 't', now: 1 })!.messages[1])
      .toMatchObject({ groupPersonaId: 'p', groupSpeakerName: 'Mate' })
    expect(branch.forks).toBeUndefined()
    expect(branch.compactions?.map((r) => r.id)).toEqual(['k1'])
    expect(copyConversation(src, 'x', { endAt: 'nope', title: 't', now: 1 })).toBeNull()
  })
})

describe('Save on an edited user message (GH #172)', () => {
  it('plain text: the content is the new text', () => {
    expect(savedUserEdit({ content: 'old' }, 'new')).toEqual({ content: 'new', displayContent: undefined })
  })

  it('with files: the typed start is swapped, the file blocks stay', () => {
    const msg = { content: 'look at this\n\n[Attached file: a.bin]\nType: x', displayContent: 'look at this' }
    expect(editableText(msg)).toBe('look at this')
    expect(savedUserEdit(msg, 'look closer')).toEqual({
      content: 'look closer\n\n[Attached file: a.bin]\nType: x', displayContent: 'look closer',
    })
  })

  it('a slash command label: the model reads exactly what is shown now', () => {
    const msg = { content: 'Review the staged diff and ...', displayContent: '/review' }
    expect(savedUserEdit(msg, 'please check the diff')).toEqual({ content: 'please check the diff', displayContent: undefined })
  })
})
