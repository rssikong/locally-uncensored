/**
 * The recent-chats list on the empty chat screen.
 *
 * Ported from the web app. The owner asked
 * for the web behaviour: while the side panel is collapsed the latest chats
 * live in the main area, and the moment the panel is expanded they belong to
 * the panel again and disappear from here. ChatView owns that condition; this
 * component is only the list.
 */
import { motion } from 'framer-motion'
import { MOTION_S } from '../ui/motion'
import { MessageSquare } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useUIStore } from '../../stores/uiStore'
import { useCodexStore } from '../../stores/codexStore'
import { timeAgo } from '../../lib/time-ago'
import { conversationMode } from '../../lib/conversation-mode'

/** Same cut as the web list: newest first, eight rows. */
const MAX_ROWS = 8

/** GH #141: the list follows the mode picked in the rail, exactly
 *  like the expanded panel does (Sidebar.tsx filters its rows by chatMode).
 *  It used to show plain chats under Code and Remote too. */
const HEADING: Record<string, string> = {
  lu: 'Recent chats',
  codex: 'Recent code chats',
  remote: 'Recent remote chats',
  openclaw: 'Recent agent chats',
}
const EMPTY: Record<string, string> = {
  lu: 'No chats yet.',
  codex: 'No code chats yet.',
  remote: 'No remote chats yet.',
  openclaw: 'No agent chats yet.',
}
/** The open chat is the only one of its mode: there IS a chat, it is just
 *  not listed (it is where the user already is). "No chats yet" above the
 *  composer of that very chat read as wrong (how-it-works session, 3.0.7). */
const NO_OTHER: Record<string, string> = {
  lu: 'No other chats yet.',
  codex: 'No other code chats yet.',
  remote: 'No other remote chats yet.',
  openclaw: 'No other agent chats yet.',
}

export function RecentChats() {
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)
  const setView = useUIStore((s) => s.setView)
  const chatMode = useCodexStore((s) => s.chatMode)

  const recents = conversations
    // The chat you are already looking at is not a place to go back to. On the
    // no-chat screen nothing is active, so nothing is dropped there.
    .filter((c) => c.id !== activeConversationId)
    .filter((c) => conversationMode(c) === chatMode)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_ROWS)

  // Opening a row is what a click on the same row in the panel does: the
  // mode is already the right one (the list is filtered by it), so select the
  // conversation and land on the chat view.
  const openChat = (id: string) => {
    setActiveConversation(id)
    setView('chat')
  }

  if (recents.length === 0) {
    const openOneOnly = conversations.some((c) => c.id === activeConversationId && conversationMode(c) === chatMode)
    const line = openOneOnly ? (NO_OTHER[chatMode] ?? NO_OTHER.lu) : (EMPTY[chatMode] ?? EMPTY.lu)
    return (
      <p data-testid="home-recent-chats" className="t-micro text-gray-400 dark:text-gray-500">
        {line}
      </p>
    )
  }

  return (
    <motion.div
      data-testid="home-recent-chats"
      className="w-full max-w-[340px]"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION_S.base, ease: 'easeOut' }}
    >
      <div className="mb-1 px-1 t-label font-medium text-gray-400 dark:text-gray-600">
        {HEADING[chatMode] ?? HEADING.lu}
      </div>
      <ul>
        {recents.map((c, i) => (
          <motion.li
            key={c.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: MOTION_S.base, delay: 0.03 + i * 0.03, ease: 'easeOut' }}
          >
            <button
              type="button"
              onClick={() => openChat(c.id)}
              className="w-full flex items-center gap-2 rounded-md px-1.5 py-[5px] text-left hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors"
            >
              <MessageSquare size={11} className="shrink-0 text-gray-300 dark:text-gray-600" />
              <span className="flex-1 truncate t-micro text-gray-600 dark:text-gray-300">
                {c.title}
              </span>
              <span className="shrink-0 t-micro tabular-nums text-gray-300 dark:text-gray-600">
                {timeAgo(c.updatedAt)}
              </span>
            </button>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  )
}
