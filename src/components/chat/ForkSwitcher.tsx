import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * "< 1/2 >" at a message whose continuation has kept versions (GH #172,
 * #174): an edit that was resent, or a regenerated answer. The arrows stop at
 * the ends instead of wrapping, so 1 and the last version read as the ends of
 * a row, the way other chat apps show them. Without `onSwitch` (a turn is
 * streaming) the arrows are off and the count still says what exists.
 */
export function ForkSwitcher({ forkKey, index, total, onSwitch, align }: {
  forkKey: string
  index: number
  total: number
  onSwitch?: (key: string, index: number) => void
  align: 'start' | 'end'
}) {
  const btn = 'p-0.5 rounded text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-40 disabled:hover:bg-transparent transition-colors'
  return (
    <div
      className={'flex items-center gap-1 t-micro text-gray-500 ' + (align === 'end' ? 'justify-end pr-0.5' : 'justify-start pl-0.5')}
      data-testid="fork-switcher"
      role="group"
      aria-label={`Version ${index + 1} of ${total}`}
    >
      <button type="button" className={btn} disabled={!onSwitch || index <= 0} onClick={() => onSwitch?.(forkKey, index - 1)} aria-label="Previous version" title="Previous version">
        <ChevronLeft size={12} />
      </button>
      <span className="tabular-nums">{index + 1}/{total}</span>
      <button type="button" className={btn} disabled={!onSwitch || index >= total - 1} onClick={() => onSwitch?.(forkKey, index + 1)} aria-label="Next version" title="Next version">
        <ChevronRight size={12} />
      </button>
    </div>
  )
}
