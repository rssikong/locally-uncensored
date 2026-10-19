import { useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  CHAT_FIRST_REPLY_DEFAULT_S, CHAT_FIRST_REPLY_MAX_S, CHAT_FIRST_REPLY_MIN_S, normalizeChatFirstReplySeconds,
} from '../../lib/chat-reply-timeout'

/**
 * Issue 177: how long a chat waits for the first byte of an answer from a
 * local backend. A number of seconds, or Off. The field keeps what is typed
 * until it loses focus, so typing 1200 does not snap to 30 on the first digit.
 */
export function ChatReplyTimeoutSettings() {
  const stored = useSettingsStore((s) => normalizeChatFirstReplySeconds(s.settings.chatFirstReplyTimeoutSeconds))
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [draft, setDraft] = useState<string | null>(null)
  const off = stored === 0
  return (
    <>
      <div className="text-[0.6rem] text-gray-500 dark:text-gray-500 leading-relaxed pb-1.5">
        Seconds a chat waits for the first word of an answer from a local backend before LU gives up. Loading a large model or reading a very long prompt can take longer than the default of 10 minutes. Off waits as long as the connection stays open. Stop always ends the wait.
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[0.7rem] text-gray-700 dark:text-gray-400">Chat reply timeout (s)</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[0.65rem] text-gray-500">
            <input
              type="checkbox"
              aria-label="Chat reply timeout off"
              checked={off}
              onChange={(e) => {
                setDraft(null)
                updateSettings({ chatFirstReplyTimeoutSeconds: e.target.checked ? 0 : CHAT_FIRST_REPLY_DEFAULT_S })
              }}
            />
            Off
          </label>
          <input
            aria-label="Chat reply timeout (s)"
            type="number"
            disabled={off}
            value={off ? '' : (draft ?? String(stored))}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft === null) return
              const n = parseInt(draft, 10)
              // An empty or zero field is not Off; Off is the checkbox.
              updateSettings({ chatFirstReplyTimeoutSeconds: Number.isFinite(n) && n > 0 ? normalizeChatFirstReplySeconds(n) : CHAT_FIRST_REPLY_DEFAULT_S })
              setDraft(null)
            }}
            min={CHAT_FIRST_REPLY_MIN_S}
            max={CHAT_FIRST_REPLY_MAX_S}
            placeholder={String(CHAT_FIRST_REPLY_DEFAULT_S)}
            className="w-20 px-1.5 py-0.5 rounded bg-transparent border border-white/8 text-[0.65rem] text-right text-gray-300 font-mono focus:outline-none focus:border-white/20 disabled:opacity-40"
          />
        </div>
      </div>
    </>
  )
}
