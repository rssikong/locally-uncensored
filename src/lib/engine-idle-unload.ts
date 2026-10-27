// Unload the LU Engine's chat model after a while without use (Discord,
// 21.10.2026: a large model held most of a 32 GB PC's memory while nobody
// chatted). The watch lives in Rust (commands/engine_idle.rs) and asks the
// engine itself whether anybody used it; Settings holds the minutes. This hands
// them over at boot and on every change, and says it in the standing line when
// the engine was unloaded.
import { backendCall, isTauri } from '../api/backend'
import { log } from './logger'
import { useSettingsStore } from '../stores/settingsStore'
import { useLuEngineSwitchStore } from '../stores/luEngineSwitchStore'

/** The choices Settings offers, in minutes. 0 is never. */
export const ENGINE_IDLE_UNLOAD_CHOICES = [0, 10, 30, 60, 120] as const

/** Rust's event after an unload (`ENGINE_IDLE_UNLOADED_EVENT`). */
export const ENGINE_IDLE_UNLOADED_EVENT = 'lu-engine-idle-unloaded'

/** The minutes a stored value stands for: absent, broken or negative is never. */
export function idleUnloadMinutes(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/** What a choice reads as in Settings. */
export function idleUnloadLabel(minutes: number): string {
  if (minutes <= 0) return 'Never'
  if (minutes % 60 === 0) return minutes === 60 ? 'After 1 hour' : `After ${minutes / 60} hours`
  return `After ${minutes} minutes`
}

/** The sentence after an unload. */
export function idleUnloadedNote(minutes: number): string {
  const span = minutes % 60 === 0 ? (minutes === 60 ? '1 hour' : `${minutes / 60} hours`) : `${minutes} minutes`
  return `The LU Engine unloaded the model after ${span} without use, so its memory is free. The next message loads it again.`
}

export async function syncEngineIdleUnload(minutes: number): Promise<void> {
  if (!isTauri()) return
  try {
    await backendCall('set_engine_idle_unload', { minutes: idleUnloadMinutes(minutes) })
  } catch (err) {
    log.warn('engine_idle_unload.sync_failed', { err })
  }
}

/** At boot: Rust starts at never on every launch, so it gets the stored value
 *  now and again on every change, including a Reset. */
export function startEngineIdleUnloadSync(): Promise<void> {
  useSettingsStore.subscribe((s, prev) => {
    if (s.settings.engineIdleUnloadMinutes !== prev.settings.engineIdleUnloadMinutes) {
      void syncEngineIdleUnload(idleUnloadMinutes(s.settings.engineIdleUnloadMinutes))
    }
  })
  if (isTauri()) {
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen<{ minutes?: number }>(ENGINE_IDLE_UNLOADED_EVENT, (e) => {
        useLuEngineSwitchStore.getState().announce(idleUnloadedNote(idleUnloadMinutes(e.payload?.minutes)), 'info')
      }))
      .catch((err) => log.warn('engine_idle_unload.listen_failed', { err }))
  }
  return syncEngineIdleUnload(idleUnloadMinutes(useSettingsStore.getState().settings.engineIdleUnloadMinutes))
}
