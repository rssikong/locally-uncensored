// What the chat model picker shows in Cloud mode and how it narrows, without
// any surface.
//
// The component (components/models/CloudModelPicker) draws; this file decides.
// Kept pure so the search, the filters, the grouping and the keyboard can be
// held by tests that need no DOM. Same rules as the web app's lib/model-picker.

import type { AIModel } from '../types/models'
import type { CreditRates } from '../api/providers/types'
import type { FlashPolicy } from './flash-ui'
import { displayModelName } from '../api/providers/model-name'
import { resolveToolSupport } from './tool-support'
import { modelMark, STATEMENT_MARK_LABEL, type ModelMark } from './unfiltered-mark'
import { assignFamilies, groupByFamily } from './model-family'

export type PickerFilter = 'marked' | 'vision' | 'thinking' | 'free'

/** The order the filter chips stand in. */
export const PICKER_FILTERS: readonly PickerFilter[] = ['marked', 'vision', 'thinking', 'free']

export interface PickerRow {
  /** The store's name for the model, what setActiveModel takes. */
  name: string
  /** The store's row, handed back to the pick. */
  model: AIModel
  /** What the row reads: the catalogue's short name, or the id. */
  label: string
  family: string
  /** The one mark of the row (lib/unfiltered-mark): the statement of the
   *  models released to answer without refusing, the measured mark, or none. */
  mark: ModelMark
  vision: boolean
  /** 'always' = reasons on every turn, 'toggle' = on request, null = never or
   *  not stated. */
  thinking: 'toggle' | 'always' | null
  /** No credits on THIS account: a Flash model and a paid plan, both. */
  free: FlashPolicy | null
  /** Context window in tokens as the server stated it. null when it stated
   *  none: the column then stays empty, no default is invented. */
  context: number | null
  /** Credits per one million tokens from the server. null on a server that
   *  does not send them yet, and then the row offers no rate control. */
  rates: CreditRates | null
  /** Cannot call tools, so Agent and Code cannot use it. */
  chatOnly: boolean
  /** Little room for all customers together (the server's
   *  `limited_capacity`): the row carries the quiet note. */
  limitedCapacity: boolean
  /** A quiet line after the name that no other field says, null for none. */
  quietNote: string | null
}

/** The quiet note of a row whose model has little room for all customers
 *  together, and what it says on hover. The same words as on the web. */
export const LIMITED_CAPACITY_LABEL = 'Limited capacity'
export const LIMITED_CAPACITY_TITLE = 'All customers share a small number of requests a minute on this model. At busy times it asks you to wait a few seconds.'

function declared<K extends string>(model: AIModel, key: K): unknown {
  return key in model ? (model as unknown as Record<K, unknown>)[key] : undefined
}

function quietNoteOf(model: AIModel): string | null {
  const note = declared(model, 'quietNote')
  return typeof note === 'string' && note.trim() ? note : null
}

function thinkingOf(model: AIModel): PickerRow['thinking'] {
  const stated = declared(model, 'thinkMode')
  return stated === 'toggle' || stated === 'always' ? stated : null
}

/** The rows of the picker, text models only, in the order the store has them.
 *  `paidPlan` is the account's answer (lib/flash-entitlement); anything but
 *  true promises no free model. Only what the server stated is printed: a
 *  hosted row gets no eye, no bulb and no context figure from its name. */
export function pickerRows(models: readonly AIModel[], paidPlan: boolean | null): PickerRow[] {
  const text = models.filter((m) => m.type === 'text')
  const families = assignFamilies(text.map((m) => m.name))
  return text.map((model) => {
    const context = declared(model, 'declaredContext')
    const flash = declared(model, 'flash') as FlashPolicy | undefined
    const label = declared(model, 'displayName')
    const tools = declared(model, 'supportsTools')
    const mark = modelMark({
      unfiltered: declared(model, 'unfiltered') as 'full' | 'partial' | undefined,
      unrestricted: declared(model, 'unrestricted') === true,
    })
    return {
      name: model.name,
      model,
      label: typeof label === 'string' && label ? label : displayModelName(model.name),
      // The statement models stand together under their own word, whatever
      // lineage their names carry: the head is what tells them apart from the
      // open-weight catalogue at a glance.
      family: mark === 'statement' ? STATEMENT_MARK_LABEL : families.get(model.name)!,
      mark,
      vision: declared(model, 'supportsVision') === true,
      thinking: thinkingOf(model),
      free: flash && paidPlan === true ? flash : null,
      context: typeof context === 'number' && context > 0 ? context : null,
      rates: (declared(model, 'creditRates') as CreditRates | undefined) ?? null,
      chatOnly: resolveToolSupport({
        name: model.name,
        supportsTools: typeof tools === 'boolean' ? tools : undefined,
      }) === 'none',
      limitedCapacity: declared(model, 'limitedCapacity') === true,
      quietNote: quietNoteOf(model),
    }
  })
}

const FILTER_TEST: Record<PickerFilter, (row: PickerRow) => boolean> = {
  marked: (row) => row.mark !== null,
  vision: (row) => row.vision,
  thinking: (row) => row.thinking !== null,
  free: (row) => row.free !== null,
}

/** How many rows each filter would keep, counted over the whole list so the
 *  number on a chip does not move while another chip is pressed. */
export function filterCounts(rows: readonly PickerRow[]): Record<PickerFilter, number> {
  return Object.fromEntries(
    PICKER_FILTERS.map((f) => [f, rows.filter(FILTER_TEST[f]).length]),
  ) as Record<PickerFilter, number>
}

/** The words of a search, lower case. Several words must ALL match. */
export function searchTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

/** Rows that pass every pressed filter and every search word. A word is looked
 *  for in the label, the family and the id, so "qwen 3.5" and "deepseek-ai"
 *  both find what they name. */
export function filterRows(
  rows: readonly PickerRow[],
  query: string,
  filters: ReadonlySet<PickerFilter>,
): PickerRow[] {
  const tokens = searchTokens(query)
  return rows.filter((row) => {
    for (const f of filters) if (!FILTER_TEST[f](row)) return false
    const hay = `${row.label} ${row.family} ${displayModelName(row.name)}`.toLowerCase()
    return tokens.every((t) => hay.includes(t))
  })
}

export interface PickerGroup {
  /** null = no head: a search is active, or there is only one family. */
  family: string | null
  rows: PickerRow[]
}

/** The visible list. Grouped by family with one head per group; a search
 *  drops the heads, because the result is a hit list and not a catalogue. In
 *  both cases the rows stand in family order, so the flat list and the grouped
 *  one do not shuffle against each other. */
export function pickerGroups(rows: readonly PickerRow[], searching: boolean): PickerGroup[] {
  // The statement group leads the list, in front of every lineage.
  const byFamily = groupByFamily(rows)
  const groups = [
    ...byFamily.filter((g) => g.family === STATEMENT_MARK_LABEL),
    ...byFamily.filter((g) => g.family !== STATEMENT_MARK_LABEL),
  ]
  if (groups.length === 0) return []
  if (searching || groups.length === 1) return [{ family: null, rows: groups.flatMap((g) => g.rows) }]
  return groups
}

/** How far Page Up and Page Down move the cursor. */
const PAGE = 10

/**
 * Where the keyboard cursor goes for `key`, or null when the key is not a
 * cursor key. Home and End belong to the text field while it holds a query,
 * so they only move the cursor when the search is empty.
 */
export function moveCursor(cursor: number, key: string, count: number, searching: boolean): number | null {
  const last = Math.max(0, count - 1)
  switch (key) {
    case 'ArrowDown': return Math.min(last, cursor + 1)
    case 'ArrowUp': return Math.max(0, cursor - 1)
    case 'PageDown': return Math.min(last, cursor + PAGE)
    case 'PageUp': return Math.max(0, cursor - PAGE)
    case 'Home': return searching ? null : 0
    case 'End': return searching ? null : last
    default: return null
  }
}

/** A label cut into the stretches a search word hits and the ones it misses,
 *  for the underline in the list. */
export function highlightParts(label: string, tokens: readonly string[]): { text: string; hit: boolean }[] {
  const lower = label.toLowerCase()
  const hit = new Array<boolean>(label.length).fill(false)
  for (const t of tokens) {
    for (let at = lower.indexOf(t); at !== -1; at = lower.indexOf(t, at + t.length)) {
      hit.fill(true, at, at + t.length)
    }
  }
  const parts: { text: string; hit: boolean }[] = []
  for (let i = 0; i < label.length; i++) {
    const tail = parts[parts.length - 1]
    if (tail && tail.hit === hit[i]) tail.text += label[i]
    else parts.push({ text: label[i], hit: hit[i] })
  }
  return parts
}

/** The one line a rate popover prints per direction: whole credits, grouped. */
export function formatCreditRate(credits: number): string {
  return Math.round(credits).toLocaleString('en-US')
}
