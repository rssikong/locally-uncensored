// @vitest-environment jsdom
/**
 * A request limit (HTTP 429) on the phone, in the chat and in Create.
 *
 * The one rule (lib/request-limit.ts): the sentence of the server is the
 * message itself, word for word, with no title above it. The app's own
 * sentence stands in only where the server sent none. The wait and Stop are
 * the desktop's: the same hooks run on the phone.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const phone = vi.hoisted(() => ({ on: true }))
vi.mock('../../lib/device-kind', async (orig) => ({ ...(await orig<typeof import('../../lib/device-kind')>()), isMobile: () => phone.on }))
vi.mock('../platform/clipboard', () => ({ copyText: async () => true }))

import { CloudJobError } from '../../api/cloud/jobs'
import { throttleMessage } from '../../hooks/useCloudCreate'
import { classifyRunError, viewAnswer } from '../../lib/message-error'
import { requestLimitMessage } from '../../lib/request-limit'
import { useRunActivityStore, waitBeforeRetry } from '../../stores/runActivityStore'
import type { Message } from '../../types/chat'
import { viewBlocks } from '../screens/agent/parts/blocks'
import { ErrorNotice } from '../screens/create/parts/ErrorNotice'
import { explainError } from '../screens/create/parts/errors'

const SERVER = 'This model is shared by all customers and is busy right now. Try again in 20 seconds. Nothing was charged.'

afterEach(() => {
  cleanup()
  phone.on = true
})

const SRC = join(__dirname, '..')
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}

describe('chat', () => {
  // What the provider layer throws for a 429: code rate_limit, the sentence chosen by lib/request-limit.ts.
  const thrown = (message: string) => Object.assign(new Error(message), { code: 'rate_limit', status: 429 })

  it('files a request limit as its own kind, with the sentence of the server as the reason', () => {
    expect(classifyRunError(thrown(SERVER), { cloud: true })).toEqual({ kind: 'limit', detail: SERVER })
  })

  it('does so whatever words the sentence holds', () => {
    // "connection" and "timed out" would read as a network error, "sign in again" as an ended session.
    for (const said of ['Too many requests on this connection. It timed out.', 'Limit reached. Sign in again later.']) {
      expect(classifyRunError(thrown(said), { cloud: true }).kind, said).toBe('limit')
    }
  })

  it('the reader hands the sentence to the box and keeps the answer text apart', () => {
    const message = { id: 'a', role: 'assistant', content: `Half an answer\n\nError: ${SERVER}`, error: { kind: 'limit', detail: SERVER, at: 14 } } as unknown as Message
    expect(viewAnswer(message, { cloud: true })).toEqual({ body: 'Half an answer', error: { kind: 'limit', detail: SERVER } })
  })

  it('the box of the chat draws the sentence alone: no title, and Try again', () => {
    const source = readFileSync(join(SRC, 'screens/chat/parts/MessageItem.tsx'), 'utf8')
    const box = source.slice(source.indexOf("case 'limit':"), source.indexOf("case 'interrupted':"))
    expect(box).toContain('<Notice variant="warn" testid="m-chat-error" actions={retry}>')
    expect(box).toContain('{error.detail}')
    expect(box).not.toContain('title=')
  })
})

describe('Create', () => {
  it('says the sentence of the server, word for word', () => {
    expect(throttleMessage(new CloudJobError(SERVER, 429, { retryAfterMs: 20_000 }))).toBe(SERVER)
  })

  it('says the sentence of lib/request-limit.ts where the server sent only the label', () => {
    const own = requestLimitMessage({ said: 'too many requests', retryAfterMs: 42_000, nothingCharged: true, again: 'try again' })
    expect(throttleMessage(new CloudJobError('too many requests', 429, { retryAfterMs: 42_000 }))).toBe(own)
    expect(own).toBe('The server is limiting requests right now. Please try again in about 42 seconds. Nothing was charged.')
  })

  it('leaves the three refusals about money as they are', () => {
    expect(throttleMessage(new CloudJobError('x', 429, { code: 'video_budget_exhausted' }))).toMatch(/video budget is used up/)
  })

  it('the desktop keeps its own sentence', () => {
    phone.on = false
    expect(throttleMessage(new CloudJobError(SERVER, 429, { retryAfterMs: 20_000 }))).toBe('Too many requests at once. Wait 20s and try again.')
  })

  it('the box shows that sentence alone, with no title above it, and offers to try again', () => {
    const message = throttleMessage(new CloudJobError(SERVER, 429, { retryAfterMs: 20_000 }))
    expect(explainError(message)).toMatchObject({ kind: 'too-fast', action: 'retry' })
    render(<ErrorNotice message={message} stillBooked={false} onRetry={() => {}} />)
    const box = screen.getByTestId('m-create-error')
    expect(box.querySelector('.m-note-title')).toBeNull()
    expect(box.textContent).toContain(SERVER)
    expect(screen.getByTestId('m-create-error-action').textContent).toBe('Try again')
    expect(screen.queryByTestId('m-create-error-copy')).toBeNull()
  })

  it('a sentence of the server that holds the words of another kind is still the limit', () => {
    const said = 'The network of this model is at its limit, your credits are safe. Try again in a minute.'
    expect(explainError(throttleMessage(new CloudJobError(said, 429))).kind).toBe('too-fast')
  })

  it('the guided run reads a 429 the same way', () => {
    const run = readFileSync(join(SRC, 'screens/create/parts/guided-run.ts'), 'utf8')
    expect(run).toContain('else if (err instanceof CloudJobError && err.status === 429) message = throttleMessage(err)')
  })

  it('the old title of the phone is gone', () => {
    const hits = files(SRC).filter((path) => !/__tests__/.test(path) && /Too many requests at once|tooFastTitle|tooFastText/.test(readFileSync(path, 'utf8')))
    expect(hits).toEqual([])
  })
})

describe('the wait of an agent run', () => {
  it('is shown on the phone: the line the run writes is a note of the answer', () => {
    const line = 'Rate limited by the server, which asked for 42 seconds. Waiting, then carrying on.'
    const view = viewBlocks({ thinking: '', agentBlocks: [{ id: 'w', phase: 'reflection', content: line, timestamp: 1 }] } as Pick<Message, 'thinking' | 'agentBlocks'>)
    expect(view.items).toEqual([{ kind: 'note', id: 'w', text: line, phase: 'reflection' }])
  })

  it('ends at once when Stop is pressed', async () => {
    vi.useFakeTimers()
    try {
      const stop = new AbortController()
      let done = false
      const wait = waitBeforeRetry('c1', 60_000, stop.signal).then(() => {
        done = true
      })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(done).toBe(false)
      expect(useRunActivityStore.getState().activity.c1?.kind).toBe('retrying')
      stop.abort()
      await wait
      expect(done).toBe(true)
      expect(useRunActivityStore.getState().activity.c1).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
