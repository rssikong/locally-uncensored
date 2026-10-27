// Does this device have the interface for Create in chat: the switch, the
// order card with its price, Start and Stop.
//
// Create in chat is more than two tools. The model lays out an order, the
// customer reads it on a card and approves it there. The phone has no such
// card yet. A model that carried the tools there would write orders nobody
// can see or start, and the app would add notes that promise a card ("the
// order appears here with its price").
//
// So the question is asked in front of everything that switches Create on:
// in hooks/useChat.ts where the turn decides it, and in hooks/useAgentChat.ts
// where the texts and the two claim guards live. The rules themselves are the
// mirrored ones in lib/create/chat-switch.ts, unchanged; this file only says
// whether they are asked at all.
//
// The stored switch (settings.createEnabled) can still arrive on a phone, in
// a backup that was written on a desktop. mobile/boot/restore.ts leaves it
// out, and even if it were there, nothing here would act on it.

import { isMobile } from './device-kind'
import { createActive, createChatLive } from './create/chat-switch'

/** True where the order card exists. Today: everywhere but the phone app. */
export function hasCreateOrderSurface(): boolean {
  return !isMobile()
}

/** `createChatLive` of the mirrored rules, asked only where the card exists. */
export function createLiveHere(...args: Parameters<typeof createChatLive>): boolean {
  return hasCreateOrderSurface() && createChatLive(...args)
}

/** `createActive` of the mirrored rules, asked only where the card exists. */
export function createActiveHere(...args: Parameters<typeof createActive>): boolean {
  return hasCreateOrderSurface() && createActive(...args)
}
