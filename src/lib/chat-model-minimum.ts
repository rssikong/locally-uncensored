import type { DiscoverModel } from '../api/model-bundles'
import { isMobile } from './device-kind'

export const SMALL_CHAT_MODEL_WARNING = 'Below 7B: for local loading tests and experiments only. Not recommended for chat or agent work. Choose a model with at least 7B parameters.'

/** Read parameter-count tags, never file sizes or MoE active-parameter counts. */
export function isBelowChatMinimum(model: Pick<DiscoverModel, 'tags'>): boolean {
  // A phone runs models below 7B on purpose: they are the ones that fit. The
  // warning (and the filter built on it) is desktop advice.
  if (isMobile()) return false
  return model.tags.some(tag => {
    const match = /^(\d+(?:\.\d+)?)B$/i.exec(tag.trim())
    return match !== null && Number(match[1]) > 0 && Number(match[1]) < 7
  })
}

export function chatRecommendationGroups(groups: DiscoverModel[][]): DiscoverModel[][] {
  return groups.filter(group => group.length > 0 && group.every(model => !isBelowChatMinimum(model)))
}

export interface ChatSizeCandidate {
  name: string
  model?: string
  type?: string
  details?: { parameter_size?: string }
}

/** Prefer explicit provider metadata; names are a fallback, never byte sizes. */
export function installedChatSizeB(model: ChatSizeCandidate): number | null {
  const stated = model.details?.parameter_size?.trim()
  if (stated) {
    const match = /^(\d+(?:\.\d+)?)\s*([BM])$/i.exec(stated)
    if (match) {
      const count = Number(match[1]) / (match[2].toUpperCase() === 'M' ? 1000 : 1)
      if (Number.isFinite(count) && count > 0) return count
    }
  }
  // Require a boundary before the count so A3B is not read as total size.
  const match = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?=$|[^a-z0-9])/i.exec(model.model || model.name)
  const count = match ? Number(match[1]) : null
  return count !== null && Number.isFinite(count) && count > 0 ? count : null
}

export function canAutoSelectChat(model: ChatSizeCandidate): boolean {
  if (model.type === 'image' || model.type === 'video') return false
  // On a phone every local text model may be the automatic choice. With the
  // 7B floor the app never picked a model there by itself, because nothing
  // that fits a phone reaches 7B.
  if (isMobile()) return true
  const count = installedChatSizeB(model)
  return count !== null && count >= 7
}
