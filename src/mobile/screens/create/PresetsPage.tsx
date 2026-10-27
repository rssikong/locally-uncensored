/**
 * K12 Presets. Route /create/presets, page, strand 3 (Create).
 *
 * The guided presets of the 3.0.5: a run of one to three steps that leads to
 * a result ("Talking Avatar": create the voice, animate the speaker). The
 * list shows each preset as a card with its picture, what it does, how many
 * steps it has and from which price. A card opens the run
 * (/create/presets/:id, PresetRunPage). The data is the one of the desktop
 * (lib/render/create-presets.ts), read through parts/guided.ts.
 *
 * K12.1 kind chips, K12.2 preset card, K12.3 Continue (the preset that is
 * still open), K12.4 Prompt styles (the prompt building blocks, K12b).
 */
import { useMemo, useState } from 'react'
import { Layers, Star } from 'lucide-react'
import { nav } from '../../nav'
import { CREATE_STRINGS as T } from '../../strings/create'
import { Button, Chip, ChipGroup, EmptyState, ListGroup, Notice, Page, Row } from '../../ui'
import { useCatalogVersion } from './parts/catalog'
import { useGate } from './parts/facts'
import { guidedPresets, presetFromCredits, presetPicture, type CreatePreset } from './parts/guided'
import { guidedTouched, runBusy, useGuided } from './parts/guided-run'
import { creditsLabel } from './parts/params'
import { adultPresetsAllowed } from './parts/policy'
import './parts/create.css'

function Card({ preset }: { preset: CreatePreset }) {
  const [broken, setBroken] = useState(false)
  const from = presetFromCredits(preset)
  const facts = [T.guided.steps(preset.steps.length), from !== null && from > 0 ? T.guided.from(creditsLabel(from)) : null].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      className="m-k-preset"
      aria-label={T.guided.open(preset.title)}
      data-testid="m-create-preset-card"
      data-m-id={preset.id}
      data-el="K12.2"
      onClick={() => nav.push('/create/presets/:id', { id: preset.id })}
    >
      <span className="m-k-preset-art" data-accent={preset.accent} aria-hidden="true">
        {broken ? null : <img src={presetPicture(preset.id)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />}
      </span>
      <span className="m-k-preset-text">
        <span className="m-k-card-title">{preset.title}</span>
        <span className="m-k-card-sub">{preset.summary}</span>
        <span className="m-k-preset-facts m-mono" data-testid="m-create-preset-facts">
          {facts}
        </span>
      </span>
    </button>
  )
}

export default function PresetsPage() {
  // The "from" prices of the classic steps come from the live catalog.
  useCatalogVersion()
  const { gate } = useGate()
  const open = useGuided((s) => s.preset)
  const touched = useGuided(guidedTouched)
  const busy = useGuided(runBusy)
  const [kind, setKind] = useState<string>('all')
  const adult = adultPresetsAllowed()
  const presets = useMemo(() => guidedPresets({ adult }), [adult])
  const kinds = useMemo(() => [...new Set(presets.map((p) => p.category))], [presets])
  const shown = kind === 'all' ? presets : presets.filter((p) => p.category === kind)
  const openOne = open && presets.some((p) => p.id === open.id) && (touched || busy) ? open : null

  if (gate !== 'open') {
    return (
      <Page title={T.guided.title} screen="create-presets">
        <EmptyState
          title={T.gateTitle}
          icon={Layers}
          testid="m-create-presets-gate"
          actions={
            <Button variant="cloud" block onPress={() => nav.switchTab('create')} testid="m-create-presets-gate-open">
              {T.guided.toCreate}
            </Button>
          }
        >
          {T.guided.gateText}
        </EmptyState>
      </Page>
    )
  }

  return (
    <Page title={T.guided.title} screen="create-presets" needsNetwork flush>
      {/* data-m-sparse-box: "nothing in this category" stands in the middle of the room under the chips. */}
      <div className="m-k-gap" data-m-sparse-box="">
        <p className="m-cap m-k-pad m-k-intro">{T.guided.lead}</p>
        {openOne ? (
          <div className="m-k-pad">
            <Notice
              title={T.guided.continueTitle(openOne.title)}
              testid="m-create-presets-continue"
              actions={
                <Button compact onPress={() => nav.push('/create/presets/:id', { id: openOne.id })} testid="m-create-presets-continue-open" el="K12.3">
                  {T.guided.continue}
                </Button>
              }
            >
              {busy ? T.guided.continueRunning : T.guided.continueText}
            </Notice>
          </div>
        ) : null}
        {kinds.length > 1 ? (
          <ChipGroup label={T.guided.categories} role="radiogroup" testid="m-create-presets-kinds">
            <Chip kind="choice" selected={kind === 'all'} onPress={() => setKind('all')} testid="m-create-presets-kind-all" el="K12.1">
              {T.guided.all}
            </Chip>
            {kinds.map((k) => (
              <Chip key={k} kind="choice" selected={kind === k} onPress={() => setKind(k)} testid={`m-create-presets-kind-${k.toLowerCase()}`} el="K12.1">
                {k}
              </Chip>
            ))}
          </ChipGroup>
        ) : null}
        {shown.length === 0 ? (
          <EmptyState title={T.guided.noneTitle} icon={Layers} testid="m-create-presets-none">
            {T.guided.noneText}
          </EmptyState>
        ) : (
          <div className="m-k-presets" data-testid="m-create-presets-list" data-m-count={shown.length}>
            {shown.map((p) => (
              <Card key={p.id} preset={p} />
            ))}
          </div>
        )}
        <ListGroup>
          <Row icon={Star} title={T.guided.stylesRow} subtitle={T.guided.stylesRowSub} onPress={() => nav.push('/create/styles')} testid="m-create-presets-styles" el="K12.4" />
        </ListGroup>
      </div>
    </Page>
  )
}
