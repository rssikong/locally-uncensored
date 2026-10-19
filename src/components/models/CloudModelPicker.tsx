import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Eye, Lightbulb, LockOpen, Search, X } from 'lucide-react'
import { usePopoverPlatz } from '../../hooks/usePopoverPlatz'
import { displayModelName } from '../../api/providers'
import { formatContextWindow } from '../../lib/formatters'
import { FLASH_MARK_LABEL, flashMarkTitle, useFlashEntitlement } from '../../lib/flash-entitlement'
import { STATEMENT_MARK_LABEL, UNFILTERED_MARK_LABEL } from '../../lib/unfiltered-mark'
import { BetaMark } from '../ui/BetaMark'
import { log } from '../../lib/logger'
import {
  LIMITED_CAPACITY_LABEL, LIMITED_CAPACITY_TITLE, PICKER_FILTERS, filterCounts, filterRows, formatCreditRate, highlightParts, moveCursor, pickerGroups, pickerRows,
  searchTokens,
  type PickerFilter, type PickerGroup, type PickerRow,
} from '../../lib/model-picker'
import type { AIModel } from '../../types/models'
import { ModelPickerSkeleton } from '../layout/ViewSkeletons'
import { ModelRowMarks } from './ModelRowMarks'

/**
 * The chat model picker in Cloud mode, for Chat, Agent and Code.
 *
 * 05.10.2026: grouped by model family under one-line sticky heads, a
 * search on top, filter chips, a footer with the count and the keys. A row
 * reads name, the measured mark, vision, thinking and the context window the
 * server stated. There is no credit column: a small question mark per row
 * opens the model's credit rates per one million tokens.
 *
 * This component draws the inside of the menu. The menu itself (the sheet, its
 * place next to the trigger, opening and closing, what a pick does) stays with
 * ModelSelector, which also draws the local list. What a row shows and how the
 * list narrows is decided in lib/model-picker.
 */

/** The width of the menu in Cloud mode, in the app's own pixels. */
export const CLOUD_PICKER_WIDTH = 400
/** Never taller than this, and never taller than the room next to the trigger. */
export const CLOUD_PICKER_MAX_HEIGHT = 520

/** What the list is not showing in Cloud mode, and how to get it back (G20:
 *  the silence used to read as "my local models are gone"). */
export const CLOUD_MODE_LIST_NOTE =
  'Cloud mode shows hosted models only. Switch the app to Local mode to use Ollama, LM Studio or the LU Engine.'

// A full agent tool set is about 5k tokens of definitions before the
// conversation starts, so a 4k model calls tools in Chat but cannot carry
// Agent or Code. Saying that on the context figure beats letting the user find
// out from the upstream's own words after the first message.
const TIGHT_CONTEXT = 8192

function contextTitle(ctx: number): string | undefined {
  return ctx < TIGHT_CONTEXT
    ? `A ${formatContextWindow(ctx)} context window is too small for a full Agent or Code tool set`
    : undefined
}

const FILTER_LABEL: Record<PickerFilter, string> = {
  marked: UNFILTERED_MARK_LABEL,
  vision: 'Vision',
  thinking: 'Thinking',
  free: FLASH_MARK_LABEL,
}

const FILTER_ICON: Partial<Record<PickerFilter, typeof Eye>> = {
  marked: LockOpen,
  vision: Eye,
  thinking: Lightbulb,
}

/** One line under the search for what needs attention now. */
export interface PickerNote {
  testId: string
  text: string
  tone: 'info' | 'error'
  onDismiss?: () => void
}

export interface CloudModelPickerProps {
  /** The text models this surface offers. */
  models: AIModel[]
  activeModel: string | null
  /** No model list has arrived yet. */
  loading: boolean
  notes: PickerNote[]
  /** Hosted models left out here because Code cannot use them. */
  hiddenForCode: number
  /** What the list says when it holds no model at all. */
  empty: ReactNode
  /** The scrolling list, for the menu's own placement. */
  listRef: RefObject<HTMLDivElement | null>
  onPick: (model: AIModel) => void
  /** The element that had the keyboard before the search field took it. */
  onTookFocus: (from: HTMLElement | null) => void
}

/** The rows, or a flat list of bare names when building them threw. A single
 *  malformed entry must not take the chat view down with it (K6, 3.0.1). */
function safeRows(models: AIModel[], paidPlan: boolean | null): PickerRow[] {
  try {
    return pickerRows(models, paidPlan)
  } catch (e) {
    log.error('[CloudModelPicker] building the rows threw, showing bare names', { err: e, modelCount: models.length })
    return models.filter((m) => m.type === 'text').map((model) => ({
      name: model.name, model, label: displayModelName(model.name), family: 'Other',
      mark: null, vision: false, thinking: null, free: null, context: null, rates: null, chatOnly: false, limitedCapacity: false, quietNote: null,
    }))
  }
}

// The question mark of a row and what it opens.
//
// HARD RULE: credits per token count only. Never a money amount, never how
// many tokens a sum of money buys. The figures are the server's
// (`credit_rates` of the models route); a server that does not send them
// gives the row no question mark at all.
//
// Placed by the app's one placement rule (hooks/usePopoverPlatz, GitHub #149)
// and lifted out of the list, so neither the list's own edge nor the window's
// can cut it.
function RateControl({ row, open, tabbable, popId, onToggle }: {
  row: PickerRow
  open: boolean
  tabbable: boolean
  popId: string
  onToggle: () => void
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const lage = usePopoverPlatz(popRef, open, { anker: buttonRef, fest: 'rechts', abstand: 4, luft: 8 })
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="lu-picker-rate-btn"
        tabIndex={tabbable ? 0 : -1}
        data-model-rate
        // The row's name stays out of the label on purpose: the row already
        // says it, and a second button carrying it would answer to the same
        // name as the one that picks the model.
        aria-label="Credit rates"
        title={`Credit rates of ${row.label}`}
        aria-expanded={open}
        aria-describedby={open ? popId : undefined}
        onClick={onToggle}
      >
        ?
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          id={popId}
          role="tooltip"
          data-model-rate
          data-testid="model-rate-popover"
          className="lu-picker-rate"
          style={lage.style}
        >
          {row.free ? (
            <span>{flashMarkTitle(row.free.dailyTokens)}</span>
          ) : row.rates && (
            <>
              <h4>Credits per 1M tokens</h4>
              <dl>
                <dt>Input</dt>
                <dd data-rate="input">{formatCreditRate(row.rates.inputPerMillion)}</dd>
                <dt>Output</dt>
                <dd data-rate="output">{formatCreditRate(row.rates.outputPerMillion)}</dd>
              </dl>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

export function CloudModelPicker({
  models, activeModel, loading, notes, hiddenForCode, empty, listRef, onPick, onTookFocus,
}: CloudModelPickerProps) {
  const paidPlan = useFlashEntitlement()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<ReadonlySet<PickerFilter>>(new Set())
  /** The row whose rates are shown. */
  const [rate, setRate] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const uid = useId()
  const optionId = (index: number) => `${uid}-option-${index}`

  const rows = useMemo(() => safeRows(models, paidPlan), [models, paidPlan])
  const counts = useMemo(() => filterCounts(rows), [rows])
  const tokens = useMemo(() => searchTokens(query), [query])
  const groups: PickerGroup[] = useMemo(
    () => pickerGroups(filterRows(rows, query, filters), tokens.length > 0),
    [rows, query, filters, tokens],
  )
  const visible = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const chips = PICKER_FILTERS.filter((f) => counts[f] > 0)

  // The keyboard cursor. It starts on the selected model, so Enter confirms it
  // and the arrows start from where the user is. `null` until the user moves
  // it or narrows the list: the list may still be arriving when the menu
  // opens, and a fixed number from the first render would point at whatever
  // row happens to stand there later.
  const [moved, setMoved] = useState<number | null>(null)
  const selectedAt = visible.findIndex((r) => r.name === activeModel)
  const cursor = Math.min(moved ?? Math.max(0, selectedAt), Math.max(0, visible.length - 1))
  /** Set when the cursor moved by key or by opening, so the list follows it.
   *  A cursor that follows the mouse must not scroll the list under it. */
  const followCursor = useRef(true)

  // The search field takes the keyboard when the menu opens: typing filters,
  // the arrows move, Enter picks. Who had it before is handed up, so the menu
  // can give it back when it closes.
  useEffect(() => {
    const before = document.activeElement
    // An effect can run twice (React's strict mode does that on purpose). The
    // second time the field already has the keyboard, and it is not where the
    // keyboard came from.
    if (before !== inputRef.current) onTookFocus(before instanceof HTMLElement ? before : null)
    inputRef.current?.focus({ preventScroll: true })
    // Once, on the way in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the cursor row in view. Done by hand on the list alone:
  // scrollIntoView would also move every scrolling ancestor of the menu.
  useEffect(() => {
    if (!followCursor.current) return
    const list = listRef.current
    const el = document.getElementById(optionId(cursor))
    if (!list || !el) return
    followCursor.current = false
    // 24 px is the sticky group head a row must not hide under.
    const top = el.offsetTop - 24
    const bottom = el.offsetTop + el.offsetHeight
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top)
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
    // optionId is stable for the life of the menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, visible.length, listRef])

  const narrow = (next: { query?: string; filters?: ReadonlySet<PickerFilter> }) => {
    if (next.query !== undefined) setQuery(next.query)
    if (next.filters) setFilters(next.filters)
    followCursor.current = true
    setMoved(0)
    setRate(null)
  }

  const toggleFilter = (f: PickerFilter) => {
    const next = new Set(filters)
    if (next.has(f)) next.delete(f)
    else next.add(f)
    narrow({ filters: next })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Escape goes one step back at a time: the rates, then the search, and
      // only then the menu itself. Stopped here, the event does not reach the
      // menu's own Escape (hooks/useDismissOnEscape listens on the document).
      if (rate) { e.stopPropagation(); setRate(null); return }
      if (query) { e.stopPropagation(); narrow({ query: '' }); inputRef.current?.focus() }
      return
    }
    const inSearch = e.target === inputRef.current
    if (e.key === 'Enter') {
      if (!inSearch) return
      e.preventDefault()
      if (visible[cursor]) onPick(visible[cursor].model)
      return
    }
    // Home and End move the caret while the field holds text.
    const next = moveCursor(cursor, e.key, visible.length, inSearch && query.length > 0)
    if (next === null) return
    e.preventDefault()
    followCursor.current = true
    setRate(null)
    setMoved(next)
    // The arrows belong to the list wherever the keyboard stands in the menu.
    if (!inSearch) inputRef.current?.focus()
  }

  let index = -1

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // A press anywhere but on a question mark puts the rates away.
        if (rate && !(e.target as HTMLElement).closest('[data-model-rate]')) setRate(null)
      }}
    >
      <div className="lu-picker-search">
        <Search size={13} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={`${uid}-list`}
          aria-activedescendant={visible[cursor] ? optionId(cursor) : undefined}
          aria-label="Search models"
          placeholder="Search models"
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => narrow({ query: e.target.value })}
          data-testid="model-picker-search"
        />
        {query && (
          <button
            type="button"
            className="lu-picker-text-btn"
            onClick={() => { narrow({ query: '' }); inputRef.current?.focus() }}
          >
            Clear
          </button>
        )}
      </div>

      {notes.map((note) => (
        <div
          key={note.testId}
          className={`lu-picker-note${note.tone === 'error' ? ' is-err' : ''}`}
          data-tone={note.tone}
        >
          <span className={`lu-picker-dot ${note.tone === 'error' ? 'is-err' : 'is-accent'}`} />
          <span data-testid={note.testId}>{note.text}</span>
          {note.onDismiss && (
            <button
              type="button"
              className="lu-picker-text-btn"
              onClick={note.onDismiss}
              aria-label="Dismiss"
              title="Dismiss"
            >
              <X size={10} />
            </button>
          )}
        </div>
      ))}

      {chips.length > 0 && (
        <div className="lu-picker-chips" role="group" aria-label="Narrow the list">
          {chips.map((f) => {
            const Icon = FILTER_ICON[f]
            return (
              <button
                key={f}
                type="button"
                className="lu-picker-chip"
                aria-pressed={filters.has(f)}
                data-chip={f}
                onClick={() => toggleFilter(f)}
              >
                {Icon && <Icon size={11} aria-hidden="true" />}
                {FILTER_LABEL[f]} <i>{counts[f]}</i>
              </button>
            )
          })}
        </div>
      )}

      {rows.some((r) => r.context !== null) && (
        <div className="lu-picker-cap" aria-hidden="true">
          <span>Model</span>
          <span>Context</span>
        </div>
      )}

      <div
        ref={listRef}
        id={`${uid}-list`}
        role="listbox"
        aria-label="Models"
        className="lu-picker-list"
        onScroll={(e) => {
          // The rates follow their question mark while the list scrolls, and
          // go away once that row has left the list's window.
          if (!rate) return
          const button = e.currentTarget.querySelector('.lu-picker-rate-btn[aria-expanded="true"]')
          if (!button) return
          const list = e.currentTarget.getBoundingClientRect()
          const b = button.getBoundingClientRect()
          if (b.bottom < list.top || b.top > list.bottom) setRate(null)
        }}
      >
        {loading && rows.length === 0 && <ModelPickerSkeleton />}
        {!loading && rows.length === 0 && empty}
        {rows.length > 0 && visible.length === 0 && (
          <p className="lu-picker-empty" data-testid="model-picker-no-match">
            No models match. Clear the search or a tag.
          </p>
        )}

        {groups.map((group) => (
          <div key={group.family ?? 'all'} role="presentation">
            {group.family && (
              <div className="lu-picker-head" role="presentation" data-family={group.family}>
                <b>{group.family}</b>
                {/* One mark for the whole group, none on its rows. */}
                {group.family === STATEMENT_MARK_LABEL && <BetaMark feature="direct-models" />}
                <span className="n">{group.rows.length}</span>
              </div>
            )}

            {group.rows.map((row) => {
              index += 1
              const at = index
              const isActive = row.name === activeModel
              const ctx = row.context
              const lead = (
                <>
                  <span className="lu-picker-name">
                    {highlightParts(row.label, tokens).map((part, i) =>
                      part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>)}
                  </span>
                  {/* The mark from the catalogue, out of the one component
                      that draws it everywhere. */}
                  <ModelRowMarks
                    model={{ unfiltered: row.mark === 'measured' ? 'full' : undefined, unrestricted: row.mark === 'statement' }}
                    row
                  />
                  {row.chatOnly && (
                    <span
                      className="t-micro lu-picker-tag"
                      title="This model does not support tool calling, so Agent and Code mode cannot use it"
                      data-mark="chat-only"
                    >
                      Chat only
                    </span>
                  )}
                </>
              )
              return (
                /* The part that picks the model is a <button>; the rate
                   control is a button of its own NEXT to it, because no
                   browser allows one inside another. The keyboard reaches a
                   row through the cursor (arrows, then Enter), so the pick
                   button stays out of the Tab order and Tab walks the
                   controls instead of every row. */
                <div
                  key={row.name}
                  id={optionId(at)}
                  role="option"
                  aria-selected={isActive}
                  data-cursor={at === cursor}
                  className="lu-picker-row"
                  title={displayModelName(row.name)}
                  onMouseMove={() => { if (at !== cursor) setMoved(at) }}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    className="lu-picker-pick"
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => onPick(row.model)}
                  >
                    {row.limitedCapacity ? (
                      /* The note about the model's room: plain muted text,
                         on purpose no tag, because it is no mark. It stands
                         after the name where the row has the room and under
                         it where it has not, so neither is cut. */
                      <span className="lu-picker-lead">
                        {lead}
                        <span className="lu-picker-quiet" title={LIMITED_CAPACITY_TITLE} data-note="limited-capacity">
                          {LIMITED_CAPACITY_LABEL}
                        </span>
                      </span>
                    ) : row.quietNote ? (
                      <span className="lu-picker-lead">
                        {lead}
                        <span className="lu-picker-quiet" data-note="quiet">{row.quietNote}</span>
                      </span>
                    ) : lead}
                    <span className="lu-picker-fill" />
                    <span className="lu-picker-icons">
                      <span title={row.vision ? 'Reads images' : undefined} data-icon={row.vision ? 'vision' : undefined}>
                        {row.vision && <Eye size={14} aria-label="Reads images" />}
                      </span>
                      <span
                        title={row.thinking === 'always' ? 'Always thinks before it answers'
                          : row.thinking === 'toggle' ? 'Can think before it answers' : undefined}
                        data-icon={row.thinking ? 'thinking' : undefined}
                      >
                        {row.thinking && <Lightbulb size={14} aria-label="Thinks before it answers" />}
                      </span>
                    </span>
                    {/* Only a context window the server stated is printed. A
                        model nobody stated one for keeps the cell empty. */}
                    <span className="lu-picker-num" title={ctx === null ? undefined : contextTitle(ctx)} data-context>
                      {ctx === null ? '' : formatContextWindow(ctx)}
                    </span>
                  </button>

                  {/* No rates from the server and no free allowance: nothing
                      true to show, so no question mark. The slot keeps its
                      width, the context column stays in line. */}
                  <span className="lu-picker-rate-anchor">
                    {(row.rates || row.free) && (
                      <RateControl
                        row={row}
                        open={rate === row.name}
                        tabbable={at === cursor}
                        popId={`${uid}-rate`}
                        onToggle={() => setRate(rate === row.name ? null : row.name)}
                      />
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="lu-picker-foot">
        <span data-testid="model-picker-count" title={CLOUD_MODE_LIST_NOTE}>
          {visible.length === rows.length
            ? `${rows.length} cloud ${rows.length === 1 ? 'model' : 'models'}`
            : `${visible.length} of ${rows.length}`}
        </span>
        {/* Say WHY the list is shorter here than in Chat, otherwise a missing
            favourite reads as a bug. */}
        {hiddenForCode > 0 && (
          <span
            data-testid="model-picker-hidden-for-code"
            title={`${hiddenForCode} cloud ${hiddenForCode === 1 ? 'model is' : 'models are'} hidden here because they cannot call tools. They are still in Chat.`}
          >
            {hiddenForCode} hidden, no tool calling
          </span>
        )}
        <span className="lu-picker-keys" aria-hidden="true">
          <kbd>&uarr;</kbd><kbd>&darr;</kbd><kbd>Enter</kbd><kbd>Esc</kbd>
        </span>
      </div>
    </div>
  )
}
