import { useSyncExternalStore } from 'react'
import { useChatStore } from '../../../../stores/chatStore'

function subscribeHydration(notify: () => void): () => void {
  try {
    return useChatStore.persist.onFinishHydration(notify)
  } catch {
    return () => {}
  }
}

function hasHydrated(): boolean {
  try {
    return useChatStore.persist.hasHydrated()
  } catch {
    return true
  }
}

/** False until the chats were read from storage. Until then a list is "loading", not "empty". */
export function useChatsHydrated(): boolean {
  return useSyncExternalStore(subscribeHydration, hasHydrated, () => true)
}
