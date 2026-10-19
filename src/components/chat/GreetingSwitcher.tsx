import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Message } from '../../types/chat'
import { useChatStore } from '../../stores/chatStore'

/**
 * Arrows under the opening message of a character card chat, to pick one of
 * the card's greetings (3.0.7). MessageList shows it only while the greeting
 * is the last message; chatStore.selectGreeting refuses later swaps anyway.
 */
export function GreetingSwitcher({ conversationId, message }: { conversationId: string; message: Message }) {
  const selectGreeting = useChatStore((s) => s.selectGreeting)
  const total = message.greetings?.length ?? 0
  if (total < 2) return null
  const index = Math.min(Math.max(message.greetingIndex ?? 0, 0), total - 1)
  const go = (next: number) => selectGreeting(conversationId, message.id, (next + total) % total)
  const btn = 'p-0.5 rounded text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors'
  return (
    <div className="flex items-center gap-1 px-4 -mt-1 mb-2 t-micro text-gray-500" data-testid="greeting-switcher">
      <button type="button" className={btn} onClick={() => go(index - 1)} aria-label="Previous greeting" title="Previous greeting">
        <ChevronLeft size={12} />
      </button>
      <span className="tabular-nums">{index + 1} / {total}</span>
      <button type="button" className={btn} onClick={() => go(index + 1)} aria-label="Next greeting" title="Next greeting">
        <ChevronRight size={12} />
      </button>
    </div>
  )
}
