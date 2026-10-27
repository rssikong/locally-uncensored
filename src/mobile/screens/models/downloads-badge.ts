/**
 * SLOT in the tab bar, filled by strand 4 (Models and onboarding).
 *
 * A dot at the Models tab shows running downloads (DESIGN.md 2.3), and its
 * words go into the name of the tab: "Models, 1 download running".
 * MobileRoot calls this hook for as long as the app lives, so it is also
 * where the strand installs what has to run all the time (parts/watch.ts).
 */
import { useEffect } from 'react'
import { useDownloadStore } from '../../../stores/downloadStore'
import { MODELS_STRINGS as S } from '../../strings/models'
import type { TabBadge } from '../../ui/TabBar'
import { isActive } from './parts/download-state'
import { installModelsWatch } from './parts/watch'

export function activeDownloadCount(downloads: Record<string, { status: string }>): number {
  return Object.values(downloads).filter((row) => isActive(row as Parameters<typeof isActive>[0])).length
}

export function useDownloadsBadge(): TabBadge | null {
  const count = useDownloadStore((s) => activeDownloadCount(s.downloads))
  useEffect(() => {
    installModelsWatch()
  }, [])
  return count > 0 ? { description: S.models.badge(count) } : null
}
