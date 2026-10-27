/**
 * A small model that repeats one passage until Stop (acceptance Android,
 * re-run, N4): recognised and ended, without stopping ordinary text.
 */
import { describe, expect, it } from 'vitest'
import { LoopStop, endsInLoop } from '../repetition-stop'

/** Feed a text the way a stream does, a few characters at a time. True when the guard tripped, with the place. */
function feed(text: string, chunk = 7): { stopped: boolean; at: number } {
  const guard = new LoopStop()
  for (let i = 0; i < text.length; i += chunk) {
    if (guard.push(text.slice(i, i + chunk))) return { stopped: true, at: i + chunk }
  }
  return { stopped: false, at: text.length }
}

const RESULTS = [
  '1. **Canberra - Wikipedia** Canberra is the capital city of Australia. Source: Wikipedia\n',
  '2. **Capital of Australia** The capital of Australia is Canberra, in the state of Victoria. Source: Britannica\n',
  '3. **Australia facts** Canberra was founded in 1913 as the capital. Source: Australia.com\n',
].join('')

describe('a loop inside one answer is stopped', () => {
  it('stops invented search results that repeat, long before six minutes of them', () => {
    const run = feed(`Here are the search results:\n\n${RESULTS.repeat(40)}`)
    expect(run.stopped).toBe(true)
    // Five rounds of the passage are enough, not forty.
    expect(run.at).toBeLessThan(RESULTS.length * 8)
  })

  it('stops a loop that differs only in line breaks and spaces', () => {
    const a = 'The capital of Australia is Canberra. Let me search for that. '
    const b = 'The capital of Australia is Canberra.\n\nLet me search   for that.\n'
    expect(feed((a + b).repeat(30)).stopped).toBe(true)
  })

  it('stops one sentence written again and again', () => {
    expect(feed('I will search the web for the answer now. '.repeat(60)).stopped).toBe(true)
  })

  it('stops a very short pattern only after much more of it', () => {
    expect(feed('ha '.repeat(300)).stopped).toBe(false)
    expect(feed('ha '.repeat(1200)).stopped).toBe(true)
    expect(feed(`A ruler:\n${'-'.repeat(400)}\nand text after it.`).stopped).toBe(false)
  })

  it('works whatever the size of the pieces the stream delivers', () => {
    const text = `Intro. ${RESULTS.repeat(30)}`
    for (const chunk of [1, 3, 64, 500, 5000]) expect(feed(text, chunk).stopped, `chunk ${chunk}`).toBe(true)
  })

  it('stays stopped once it tripped', () => {
    const guard = new LoopStop()
    expect(guard.push(RESULTS.repeat(40))).toBe(true)
    expect(guard.push('something new')).toBe(true)
  })
})

describe('ordinary text is left alone', () => {
  it('a long answer in prose', () => {
    const prose = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} says something about topic ${i * 7 % 13} and then moves on to the next thought. `).join('')
    expect(feed(prose).stopped).toBe(false)
  })

  it('a count and a table whose rows differ', () => {
    expect(feed(Array.from({ length: 1500 }, (_, i) => `${i + 1}, `).join('')).stopped).toBe(false)
    const table = `| n | square |\n|---|---|\n${Array.from({ length: 300 }, (_, i) => `| ${i} | ${i * i} |\n`).join('')}`
    expect(feed(table).stopped).toBe(false)
  })

  it('a list of real search results with different entries', () => {
    const list = Array.from({ length: 60 }, (_, i) => `${i + 1}. **Result ${i + 1}** A page about subject ${i * 31 % 17}. Source: site${i}.example\n`).join('')
    expect(feed(list).stopped).toBe(false)
  })

  it('a passage that is repeated a few times and then goes on', () => {
    const text = `${RESULTS.repeat(3)}That is all I found. ${'Now something else entirely follows here. '.repeat(3)}And the answer ends.`
    expect(feed(text).stopped).toBe(false)
  })

  it('code with similar lines', () => {
    const code = Array.from({ length: 200 }, (_, i) => `  case ${i}: return handler_${i}(input, ${i % 5});\n`).join('')
    expect(feed(code).stopped).toBe(false)
  })

  it('short text is never looked at', () => {
    expect(endsInLoop('abc'.repeat(100))).toBe(false)
    expect(new LoopStop().push('')).toBe(false)
    expect(new LoopStop().push('   \n\n  ')).toBe(false)
  })
})
