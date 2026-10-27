import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../api/backend', () => ({ backendCall: vi.fn(), isTauri: () => true }))
import { backendCall } from '../../api/backend'
import { useMemoryStore } from '../memoryStore'
import { useRemoteStore, waitForMemoryHydration } from '../remoteStore'

const call = vi.mocked(backendCall)

afterEach(() => {
  vi.restoreAllMocks()
  useRemoteStore.setState({ enabled: false, loading: false, error: null, memoryNotice: null })
})

describe('Remote and the first load of the saved memory (A17)', () => {
  it('loading the memory after launch does not revoke a Remote session that already runs', async () => {
    call.mockReset().mockResolvedValue(undefined)
    useRemoteStore.setState({ enabled: true, loading: false })
    vi.spyOn(useMemoryStore.persist, 'hasHydrated').mockReturnValue(false)
    // What hydration does: replace the empty start state with what was saved.
    useMemoryStore.setState({ settings: { ...useMemoryStore.getState().settings } })
    await Promise.resolve()
    expect(call).not.toHaveBeenCalledWith('revoke_remote_memory')
  })

  it('an edit after hydration still revokes', async () => {
    call.mockReset().mockResolvedValue(undefined)
    useRemoteStore.setState({ enabled: true, loading: false })
    vi.spyOn(useMemoryStore.persist, 'hasHydrated').mockReturnValue(true)
    useMemoryStore.setState({ settings: { ...useMemoryStore.getState().settings } })
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('revoke_remote_memory'))
  })

  it('waitForMemoryHydration resolves on the hydration event, or after its time limit', async () => {
    vi.spyOn(useMemoryStore.persist, 'hasHydrated').mockReturnValue(false)
    let finish: (() => void) | undefined
    vi.spyOn(useMemoryStore.persist, 'onFinishHydration').mockImplementation((fn) => { finish = () => fn(useMemoryStore.getState()); return () => {} })
    let done = false
    const p = waitForMemoryHydration(10_000).then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    finish?.()
    await p
    expect(done).toBe(true)
    await waitForMemoryHydration(5) // no event: the time limit lets it go on
  })
})
