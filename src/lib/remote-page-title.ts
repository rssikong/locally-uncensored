// GitHub #19: the name of the browser tab on the phone. The Rust remote
// server writes it into the page it serves (commands/remote.rs,
// page_with_title); Settings holds the text. Like the download limit, the
// Rust side forgets it on every launch, so it is handed over at boot and on
// every change, including a Reset.
import { backendCall, isTauri } from '../api/backend'
import { log } from './logger'
import { useSettingsStore } from '../stores/settingsStore'

/** The name the phone shows when Settings leaves the field empty. */
export const DEFAULT_REMOTE_PAGE_TITLE = 'AI Terminal'
/** Longest name, in characters. The Rust side caps at the same number. */
export const MAX_REMOTE_PAGE_TITLE = 60

export async function syncRemotePageTitle(title: string): Promise<void> {
  if (!isTauri()) return
  try {
    await backendCall('set_remote_page_title', { title: title ?? '' })
  } catch (err) {
    log.warn('remote_page_title.sync_failed', { err })
  }
}

export function startRemotePageTitleSync(): Promise<void> {
  useSettingsStore.subscribe((s, prev) => {
    if (s.settings.remotePageTitle !== prev.settings.remotePageTitle) {
      void syncRemotePageTitle(s.settings.remotePageTitle)
    }
  })
  return syncRemotePageTitle(useSettingsStore.getState().settings.remotePageTitle)
}
