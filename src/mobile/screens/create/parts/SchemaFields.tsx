/**
 * The controls of a provider schema, for a phone.
 *
 * One model of the cloud studio brings its own fields (length, resolution,
 * voice, presenter, style LoRAs ...). This file draws them, and the sub
 * pages a field needs: a choice list for a field with many values, tiles
 * with faces for the presenter, an editor for a list field.
 *
 * It does not know where the values live. The run settings of Create keep
 * them in the create store, a guided preset keeps them per step; both hand
 * in a SchemaHost. So there is one truth about which control sends which
 * value, as on the desktop (components/create/experimental/SchemaControl.tsx).
 *
 * Sub pages are named by a string, the way sheets name theirs:
 *   pick:<field>          choice list (or the presenter tiles)
 *   list:<field>          editor of a list field
 *   item:<field>:<index>  the choice of one entry of a list field
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dices, Plus, Search, Trash2 } from 'lucide-react'
import { avatarPerson, avatarPreview } from '../../../../lib/render/heygen-avatars'
import { studioShownValue } from '../../../../lib/render/create-studio'
import { studioFields, studioSchema, type Schema } from '../../../../lib/render/studio-contract'
import { CREATE_STRINGS as T } from '../../../strings/create'
import { Button, EmptyState, Field, IconButton, ListGroup, NumberField, Row, Segmented, Slider } from '../../../ui'

export interface SchemaHost {
  /** Id of the studio model whose schema is drawn. */
  model: string
  options: Record<string, unknown>
  /** Set one value. `undefined` or an empty text takes the field out, so the model's own default counts. */
  set: (key: string, value: unknown) => void
  disabled?: boolean
}

// ---------- pure ----------

export function fieldName(name: string): string {
  if (name === 'preset') return T.run.stylePreset
  if (name === 'avatar') return T.run.presenterField
  if (name === 'loras') return T.run.loras
  return name.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())
}

/** The fields in the order the provider wants them (`x-order-properties`), the rest behind. */
export function fieldsInOrder(model: string): [string, Schema][] {
  const wanted = (studioSchema(model) as { 'x-order-properties'?: unknown })['x-order-properties']
  const order = Array.isArray(wanted) ? wanted.map(String) : []
  const rank = (key: string) => {
    const i = order.indexOf(key)
    return i === -1 ? order.length : i
  }
  return Object.entries(studioFields(model)).sort((a, b) => rank(a[0]) - rank(b[0]))
}

export type ListKind =
  /** Entries with a `path` from a fixed list and a strength (style LoRAs). */
  | 'choices'
  /** Free lines of text (a pronunciation list). */
  | 'texts'

/** What kind of list a field is, or null when a phone cannot edit it. */
export function listKind(schema: Schema | undefined): ListKind | null {
  if (!schema || schema.type !== 'array') return null
  const items = schema.items
  if (!items) return null
  if (items.type === 'object' && Array.isArray(items.properties?.path?.enum) && items.properties.path.enum.length > 0) return 'choices'
  if (items.type === 'string' && !items.enum) return 'texts'
  return null
}

/** Does a phone draw this field. A list it cannot edit and a nested object are left out, never shown locked. */
export function isDrawn(schema: Schema): boolean {
  if (schema.type === 'object') return false
  if (schema.type === 'array') return listKind(schema) !== null
  return true
}

/** The fields of a model a phone draws, in the provider's order. */
export function drawnFields(model: string): [string, Schema][] {
  return fieldsInOrder(model).filter(([, schema]) => isDrawn(schema))
}

export interface ChoiceEntry {
  path: string
  scale?: number
}

export function choiceEntries(value: unknown): ChoiceEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is ChoiceEntry => !!v && typeof v === 'object' && typeof (v as { path?: unknown }).path === 'string')
}

export function textEntries(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

export function listMax(schema: Schema, kind: ListKind): number {
  return schema.maxItems ?? (kind === 'choices' ? 3 : 30)
}

/** The entry "Add" puts in: the first choice that is not in the list yet. */
export function nextChoice(schema: Schema, rows: readonly ChoiceEntry[]): ChoiceEntry | null {
  const choices = (schema.items?.properties?.path?.enum ?? []).map(String)
  if (choices.length === 0) return null
  const path = choices.find((c) => !rows.some((r) => r.path === c)) ?? choices[0]
  const scale = schema.items?.properties?.scale?.default
  return { path, scale: typeof scale === 'number' ? scale : 1 }
}

/** A list with nothing in it is not sent at all. */
export function listValue<V>(rows: readonly V[]): V[] | undefined {
  return rows.length > 0 ? [...rows] : undefined
}

export function listSummary(schema: Schema, value: unknown): string {
  const kind = listKind(schema)
  if (kind === 'choices') {
    const rows = choiceEntries(value)
    return rows.length === 0 ? T.run.listNone : rows.map((r) => r.path).join(', ')
  }
  const rows = textEntries(value)
  return rows.length === 0 ? T.run.listNone : T.run.listCount(rows.length)
}

/** Does the presenter field of this schema come with faces. */
export function hasFaces(field: string, schema: Schema | undefined): boolean {
  return field === 'avatar' && Array.isArray(schema?.enum) && schema.enum.some((v) => !!avatarPreview(String(v)))
}

/** The scene of a presenter without the person's name: under the head "Annie" stands "Bar Standing Side 2". */
export function sceneOf(name: string): string {
  return name.slice(avatarPerson(name).length).trim() || name
}

export function searchChoices(choices: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  return q ? choices.filter((c) => c.toLowerCase().includes(q)) : [...choices]
}

/** How many entries of a long list are drawn at first, and with each "more". */
export const CHUNK = 60

export function isSchemaSub(sub: string | null | undefined): sub is string {
  return !!sub && (sub.startsWith('pick:') || sub.startsWith('list:') || sub.startsWith('item:'))
}

export function schemaSubTitle(sub: string): string {
  const [, field] = sub.split(':')
  return fieldName(field ?? '')
}

function decimals(step: number): number {
  return Math.max(0, (String(step).split('.')[1] ?? '').length)
}

function tid(key: string): string {
  return `m-create-opt-${key.replaceAll('_', '-')}`
}

// ---------- long lists: draw a part, load the rest on the way down ----------

/**
 * A list of any length without a cap: the first CHUNK entries are drawn, the
 * next ones when the end comes near the screen, and a button does the same
 * for anyone whose browser cannot tell.
 */
function useChunks(total: number, resetKey: string): { shown: number; more: () => void; sentinel: (el: HTMLElement | null) => void } {
  // The count belongs to one search text: another text starts at the first part again.
  const [state, setState] = useState({ key: resetKey, shown: CHUNK })
  const shown = state.key === resetKey ? state.shown : CHUNK
  const more = () => setState((prev) => ({ key: resetKey, shown: (prev.key === resetKey ? prev.shown : CHUNK) + CHUNK }))
  const observer = useRef<IntersectionObserver | null>(null)
  const sentinel = (el: HTMLElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el || typeof IntersectionObserver === 'undefined') return
    observer.current = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) more()
      },
      { rootMargin: '400px' },
    )
    observer.current.observe(el)
  }
  useEffect(() => () => observer.current?.disconnect(), [])
  return { shown: Math.min(shown, total), more, sentinel }
}

function MoreRow({ shown, total, more, sentinel }: { shown: number; total: number; more: () => void; sentinel: (el: HTMLElement | null) => void }) {
  if (shown >= total) return null
  return (
    <div className="m-k-sec" ref={sentinel} data-testid="m-create-opt-more-wrap">
      <span className="m-cap" data-testid="m-create-opt-shown">
        {T.run.shownOf(shown, total)}
      </span>
      <Button block onPress={more} testid="m-create-opt-more">
        {T.run.showMore}
      </Button>
    </div>
  )
}

// ---------- the fields ----------

function FaceThumb({ name }: { name: string }) {
  const src = avatarPreview(name)
  return (
    <span className="m-k-face-thumb" aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" width={64} height={36} /> : null}
    </span>
  )
}

export function SchemaFields({ host, onOpen, only }: { host: SchemaHost; onOpen: (sub: string) => void; only?: readonly string[] }) {
  const { model, options, set, disabled } = host
  const fields = drawnFields(model).filter(([key]) => !only || only.includes(key))
  return (
    <div className="m-k-gap" data-testid="m-create-model-settings">
      {fields.map(([key, schema]) => {
        const name = fieldName(key)
        const value = studioShownValue(model, options, key)
        const id = tid(key)
        if (schema.type === 'array') {
          return (
            <ListGroup key={key}>
              <Row title={name} subtitle={listSummary(schema, value)} label={T.run.choose(name)} disabled={disabled} onPress={() => onOpen(`list:${key}`)} testid={id} />
            </ListGroup>
          )
        }
        if (schema.type === 'boolean') {
          return (
            <ListGroup key={key}>
              <Row title={name} disabled={disabled} switch={{ checked: value === true, onChange: (next) => set(key, next), tone: 'cloud' }} testid={id} />
            </ListGroup>
          )
        }
        if (hasFaces(key, schema)) {
          const current = value === undefined || value === '' ? '' : String(value)
          return (
            <div className="m-group" key={key}>
              <button type="button" className="m-row" disabled={disabled} aria-label={current ? T.run.presenterChange(current) : T.run.choose(name)} data-testid={id} data-m-id={current || undefined} onClick={() => onOpen(`pick:${key}`)}>
                <FaceThumb name={current} />
                <span className="m-row-text">
                  <span className="m-row-title">{name}</span>
                  <span className="m-row-sub">{current || T.run.presenterNone}</span>
                </span>
              </button>
            </div>
          )
        }
        if (schema.enum) {
          const choices = schema.enum.map(String)
          const short = choices.length <= 4 && choices.every((c) => c.length <= 10)
          if (short) {
            return (
              <div className="m-k-sec" key={key}>
                <span className="m-label">{name}</span>
                <Segmented label={name} value={String(value ?? choices[0])} onChange={(v) => set(key, typeof schema.enum?.[0] === 'number' ? Number(v) : v)} options={choices.map((c) => ({ value: c, label: c, disabled }))} testid={id} />
              </div>
            )
          }
          return (
            <ListGroup key={key}>
              <Row title={name} value={value === undefined || value === '' ? T.run.automatic : String(value)} label={T.run.choose(name)} disabled={disabled} onPress={() => onOpen(`pick:${key}`)} testid={id} />
            </ListGroup>
          )
        }
        if (schema.type === 'integer' || schema.type === 'number') {
          const step = schema.type === 'integer' ? 1 : 0.1
          const num = typeof value === 'number' ? value : Number(value ?? schema.minimum ?? 0)
          if (key === 'seed') {
            return (
              <div className="m-k-sec" key={key}>
                <span className="m-label">{name}</span>
                <div className="m-rowh">
                  <NumberField label={name} value={Number.isFinite(num) ? num : 0} min={schema.minimum ?? 0} max={schema.maximum ?? 2_147_483_647} step={1} onChange={(v) => set(key, v)} testid={id} />
                  <IconButton icon={Dices} label={T.run.seedRandom} edged onPress={() => set(key, Math.floor(Math.random() * 2_147_483_647))} testid={`${id}-random`} />
                </div>
              </div>
            )
          }
          if (schema.minimum !== undefined && schema.maximum !== undefined && schema.maximum - schema.minimum <= 1000) {
            return (
              <div className="m-k-sec" key={key}>
                <Slider label={name} value={Math.min(schema.maximum, Math.max(schema.minimum, num))} min={schema.minimum} max={schema.maximum} step={step} format={(v) => v.toFixed(decimals(step))} onChange={(v) => set(key, v)} testid={id} />
              </div>
            )
          }
          return (
            <div className="m-k-sec" key={key}>
              <span className="m-label">{name}</span>
              <NumberField label={name} value={Number.isFinite(num) ? num : 0} min={schema.minimum ?? 0} max={schema.maximum ?? 1_000_000} step={step} onChange={(v) => set(key, v)} testid={id} />
            </div>
          )
        }
        return (
          <div className="m-k-sec" key={key}>
            <Field label={name} value={typeof value === 'string' ? value : ''} onChange={(v) => set(key, v)} maxLength={2000} disabled={disabled} testid={id} />
          </div>
        )
      })}
    </div>
  )
}

// ---------- sub page: a choice list ----------

function ChoiceList({ label, choices, current, automatic, onPick }: { label: string; choices: readonly string[]; current: string | null; automatic: boolean; onPick: (value: string | undefined) => void }) {
  const [query, setQuery] = useState('')
  const found = useMemo(() => searchChoices(choices, query), [choices, query])
  const { shown, more, sentinel } = useChunks(found.length, query)
  return (
    <div data-testid="m-create-opt-picker" data-m-total={choices.length}>
      {choices.length > 8 ? (
        <div className="m-k-sec">
          <Field label={T.model.search} hideLabel type="search" icon={Search} placeholder={T.model.searchPlaceholder} value={query} onChange={setQuery} clearable testid="m-create-opt-search" />
        </div>
      ) : null}
      {found.length === 0 ? (
        <EmptyState title={T.model.none}>{T.model.noneText}</EmptyState>
      ) : (
        <ListGroup role="radiogroup" label={label}>
          {automatic ? <Row title={T.run.automatic} radio={{ checked: current === null, onSelect: () => onPick(undefined), reselect: true }} testid="m-create-opt-choice-auto" /> : null}
          {found.slice(0, shown).map((c) => (
            <Row key={c} id={c} title={c} radio={{ checked: current === c, onSelect: () => onPick(c), reselect: true }} testid="m-create-opt-choice" />
          ))}
        </ListGroup>
      )}
      <MoreRow shown={shown} total={found.length} more={more} sentinel={sentinel} />
    </div>
  )
}

// ---------- sub page: the presenter, with faces ----------

/**
 * The presenter is a face, not a word (decision of 19.09.2026 for the
 * desktop: one has to see the character before spending money on a run).
 * Tiles with the preview picture, the person as a head above her scenes, a
 * search over the name, and every entry of the provider's list, loaded on
 * the way down.
 */
function FaceTiles({ names, current, onPick }: { names: readonly string[]; current: string; onPick: (name: string) => void }) {
  const [query, setQuery] = useState('')
  const found = useMemo(() => searchChoices(names, query), [names, query])
  const { shown, more, sentinel } = useChunks(found.length, query)
  const visible = found.slice(0, shown)
  const groups: { person: string; names: string[] }[] = []
  for (const name of visible) {
    const person = avatarPerson(name)
    const last = groups[groups.length - 1]
    if (last && last.person === person) last.names.push(name)
    else groups.push({ person, names: [name] })
  }
  return (
    <div data-testid="m-create-presenter-picker" data-m-total={names.length}>
      <div className="m-k-sec">
        <Field label={T.run.presenterSearch} hideLabel type="search" icon={Search} placeholder={T.run.presenterSearch} value={query} onChange={setQuery} clearable testid="m-create-presenter-search" />
      </div>
      {found.length === 0 ? (
        <EmptyState title={T.run.presenterNoMatch} testid="m-create-presenter-none">
          {T.model.noneText}
        </EmptyState>
      ) : (
        <div role="radiogroup" aria-label={T.run.presenterField}>
          {groups.map((group, gi) => (
            <section key={`${group.person}-${gi}`} data-testid="m-create-presenter-person" data-m-id={group.person}>
              <h2 className="m-label m-group-label">{group.person}</h2>
              <div className="m-k-faces">
                {group.names.map((name) => {
                  const src = avatarPreview(name)
                  const checked = name === current
                  return (
                    <button key={name} type="button" role="radio" aria-checked={checked} aria-label={name} className="m-k-face" data-testid="m-create-presenter-face" data-m-id={name} data-state={src ? 'photo' : 'no-photo'} onClick={() => onPick(name)}>
                      <span className="m-k-face-img">{src ? <img src={src} alt="" loading="lazy" width={224} height={126} /> : <span className="m-cap">{T.run.presenterNoPhoto}</span>}</span>
                      <span className="m-k-face-name">{sceneOf(name)}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <MoreRow shown={shown} total={found.length} more={more} sentinel={sentinel} />
    </div>
  )
}

// ---------- sub page: a list field ----------

function ChoicesEditor({ host, field, schema, onOpen }: { host: SchemaHost; field: string; schema: Schema; onOpen: (sub: string) => void }) {
  const rows = choiceEntries(host.options[field])
  const max = listMax(schema, 'choices')
  const scale = schema.items?.properties?.scale
  const min = scale?.minimum ?? 0
  const top = scale?.maximum ?? 2
  const write = (next: ChoiceEntry[]) => host.set(field, listValue(next))
  const add = () => {
    const entry = nextChoice(schema, rows)
    if (entry) write([...rows, entry])
  }
  return (
    <div className="m-k-gap" data-testid="m-create-opt-list" data-m-kind="choices">
      <p className="m-cap m-k-pad" data-testid="m-create-opt-list-hint">
        {field === 'loras' ? T.run.lorasHint(max) : T.run.listUpTo(max)}
      </p>
      {rows.length === 0 ? (
        <p className="m-cap m-k-pad" data-testid="m-create-opt-list-empty">
          {T.run.listEmpty}
        </p>
      ) : null}
      {rows.map((row, i) => (
        <div className="m-k-card" key={`${row.path}-${i}`} data-testid="m-create-opt-list-row" data-m-id={row.path}>
          <ListGroup>
            <Row
              title={T.run.listEntry(i + 1)}
              value={row.path}
              label={T.run.listEntryChange(i + 1, row.path)}
              disabled={host.disabled}
              onPress={() => onOpen(`item:${field}:${i}`)}
              trailing={<IconButton icon={Trash2} label={T.run.listEntryRemove(i + 1, row.path)} disabled={host.disabled} onPress={() => write(rows.filter((_, j) => j !== i))} testid="m-create-opt-list-remove" />}
              testid="m-create-opt-list-pick"
            />
          </ListGroup>
          <Slider
            label={T.run.strengthOf}
            value={Math.min(top, Math.max(min, typeof row.scale === 'number' ? row.scale : 1))}
            min={min}
            max={top}
            step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={(v) => write(rows.map((r, j) => (j === i ? { ...r, scale: Math.round(v * 10) / 10 } : r)))}
            testid="m-create-opt-list-strength"
          />
        </div>
      ))}
      <div className="m-k-sec">
        <Button block icon={Plus} disabled={host.disabled || rows.length >= max} disabledReason={rows.length >= max ? T.run.listFull(max) : undefined} onPress={add} testid="m-create-opt-list-add">
          {field === 'loras' ? T.run.lorasAdd : T.run.listAdd}
        </Button>
      </div>
    </div>
  )
}

function TextsEditor({ host, field, schema }: { host: SchemaHost; field: string; schema: Schema }) {
  const rows = textEntries(host.options[field])
  const max = listMax(schema, 'texts')
  const [draft, setDraft] = useState('')
  const placeholder = (schema as { 'x-placeholder'?: unknown })['x-placeholder']
  const write = (next: string[]) => host.set(field, listValue(next))
  const add = () => {
    const text = draft.trim()
    if (!text || rows.length >= max || rows.includes(text)) return
    write([...rows, text])
    setDraft('')
  }
  return (
    <div className="m-k-gap" data-testid="m-create-opt-list" data-m-kind="texts">
      <div className="m-k-sec">
        <Field
          label={T.run.listNewEntry}
          hint={schema.description ?? T.run.listUpTo(max)}
          placeholder={typeof placeholder === 'string' ? placeholder : undefined}
          value={draft}
          onChange={setDraft}
          onSubmit={add}
          maxLength={200}
          disabled={host.disabled || rows.length >= max}
          testid="m-create-opt-list-text"
        />
        <Button block icon={Plus} disabled={host.disabled || !draft.trim() || rows.length >= max} disabledReason={rows.length >= max ? T.run.listFull(max) : undefined} onPress={add} testid="m-create-opt-list-add">
          {T.run.listAdd}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="m-cap m-k-pad" data-testid="m-create-opt-list-empty">
          {T.run.listEmpty}
        </p>
      ) : (
        <ListGroup>
          {rows.map((row, i) => (
            <Row key={row} id={row} title={row} trailing={<IconButton icon={Trash2} label={T.run.listTextRemove(row)} disabled={host.disabled} onPress={() => write(rows.filter((_, j) => j !== i))} testid="m-create-opt-list-remove" />} testid="m-create-opt-list-row" />
          ))}
        </ListGroup>
      )}
    </div>
  )
}

// ---------- the sub pages, by name ----------

/**
 * The body of the sub page `sub`. `onDone` goes one step back (the choice
 * was made), `onOpen` opens a further sub page.
 */
export function SchemaSub({ host, sub, onDone, onOpen }: { host: SchemaHost; sub: string; onDone: () => void; onOpen: (sub: string) => void }): ReactNode {
  const [kind, field = '', index] = sub.split(':')
  const schema = studioFields(host.model)[field]
  if (!schema) return <EmptyState title={T.model.none} />
  if (kind === 'list') {
    const lk = listKind(schema)
    if (lk === 'choices') return <ChoicesEditor host={host} field={field} schema={schema} onOpen={onOpen} />
    if (lk === 'texts') return <TextsEditor host={host} field={field} schema={schema} />
    return <EmptyState title={T.model.none} />
  }
  if (kind === 'item') {
    const rows = choiceEntries(host.options[field])
    const i = Number(index)
    const choices = (schema.items?.properties?.path?.enum ?? []).map(String)
    return (
      <ChoiceList
        label={fieldName(field)}
        choices={choices}
        current={rows[i]?.path ?? null}
        automatic={false}
        onPick={(value) => {
          if (value !== undefined && rows[i]) host.set(field, rows.map((r, j) => (j === i ? { ...r, path: value } : r)))
          onDone()
        }}
      />
    )
  }
  const choices = (schema.enum ?? []).map(String)
  const shown = studioShownValue(host.model, host.options, field)
  const current = shown === undefined || shown === '' ? null : String(shown)
  const numeric = typeof schema.enum?.[0] === 'number'
  if (hasFaces(field, schema)) {
    return (
      <FaceTiles
        names={choices}
        current={current ?? ''}
        onPick={(name) => {
          host.set(field, name)
          onDone()
        }}
      />
    )
  }
  return (
    <ChoiceList
      label={fieldName(field)}
      choices={choices}
      current={current}
      automatic={schema.default === undefined}
      onPick={(value) => {
        host.set(field, value === undefined ? undefined : numeric ? Number(value) : value)
        onDone()
      }}
    />
  )
}
