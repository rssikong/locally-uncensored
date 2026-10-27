/**
 * The error of an answer is a field, not a guess from its text (mobile round
 * 2, audit L12).
 *
 * Three things are pinned here:
 *   1. the mapping from what a send throws to the kind on the message,
 *   2. that a reader takes the field before any wording,
 *   3. that the chat hook writes the field wherever it writes an error
 *      sentence (read from its source, so a new catch branch cannot forget).
 *
 * The behaviour through the mounted hook is in
 * src/hooks/__tests__/useChat-schreibt-die-fehlerart.test.ts.
 *
 * Run: npx vitest run src/lib/__tests__/message-error.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CREDITS_EXHAUSTED_MESSAGE } from '../credits-exhausted'
import { INTERRUPTED_EMPTY_TEXT } from '../interrupted-runs'
import { answerBody, classifyRunError, kindFromReason, messageErrorFor, viewAnswer } from '../message-error'

const here = dirname(fileURLToPath(import.meta.url))
const hook = readFileSync(resolve(here, '../../hooks/useChat.ts'), 'utf8')

const coded = (message: string, code: string) => Object.assign(new Error(message), { code })

describe('classifyRunError: what a send threw becomes a kind', () => {
  it('an empty wallet is credits, whatever the sentence says', () => {
    expect(classifyRunError(coded('anything at all', 'credits_exhausted'), { cloud: true })).toEqual({ kind: 'credits', detail: '' })
  })
  it('a missing or refused session of LU Cloud is session', () => {
    expect(classifyRunError(coded('Sign in to your LU Cloud account to chat in the cloud.', 'signed_out'), { cloud: true })).toEqual({ kind: 'session', detail: '' })
    expect(classifyRunError(coded('whatever', 'auth'), { cloud: true }).kind).toBe('session')
    expect(classifyRunError(new Error('401 Unauthorized'), { cloud: true }).kind).toBe('session')
  })
  it('a refused key of the user\'s own provider is NOT the LU Cloud session', () => {
    const own = classifyRunError(coded('Incorrect API key provided', 'auth'), { cloud: false })
    expect(own.kind).toBe('generic')
    expect(own.detail).toBe('Incorrect API key provided')
  })
  it('the code "network" decides where the wording names nothing more exact', () => {
    expect(classifyRunError(coded('no route to the host', 'network'), { cloud: false })).toEqual({ kind: 'network', detail: 'no route to the host' })
    // The provider layer says "network" for an engine of the device that is not up. The reason names the engine, and that wins.
    expect(classifyRunError(coded('The on device engine is not answering (503)', 'network'), { cloud: false }).kind).toBe('engine')
    expect(classifyRunError(coded('the engine could not be reached', 'network'), { cloud: true }).kind).toBe('network')
  })
  it('the sentences of the native side for a name that does not resolve are network errors, with or without the old prefix', () => {
    // Since round 2 the native side says this instead of "Blocked: 'host' did not resolve within 5 s".
    const lookup = "Could not look up 'api.groq.com'. The network seems to be slow or offline. Check the connection and try again."
    const reach = "Could not reach 'api.groq.com'. The network seems to be slow or offline. Check the connection and try again."
    for (const cloud of [true, false]) {
      expect(classifyRunError(lookup, { cloud }).kind).toBe('network')
      expect(classifyRunError(reach, { cloud }).kind).toBe('network')
    }
    // "Blocked" now only means an address that really is not allowed: that is no network error, and no retry repairs it.
    expect(classifyRunError("Blocked: 'example.org' is not an allowed address", { cloud: false }).kind).toBe('generic')
    // The phone refuses clear text to a public host with a sentence of its own: shown as it is.
    const https = "This phone only connects to 'api.example.com' over https. Change the address of this provider so that it starts with https://."
    expect(classifyRunError(https, { cloud: false })).toEqual({ kind: 'generic', detail: https })
  })
  it('without a code the reason decides: engine on the device, network in the cloud', () => {
    expect(classifyRunError('connection refused', { cloud: false }).kind).toBe('engine')
    expect(classifyRunError('connection refused', { cloud: true }).kind).toBe('network')
    expect(classifyRunError(new Error('Failed to fetch'), { cloud: true })).toEqual({ kind: 'network', detail: 'Failed to fetch' })
    expect(classifyRunError(new Error('The model is still loading'), { cloud: false }).kind).toBe('engine')
    expect(classifyRunError(new Error('out of memory'), { cloud: false })).toEqual({ kind: 'engine', detail: 'out of memory' })
  })
  it('a Tauri invoke rejects with a string, and that is read too', () => {
    expect(classifyRunError('error decoding response body: connection reset by peer', { cloud: false }).kind).toBe('network')
  })
  it('anything else keeps its reason, and nothing at all is a failed connection', () => {
    expect(classifyRunError(new Error('Something odd'), { cloud: true })).toEqual({ kind: 'generic', detail: 'Something odd' })
    expect(classifyRunError(undefined, { cloud: true })).toEqual({ kind: 'network', detail: 'Connection failed' })
    expect(classifyRunError(undefined, { cloud: false })).toEqual({ kind: 'network', detail: 'Connection failed' })
  })
  it('the field remembers how much of the text is the answer', () => {
    expect(messageErrorFor(new Error('Failed to fetch'), { cloud: true }, 'Half an answer')).toEqual({ kind: 'network', detail: 'Failed to fetch', at: 14 })
  })
})

describe('kindFromReason', () => {
  it('keeps the old table of the mobile chat', () => {
    expect(kindFromReason('Session expired. Sign in again.', true)).toBe('session')
    expect(kindFromReason('Session expired. Sign in again.', false)).toBe('generic')
    expect(kindFromReason('503 from llama', false)).toBe('engine')
    expect(kindFromReason('timed out', true)).toBe('network')
  })
})

describe('viewAnswer: the field wins over the text', () => {
  it('reads kind, reason and the answer from the field', () => {
    const view = viewAnswer({ content: 'Half an answer\n\nError: Failed to fetch', error: { kind: 'network', detail: 'Failed to fetch', at: 14 } }, { cloud: true })
    expect(view).toEqual({ body: 'Half an answer', error: { kind: 'network', detail: 'Failed to fetch' } })
  })
  it('a changed sentence does not change the kind', () => {
    // The wording of the logic layer may be rewritten at any time. With the field the box stays the right one.
    const view = viewAnswer({ content: 'Part\n\nYour balance is used up for this month.', error: { kind: 'credits', detail: '', at: 4 } }, { cloud: true })
    expect(view).toEqual({ body: 'Part', error: { kind: 'credits', detail: '' } })
    const session = viewAnswer({ content: 'Please log in once more.', error: { kind: 'session', detail: '', at: 0 } }, { cloud: true })
    expect(session).toEqual({ body: '', error: { kind: 'session', detail: '' } })
  })
  it('the field decides even when the text looks like another kind', () => {
    const view = viewAnswer({ content: 'Error: Failed to fetch', error: { kind: 'engine', detail: 'x', at: 0 } }, { cloud: true })
    expect(view.error).toEqual({ kind: 'engine', detail: 'x' })
  })
  it('never cuts past the text that is there (an answer that was edited afterwards)', () => {
    expect(viewAnswer({ content: 'Short', error: { kind: 'generic', detail: 'r', at: 400 } }).body).toBe('Short')
  })
  it('never judges an answer that is still being written', () => {
    expect(viewAnswer({ content: 'Half', error: { kind: 'network', detail: '', at: 0 } }, { streaming: true })).toEqual({ body: 'Half', error: null })
    expect(viewAnswer({ content: '' }, { streaming: true }).error).toBeNull()
  })
  it('a clean answer has no error', () => {
    expect(viewAnswer({ content: 'All good.' })).toEqual({ body: 'All good.', error: null })
  })
})

describe('viewAnswer: a message without the field (older chats, the agent loop)', () => {
  it('still knows the sentences the logic layer leaves in the text', () => {
    expect(viewAnswer({ content: CREDITS_EXHAUSTED_MESSAGE }, { cloud: true })).toEqual({ body: '', error: { kind: 'credits', detail: '' } })
    expect(viewAnswer({ content: `Half an answer\n\n${CREDITS_EXHAUSTED_MESSAGE}` }, { cloud: true }).body).toBe('Half an answer')
    expect(viewAnswer({ content: 'Sign in to your LU Cloud account to chat in the cloud.' }, { cloud: true }).error?.kind).toBe('session')
    expect(viewAnswer({ content: 'Part\n\nError: 401 Unauthorized' }, { cloud: true })).toEqual({ body: 'Part', error: { kind: 'session', detail: '' } })
    expect(viewAnswer({ content: 'Error from LU Engine: out of memory' }).error).toEqual({ kind: 'engine', detail: 'out of memory' })
    expect(viewAnswer({ content: 'Error: Something odd' }, { cloud: true }).error).toEqual({ kind: 'generic', detail: 'Something odd' })
  })
  it('knows a run the app cut off and a stream that broke from the finish reason', () => {
    expect(viewAnswer({ content: 'Start of it', finishReason: 'interrupted' })).toEqual({ body: 'Start of it', error: { kind: 'interrupted', detail: '' } })
    expect(viewAnswer({ content: INTERRUPTED_EMPTY_TEXT, finishReason: 'interrupted' })).toEqual({ body: '', error: { kind: 'interrupted', detail: '' } })
    expect(viewAnswer({ content: 'Start', finishReason: 'disconnect' })).toEqual({ body: 'Start', error: { kind: 'network', detail: '' } })
  })
  it('calls an answer without text and without thoughts empty', () => {
    expect(viewAnswer({ content: '  ' }).error?.kind).toBe('empty')
    expect(viewAnswer({ content: '', thinking: 'hm' }).error).toBeNull()
  })
  it('does not take an answer that only talks about errors for one', () => {
    const text = 'An "Error: x" line in the middle of a sentence is fine.'
    expect(viewAnswer({ content: text })).toEqual({ body: text, error: null })
  })
  it('answerBody is the text without the tail', () => {
    expect(answerBody({ content: 'Kept\n\nError: timeout' })).toBe('Kept')
  })
})

describe('guard: the chat hook writes the field where it writes the sentence', () => {
  it('imports the one function that builds the field', () => {
    expect(hook).toMatch(/import \{ messageErrorFor \} from '\.\.\/lib\/message-error'/)
  })
  it('the generic error branch of a send writes it right after the text', () => {
    expect(hook).toMatch(/run\.content \+ "\\n\\n" \+ errorMsg\s+\)[\s\S]{0,400}updateMessageError\(\s*run\.convId,\s*assistantMessage\.id,\s*messageErrorFor\(err, \{ cloud: isCloudRun \}, run\.content\)/)
  })
  it('the empty wallet branch writes it', () => {
    expect(hook).toMatch(/CREDITS_EXHAUSTED_MESSAGE\s+\)\s+useChatStore\.getState\(\)\.updateMessageError\(\s*run\.convId,\s*assistantMessage\.id,\s*messageErrorFor\(err, \{ cloud: isCloudRun \}, run\.content\)/)
  })
  it('a failed speaker of a group round writes it', () => {
    expect(hook).toMatch(/`Error from \$\{model\}: [\s\S]{0,400}updateMessageError\(\s*convId,\s*assistantMessage\.id,\s*messageErrorFor\(err, \{ cloud: getProviderIdFromModel\(model\) === 'lu-cloud' \}, ''\)/)
  })
  it('no place in the hook builds an "Error:" sentence without the field', () => {
    // Every template that starts an error sentence in this file, and every write of the field.
    const sentences = hook.match(/`Error(?: from \$\{model\})?: \$\{/g) ?? []
    const writes = hook.match(/updateMessageError\(/g) ?? []
    expect(sentences).toHaveLength(2)
    // Two error sentences, the credits sentence and the LU Cloud outage
    // (3.0.8, A28: the server's sentence, which no reader knows by its wording).
    expect(writes).toHaveLength(4)
  })
})
