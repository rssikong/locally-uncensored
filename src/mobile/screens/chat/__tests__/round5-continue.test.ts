/**
 * Acceptance on Android, round 4, N6: "Continue" after LU was closed in the
 * middle of an answer wrote a message of the user nobody had written
 * ("Continue your answer exactly where it stopped...") and went on in a
 * second bubble. Expected: the same bubble goes on, nothing in between.
 *
 * Run: npx vitest run src/mobile/screens/chat/__tests__/round5-continue.test.ts
 */
import { describe, expect, it } from 'vitest'
import type { Message } from '../../../../types/chat'
import { CONTINUE_PROMPT, continuationGlue, foldContinuations, startsOver, visibleMessages, withoutRequestEcho, writtenPart } from '../parts/logic/messages'

const user = (id: string, content: string): Message => ({ id, role: 'user', content, timestamp: 1 }) as Message
const answer = (id: string, content: string, over: Partial<Message> = {}): Message => ({ id, role: 'assistant', content, timestamp: 2, ...over }) as Message
const request = (id: string) => user(id, CONTINUE_PROMPT)

describe('an answer and its continuation are one answer', () => {
  it('while the model still writes: one bubble under the id of the first, the request is not shown', () => {
    const raw = [user('q', 'Tell a long story'), answer('a1', 'Once upon a time there was', { finishReason: 'stop' }), request('c'), answer('a2', ' a tide that turned twice a day.')]
    const shown = visibleMessages(raw)
    expect(shown.map((m) => [m.role, m.id])).toEqual([['user', 'q'], ['assistant', 'a1']])
    expect(shown[1].content).toBe('Once upon a time there was a tide that turned twice a day.')
    // What is stored is untouched until the run is over.
    expect(raw).toHaveLength(4)
  })

  it('the request is hidden from the first moment, before the second answer is there', () => {
    const raw = [user('q', 'Tell a long story'), answer('a1', 'Once upon a time'), request('c')]
    expect(visibleMessages(raw).map((m) => m.id)).toEqual(['q', 'a1'])
    // Not folded away yet: the send path still needs it.
    expect(foldContinuations(raw)).toBe(raw)
  })

  it('the state of the bubble is the state of the part that is written now', () => {
    const raw = [answer('a1', 'Part one', { finishReason: 'stop', thinking: 'first thought' }), request('c'), answer('a2', ' and part two', { finishReason: 'interrupted', timestamp: 9, thinking: 'second thought' })]
    const [one] = foldContinuations(raw)
    expect(one).toMatchObject({ id: 'a1', finishReason: 'interrupted', timestamp: 9, content: 'Part one and part two', thinking: 'first thought\n\nsecond thought' })
  })

  it('an error of the second part points behind the whole text, and the tail an error left in the first part is not carried along', () => {
    const raw = [
      answer('a1', 'Part one\n\nError: boom', { error: { kind: 'network', detail: 'boom', at: 8 } }),
      request('c'),
      answer('a2', ' and two\n\nError: again', { error: { kind: 'engine', detail: 'again', at: 8 } }),
    ]
    const [one] = foldContinuations(raw)
    expect(one.content).toBe('Part one and two\n\nError: again')
    expect(one.error).toEqual({ kind: 'engine', detail: 'again', at: 16 })
    expect(one.content.slice(0, one.error!.at)).toBe('Part one and two')
  })

  it('a good second part clears the error of the first', () => {
    const [one] = foldContinuations([answer('a1', 'Part one', { error: { kind: 'network', detail: 'x', at: 8 } }), request('c'), answer('a2', ' and two')])
    expect(one.error).toBeUndefined()
  })

  it('continued twice: still one answer', () => {
    const raw = [user('q', 'Go'), answer('a1', 'One'), request('c1'), answer('a2', ' two'), request('c2'), answer('a3', ' three')]
    const folded = foldContinuations(raw)
    expect(folded.map((m) => m.id)).toEqual(['q', 'a1'])
    expect(folded[1].content).toBe('One two three')
  })

  it('stopped before the model went on: when the run is over the request goes, the answer stays as it was', () => {
    const raw = [user('q', 'Go'), answer('a1', 'One'), request('c')]
    expect(foldContinuations(raw, { final: true }).map((m) => m.id)).toEqual(['q', 'a1'])
  })

  it('nothing to fold: the very same list comes back, so nothing is stored or painted again', () => {
    const raw = [user('q', 'Hi'), answer('a', 'Hello')]
    expect(foldContinuations(raw)).toBe(raw)
    expect(foldContinuations(raw, { final: true })).toBe(raw)
  })

  it('the same sentence typed as a first message, or with a file, is a message of the user', () => {
    expect(visibleMessages([request('c'), answer('a', 'Of what?')]).map((m) => m.id)).toEqual(['c', 'a'])
    const withFile = { ...request('c'), files: [{ name: 'a.txt' }] } as unknown as Message
    expect(visibleMessages([answer('a1', 'One'), withFile, answer('a2', 'Two')]).map((m) => m.id)).toEqual(['a1', 'c', 'a2'])
  })

  it('hidden messages, tool results and plain system lines stay out as before', () => {
    const raw = [user('q', 'Hi'), { ...answer('h', 'x'), hidden: true } as Message, { id: 't', role: 'tool', content: 'r', timestamp: 1 } as Message, answer('a', 'Hello')]
    expect(visibleMessages(raw).map((m) => m.id)).toEqual(['q', 'a'])
  })
})

// Round 9, N8 of the check on Android: "Continue" with Qwen3 1.7B. The bubble
// read "... navigating theLighthouses have played ...": the model began the
// essay again, and the two parts met without a blank.
describe('where the two parts meet', () => {
  it('a part that goes on with a new word gets the blank the model did not write', () => {
    const [one] = foldContinuations([answer('a1', 'Sailors relied on them while navigating the'), request('c'), answer('a2', 'rocky coast at night.')])
    expect(one.content).toBe('Sailors relied on them while navigating the rocky coast at night.')
  })

  it('no second blank where one side brings its own, and none in front of a mark that closes the sentence', () => {
    expect(continuationGlue('there was', ' a tide')).toBe('')
    expect(continuationGlue('there was ', 'a tide')).toBe('')
    expect(continuationGlue('the coast', '. Then')).toBe('')
    expect(continuationGlue('the coast', ', and then')).toBe('')
    expect(continuationGlue('the so-called (', 'old) tower')).toBe('')
    expect(continuationGlue('', 'Start')).toBe('')
    expect(continuationGlue('End', '')).toBe('')
  })

  it('a heading, a list or a fence starts on its own line, and a script without blanks gets none', () => {
    expect(continuationGlue('as follows:', '- first')).toBe('\n\n')
    expect(continuationGlue('the code', '```ts')).toBe('\n\n')
    expect(continuationGlue('the end', '## Next part')).toBe('\n\n')
    expect(continuationGlue('灯台は', '海を照らす')).toBe('')
  })

  it('an error of the second part still points behind the whole text, the blank included', () => {
    const [one] = foldContinuations([answer('a1', 'Part one'), request('c'), answer('a2', 'and two\n\nError: again', { error: { kind: 'engine', detail: 'again', at: 7 } })])
    expect(one.content).toBe('Part one and two\n\nError: again')
    expect(one.content.slice(0, one.error!.at)).toBe('Part one and two')
  })
})

describe('a model that starts the answer over', () => {
  const head = 'Lighthouses have played a vital role in maritime history. For centuries sailors relied on them while navigating the'
  const rewrite = 'Lighthouses have played a vital role in maritime history, guiding ships past reefs and into harbours. They were built on headlands, islands and breakwaters, and each one showed its own pattern of light.'

  it('is told by its opening words, also when it writes a heading or other case this time', () => {
    expect(startsOver(head, rewrite)).toBe(true)
    expect(startsOver(head, '# Lighthouses have played a vital role')).toBe(true)
    expect(startsOver(head, 'rocky coast at night.')).toBe(false)
    expect(startsOver(head, '')).toBe(false)
    // Too little is written to say that anything repeats.
    expect(startsOver('Yes.', 'Yes, and')).toBe(false)
  })

  it('the text is there once: the new answer replaces the part, it is not put behind it', () => {
    const [one] = foldContinuations([user('q', 'Write about lighthouses'), answer('a1', head, { finishReason: 'stop' }), request('c'), answer('a2', rewrite)]).slice(1)
    expect(one.id).toBe('a1')
    expect(one.content).toBe(rewrite)
    expect(one.content.match(/Lighthouses have played/g)).toHaveLength(1)
  })

  it('while the new answer is still shorter, the part that is there stays: nothing shrinks, nothing is doubled', () => {
    for (const soFar of ['Light', 'Lighthouses have played a vital', rewrite.slice(0, head.length)]) {
      const [one] = foldContinuations([answer('a1', head), request('c'), answer('a2', soFar)])
      expect(one.content, soFar).toBe(head)
    }
    const [longer] = foldContinuations([answer('a1', head), request('c'), answer('a2', rewrite.slice(0, head.length + 1))])
    expect(longer.content).toBe(rewrite.slice(0, head.length + 1))
  })

  it('cut again before it got further than the first time: the longer part stays, with the error behind it', () => {
    const [one] = foldContinuations([answer('a1', head), request('c'), answer('a2', 'Lighthouses have played\n\nError: gone', { error: { kind: 'network', detail: 'gone', at: 23 } })])
    expect(one.content).toBe(`${head}\n\nError: gone`)
    expect(one.error).toEqual({ kind: 'network', detail: 'gone', at: head.length })
    expect(one.content.slice(0, one.error!.at)).toBe(head)
  })
})

// Round 10: with the engine of the phone the second answer is written inside the open turn of the first
// (lib/continue-answer.ts). It is marked, and the two join as they are: no blank is guessed, no new start is looked for.
describe('a continuation the engine wrote inside the cut answer', () => {
  const exact = (id: string, content: string, over: Partial<Message> = {}) => answer(id, content, { continuation: 'exact', ...over })

  it('joins in the middle of a word without a blank, where a guess would put one', () => {
    const cut = answer('a1', 'Along the coast the light')
    expect(foldContinuations([cut, request('c'), answer('a2', 'houses stand.')])[0].content).toBe('Along the coast the light houses stand.')
    expect(foldContinuations([cut, request('c'), exact('a2', 'houses stand.')])[0].content).toBe('Along the coast the lighthouses stand.')
  })

  it('keeps the blank and the line break the engine wrote', () => {
    expect(foldContinuations([answer('a1', 'navigating the'), request('c'), exact('a2', ' rocky coast.')])[0].content).toBe('navigating the rocky coast.')
    expect(foldContinuations([answer('a1', '1. One\n2. Two\n'), request('c'), exact('a2', '3. Three')])[0].content).toBe('1. One\n2. Two\n3. Three')
  })

  it('is never taken for a new start, also when it repeats the opening words', () => {
    const head = 'The tide comes in and the tide goes out, and then'
    const [one] = foldContinuations([answer('a1', head), request('c'), exact('a2', ' the tide comes in and the tide goes out, and then again.')])
    expect(one.content).toBe(`${head} the tide comes in and the tide goes out, and then again.`)
  })

  it('the mark does not stay on the answer the two have become, and an error points behind the whole text', () => {
    const [one] = foldContinuations([answer('a1', 'Part one'), request('c'), exact('a2', ' and two\n\nError: again', { error: { kind: 'engine', detail: 'again', at: 8 } })])
    expect(one.continuation).toBeUndefined()
    expect(one.content.slice(0, one.error!.at)).toBe('Part one and two')
  })

  it('an answer that was complete after all: nothing is added and the cut is gone', () => {
    const [one] = foldContinuations([answer('a1', 'All of it.', { finishReason: 'interrupted' }), request('c'), exact('a2', '', { finishReason: 'stop' })], { final: true })
    expect(one).toMatchObject({ id: 'a1', content: 'All of it.', finishReason: 'stop' })
  })

  it('what the engine is given is the written part, without the tail an error left', () => {
    expect(writtenPart(answer('a1', 'Part one\n\nError: boom', { error: { kind: 'network', detail: 'boom', at: 8 } }))).toBe('Part one')
    expect(writtenPart(answer('a1', 'Ends in a blank '))).toBe('Ends in a blank ')
  })
})

/**
 * iPhone re-check, N4: SmolLM2 360M wrote the request down. The folded answer
 * read "... WeContinue your answer exactly where it stopped. Do not repeat
 * what is already written. As the crew beg...". And N12: the two parts met
 * as "glass windowsThe single-pane glass windows".
 */
describe('the request to continue never stands in an answer', () => {
  const HEAD = 'The ship left the harbour at dawn. We'
  const [FIRST, SECOND] = CONTINUE_PROMPT.split(/(?<=\.)\s+/)
  const fold = (tail: string, over: Partial<Message> = {}) => foldContinuations([user('q', 'Tell a long story'), answer('a1', HEAD, { finishReason: 'stop' }), request('c'), answer('a2', tail, over)])[1]

  it('the case of the report: the model repeats the request and goes on', () => {
    const one = fold(`${CONTINUE_PROMPT} As the crew began to sing, the wind turned.`)
    expect(one.content).toBe(`${HEAD} As the crew began to sing, the wind turned.`)
    expect(one.content).not.toContain('Continue your answer')
    expect(one.content).not.toContain('Do not repeat')
  })

  it('wherever it stands: at the start, in the middle, at the end, on a line of its own, twice', () => {
    expect(fold(`sailed on. ${CONTINUE_PROMPT} The wind turned.`).content).toBe(`${HEAD} sailed on. The wind turned.`)
    expect(fold(`sailed on. ${CONTINUE_PROMPT}`).content.trimEnd()).toBe(`${HEAD} sailed on.`)
    expect(fold(`sailed on.\n\n${CONTINUE_PROMPT}\n\nThe wind turned.`).content).not.toContain('Continue your answer')
    expect(fold(`${CONTINUE_PROMPT} sailed on. ${CONTINUE_PROMPT} The wind turned.`).content).toBe(`${HEAD} sailed on. The wind turned.`)
  })

  it('one of the two sentences alone, other case, other blanks', () => {
    expect(fold(`${FIRST} sailed on.`).content).toBe(`${HEAD} sailed on.`)
    expect(fold(`${SECOND} sailed on.`).content).toBe(`${HEAD} sailed on.`)
    expect(fold(`${CONTINUE_PROMPT.toUpperCase()} sailed on.`).content).toBe(`${HEAD} sailed on.`)
    expect(fold(`${FIRST}\n${SECOND} sailed on.`).content).toBe(`${HEAD} sailed on.`)
  })

  it('while the model is still writing the sentence nothing of it shows', () => {
    for (let n = 12; n < CONTINUE_PROMPT.length; n += 1) {
      const now = fold(CONTINUE_PROMPT.slice(0, n)).content
      expect(now, `after ${n} characters`).not.toMatch(/Continue your answer|Do not repeat/i)
      expect(now.startsWith(HEAD)).toBe(true)
    }
  })

  it('an answer that only uses the words is left alone', () => {
    expect(withoutRequestEcho('Continue your journey along the coast.')).toBe('Continue your journey along the coast.')
    expect(withoutRequestEcho('Do not repeat the mistake.')).toBe('Do not repeat the mistake.')
    expect(withoutRequestEcho('')).toBe('')
  })

  it('an error of the second part still points behind the text that is shown', () => {
    const echoed = `${CONTINUE_PROMPT} sailed on.`
    const one = fold(`${echoed}\n\nError: boom`, { error: { kind: 'network', detail: 'boom', at: echoed.length } })
    expect(one.content.slice(0, one.error!.at)).toBe(`${HEAD} sailed on.`)
    expect(one.content.slice(one.error!.at)).toBe('\n\nError: boom')
  })

  it('a model that repeats the request and then starts the answer over shows the text once', () => {
    const again = `${CONTINUE_PROMPT} ${HEAD} sailed on for many days and nights.`
    expect(fold(again).content).toBe(`${HEAD} sailed on for many days and nights.`)
  })

  it('written inside the cut answer the model never read the request, and its text is not touched', () => {
    const text = ` said: "${CONTINUE_PROMPT}"`
    expect(fold(text, { continuation: 'exact' }).content).toBe(HEAD + text)
  })

  it('N12: a part that ends in a word and a part that opens with a new sentence do not run together', () => {
    const raw = [answer('a1', 'They looked out through the glass windows', { finishReason: 'stop' }), request('c'), answer('a2', 'The single-pane glass windows did not hold.')]
    expect(foldContinuations(raw)[0].content).toBe('They looked out through the glass windows The single-pane glass windows did not hold.')
    // Written inside the answer the engine brings its own blank and it is kept.
    const exact = [answer('a1', 'the single-pane glass windows', { finishReason: 'stop' }), request('c'), answer('a2', ' did not hold.', { continuation: 'exact' })]
    expect(foldContinuations(exact)[0].content).toBe('the single-pane glass windows did not hold.')
  })
})

/**
 * Second check on Android with 8 GB, F5: "Continue" went on, and at the seam
 * a half sentence or a word stood twice (2 of 2):
 *   "... with the earliest The concept of lighthouses dates back to ancient
 *    times, with the earliest known lighthouse ..."
 *   "This lighthouse was was designed"
 * The model takes a run-up: it writes the end of what is there once more and
 * goes on from it. Inside the open turn (round 10) it does so less and still
 * can, so both ways of going on take the repetition out (lib/continue-answer.ts).
 */
describe('a continuation that repeats the end of what is written', () => {
  const exact = (id: string, content: string, over: Partial<Message> = {}) => answer(id, content, { continuation: 'exact', ...over })
  const SENTENCE = 'The concept of lighthouses dates back to ancient times, with the earliest'
  const HEAD = `Lighthouses have guided ships for centuries. ${SENTENCE}`

  for (const [how, part] of [['as a new turn', answer], ['inside the cut answer', exact]] as const) {
    it(`the half sentence of the report is there once (${how})`, () => {
      const [one] = foldContinuations([answer('a1', HEAD), request('c'), part('a2', `${SENTENCE} known lighthouse being the Pharos of Alexandria.`)], { final: true })
      expect(one.content).toBe(`${HEAD} known lighthouse being the Pharos of Alexandria.`)
      expect(one.content.match(/with the earliest/g)).toHaveLength(1)
    })

    it(`the doubled word of the report is there once (${how})`, () => {
      const head = 'It stands on a rock. This lighthouse was'
      for (const next of ['was designed by a Scottish engineer.', ' was designed by a Scottish engineer.']) {
        const [one] = foldContinuations([answer('a1', head), request('c'), part('a2', next)], { final: true })
        expect(one.content, JSON.stringify(next)).toBe('It stands on a rock. This lighthouse was designed by a Scottish engineer.')
      }
    })

    it(`a written part that ends in a blank gets no second one (${how})`, () => {
      const [one] = foldContinuations([answer('a1', 'This lighthouse was '), request('c'), part('a2', 'lighthouse was designed.')], { final: true })
      expect(one.content).toBe('This lighthouse was designed.')
    })

    it(`a continuation that repeats nothing is joined as before (${how})`, () => {
      const [one] = foldContinuations([answer('a1', 'This lighthouse was'), request('c'), part('a2', ' designed by an engineer.')], { final: true })
      expect(one.content).toBe('This lighthouse was designed by an engineer.')
    })
  }

  it('an error of the second part still points behind the text that is shown', () => {
    const [one] = foldContinuations([answer('a1', 'This lighthouse was'), request('c'), exact('a2', ' was designed\n\nError: again', { error: { kind: 'engine', detail: 'again', at: 13 } })])
    expect(one.content.slice(0, one.error!.at)).toBe('This lighthouse was designed')
  })

  it('while the model is still writing the repetition, nothing of it shows and nothing is taken away again', () => {
    const cut = answer('a1', HEAD)
    const repeat = `${SENTENCE} known lighthouse`
    let longest = HEAD.length
    for (let n = 1; n <= repeat.length; n++) {
      const [one] = foldContinuations([cut, request('c'), exact('a2', repeat.slice(0, n))])
      // Never the repeated words behind the written ones, and the text on screen never gets shorter.
      expect(one.content.startsWith(HEAD), `after ${n} characters`).toBe(true)
      expect(one.content.match(/The concept of lighthouses/g), `after ${n} characters`).toHaveLength(1)
      expect(one.content.length, `after ${n} characters`).toBeGreaterThanOrEqual(longest)
      longest = one.content.length
    }
    expect(foldContinuations([cut, request('c'), exact('a2', repeat)])[0].content).toBe(`${HEAD} known lighthouse`)
  })

  it('a first word that only looks like a repetition shows as soon as the next one parts ways', () => {
    const cut = answer('a1', 'The tower was built in 1850. The lamp')
    expect(foldContinuations([cut, request('c'), exact('a2', ' The')])[0].content).toBe('The tower was built in 1850. The lamp')
    expect(foldContinuations([cut, request('c'), exact('a2', ' The keeper')])[0].content).toBe('The tower was built in 1850. The lamp The keeper')
    // When the run is over nothing is held back: a short ending that also stands earlier in the text is the ending.
    const roses = answer('a1', 'Roses are red. Violets are blue. Roses are')
    expect(foldContinuations([roses, request('c'), exact('a2', ' red.')], { final: true })[0].content).toBe('Roses are red. Violets are blue. Roses are red.')
  })

  it('what is not a repetition of whole words stays: inside a word, two letters, a row of a table, a list mark', () => {
    const kept = (head: string, next: string) => foldContinuations([answer('a1', head), request('c'), exact('a2', next)], { final: true })[0].content
    expect(kept('We ate a bana', 'na split.')).toBe('We ate a banana split.')
    expect(kept('The light', 'lighthouse')).toBe('The lightlighthouse')
    expect(kept('It is', ' is what it is.')).toBe('It is is what it is.')
    expect(kept('| ok | yes |', ' yes | no |')).toBe('| ok | yes | yes | no |')
    expect(kept('- One\n-', ' - Two')).toBe('- One\n- - Two')
    expect(kept('Count: 1, 2, 3', ', 3, 4')).toBe('Count: 1, 2, 3, 3, 4')
  })

  it('a model that starts the whole answer over is still handled as a new start, not as a run-up', () => {
    const head = 'Lighthouses guide ships along dangerous coasts and into'
    const [one] = foldContinuations([answer('a1', head), request('c'), answer('a2', 'Lighthouses guide ships along dangerous coasts and into safe harbours at night.')], { final: true })
    expect(one.content).toBe('Lighthouses guide ships along dangerous coasts and into safe harbours at night.')
  })
})

