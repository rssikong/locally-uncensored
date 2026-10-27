/**
 * Which segment the chat list shows: the chats on this phone, or the remote
 * desktop (R1, a segment of /chats and no page of its own).
 *
 * Kept here and not inside the chat list, so another page can lead to R1:
 *
 *   showChatsSegment('remote')   // go to the chat list, segment "Remote desktop"
 *
 * The segment survives leaving the tab and coming back, not a restart.
 */
import { create } from 'zustand'
import { navApi } from './api'
import { remoteDesktopOffered } from '../policy/gates'

export type ChatsSegment = 'phone' | 'remote'

interface ChatsSegmentState {
  segment: ChatsSegment
  setSegment: (segment: ChatsSegment) => void
}

export const useChatsSegment = create<ChatsSegmentState>((set) => ({
  segment: 'phone',
  // A build without Remote desktop has one segment only, whoever asks for the other.
  setSegment: (segment) => set({ segment: segment === 'remote' && !remoteDesktopOffered() ? 'phone' : segment }),
}))

/** Go to the root of the chat tab with this segment showing. */
export function showChatsSegment(segment: ChatsSegment): void {
  useChatsSegment.getState().setSegment(segment)
  navApi.resetTo('chat', [])
}
