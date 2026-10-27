import { useSettingsStore } from '../stores/settingsStore'

/**
 * Every folder the GGUF scan walks: the app models dir (Rust adds that one)
 * plus the folder the user named under Settings → Storage.
 *
 * GH #122 (2026-08-28): that setting was a download TARGET and
 * nothing else. A GGUF already sitting in it was never looked at, so the
 * Models tab stayed empty next to a folder full of models. Empty setting →
 * empty list, which is exactly the shipped single-folder scan.
 *
 * Lives here rather than in `api/engine` so `api/builtin-ensure`, which
 * engine imports, can read the same folders without an import cycle.
 */
export function customModelDirs(): string[] {
  const dir = useSettingsStore.getState().settings.hfDownloadPathOverride?.trim() || ''
  return dir ? [dir] : []
}
