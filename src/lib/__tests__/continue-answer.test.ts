/**
 * @vitest-environment jsdom
 *
 * Round 10: "Continue" really goes on, where the engine can do it.
 *
 * Who can: the engine of this phone, in a plain chat. Nobody else is asked
 * to (LU Cloud, a provider with an own key, an agent run, a group chat), and
 * on the desktop nothing of it exists.
 *
 * Run: npx vitest run src/lib/__tests__/continue-answer.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { continuesInPlace, markContinuation, wireForContinue, withLead, withoutSeamOverlap } from '../continue-answer'
import { NATIVE_HOST_KEY } from '../device-kind'
import { useChatStore } from '../../stores/chatStore'
import { useProviderStore } from '../../stores/providerStore'

const host = (kind: string | null) => {
  const w = window as unknown as Record<string, unknown>
  if (kind) w[NATIVE_HOST_KEY] = kind
  else delete w[NATIVE_HOST_KEY]
}
const slot = (over: { enabled?: boolean; managed?: boolean }) =>
  useProviderStore.setState((s) => ({ providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true, managed: true, ...over } } }))

const DEVICE = 'openai::qwen3-1.7b-q4_k_m'
const plain = { agentOn: false, group: false }

beforeEach(() => {
  host('android')
  slot({})
})
afterEach(() => host(null))

describe('who can go on inside a cut answer', () => {
  it('the engine of the phone, in a plain chat, on Android and on iOS', () => {
    expect(continuesInPlace({ model: DEVICE, ...plain })).toBe(true)
    host('ios')
    expect(continuesInPlace({ model: DEVICE, ...plain })).toBe(true)
  })

  it('not LU Cloud, not a provider with an own key', () => {
    for (const model of ['lu-cloud::zai-org/GLM-5.3', 'anthropic::claude-sonnet', 'openai-groq::llama-3.3-70b', 'ollama::llama3.1:8b', 'llama3.1:8b']) {
      expect(continuesInPlace({ model, ...plain }), model).toBe(false)
    }
  })

  it('not while the slot of the engine is someone else\'s endpoint or switched off', () => {
    slot({ managed: false })
    expect(continuesInPlace({ model: DEVICE, ...plain })).toBe(false)
    slot({ enabled: false })
    expect(continuesInPlace({ model: DEVICE, ...plain })).toBe(false)
  })

  it('not an agent run, not a group chat, not without a model', () => {
    expect(continuesInPlace({ model: DEVICE, agentOn: true, group: false })).toBe(false)
    expect(continuesInPlace({ model: DEVICE, agentOn: false, group: true })).toBe(false)
    expect(continuesInPlace({ model: null, ...plain })).toBe(false)
    expect(continuesInPlace({ model: '', ...plain })).toBe(false)
  })

  it('never on the desktop, with the very same engine slot', () => {
    for (const kind of ['macos', 'windows', 'linux']) {
      host(kind)
      expect(continuesInPlace({ model: DEVICE, ...plain }), kind).toBe(false)
    }
  })
})

describe('the request the engine gets', () => {
  const built = [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Write about lighthouses.' },
    { role: 'assistant', content: 'Lighthouses guide ships navigating the' },
    { role: 'user', content: 'Continue your answer exactly where it stopped. Do not repeat what is already written.' },
  ]

  it('ends with the cut answer, the request to continue is not in it', () => {
    const wire = wireForContinue(built, 'Lighthouses guide ships navigating the')
    expect(wire).toEqual(built.slice(0, 3))
    expect(built).toHaveLength(4)
  })

  it('the answer is put back whole when the budget of the send path shortened it', () => {
    const cut = built.map((m) => (m.role === 'assistant' ? { ...m, content: 'Lighthouses guide [...]' } : m))
    const wire = wireForContinue(cut, 'Lighthouses guide ships navigating the')!
    expect(wire.at(-1)).toEqual({ role: 'assistant', content: 'Lighthouses guide ships navigating the' })
  })

  it('other fields of the messages ride along', () => {
    const wire = wireForContinue([{ role: 'user', content: 'Look', images: [1] }, { role: 'assistant', content: 'A', tag: 'x' }, { role: 'user', content: 'go on' }], 'A cat')!
    expect(wire).toEqual([{ role: 'user', content: 'Look', images: [1] }, { role: 'assistant', content: 'A cat', tag: 'x' }])
  })

  it('anything else at the end is sent the old way', () => {
    expect(wireForContinue(built.slice(0, 3), 'x')).toBeNull()
    expect(wireForContinue([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }], 'x')).toBeNull()
    expect(wireForContinue([{ role: 'user', content: 'b' }], 'x')).toBeNull()
    expect(wireForContinue(built, '  \n')).toBeNull()
  })
})

describe('the blank a continuation opens with', () => {
  it('is put back where the send path trimmed it away', () => {
    expect(withLead(' rocky coast. ', 'rocky coast.')).toBe(' rocky coast.')
    expect(withLead('\n\n## Next', '## Next')).toBe('\n\n## Next')
  })

  it('nothing is added where the engine wrote none, or where it is still there', () => {
    expect(withLead('houses stand', 'houses stand')).toBe('houses stand')
    expect(withLead(' rocky', ' rocky')).toBe(' rocky')
  })

  it('an answer of nothing stays nothing', () => {
    expect(withLead('  \n', '')).toBe('')
  })
})

describe('the mark on the answer that is being written', () => {
  it('is set on that answer and on no other', () => {
    useChatStore.setState({
      conversations: [
        {
          id: 'c1',
          title: 't',
          model: DEVICE,
          systemPrompt: '',
          createdAt: 1,
          updatedAt: 1,
          messages: [
            { id: 'a1', role: 'assistant', content: 'Part', timestamp: 1 },
            { id: 'a2', role: 'assistant', content: '', timestamp: 2 },
          ],
        },
      ],
      activeConversationId: 'c1',
    } as never)
    markContinuation('c1', 'a2')
    const messages = useChatStore.getState().conversations[0].messages
    expect(messages[0].continuation).toBeUndefined()
    expect(messages[1].continuation).toBe('exact')
  })
})

// Second check on Android, F5: a half sentence or a word stood twice at the seam.
describe('the part that goes on, without what it repeats of the written part', () => {
  it('the longest repeated end goes: a half sentence, a word', () => {
    expect(withoutSeamOverlap('It began long ago, with the earliest', 'It began long ago, with the earliest known tower.')).toBe(' known tower.')
    expect(withoutSeamOverlap('This lighthouse was', 'was designed')).toBe(' designed')
    expect(withoutSeamOverlap('This lighthouse was', ' was designed')).toBe(' designed')
    // The longest one, not the first that fits.
    expect(withoutSeamOverlap('the tower and the tower', 'the tower and the tower stood.')).toBe(' stood.')
  })

  it('blanks at the seam do not count, on either side', () => {
    expect(withoutSeamOverlap('This lighthouse was \n', '\n was designed')).toBe(' designed')
  })

  it('nothing repeated: the very same text comes back, blank and all', () => {
    for (const [written, next] of [['navigating the', ' rocky coast'], ['Along the light', 'houses'], ['', 'anything'], ['something', ''], ['One.', '\n\nTwo.']]) {
      expect(withoutSeamOverlap(written, next)).toBe(next)
    }
  })

  it('only whole words count, one of three letters or more, or several', () => {
    expect(withoutSeamOverlap('We ate a bana', 'na split')).toBe('na split')
    expect(withoutSeamOverlap('The light', 'lighthouse')).toBe('lighthouse')
    expect(withoutSeamOverlap('a rehouse', 'house of cards')).toBe('house of cards')
    expect(withoutSeamOverlap('It is', 'is so')).toBe('is so')
    expect(withoutSeamOverlap('1, 2, 3', '3, 4')).toBe('3, 4')
    expect(withoutSeamOverlap('| yes |', 'yes | no |')).toBe('yes | no |')
    expect(withoutSeamOverlap('It is so', 'is so good')).toBe(' good')
  })

  it('other scripts are words too', () => {
    expect(withoutSeamOverlap('Der Turm wurde von einem Ingenieur für', 'für die Küste gebaut')).toBe(' die Küste gebaut')
    expect(withoutSeamOverlap('Маяк был построен', 'построен в 1850 году')).toBe(' в 1850 году')
  })

  it('looks at the end of the written part only, however long the answer is', () => {
    const long = `${'word '.repeat(2000)}and then the keeper climbed the`
    expect(withoutSeamOverlap(long, 'the keeper climbed the stairs')).toBe(' stairs')
  })

  it('while the next part is still being written, a part that so far only repeats is held back', () => {
    const written = 'It began long ago, with the earliest'
    expect(withoutSeamOverlap(written, 'It began', { stillWriting: true })).toBe('')
    expect(withoutSeamOverlap(written, 'It began long ago, with the ear', { stillWriting: true })).toBe('')
    expect(withoutSeamOverlap(written, 'It began long ago, with the earliest', { stillWriting: true })).toBe('')
    expect(withoutSeamOverlap(written, 'It began long ago, with the earliest known', { stillWriting: true })).toBe(' known')
    // It parts ways: everything shows.
    expect(withoutSeamOverlap(written, 'It began in Egypt', { stillWriting: true })).toBe('It began in Egypt')
    // Not held back once the part is finished.
    expect(withoutSeamOverlap(written, 'It began')).toBe('It began')
    // Inside a word of the written part is no start of a repetition.
    expect(withoutSeamOverlap('the earliest', 'liest', { stillWriting: true })).toBe('liest')
  })
})

