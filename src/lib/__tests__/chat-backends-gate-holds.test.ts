import { describe, it, expect, vi } from 'vitest'
import { holdChatBackends, chatBackendsBack, chatBackendsHeldBy, onChatBackendsHold, setChatBackendsRestore } from '../chat-backends-gate'

describe('a render that took the chat model off the card holds the chat requests (A2)', () => {
  it('nothing held: a request goes straight through', async () => {
    expect(chatBackendsHeldBy()).toBeNull()
    await expect(chatBackendsBack()).resolves.toBeUndefined()
  })

  it('a request waits until the hold is released, then the parked restore runs', async () => {
    const restore = vi.fn(async () => {})
    const release = holdChatBackends('video')
    expect(chatBackendsHeldBy()).toBe('video')
    let through = false
    const req = chatBackendsBack().then(() => { through = true })
    await new Promise((r) => setTimeout(r, 5))
    expect(through).toBe(false)
    setChatBackendsRestore(restore)
    release()
    await req
    expect(through).toBe(true)
    expect(restore).toHaveBeenCalledTimes(1)
    setChatBackendsRestore(null)
    expect(chatBackendsHeldBy()).toBeNull()
  })

  it('release is idempotent and listeners hear start and end', () => {
    const heard = vi.fn()
    const off = onChatBackendsHold(heard)
    const release = holdChatBackends('image')
    release()
    release()
    off()
    expect(heard).toHaveBeenCalledTimes(2)
    expect(chatBackendsHeldBy()).toBeNull()
  })

  it('a video hold is named over a picture hold', () => {
    const a = holdChatBackends('image')
    const b = holdChatBackends('video')
    expect(chatBackendsHeldBy()).toBe('video')
    b(); a()
  })
})
