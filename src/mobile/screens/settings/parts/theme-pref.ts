/** The saved theme choice as a live value. The platform seam owns the storage. */
import { useSyncExternalStore } from 'react'
import { getThemePref, onThemeChange, type ThemePref } from '../../../platform'

export function useThemePref(): ThemePref {
  return useSyncExternalStore(
    (notify) => onThemeChange(() => notify()),
    getThemePref,
    () => 'system' as const,
  )
}
