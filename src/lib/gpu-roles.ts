import type { GpuRef, GpuRoles } from '../types/settings'

/**
 * Which card each service runs on (3.0.8, A2, .molot's two-GPU wish).
 *
 * The Hardware tab used to have one pick for everything: the same
 * CUDA_VISIBLE_DEVICES went to Ollama, the LU Engine and ComfyUI, so a video
 * and the chat always shared a card. A role pins one service to one card. The
 * Rust side does the forwarding (commands/gpu.rs, `selection_for_role`); this
 * file is the part the app itself has to know: whether chat and ComfyUI are
 * apart, because then a generation has nothing to clear off the chat's card.
 */

const VENDORS = new Set(['nvidia', 'amd', 'intel'])

export const NO_GPU_ROLES: GpuRoles = { chat: null, comfy: null }

function normalizeRef(raw: unknown): GpuRef | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const index = Number(r.index)
  if (typeof r.vendor !== 'string' || !VENDORS.has(r.vendor)) return null
  if (!Number.isInteger(index) || index < 0) return null
  return { vendor: r.vendor as GpuRef['vendor'], index, name: typeof r.name === 'string' ? r.name : '' }
}

/** A stored value of any age as roles. Anything unreadable is "no pick". */
export function normalizeGpuRoles(raw: unknown): GpuRoles {
  if (!raw || typeof raw !== 'object') return { ...NO_GPU_ROLES }
  const r = raw as Record<string, unknown>
  return { chat: normalizeRef(r.chat), comfy: normalizeRef(r.comfy) }
}

export function sameCard(a: GpuRef | null, b: GpuRef | null): boolean {
  return !!a && !!b && a.vendor === b.vendor && a.index === b.index
}

/**
 * Chat and ComfyUI are pinned to two different cards. Only then is the VRAM
 * hand-off pointless: with one of them unpinned it may still land on the
 * other's card, so the old rules keep applying.
 */
export function gpuRolesSeparate(roles: GpuRoles | null | undefined): boolean {
  if (!roles?.chat || !roles.comfy) return false
  return !sameCard(roles.chat, roles.comfy)
}
