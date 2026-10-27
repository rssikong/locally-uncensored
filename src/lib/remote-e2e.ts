/**
 * Device tests against a real desktop (src-tauri/src/e2e_remote.rs). Only a
 * build with the Cargo feature `e2e-remote`, started with its environment,
 * answers `remote_e2e_mode` with `active: true`; every other build has no
 * such command and this does nothing. When it is on, Remote starts in the
 * Wi-Fi by itself, the way "anywhere" starts it (hooks/useRemoteAnywhere.ts);
 * Rust then fixes the code, writes the pairing link and accepts the phones.
 * New chats are shared with the phone, so a device test finds them. With
 * `tunnel: true` (LU_E2E_REMOTE_TUNNEL=1) "reach this computer from anywhere"
 * goes on as well and the tunnel starts, as the real setting does it. With
 * `approvals: "ask"` (LU_E2E_REMOTE_APPROVALS=ask) the desktop asks before
 * shell commands and file writes (lib/remote-e2e-approvals.ts).
 */
import { backendCall, isTauri } from '../api/backend'

export interface RemoteE2eDeps {
  ask: () => Promise<unknown>
  running: () => boolean
  start: () => Promise<void>
  /** "Share new chats with paired phones" on (CHATS-V1.md). */
  shareNewChats: () => void
  /** "Reach this computer from anywhere" on, then the tunnel up. */
  startTunnel: () => Promise<void>
  /** Shell and file writes ask, in Agent and in Code. */
  askBeforeTools: () => void
}

async function realDeps(): Promise<RemoteE2eDeps> {
  const { useRemoteStore } = await import('../stores/remoteStore')
  return {
    ask: () => backendCall('remote_e2e_mode'),
    running: () => useRemoteStore.getState().enabled,
    start: () => useRemoteStore.getState().startServer(),
    shareNewChats: () => {
      void import('../stores/settingsStore').then(({ useSettingsStore }) => useSettingsStore.getState().updateSettings({ shareNewChatsWithPhone: true }))
    },
    askBeforeTools: () => {
      void import('./remote-e2e-approvals').then(({ askBeforeTools }) => askBeforeTools())
    },
    startTunnel: async () => {
      const store = useRemoteStore.getState()
      await store.setAnywhere(true)
      // As useRemoteAnywhere: nobody stands at the computer, no QR panel.
      useRemoteStore.getState().hideQr()
      if (!useRemoteStore.getState().tunnelActive) await useRemoteStore.getState().startTunnel()
    },
  }
}

/** True when the test mode is on and Remote runs (or was started). */
export async function startRemoteForDeviceTests(deps?: RemoteE2eDeps): Promise<boolean> {
  if (!deps && !isTauri()) return false
  const d = deps ?? await realDeps()
  let mode: unknown
  try {
    mode = await d.ask()
  } catch {
    return false // a build without the feature has no such command
  }
  if (!mode || typeof mode !== 'object' || (mode as { active?: unknown }).active !== true) return false
  d.shareNewChats()
  if ((mode as { approvals?: unknown }).approvals === 'ask') d.askBeforeTools()
  if (!d.running()) await d.start()
  if ((mode as { tunnel?: unknown }).tunnel === true) {
    try {
      await d.startTunnel()
    } catch {
      // The error is in the store and shows in the Remote panel.
    }
  }
  return true
}
