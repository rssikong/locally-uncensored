import { describe, it, expect } from 'vitest'
import { normalizeGpuRoles, gpuRolesSeparate, sameCard, NO_GPU_ROLES } from '../gpu-roles'

const a = { vendor: 'nvidia' as const, index: 0, name: 'RTX 4090' }
const b = { vendor: 'nvidia' as const, index: 1, name: 'RTX 3060' }

describe('gpu roles', () => {
  it('anything unreadable is no pick', () => {
    expect(normalizeGpuRoles(undefined)).toEqual(NO_GPU_ROLES)
    expect(normalizeGpuRoles('x')).toEqual(NO_GPU_ROLES)
    expect(normalizeGpuRoles({ chat: { vendor: 'apple', index: 0 } })).toEqual(NO_GPU_ROLES)
    expect(normalizeGpuRoles({ chat: { vendor: 'nvidia', index: -1 } })).toEqual(NO_GPU_ROLES)
    expect(normalizeGpuRoles({ chat: { vendor: 'nvidia', index: 1.5 } })).toEqual(NO_GPU_ROLES)
  })

  it('a stored pick survives, a missing name reads as empty', () => {
    expect(normalizeGpuRoles({ chat: a, comfy: { vendor: 'amd', index: '1' } })).toEqual({
      chat: a,
      comfy: { vendor: 'amd', index: 1, name: '' },
    })
  })

  it('apart only with both pinned to different cards', () => {
    expect(gpuRolesSeparate({ chat: a, comfy: b })).toBe(true)
    expect(gpuRolesSeparate({ chat: a, comfy: { ...a, name: 'other label' } })).toBe(false)
    expect(gpuRolesSeparate({ chat: a, comfy: null })).toBe(false)
    expect(gpuRolesSeparate({ chat: null, comfy: b })).toBe(false)
    expect(gpuRolesSeparate(undefined)).toBe(false)
    // Same index, other vendor: two different cards.
    expect(gpuRolesSeparate({ chat: a, comfy: { vendor: 'amd', index: 0, name: 'RX' } })).toBe(true)
    expect(sameCard(a, null)).toBe(false)
  })
})
