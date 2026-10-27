import type { RequestUsage } from '../../types/chat'
import { requestUsageLine } from '../../lib/request-usage'

/**
 * "1,234 in · 56 out" under an answer: what this request took, as the backend
 * reported it (lib/request-usage.ts). Draws nothing without real numbers.
 */
export function RequestUsageLine({ usage, className = '' }: { usage: RequestUsage | undefined; className?: string }) {
  const line = requestUsageLine(usage)
  if (!line) return null
  return (
    <span
      className={'t-micro tabular-nums text-gray-500 dark:text-gray-400 select-text ' + className}
      title={line.title}
      data-testid="request-usage"
    >
      {line.text}
    </span>
  )
}
