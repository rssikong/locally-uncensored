// @vitest-environment jsdom
// After a checkout and a sign in, the app lands on exactly the model that
// was clicked in the gate (3.0.7).
//
// Run: npx vitest run src/lib/__tests__/cloud-gate-landing.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { landOnGatePick } from '../cloud-gate-landing'
import { GATE_PICK_TTL_MS } from '../cloud-gate'
import { useCloudGateStore } from '../../stores/cloudGateStore'
import { useUIStore } from '../../stores/uiStore'
import { useCreateStore } from '../../stores/createStore'

beforeEach(() => {
  useCloudGateStore.setState({ pick: null })
  useUIStore.setState({ pendingCloudModel: null, currentView: 'models' })
})

describe('landing on the clicked model', () => {
  it('hands a chat model to the mode rule and opens the chat', () => {
    useCloudGateStore.getState().setPick({ model: 'moonshotai/Kimi-K3', category: 'chat', at: 1_000 })
    expect(landOnGatePick(2_000)).toBe(true)
    expect(useUIStore.getState().pendingCloudModel).toBe('lu-cloud::moonshotai/Kimi-K3')
    expect(useUIStore.getState().currentView).toBe('chat')
    expect(useCloudGateStore.getState().pick).toBeNull()
  })

  it('opens Create on the kind of the model with the model picked', () => {
    useCloudGateStore.getState().setPick({ model: 'wan-2.2-720p', category: 'create', kind: 'video', at: 1_000 })
    expect(landOnGatePick(2_000)).toBe(true)
    expect(useUIStore.getState().currentView).toBe('create')
    expect(useCreateStore.getState().cloudVideoModel).toBe('wan-2.2-720p')
    expect(useCreateStore.getState().intent()).toBe('video')

    useCloudGateStore.getState().setPick({ model: 'flux-dev', category: 'create', kind: 'image', at: 1_000 })
    landOnGatePick(2_000)
    expect(useCreateStore.getState().cloudImageModel).toBe('flux-dev')
    expect(useCreateStore.getState().intent()).toBe('image')

    useCloudGateStore.getState().setPick({ model: 'qwen-image-2.1-edit', category: 'create', kind: 'edit', at: 1_000 })
    landOnGatePick(2_000)
    expect(useCreateStore.getState().intent()).toBe('edit')
    expect(useCreateStore.getState().cloudOpModel).toBe('qwen-image-2.1-edit')
  })

  // Negative control: no pick, or one older than a week, steers nothing.
  it('does nothing without a fresh pick, and forgets a stale one', () => {
    expect(landOnGatePick(2_000)).toBe(false)
    useCloudGateStore.getState().setPick({ model: 'moonshotai/Kimi-K3', category: 'chat', at: 1_000 })
    expect(landOnGatePick(1_000 + GATE_PICK_TTL_MS)).toBe(false)
    expect(useUIStore.getState().pendingCloudModel).toBeNull()
    expect(useUIStore.getState().currentView).toBe('models')
    expect(useCloudGateStore.getState().pick).toBeNull()
  })
})
