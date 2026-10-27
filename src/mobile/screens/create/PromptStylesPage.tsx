/**
 * K12b Prompt styles. Route /create/styles, page, strand 3 (Create).
 *
 * A prompt style is a prompt building block with a few values
 * (parts/styles.ts). A card applies the style and goes back, "New style"
 * opens the form (name, building block, values), and the user's own styles
 * can be edited and deleted. The built in ones cannot be changed.
 *
 * The guided presets of several steps live on /create/presets (PresetsPage).
 */
import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { nav } from '../../nav'
import { CREATE_STRINGS as T } from '../../strings/create'
import { Button, Chip, ChipGroup, Field, IconButton, ListGroup, Page, Row, Segmented, TextArea, toast } from '../../ui'
import { applyStyle } from './parts/actions'
import { ASPECTS, QUALITIES, type AspectKey, type QualityKey } from './parts/params'
import { BUILT_IN_STYLES, MAX_STYLE_NAME, MAX_STYLE_TEXT, checkStyle, cleanStyle, useStyleStore, type PromptStyle, type StyleProblem, type StyleTool } from './parts/styles'
import './parts/create.css'

const SECONDS = [5, 8, 10] as const

interface Draft {
  id?: string
  name: string
  tool: StyleTool
  text: string
  aspect?: AspectKey
  quality?: QualityKey
  seconds?: number
}

function describe(p: PromptStyle): string {
  const values = [p.tool === 'image' ? T.stylesPage.forImage : T.stylesPage.forVideo, p.aspect, p.quality, p.seconds ? T.stylesPage.seconds(p.seconds) : null].filter(Boolean).join(', ')
  return p.text ? `${values}. ${p.text}` : values
}

function Form({ start, onClose }: { start: Draft; onClose: () => void }) {
  const own = useStyleStore((s) => s.presets)
  const save = useStyleStore((s) => s.save)
  const [draft, setDraft] = useState<Draft>(start)
  const [problem, setProblem] = useState<StyleProblem | null>(null)
  const patch = (p: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...p }))
    setProblem(null)
  }
  const submit = () => {
    const bad = checkStyle(draft, [...own, ...BUILT_IN_STYLES])
    if (bad) {
      setProblem(bad)
      return
    }
    save(cleanStyle(draft, () => `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`))
    toast(T.stylesPage.saved, { testid: 'create-style-saved' })
    onClose()
  }
  return (
    <Page
      title={draft.id ? T.stylesPage.formEdit : T.stylesPage.formNew}
      screen="create-styles"
      onBack={onClose}
      flush
      footer={
        <Button variant="primary" block onPress={submit} testid="m-create-style-save">
          {T.stylesPage.save}
        </Button>
      }
    >
      <div className="m-k-gap m-k-form" data-testid="m-create-style-form">
        <div className="m-k-pad m-k-gap">
        <Field
          label={T.stylesPage.name}
          value={draft.name}
          onChange={(name) => patch({ name })}
          placeholder={T.stylesPage.namePlaceholder}
          maxLength={MAX_STYLE_NAME}
          error={problem === 'no-name' || problem === 'name-taken' || problem === 'full' ? T.stylesPage.problems[problem] : undefined}
          testid="m-create-style-name"
        />
        <Segmented
          label={T.stylesPage.tool}
          value={draft.tool}
          onChange={(tool) => patch(tool === 'image' ? { tool, seconds: undefined } : { tool, aspect: undefined, quality: undefined })}
          options={[
            { value: 'image', label: T.stylesPage.forImage, testid: 'm-create-style-for-image' },
            { value: 'video', label: T.stylesPage.forVideo, testid: 'm-create-style-for-video' },
          ]}
        />
        <TextArea
          label={T.stylesPage.text}
          value={draft.text}
          onChange={(text) => patch({ text })}
          hint={T.stylesPage.textHint}
          rows={3}
          maxLength={MAX_STYLE_TEXT}
          error={problem === 'no-content' ? T.stylesPage.problems['no-content'] : undefined}
          testid="m-create-style-text"
        />
        </div>
        {draft.tool === 'image' ? (
          <>
            <div>
              <div className="m-label m-k-pad">{T.stylesPage.aspect}</div>
              <ChipGroup label={T.stylesPage.aspect} role="radiogroup" wrap>
                <Chip kind="choice" selected={!draft.aspect} onPress={() => patch({ aspect: undefined })} testid="m-create-style-aspect">
                  {T.stylesPage.keepValue}
                </Chip>
                {ASPECTS.map((a) => (
                  <Chip key={a} kind="choice" selected={draft.aspect === a} onPress={() => patch({ aspect: a })} testid="m-create-style-aspect">
                    {a}
                  </Chip>
                ))}
              </ChipGroup>
            </div>
            <div>
              <div className="m-label m-k-pad">{T.stylesPage.quality}</div>
              <ChipGroup label={T.stylesPage.quality} role="radiogroup" wrap>
                <Chip kind="choice" selected={!draft.quality} onPress={() => patch({ quality: undefined })} testid="m-create-style-quality">
                  {T.stylesPage.keepValue}
                </Chip>
                {QUALITIES.map((q) => (
                  <Chip key={q} kind="choice" selected={draft.quality === q} onPress={() => patch({ quality: q })} testid="m-create-style-quality">
                    {q}
                  </Chip>
                ))}
              </ChipGroup>
            </div>
          </>
        ) : (
          <div>
            <div className="m-label m-k-pad">{T.stylesPage.length}</div>
            <ChipGroup label={T.stylesPage.length} role="radiogroup" wrap>
              <Chip kind="choice" selected={!draft.seconds} onPress={() => patch({ seconds: undefined })} testid="m-create-style-seconds">
                {T.stylesPage.keepValue}
              </Chip>
              {SECONDS.map((s) => (
                <Chip key={s} kind="choice" selected={draft.seconds === s} onPress={() => patch({ seconds: s })} testid="m-create-style-seconds">
                  {T.stylesPage.seconds(s)}
                </Chip>
              ))}
            </ChipGroup>
          </div>
        )}
      </div>
    </Page>
  )
}

export default function PromptStylesPage() {
  const own = useStyleStore((s) => s.presets)
  const remove = useStyleStore((s) => s.remove)
  const [form, setForm] = useState<Draft | null>(null)

  if (form) return <Form start={form} onClose={() => setForm(null)} />

  const apply = (p: PromptStyle) => {
    applyStyle(p)
    toast(T.stylesPage.applied(p.name), { testid: 'create-style-applied' })
    void nav.back()
  }
  const del = async (p: PromptStyle) => {
    const yes = await nav.confirm({ title: T.stylesPage.deleteTitle(p.name), text: T.stylesPage.deleteText, confirmLabel: T.stylesPage.delete, tone: 'danger', testid: 'create-style-delete' })
    if (yes) remove(p.id)
  }
  return (
    <Page
      title={T.stylesPage.title}
      screen="create-styles"
      flush
      footer={
        <Button variant="primary" block icon={Plus} onPress={() => setForm({ name: '', tool: 'image', text: '' })} testid="m-create-style-new">
          {T.stylesPage.new}
        </Button>
      }
    >
      <ListGroup title={T.stylesPage.mine}>
        {own.length === 0 ? <Row title={T.stylesPage.emptyMine} testid="m-create-styles-none" /> : null}
        {own.map((p) => (
          <Row
            key={p.id}
            title={p.name}
            subtitle={describe(p)}
            label={T.stylesPage.apply(p.name)}
            chevron={false}
            onPress={() => apply(p)}
            trailing={
              <>
                <IconButton icon={Pencil} label={T.stylesPage.editLabel(p.name)} onPress={() => setForm({ ...p })} testid="m-create-style-edit" />
                <IconButton icon={Trash2} label={T.stylesPage.deleteLabel(p.name)} onPress={() => void del(p)} testid="m-create-style-remove" />
              </>
            }
            testid="m-create-style-card"
           
          />
        ))}
      </ListGroup>
      <ListGroup title={T.stylesPage.builtIn}>
        {BUILT_IN_STYLES.map((p) => (
          <Row key={p.id} title={p.name} subtitle={describe(p)} label={T.stylesPage.apply(p.name)} chevron={false} onPress={() => apply(p)} testid="m-create-style-card" />
        ))}
      </ListGroup>
    </Page>
  )
}
