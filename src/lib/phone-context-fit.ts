/**
 * A request that fits the window of the model on a phone, every time.
 *
 * Acceptance on Android with 8 GB, B1: the agent read a page and the run ended
 * on "the request exceeds the available context size (4289 prompt tokens,
 * context 4096)", two runs of three with the model the app recommends.
 *
 * Why the desktop rules do not hold here. They were built for windows of 8k
 * and up: a fresh tool result may be 60 000 characters long, an aged one
 * 4 000, the newest four messages are kept whatever they weigh, and the budget
 * is counted at four characters per token. The window of a phone is 4096
 * tokens at most (mobile/lib/device-fit.ts). The tool list alone is about
 * 1 600 of them, one page of a website is 6 000, and web text, numbers and
 * JSON run closer to three characters per token than to four. Every one of
 * those floors is larger than what is left.
 *
 * And it is worse than three for the pages an agent reads most (round 9,
 * A-02 on Android: "dropped old messages to fit the context dropped=4" in
 * three runs of three). The tokenizer of the Qwen family, which is what the
 * app recommends, writes every digit as a token of its own, and the space in
 * front of a number as another. A page of population figures measured 1.3
 * characters per token, a table of numbers 1.07. Counted at 3.3 the request
 * looked half as long as it was, so the engine dropped what the phone thought
 * it had kept. `phoneTokens` therefore counts by what the text is made of
 * (see there), and is checked against measured token counts in the tests.
 *
 * The engine of the phone makes a request fit by dropping the oldest messages
 * (commands/engine_inproc.rs). That drops the question first, and it cannot
 * help when one message alone is too long: that is the error above.
 *
 * So the phone cuts before it sends, in this order:
 *   1. tool results of earlier steps down to a few lines,
 *   2. the results of the step that just ran down to the room that is left,
 *   3. the oldest turns of the chat, never the question being answered,
 *      then the oldest rounds of this run behind the question,
 *   4. as the last resort the longest text that remains, the question last.
 * The system prompt is never touched. Only the copy on the wire is cut: the
 * chat keeps what it has.
 *
 * "The question" is what the user asked, not the last message with the role
 * `user`: the loop appends its own steering sentences with that role. The
 * caller names the question (`question`), and without that the steering
 * sentences that have a source are told apart by it (lib/loop-steers.ts).
 *
 * Nothing here runs on a desktop, and nothing runs for a model with a large
 * window (a cloud model on a phone).
 */
import { singleModelSlot } from './capabilities'
import { isToolResult } from './context-decay'
import { isLoopSteer } from './loop-steers'
import { truncateToolResult } from './truncate-tool-result'

/** Windows above this are not the engine of a phone. */
export const PHONE_FIT_MAX_CTX = 16384
/** What the engine keeps free for the answer (REPLY_RESERVE in engine_inproc.rs). */
export const PHONE_REPLY_RESERVE = 512
/**
 * Kept free on top: the frame of the chat template around the request (the
 * turn that opens the answer, the thinking mark) and what the estimate misses.
 */
const TEMPLATE_SLACK = 128
/** Characters of a tool result of an earlier step, once the window is tight. */
export const PHONE_AGED_RESULT_CHARS = 600
/** The least a fresh result is cut to, in tokens. Below that it says nothing. */
const MIN_FRESH_TOKENS = 150
/** The share of the window one fresh result may take where it enters the run. */
const ENTRY_SHARE = 0.35
/** Characters per token of ordinary prose. Only for the length a result may have where it enters the run. */
const ENTRY_CHARS_PER_TOKEN = 3.3
/** A word up to this many letters counts as one token. */
const SHORT_WORD = 6
/** Letters per token of a longer word (a German compound, a technical term). */
const LONG_WORD_LETTERS = 3
/** Letters per token of a run with capitals inside it: an identifier, base64, a hash. */
const ODD_CASE_LETTERS = 1.3
/** Letters per token of a run that touches a digit: hex, a unit, a product code. */
const BESIDE_DIGIT_LETTERS = 1.5
/** Punctuation marks in a row that make one token ("://", the quotes and braces of JSON). */
const PUNCTUATION_RUN = 3
/** Blanks and line breaks in a row that make one token. */
const WHITESPACE_RUN = 3

interface FitMessage {
  role: string
  content?: unknown
  tool_calls?: unknown
  tool_call_id?: string
}

const isLetter = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90)
const isUpper = (c: number) => c >= 65 && c <= 90
const isDigit = (c: number) => c >= 48 && c <= 57
const isBlank = (c: number) => c === 32 || c === 9 || c === 10 || c === 13

/**
 * Pure: tokens of a text, estimated so that the estimate is rarely too low.
 *
 * Counted by what the text is made of, because characters per token differ by
 * a factor of four between prose and a table of numbers:
 *   - a digit is a token (the Qwen and Gemma families split numbers that way),
 *   - a character outside ASCII is a token (an umlaut usually is one, a
 *     Chinese or Japanese character is one or more),
 *   - punctuation is a token per three marks in a row,
 *   - a blank in front of a word rides with the word, any other run of blanks
 *     and line breaks is a token per three,
 *   - a word is one token up to six letters and one per three letters beyond
 *     that. A run with capitals inside it or digits beside it (base64, hex,
 *     identifiers) is cut much finer by every tokenizer and counted so.
 *
 * Measured against the tokenizers of Qwen 2.5 (the vocabulary Qwen3 uses) and
 * Llama 3.2 on a tool prompt, prose, a population page, search results, code,
 * links, hex and base64: between 1.04 and 1.7 times the real count, never
 * below it (__tests__/phone-token-estimate.test.ts holds the numbers). The
 * tokenizer of SmolLM2 cuts German finer than this counts (0.9 times); that
 * model cannot use tools, so no agent run is sent to it.
 */
export function phoneTokens(text: string): number {
  if (!text) return 0
  const n = text.length
  let tokens = 0
  let i = 0
  while (i < n) {
    const c = text.charCodeAt(i)
    if (c > 127) {
      tokens += 1
      i += 1
    } else if (isLetter(c)) {
      let j = i + 1
      let odd = false
      while (j < n && isLetter(text.charCodeAt(j))) {
        if (isUpper(text.charCodeAt(j))) odd = true
        j += 1
      }
      const letters = j - i
      const besideDigit = (i > 0 && isDigit(text.charCodeAt(i - 1))) || (j < n && isDigit(text.charCodeAt(j)))
      if (odd) tokens += Math.ceil(letters / ODD_CASE_LETTERS)
      else if (besideDigit) tokens += Math.ceil(letters / BESIDE_DIGIT_LETTERS)
      else if (letters <= SHORT_WORD) tokens += 1
      else tokens += Math.ceil(letters / LONG_WORD_LETTERS)
      i = j
    } else if (isDigit(c)) {
      tokens += 1
      i += 1
    } else if (isBlank(c)) {
      let j = i + 1
      while (j < n && isBlank(text.charCodeAt(j))) j += 1
      const blanks = j - i
      const ridesWithWord = blanks === 1 && c === 32 && j < n && isLetter(text.charCodeAt(j))
      if (!ridesWithWord) tokens += Math.ceil(blanks / WHITESPACE_RUN)
      i = j
    } else {
      let j = i + 1
      while (j < n) {
        const next = text.charCodeAt(j)
        if (next > 127 || isLetter(next) || isDigit(next) || isBlank(next)) break
        j += 1
      }
      tokens += Math.ceil((j - i) / PUNCTUATION_RUN)
      i = j
    }
  }
  return tokens
}

function textOf(m: FitMessage): string {
  if (typeof m.content === 'string') return m.content
  if (m.content === undefined || m.content === null) return ''
  try {
    return JSON.stringify(m.content)
  } catch {
    return ''
  }
}

function messageTokens(m: FitMessage): number {
  let tokens = phoneTokens(textOf(m)) + 6
  if (m.tool_calls) {
    try {
      tokens += phoneTokens(JSON.stringify(m.tool_calls))
    } catch {
      /* a call that cannot be written cannot be counted */
    }
  }
  return tokens
}

function estimated(messages: readonly FitMessage[]): number {
  let sum = 0
  for (const m of messages) sum += messageTokens(m)
  return sum
}

/** Does the phone rule apply to a window of this size? */
export function phoneFitApplies(ctx: number): boolean {
  return singleModelSlot() && Number.isFinite(ctx) && ctx > 0 && ctx <= PHONE_FIT_MAX_CTX
}

/**
 * Windows up to this get the short tool list on a phone (round 9, N15).
 *
 * Acceptance on Android with 8 GB: Agent on, one message "Say hello in three
 * words.", and the gauge said "Context 42%". The request carried seven tool
 * schemas as text, about 2000 of 4096 tokens, before a word was said. Two of
 * them (list a folder, search in files) ride along on every question that
 * names neither a file nor the web. The cap of Small Model Mode leaves them
 * out unless the question asks for them, and that is what a small window
 * gets here without the user having to find that switch. A tool the user
 * names is offered past the cap, as everywhere (`applyMaxTools`).
 */
export const PHONE_TOOL_CAP_MAX_CTX = 8192

/** Does a phone with a window of this size get the short tool list? */
export function phoneToolCapApplies(ctx: number): boolean {
  return phoneFitApplies(ctx) && ctx <= PHONE_TOOL_CAP_MAX_CTX
}

/**
 * The options of the tool selection, with the cap of a small window on a
 * phone. Everywhere else, and where a cap is already set, they come back as
 * they were given.
 */
export function withPhoneToolCap<T extends { maxTools?: number }>(opts: T, ctx: number, cap: number): T {
  if (opts.maxTools || !phoneToolCapApplies(ctx)) return opts
  return { ...opts, maxTools: cap }
}

/** Pure: the tokens a request may have in a window of `ctx`. */
export function phonePromptLimit(ctx: number): number {
  return Math.max(0, Math.floor(ctx - Math.min(PHONE_REPLY_RESERVE, ctx / 4) - TEMPLATE_SLACK))
}

/**
 * Cut a text to `tokens` at most, head and tail kept. Never longer than it was.
 *
 * A text is not evenly dense: the head of a page is prose, its middle a table
 * of numbers. A cut by the average of the whole text keeps a part that is
 * denser or thinner than the average, so the length is searched for: the
 * longest cut whose count fits. Without that the result was either still too
 * long, and the next steps dropped earlier rounds of the run to make room it
 * could have given, or much shorter than the room it had.
 */
function cutToTokens(text: string, tokens: number): string {
  if (phoneTokens(text) <= tokens) return text
  let low = 0
  let high = text.length
  let best = truncateToolResult(text, 0)
  for (let round = 0; round < 14 && high - low > 16; round++) {
    const chars = Math.floor((low + high) / 2)
    const cut = truncateToolResult(text, chars)
    if (cut.length < text.length && phoneTokens(cut) <= tokens) {
      best = cut
      low = chars
    } else {
      high = chars
    }
  }
  return best.length < text.length ? best : text
}

/**
 * How long a tool result may be where it enters the run.
 *
 * On a desktop, and for a large window, this is `fallback`: the number the
 * call site used before. On a phone it is a share of the window, so the run
 * never carries a page it could not send anyway.
 */
export function phoneResultChars(ctx: number, fallback: number): number {
  if (!phoneFitApplies(ctx)) return fallback
  return Math.min(fallback, Math.max(800, Math.floor(ctx * ENTRY_SHARE * ENTRY_CHARS_PER_TOKEN)))
}

/**
 * A request whose real size is known: the engine said how many tokens it was
 * (`usage.prompt_tokens`). `keys` name its messages in order.
 */
export interface PhoneMeasure {
  keys: string[]
  tokens: number
}

const keyOf = (m: FitMessage) => `${m.role}\u0000${textOf(m)}\u0000${m.tool_calls ? JSON.stringify(m.tool_calls) : ''}`

/**
 * Pure: remember what the engine counted for a request that was sent.
 *
 * WHY. The estimate above is built to be too high rather than too low, and it
 * is highest where it matters most: the tool list in the system prompt is
 * English JSON, counted at 1.6 times its real size, which is 700 tokens of a
 * window of 4096 that the page the agent reads then does not get. The engine
 * knows the real number and reports it with every answer. The first request
 * of a run is the system prompt, the chat so far and the question, so its
 * count is the real size of everything a later request of the run starts
 * with, and only what the run adds has to be estimated.
 *
 * Null when the number cannot be what was sent: less than half the estimate
 * means the engine dropped messages before it counted.
 */
export function measuredRequest(messages: readonly FitMessage[], promptTokens: number | undefined): PhoneMeasure | null {
  if (!promptTokens || !Number.isFinite(promptTokens) || promptTokens <= 0 || messages.length === 0) return null
  if (promptTokens < estimated(messages) / 2) return null
  return { keys: messages.map(keyOf), tokens: Math.ceil(promptTokens) }
}

/**
 * Tokens of a request: the measured count for the messages it starts with,
 * where it still starts with exactly those, and the estimate for the rest.
 * Once one of them is cut or dropped the measurement says nothing about what
 * is left, and everything is estimated again, which is the careful side.
 */
function sized(messages: readonly FitMessage[], measured?: PhoneMeasure | null): number {
  if (!measured || measured.keys.length > messages.length) return estimated(messages)
  for (let i = 0; i < measured.keys.length; i++) {
    if (keyOf(messages[i]) !== measured.keys[i]) return estimated(messages)
  }
  return measured.tokens + estimated(messages.slice(measured.keys.length))
}

export interface FitOptions {
  /**
   * Leave every text as long as it is: only whole turns are left out, oldest
   * first. For a plain chat. A question that is too long on its own then
   * comes back with `over`, and the engine, which counts for real, decides.
   */
  keepTexts?: boolean
}

export interface PhoneFit<T> {
  messages: T[]
  /** Something was cut or dropped. */
  changed: boolean
  /** Estimated tokens of what goes out. */
  tokens: number
  /** The request still does not fit: the system prompt alone is too long. */
  over: boolean
}

/** Is this a message the user wrote: role `user`, no tool result, no steer of the loop? */
function isUserTurn(m: FitMessage): boolean {
  return m.role === 'user' && !isToolResult(m) && !isLoopSteer(m.content)
}

/**
 * Pure: the text of the question a run answers, read off the request as it
 * stands when the run starts: the last message the user wrote. The loop asks
 * this once, before it appends anything of its own, and hands the answer to
 * `fitRequestForPhone` with every request of the run.
 */
export function questionOf(messages: readonly FitMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isUserTurn(messages[i]) && typeof messages[i].content === 'string') return messages[i].content as string
  }
  return undefined
}

/**
 * Pure: the same request, cut to `limit` tokens.
 *
 * Returns the array it was given when it fits already. `toolTokens` is the
 * size of a tool list that travels next to the messages (the engine of a
 * phone has none: its tools stand in the system prompt). `question` is the
 * text of the message the run answers (`questionOf`); it is never dropped.
 * `measured` is an earlier request of the run whose real size the engine
 * reported (`measuredRequest`).
 */
export function fitToWindow<T extends FitMessage>(
  messages: readonly T[],
  ctx: number,
  toolTokens = 0,
  question?: string,
  measured?: PhoneMeasure | null,
  options: FitOptions = {},
): PhoneFit<T> {
  const limit = Math.max(0, phonePromptLimit(ctx) - Math.max(0, toolTokens))
  const total = (list: readonly FitMessage[]) => sized(list, measured)
  let work = messages as T[]
  let size = total(work)
  if (size <= limit) return { messages: work, changed: false, tokens: size, over: false }
  work = work.slice()

  const setContent = (i: number, content: string) => {
    work[i] = { ...work[i], content }
  }

  // Results of the step that just ran: every result behind the last message that is not one.
  let freshFrom = work.length
  while (freshFrom > 0 && isToolResult(work[freshFrom - 1])) freshFrom--

  // 1. Results of earlier steps.
  for (let i = 0; i < freshFrom; i++) {
    const m = work[i]
    if (!isToolResult(m) || typeof m.content !== 'string' || m.content.length <= PHONE_AGED_RESULT_CHARS) continue
    setContent(i, truncateToolResult(m.content, PHONE_AGED_RESULT_CHARS))
  }
  size = total(work)

  // 2. The results of the step that just ran share what is left.
  if (size > limit && freshFrom < work.length) {
    const fresh: number[] = []
    for (let i = freshFrom; i < work.length; i++) if (typeof work[i].content === 'string') fresh.push(i)
    const freshTokens = fresh.reduce((sum, i) => sum + phoneTokens(work[i].content as string), 0)
    const room = limit - (size - freshTokens)
    const each = Math.max(MIN_FRESH_TOKENS, Math.floor(room / Math.max(1, fresh.length)))
    for (const i of fresh) setContent(i, cutToTokens(work[i].content as string, each))
    size = total(work)
  }

  const first = work[0]?.role === 'system' ? 1 : 0
  // The question: the message the caller named, else the last one the user
  // wrote. A steering sentence of the loop is neither.
  const questionAt = () => {
    if (question !== undefined) {
      for (let i = work.length - 1; i >= first; i--) {
        if (work[i].role === 'user' && work[i].content === question) return i
      }
    }
    for (let i = work.length - 1; i >= first; i--) if (isUserTurn(work[i])) return i
    return first
  }

  // 3. The oldest turns, up to the question being answered.
  if (size > limit) {
    while (size > limit && questionAt() > first) {
      work.splice(first, 1)
      // A result whose call just went, and an answer that opens the chat: both go with it.
      while (questionAt() > first && (isToolResult(work[first]) || work[first].role === 'assistant')) work.splice(first, 1)
      size = total(work)
    }
  }

  // 3b. The oldest rounds of this run, behind the question. The round that
  // just ran stays: its call, its results, and what the loop said after it.
  if (size > limit) {
    const lastRound = () => {
      for (let i = work.length - 1; i > questionAt(); i--) if (work[i].role === 'assistant') return i
      return -1
    }
    for (;;) {
      const at = questionAt() + 1
      if (size <= limit || at >= lastRound()) break
      work.splice(at, 1)
      // The results of a call that just went go with it.
      while (at < lastRound() && isToolResult(work[at])) work.splice(at, 1)
      size = total(work)
    }
  }

  // 4. The longest text that is left, the system prompt excepted. The
  // question is cut only when nothing else is left to cut. Not in a plain
  // chat (`keepTexts`): there a text the user wrote goes out whole or not at all.
  for (let round = 0; !options.keepTexts && round < 8 && size > limit; round++) {
    const longestBut = (skip: number): [number, number] => {
      let longest = -1
      let longestTokens = 0
      for (let i = 0; i < work.length; i++) {
        if (i === skip || work[i].role === 'system' || typeof work[i].content !== 'string') continue
        const t = phoneTokens(work[i].content as string)
        if (t > longestTokens) {
          longest = i
          longestTokens = t
        }
      }
      return [longest, longestTokens]
    }
    let [longest, longestTokens] = longestBut(questionAt())
    if (longest < 0 || longestTokens <= 40) [longest, longestTokens] = longestBut(-1)
    if (longest < 0 || longestTokens <= 40) break
    const next = cutToTokens(work[longest].content as string, Math.max(40, longestTokens - (size - limit)))
    if (next === work[longest].content) break
    setContent(longest, next)
    size = total(work)
  }

  return { messages: work, changed: true, tokens: size, over: size > limit }
}

/**
 * What the agent loop calls right before a request goes out.
 * The same array on a desktop and for every window a phone does not own.
 */
export function fitRequestForPhone<T extends FitMessage>(
  messages: T[],
  ctx: number,
  toolTokens = 0,
  question?: string,
  measured?: PhoneMeasure | null,
): T[] {
  if (!phoneFitApplies(ctx)) return messages
  return fitToWindow(messages, ctx, toolTokens, question, measured).messages
}

// ── the context figure of a plain chat ───────────────────────────────────
//
// Acceptance android-4gb, F11. The chip said "Context 72%" while the app
// refused the question as too long, and in the same chat it went 74, 78, 13,
// 18, 21, 86 without anything being deleted.
//
// Three ways of counting were at work. The chip counted four characters per
// token: 11 500 characters of notes with many numbers came out at 2 875
// tokens of 4 096, and they were more than 8 000 (a digit is a token). The
// send path dropped old turns by the same four characters. And the engine
// counted for real, dropped what did not fit from the front, the long
// question with it, and reported the small rest, which the chip then showed
// as 13 percent, until an answer without a count made it fall back to four
// characters per token over everything (86).
//
// Now there is one: what `fitToWindow` counts and cuts by. The send path of a
// plain chat on a phone leaves out the oldest turns with it before the
// request goes out, so the engine has nothing left to drop, and the chip
// shows the result of the same function over the same messages. The figure
// only goes down when turns were left out, and then it says so.

export type PhoneMeterState = 'fits' | 'trimmed' | 'too-long'

export interface PhoneMeter {
  /** Estimated tokens of what goes out. */
  tokens: number
  /** The tokens a request may have in this window (`phonePromptLimit`). */
  limit: number
  /** `tokens` of `limit`, 0 to 100. At 100 the next thing that does not fit is left out. */
  percent: number
  /**
   * fits      the whole chat goes out
   * trimmed   older turns are left out (or old tool results shortened): the figure is what is left
   * too-long  the question alone does not fit, with everything before it left out
   */
  state: PhoneMeterState
  /** Messages of the chat that do not go out. */
  dropped: number
}

/** Pure: a plain chat cut for the window of a phone. Whole turns only, oldest first, the question never. */
export function fitChatToWindow<T extends FitMessage>(messages: readonly T[], ctx: number): PhoneFit<T> {
  return fitToWindow(messages, ctx, 0, undefined, null, { keepTexts: true })
}

/** What the send path of a plain chat calls. The same array on a desktop and for every window a phone does not own. */
export function fitChatForPhone<T extends FitMessage>(messages: T[], ctx: number): PhoneFit<T> {
  if (!phoneFitApplies(ctx)) return { messages, changed: false, tokens: 0, over: false }
  return fitChatToWindow(messages, ctx)
}

/**
 * Pure: the figure for a request. `candidate` is what the chat holds for the
 * model (system prompt first), `fit` what `fitChatToWindow` made of it.
 * `leftOutBefore`: messages another rule had left out already.
 */
export function meterOfFit(candidateCount: number, fit: PhoneFit<FitMessage>, ctx: number, leftOutBefore = 0): PhoneMeter {
  const limit = phonePromptLimit(ctx)
  const dropped = Math.max(0, candidateCount - fit.messages.length) + Math.max(0, leftOutBefore)
  const state: PhoneMeterState = fit.over ? 'too-long' : fit.changed || dropped > 0 ? 'trimmed' : 'fits'
  const percent = limit > 0 ? Math.min(100, Math.max(0, Math.round((fit.tokens / limit) * 100))) : 0
  return { tokens: fit.tokens, limit, percent: state === 'too-long' ? 100 : percent, state, dropped }
}

/** Pure: the figure for a chat as it stands, by the rule the send path cuts with. */
export function phoneContextMeter(messages: readonly FitMessage[], ctx: number): PhoneMeter {
  return meterOfFit(messages.length, fitChatToWindow(messages, ctx), ctx)
}

/** Pure: tokens of a text the way the window of a phone is counted, with the frame of one message. */
export function phoneMessageTokens(message: FitMessage): number {
  return messageTokens(message)
}

/** What the send path reports once per request of a plain chat on a phone. */
export interface PhoneMeterReport {
  meter: PhoneMeter
  /** The window it was built against. */
  window: number
  /** Stored messages of the chat that were part of this request (the empty answer being written is not). */
  atMessageCount: number
}

/** One stored message of a chat, and whether it reaches the model (an app notice and an empty answer do not). */
export interface StoredForMeter {
  message: FitMessage
  counts: boolean
}

/**
 * Pure: the figure to show.
 *
 * `report` is the last request of this chat, if one went out since the app
 * started. `stored` are ALL messages of the chat in order, each with whether
 * it reaches the model, and `system` is the system prompt as far as it is
 * known.
 *
 * With a report the figure is what went out plus what was added since (the
 * answer; a question that is only typed is not in the chat yet). It only
 * falls when a request left turns out, and then the state says `trimmed`.
 * Without a report (a chat opened after a restart) it is the same rule run
 * over the chat as it stands.
 */
export function shownPhoneMeter(report: PhoneMeterReport | null | undefined, stored: readonly StoredForMeter[], system: string, ctx: number): PhoneMeter {
  const whole = () => {
    const visible = stored.filter((s) => s.counts).map((s) => s.message)
    return phoneContextMeter(system ? [{ role: 'system', content: system }, ...visible] : visible, ctx)
  }
  if (!report || report.window !== ctx || report.atMessageCount > stored.length) return whole()
  const added = stored.slice(report.atMessageCount).filter((s) => s.counts)
  // A question that did not fit is history once another one is asked; until then it is still what would go out.
  if (report.meter.state === 'too-long') return added.some((s) => s.message.role === 'user') ? whole() : report.meter
  let tokens = report.meter.tokens
  for (const s of added) tokens += messageTokens(s.message)
  const limit = phonePromptLimit(ctx)
  // What was added no longer fits: the next request leaves turns out. Say what it will carry.
  if (tokens > limit) {
    const next = whole()
    return next.state === 'fits' ? { ...next, state: 'trimmed' } : next
  }
  const percent = limit > 0 ? Math.min(100, Math.max(0, Math.round((tokens / limit) * 100))) : 0
  return { tokens, limit, percent, state: report.meter.state, dropped: report.meter.dropped }
}
