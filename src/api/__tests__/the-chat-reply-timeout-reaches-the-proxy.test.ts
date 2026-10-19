/**
 * Issue 177: the 600 s "sent nothing" limit is a setting now.
 *
 * The Rust proxy waited a fixed 600 s for the first chunk, which a 200K token
 * prompt with a cold cache runs past while the backend is working normally.
 * The limit lives in Settings, General, Chat Reply Timeout, and it only helps
 * if every stream carries it to the proxy, read when the request leaves.
 * Before this the invoke carried no such argument at all.
 *
 * Run: npx vitest run src/api/__tests__/the-chat-reply-timeout-reaches-the-proxy.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const invokeMock = vi.fn()
class MockChannel<T = unknown> {
  onmessage: (msg: T) => void = () => {}
}
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: MockChannel,
}))

import { localFetchStream } from '../backend'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { isRecord } from '../../types/json-guards'
import { chatFirstReplyMs, normalizeChatFirstReplySeconds } from '../../lib/chat-reply-timeout'

type Args = { onChunk: MockChannel<number[]>; firstChunkTimeoutMs?: number }

function tauriMode(on: boolean) {
  const existing: unknown = Reflect.get(globalThis, 'window')
  const w: Record<string, unknown> = isRecord(existing) ? existing : {}
  Reflect.set(globalThis, 'window', w)
  if (on) w.__TAURI_INTERNALS__ = {}
  else delete w.__TAURI_INTERNALS__
}

async function sentWindow(): Promise<number | undefined> {
  invokeMock.mockImplementationOnce((_cmd: string, args: Args) => {
    queueMicrotask(() => args.onChunk.onmessage([]))
    return new Promise(() => {})
  })
  await localFetchStream('http://127.0.0.1:8127/v1/chat/completions', { method: 'POST', body: '{}' })
  const call = invokeMock.mock.calls.find((c) => c[0] === 'proxy_localhost_stream_chunked')
  return (call?.[1] as Args | undefined)?.firstChunkTimeoutMs
}

beforeEach(() => {
  invokeMock.mockReset()
  tauriMode(true)
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
})
afterEach(() => tauriMode(false))

describe('the chat reply timeout reaches the Rust proxy', () => {
  it('the default is the 600 s everyone had before', async () => {
    expect(DEFAULT_SETTINGS.chatFirstReplyTimeoutSeconds).toBe(600)
    expect(await sentWindow()).toBe(600_000)
  })

  it('a long prompt setting of two hours goes out as two hours', async () => {
    useSettingsStore.getState().updateSettings({ chatFirstReplyTimeoutSeconds: 7200 })
    expect(await sentWindow()).toBe(7_200_000)
  })

  it('Off goes out as 0, which the proxy reads as wait while connected', async () => {
    useSettingsStore.getState().updateSettings({ chatFirstReplyTimeoutSeconds: 0 })
    expect(await sentWindow()).toBe(0)
  })
})

describe('stored values are cleaned before they reach the wire', () => {
  it('too small, too large, broken', () => {
    expect(normalizeChatFirstReplySeconds(5)).toBe(30)
    expect(normalizeChatFirstReplySeconds(10_000_000)).toBe(86_400)
    expect(normalizeChatFirstReplySeconds('x')).toBe(600)
    expect(normalizeChatFirstReplySeconds(-3)).toBe(0)
    expect(chatFirstReplyMs({})).toBe(600_000)
  })
})
