/**
 * "Always for this chat" on the Code mode's staged writes, said on a paired
 * phone (lib/remote-chats-bridge.ts). The desktop shows it while it holds:
 * for the run of that phone only.
 */
import { create } from 'zustand'

interface StagedAlwaysState {
  /** Chat id to the name of the phone that allowed the writes. */
  byChat: Record<string, string>
}

export const useStagedAlwaysStore = create<StagedAlwaysState>(() => ({ byChat: {} }))

export function setStagedAlways(convId: string, deviceName: string | null): void {
  useStagedAlwaysStore.setState((s) => {
    const byChat = { ...s.byChat }
    if (deviceName === null) delete byChat[convId]
    else byChat[convId] = deviceName
    return { byChat }
  })
}
