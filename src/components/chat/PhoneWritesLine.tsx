import { Smartphone } from 'lucide-react'
import { useStagedAlwaysStore } from '../../lib/remote-staged-always'

/** "Writes in this chat are approved from <phone>": shown while a paired
 *  phone's "always for this chat" holds (lib/remote-staged-always.ts). */
export function PhoneWritesLine({ chatId }: { chatId: string | null }) {
  const name = useStagedAlwaysStore((s) => (chatId ? s.byChat[chatId] : undefined))
  if (!name) return null
  return (
    <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 border-b border-gray-200 dark:border-white/[0.04]" role="status" data-testid="phone-writes-line">
      <Smartphone size={10} className="text-gray-500 dark:text-gray-400" />
      <span className="t-micro text-gray-700 dark:text-gray-300 truncate">Writes in this chat are approved from <bdi>{name}</bdi></span>
    </div>
  )
}
