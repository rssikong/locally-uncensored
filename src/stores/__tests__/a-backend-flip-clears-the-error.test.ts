import { describe, it, expect, beforeEach } from 'vitest'
import { useCreateStore } from '../createStore'

// How-to recording, 15.10.2026: "Use locally failed" from the Cloud shelf
// stood on in red after the flip to Local. An error belongs to its mode.
describe('a flip between Cloud and Local', () => {
  beforeEach(() => {
    useCreateStore.setState({ backend: 'cloud', error: null } as never)
  })

  it('clears an error of the mode it leaves', () => {
    useCreateStore.getState().setError('Use locally failed: the download stopped')
    useCreateStore.getState().setBackend('local')
    expect(useCreateStore.getState().error).toBeNull()
  })

  it('clears it on the way back to Cloud too', () => {
    useCreateStore.getState().setBackend('local')
    useCreateStore.getState().setError('ComfyUI stopped')
    useCreateStore.getState().setBackend('cloud')
    expect(useCreateStore.getState().error).toBeNull()
  })

  it('keeps the error when the mode does not change', () => {
    useCreateStore.getState().setError('Something went wrong')
    useCreateStore.getState().setBackend('cloud')
    expect(useCreateStore.getState().error).toBe('Something went wrong')
  })
})
