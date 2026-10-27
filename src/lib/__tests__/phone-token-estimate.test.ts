/**
 * Round 9, A-02 of the check on Android with 8 GB: the agent read a page with
 * the model the app recommends, the answer came, and the log said in three
 * runs of three
 *
 *   engine: dropped old messages to fit the context dropped=4 n_ctx=4096
 *
 * The phone cuts a request before it sends it (lib/phone-context-fit.ts) so
 * that the engine never has to. It counted 3.3 characters per token. The
 * tokenizer of the Qwen family writes every digit as its own token, and the
 * blank in front of a number as another: a page of population figures has
 * 1.3 characters per token. The request looked half as long as it was.
 *
 * The numbers in fixtures/phone-token-samples.json are MEASURED, with
 * llama-tokenize on the vocabulary of Qwen 2.5 (the one Qwen3 uses), Llama
 * 3.2 and SmolLM2. Nothing in here is an estimate checked against itself.
 *
 * Run: npx vitest run src/lib/__tests__/phone-token-estimate.test.ts
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('../capabilities', async (orig) => ({ ...(await orig() as object), singleModelSlot: () => true }))

import { fitToWindow, measuredRequest, phonePromptLimit, phoneResultChars, phoneTokens } from '../phone-context-fit'
import { truncateToolResult } from '../truncate-tool-result'
import { buildHermesToolResult } from '../../api/hermes-tool-calling'

interface Sample { text: string; qwen: number; llama: number; smol: number }
interface Line { text: string; qwen: number }
interface Fixture {
  samples: Record<string, Sample>
  run: {
    question: Line
    callSearch: Line
    callFetch: Line
    wrapSearch: { qwen: number }
    wrapFetch: { qwen: number }
    markerRaw: { qwen: number }
    markerJson: { qwen: number }
    framePerMessage: { qwen: number }
    search: Line[]
    page: Line[]
  }
}
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/phone-token-samples.json'), 'utf8')) as Fixture
const { samples, run } = fixture

/** The count of round 6: 3.3 characters per token, a character outside ASCII one token. */
function countOfRound6(text: string): number {
  let wide = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) wide++
  return Math.ceil((text.length - wide) / 3.3 + wide)
}

describe('the estimate against measured token counts', () => {
  it('is never below the count of the Qwen and Llama tokenizers, for every kind of text an agent meets', () => {
    for (const [name, s] of Object.entries(samples)) {
      const real = Math.max(s.qwen, s.llama)
      expect(phoneTokens(s.text), name).toBeGreaterThanOrEqual(real)
    }
  })

  it('is not so careful that the window is wasted: at most 1.7 times the real count', () => {
    for (const [name, s] of Object.entries(samples)) {
      expect(phoneTokens(s.text) / Math.max(s.qwen, s.llama), name).toBeLessThanOrEqual(1.7)
    }
  })

  it('SmolLM2 cuts German finer than counted, and stays within an eighth of it (the model has no tools)', () => {
    for (const [name, s] of Object.entries(samples)) {
      expect(phoneTokens(s.text) / s.smol, name).toBeGreaterThanOrEqual(0.875)
    }
  })

  it('the cause of A-02: the count of round 6 saw 40 percent of a population page and a third of a table', () => {
    expect(countOfRound6(samples.mixed.text) / samples.mixed.qwen).toBeLessThan(0.45)
    expect(countOfRound6(samples.hex.text) / samples.hex.qwen).toBeLessThan(0.4)
    expect(countOfRound6(samples.search.text) / samples.search.qwen).toBeLessThan(0.9)
    // Prose was the one kind it was careful about.
    expect(countOfRound6(samples.prose.text) / samples.prose.qwen).toBeGreaterThan(1)
  })

  it('a digit is a token, a word of six letters is one, and nothing costs less than nothing', () => {
    expect(phoneTokens('402329')).toBe(6)
    expect(phoneTokens('402,329')).toBe(7)
    expect(phoneTokens('people')).toBe(1)
    expect(phoneTokens(' people')).toBe(1)
    expect(phoneTokens('')).toBe(0)
    expect(phoneTokens('日本語のページ')).toBe(7)
  })
})

// ── The run of A-02, rebuilt ────────────────────────────────────────────────

interface Msg { role: string; content: string }

const joined = (lines: Line[]) => lines.map((l) => l.text).join('')
/** The text of the fixture as the tool returned it: real line breaks. */
const raw = (lines: Line[]) => joined(lines).replace(/\\n/g, '\n')

/**
 * The run as the loop holds it when the page has just been read: the tool
 * list in the system prompt (the real one, seven tools), the question, a
 * search, the page. The page enters the run cut to `phoneResultChars`, as in
 * hooks/useAgentChat.ts.
 */
function runOfA02(): Msg[] {
  const entry = phoneResultChars(4096, 60000)
  return [
    { role: 'system', content: samples.sys.text },
    { role: 'user', content: run.question.text },
    { role: 'assistant', content: run.callSearch.text },
    { role: 'user', content: buildHermesToolResult('web_search', truncateToolResult(raw(run.search), entry)) },
    { role: 'assistant', content: run.callFetch.text },
    { role: 'user', content: buildHermesToolResult('web_fetch', truncateToolResult(raw(run.page), entry)) },
  ]
}

/**
 * Measured tokens of a tool result that was cut, as an upper bound: every
 * line of the original of which a part is still there counts whole. The
 * lines were measured one by one (their sum is the count of the whole page
 * to within five tokens).
 */
function measuredResult(content: string, lines: Line[], wrap: number): number {
  const whole = joined(lines)
  const inner = content.replace(/^<tool_response>\n\{"name":"[a-z_]+","content":"/, '').replace(/"\}\n<\/tool_response>$/, '')
  // A cut made where the result entered stands inside the JSON, a cut made
  // by the fit outside it, and the second may fall into the mark of the first.
  const trim = (t: string) => t.replace(/^(?:\\n|\n)+/, '').replace(/(?:\\n|\n)+$/, '')
  const partOfMark = (t: string) => t.length < 30 && /^\[?t?r?u?n?c?a?t?e?d? ?\d* ?c?h?a?r?s?\]?$/.test(t)
  const parts = inner.split('…')
  const pieces = parts.map(trim).filter((t) => t && !partOfMark(t))
  let tokens = wrap + (parts.length - 1) * Math.max(run.markerRaw.qwen, run.markerJson.qwen)
  for (const piece of pieces) {
    if (!piece) continue
    const at = whole.indexOf(piece)
    expect(at, `a piece of the result is not from the page: ${piece.slice(0, 40)}`).toBeGreaterThanOrEqual(0)
    let start = 0
    for (const line of lines) {
      const end = start + line.text.length
      if (start < at + piece.length && end > at) tokens += line.qwen
      start = end
    }
  }
  return tokens
}

/** Measured tokens of the whole request as the engine counts it: every message in its frame, the turn that opens the answer, the start token. */
function measuredTokens(messages: Msg[]): number[] {
  const [system, question, callSearch, search, callFetch, page] = messages
  expect(system.content).toBe(samples.sys.text)
  expect(question.content).toBe(run.question.text)
  expect(callSearch.content).toBe(run.callSearch.text)
  expect(callFetch.content).toBe(run.callFetch.text)
  return [
    samples.sys.qwen,
    run.question.qwen,
    run.callSearch.qwen,
    measuredResult(search.content, run.search, run.wrapSearch.qwen),
    run.callFetch.qwen,
    measuredResult(page.content, run.page, run.wrapFetch.qwen),
  ].map((t) => t + run.framePerMessage.qwen)
}
/** The turn that opens the answer, the thinking mark, the start token. */
const OPENING = 8
/** engine_inproc.rs, run_chat: it drops while `n + reserve >= n_ctx`. */
const engineKeeps = (tokens: number) => tokens + 512 < 4096

describe('A-02: the request of the agent after "Read a page", in the size of the report', () => {
  it('as round 6 counted and cut it, the request was still too long, and the engine dropped four messages', () => {
    // The fit of round 6, replayed with its count: the result of the earlier
    // step down to 600 characters, then the page down to the room that is left.
    const request = runOfA02()
    const limit6 = 4096 - 512 - 64
    const count6 = (list: Msg[]) => list.reduce((sum, m) => sum + countOfRound6(m.content) + 6, 0)
    request[3] = { ...request[3], content: truncateToolResult(request[3].content, 600) }
    const page = request[5].content
    const room = limit6 - (count6(request) - countOfRound6(page))
    request[5] = { ...request[5], content: truncateToolResult(page, Math.floor((page.length * (room - 12)) / countOfRound6(page))) }
    expect(count6(request)).toBeLessThanOrEqual(limit6)

    // What the engine saw, and what it did: oldest first behind the system
    // prompt, an answer that follows goes with it.
    const real = measuredTokens(request)
    let total = real.reduce((a, b) => a + b, 0) + OPENING
    expect(engineKeeps(total)).toBe(false)
    const rest = real.slice(1)
    const roles = request.slice(1).map((m) => m.role)
    let dropped = 0
    while (!engineKeeps(total) && rest.length > 1) {
      total -= rest.shift()!
      roles.shift()
      dropped += 1
      if (rest.length > 1 && roles[0] === 'assistant') {
        total -= rest.shift()!
        roles.shift()
        dropped += 1
      }
    }
    // The line of the log: dropped=4. The question was the first to go.
    expect(dropped).toBe(4)
  })

  it('now the phone cuts it so that the engine keeps every message', () => {
    const request = runOfA02()
    const fit = fitToWindow(request, 4096, 0, run.question.text)
    expect(fit.changed).toBe(true)
    expect(fit.over).toBe(false)
    expect(fit.tokens).toBeLessThanOrEqual(phonePromptLimit(4096))
    // Nothing is dropped: system prompt, question, both calls, both results.
    expect(fit.messages).toHaveLength(request.length)
    expect(fit.messages.map((m) => m.role)).toEqual(request.map((m) => m.role))

    const real = measuredTokens(fit.messages).reduce((a, b) => a + b, 0) + OPENING
    expect(engineKeeps(real)).toBe(true)
    // And the estimate is above the measurement, message by message summed.
    expect(fit.tokens).toBeGreaterThanOrEqual(real - OPENING)

    // The page still says what was asked for: its head is there.
    expect(fit.messages[5].content).toContain('The current population of Iceland is 402,329')
  })

  it('the same holds for every length the page can have, and for a page that is one table', () => {
    for (const keep of [20, 40, 80, run.page.length]) {
      const request = runOfA02()
      request[5] = { role: 'user', content: buildHermesToolResult('web_fetch', truncateToolResult(raw(run.page.slice(0, keep)), phoneResultChars(4096, 60000))) }
      const fit = fitToWindow(request, 4096, 0, run.question.text)
      expect(fit.over, String(keep)).toBe(false)
      const real = measuredTokens(fit.messages).reduce((a, b) => a + b, 0) + OPENING
      expect(engineKeeps(real), String(keep)).toBe(true)
    }
    // Only rows of numbers: the densest text there is.
    const table = run.page.filter((l) => /^\d{4} \d/.test(l.text))
    const request = runOfA02()
    request[5] = { role: 'user', content: buildHermesToolResult('web_fetch', truncateToolResult(raw(table), phoneResultChars(4096, 60000))) }
    const fit = fitToWindow(request, 4096, 0, run.question.text)
    expect(fit.over).toBe(false)
    // The first five as they went out; the sixth here only fills the place of the page.
    const [system, question, callSearch, search, callFetch] = measuredTokens([...fit.messages.slice(0, 5), runOfA02()[5]])
    const page = measuredResult(fit.messages[5].content, table, run.wrapFetch.qwen) + run.framePerMessage.qwen
    expect(engineKeeps(system + question + callSearch + search + callFetch + page + OPENING)).toBe(true)
  })
})

describe('A-02: the engine tells the size of the first request, and the page gets the room that is really there', () => {
  // The first request of the run: the tool list and the question. The engine
  // counts it and reports the number with its answer (usage.prompt_tokens).
  const first = () => runOfA02().slice(0, 2)
  const firstCount = samples.sys.qwen + run.question.qwen + 2 * run.framePerMessage.qwen + OPENING

  it('the estimate of the tool list is half as much again as its real size, and the measurement takes that back', () => {
    expect(phoneTokens(samples.sys.text)).toBeGreaterThan(samples.sys.qwen * 1.4)
    const measured = measuredRequest(first(), firstCount)
    expect(measured).not.toBeNull()

    const request = runOfA02()
    const plain = fitToWindow(request, 4096, 0, run.question.text)
    const withCount = fitToWindow(request, 4096, 0, run.question.text, measured)
    expect(withCount.over).toBe(false)
    expect(withCount.messages).toHaveLength(request.length)
    // More of the page arrives.
    expect(withCount.messages[5].content.length).toBeGreaterThan(plain.messages[5].content.length * 1.3)
    // And the engine still keeps every message.
    const real = measuredTokens(withCount.messages).reduce((a, b) => a + b, 0) + OPENING
    expect(engineKeeps(real)).toBe(true)
  })

  it('a page that is one table still fits with the measurement', () => {
    const table = run.page.filter((l) => /^\d{4} \d/.test(l.text))
    const request = runOfA02()
    request[5] = { role: 'user', content: buildHermesToolResult('web_fetch', truncateToolResult(raw(table), phoneResultChars(4096, 60000))) }
    const fit = fitToWindow(request, 4096, 0, run.question.text, measuredRequest(first(), firstCount))
    expect(fit.over).toBe(false)
    const [system, question, callSearch, search, callFetch] = measuredTokens([...fit.messages.slice(0, 5), runOfA02()[5]])
    const page = measuredResult(fit.messages[5].content, table, run.wrapFetch.qwen) + run.framePerMessage.qwen
    expect(engineKeeps(system + question + callSearch + search + callFetch + page + OPENING)).toBe(true)
  })

  it('once a message the measurement covers is cut or gone, everything is estimated again', () => {
    const measured = measuredRequest(first(), firstCount)
    const request = runOfA02()
    request[1] = { role: 'user', content: 'Another question altogether.' }
    const fit = fitToWindow(request, 4096, 0, 'Another question altogether.', measured)
    const plain = fitToWindow(request, 4096, 0, 'Another question altogether.')
    expect(fit.messages.map((m) => m.content)).toEqual(plain.messages.map((m) => m.content))
  })

  it('a count that cannot be what was sent is not believed: the engine dropped messages before it counted', () => {
    expect(measuredRequest(first(), 200)).toBeNull()
    expect(measuredRequest(first(), 0)).toBeNull()
    expect(measuredRequest(first(), undefined)).toBeNull()
    expect(measuredRequest([], 900)).toBeNull()
  })
})
