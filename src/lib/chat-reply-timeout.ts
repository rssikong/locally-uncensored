/**
 * How long a chat waits for the FIRST byte of an answer (issue 177).
 *
 * Before the first token the backend is either loading the model or reading
 * the prompt, and on a prompt of 200K tokens with a cold cache that alone
 * takes longer than the fixed 600 s the Rust proxy allowed. The limit is now a
 * setting: a number of seconds, or 0 for Off, which waits as long as the
 * connection stays open. Stop always ends the wait.
 *
 * Only the wait for the first byte is meant. Silence in the middle of an
 * answer keeps its own short limit (proxy.rs IDLE_TIMEOUT_MS, stream-idle.ts),
 * because a model that answered once and then went quiet has died.
 */

/** The limit everyone had before it was a setting. */
export const CHAT_FIRST_REPLY_DEFAULT_S = 600
/** Smallest number the field takes, so a typo cannot cut every load short. */
export const CHAT_FIRST_REPLY_MIN_S = 30
/** Largest number the field takes: 24 hours. Off goes beyond it. */
export const CHAT_FIRST_REPLY_MAX_S = 86_400

/** The error code of a chat whose first reply window ran out. The window has
 *  already been waited once when it arrives, so neither retry ladder may send
 *  the request again (api/backend.ts, api/providers/retry.ts,
 *  lib/http-status.ts). */
export const FIRST_REPLY_TIMEOUT = 'first_reply_timeout'

/** Any stored value as whole seconds: 0 (Off) or a number in range. */
export function normalizeChatFirstReplySeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CHAT_FIRST_REPLY_DEFAULT_S
  const s = Math.trunc(value)
  if (s <= 0) return 0
  return Math.min(CHAT_FIRST_REPLY_MAX_S, Math.max(CHAT_FIRST_REPLY_MIN_S, s))
}

/** The limit in ms for the transport, 0 = Off. */
export function chatFirstReplyMs(settings: { chatFirstReplyTimeoutSeconds?: unknown }): number {
  return normalizeChatFirstReplySeconds(settings.chatFirstReplyTimeoutSeconds ?? CHAT_FIRST_REPLY_DEFAULT_S) * 1000
}
