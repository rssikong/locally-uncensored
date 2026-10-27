/**
 * K12 One guided preset. Route /create/presets/:id, page, strand 3 (Create).
 *
 * The phone form of the preset workshop of the desktop: one step at a time,
 * top to bottom. A step shows its model, what it needs (files from the phone
 * or the gallery, a text, a few settings), and its price before it starts.
 * The result of a step is the input of the next one and is carried over by
 * itself. The state of the run lives in parts/guided-run.ts, so a step keeps
 * rendering while this page is closed and is found again on return.
 *
 * K12.5 steps, K12.6 model of the step, K12.7 input card (Choose file, From
 * gallery, Remove), K12.8 text or visual style, K12.9 prompt idea, K12.10
 * settings and More settings, K12.11 Generate with the price, K12.12 Cancel
 * and refund, K12.13 result (Try again, Next step, Done), K12.14 Start over.
 */
import { useEffect, useRef, useState } from 'react'
import { AudioLines, Check, Clapperboard, ImagePlus, Layers, Lightbulb, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useCreateStore, type GalleryItem } from '../../../stores/createStore'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import { signalCreditsExhausted } from '../../../lib/credits-exhausted'
import { selectedVideoSeconds } from '../../../lib/render/video-duration'
import { nav, useParams } from '../../nav'
import { pickFiles, pickPhotos } from '../../platform/files'
import { haptic } from '../../platform/haptics'
import { CREATE_STRINGS as T } from '../../strings/create'
import { Button, Chip, EmptyState, Icon, IconButton, ListGroup, Notice, Page, Progress, Row, Segmented, TextArea } from '../../ui'
import { ErrorNotice } from './parts/ErrorNotice'
import { phoneSentence } from './parts/errors'
import { useGate } from './parts/facts'
import {
  classicControls, guidedPresetById, priceKeyOf, promptWord, stepFields, stepHasChoice, stepMissing,
  type Missing, type StepInput, type StepView,
} from './parts/guided'
import {
  attachGuidedFiles, cancelGuided, draftOf, estimateOf, guidedTouched, nextGuidedStep, openGuided, priceUsable,
  redoGuidedStep, refreshGuidedQuote, removeGuidedInput, runBusy, runGuidedStep, setGuidedClip, setGuidedOption, setGuidedPrompt,
  startOverGuided, useGuided, viewOf, type FileTrouble, type GuidedState,
} from './parts/guided-run'
import { creditsLabel, formatClock, formatCredits } from './parts/params'
import { adultPresetsAllowed, withAiConsent } from './parts/policy'
import { runPhase } from './parts/run-state'
import { SchemaFields, fieldName, type SchemaHost } from './parts/SchemaFields'
import { MediaStateBox, itemName, useItemMedia } from './parts/ui'
import type { PresetSheetProps } from './PresetSheet'
import './parts/create.css'

const openSheet = (props: PresetSheetProps) => nav.openSheet('create-preset', props)

export function inputLabel(field: string): string {
  return T.guided.field[field] ?? fieldName(field)
}

export function troubleText(problem: FileTrouble): string {
  switch (problem.kind) {
    case 'too-large':
      return T.file.tooLarge(problem.sizeMb, problem.limitMb)
    case 'wrong-kind':
      return T.file.wrongKind[problem.wanted]
    case 'empty':
      return T.file.empty
    case 'heic':
      return T.file.heic
    case 'too-heavy':
      return T.file.tooHeavy
    case 'undecodable':
      return T.file.undecodable
    case 'gone':
      return T.guided.itemGone
    default:
      return phoneSentence(problem.message)
  }
}

export function missingText(missing: Missing): string {
  if (missing.what === 'input') return T.guided.priceNeeds.input(inputLabel(missing.field).toLowerCase())
  return missing.what === 'clip' ? T.guided.priceNeeds.clip : T.guided.priceNeeds.prompt
}

const KIND_ICON = { image: ImagePlus, video: Clapperboard, audio: AudioLines } as const

// ---------- the price is asked a moment after the last change ----------

function useGuidedPrice(s: GuidedState, view: StepView | null): void {
  const key = view ? priceKeyOf(view, draftOf(s)) : ''
  const settled = !!s.done[s.index]
  const busy = runBusy(s)
  const lastPrompt = useRef(s.prompt)
  useEffect(() => {
    if (!view || settled || busy) return
    // Typing asks less often than a tap on a setting. A model with a fixed catalog price asks nobody.
    const typed = lastPrompt.current !== s.prompt
    lastPrompt.current = s.prompt
    const timer = window.setTimeout(() => void refreshGuidedQuote(), !view.studio ? 0 : typed ? 1200 : 500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, s.round, settled, busy])
}

// ---------- parts ----------

function Steps({ s }: { s: GuidedState }) {
  const preset = s.preset
  if (!preset || preset.steps.length < 2) return null
  return (
    <ol className="m-k-steps" aria-label={T.guided.stepsLabel} data-testid="m-create-preset-steps" data-el="K12.5">
      {preset.steps.map((step, i) => {
        const state = s.done[i] ? 'done' : i === s.index ? 'now' : 'later'
        return (
          <li key={i} data-state={state} aria-current={i === s.index ? 'step' : undefined} data-testid="m-create-preset-step">
            <span className="m-k-steps-n" aria-hidden="true">
              {s.done[i] ? <Check /> : i + 1}
            </span>
            <span>
              {step.title}
              {state === 'done' ? <span className="m-k-sr">{`, ${T.guided.stepDone}`}</span> : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function InputCard({ input, s, locked }: { input: StepInput; s: GuidedState; locked: boolean }) {
  const attached = s.attached[input.key]
  const uploading = s.uploading === input.key
  const trouble = s.trouble?.key === input.key ? s.trouble.problem : null
  const name = inputLabel(input.field)
  const disabled = locked || s.uploading !== null
  const fromPhone = async () => {
    // The picker opens on the tap itself. The question about sending content comes after it, before anything leaves the phone.
    const picked = input.kind === 'image' ? await pickPhotos({ multiple: input.many }) : await pickFiles({ accept: input.kind === 'video' ? 'video/*' : 'audio/*' })
    if (picked.length === 0) return
    await withAiConsent(async () => {
      await attachGuidedFiles(input.key, picked.map((p) => p.file))
    })
  }
  const sub = uploading
    ? T.guided.uploading
    : attached
      ? attached.carried
        ? T.guided.carried
        : attached.count > 1
          ? T.guided.files(attached.count)
          : attached.name
      : T.guided.inputEmpty[input.kind]
  return (
    <div className="m-k-card" data-testid="m-create-preset-input" data-m-id={input.key} data-state={uploading ? 'uploading' : attached ? 'set' : 'empty'} data-el="K12.7">
      <div className="m-k-card-head">
        <span className="m-k-thumb" aria-hidden="true">
          {uploading ? (
            <span className="m-ring" />
          ) : attached?.url && attached.kind === 'image' ? (
            <img src={attached.url} alt="" />
          ) : attached?.url && attached.kind === 'video' ? (
            <video src={`${attached.url}#t=0.1`} muted playsInline preload="metadata" />
          ) : (
            <Icon icon={KIND_ICON[input.kind]} />
          )}
        </span>
        <span className="m-k-card-text">
          <span className="m-k-card-title">
            {name}
            {input.required ? null : <span className="m-k-card-sub">{` (${T.guided.optional})`}</span>}
          </span>
          <span className="m-k-card-sub" data-testid="m-create-preset-input-state" aria-live="polite">
            {sub}
          </span>
        </span>
      </div>
      {trouble ? (
        <p className="m-cap m-k-trouble" role="alert" data-testid="m-create-preset-input-trouble">
          {troubleText(trouble)}
        </p>
      ) : null}
      <div className="m-k-card-actions">
        <Button onPress={() => void fromPhone()} disabled={disabled} label={`${attached ? T.guided.replace : T.guided.fromPhone}: ${name}`} risk={input.kind === 'image' ? 'sensor' : undefined} testid="m-create-preset-input-file">
          {attached ? T.guided.replace : T.guided.fromPhone}
        </Button>
        <Button onPress={() => openSheet({ view: 'gallery', slot: input.key })} disabled={disabled} label={`${T.guided.fromGallery}: ${name}`} testid="m-create-preset-input-gallery">
          {T.guided.fromGallery}
        </Button>
        {attached && !uploading ? (
          <Button variant="quiet" onPress={() => removeGuidedInput(input.key)} disabled={locked} label={T.guided.removeLabel(name)} testid="m-create-preset-input-remove">
            {T.guided.remove}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function ClipCard({ s, locked }: { s: GuidedState; locked: boolean }) {
  const clip = s.attached.source_url
  return (
    <div className="m-k-card" data-testid="m-create-preset-clip" data-state={clip ? 'set' : 'empty'} data-el="K12.7">
      <div className="m-k-card-head">
        <span className="m-k-thumb" aria-hidden="true">
          <Icon icon={Clapperboard} />
        </span>
        <span className="m-k-card-text">
          <span className="m-k-card-title">{T.guided.field.source_clip}</span>
          <span className="m-k-card-sub">{clip ? clip.name : T.guided.clipEmpty}</span>
        </span>
      </div>
      <div className="m-k-card-actions">
        <Button onPress={() => openSheet({ view: 'gallery', slot: 'source_url' })} disabled={locked} testid="m-create-preset-clip-pick">
          {clip ? T.guided.replace : T.guided.clipPick}
        </Button>
        {clip ? (
          <Button variant="quiet" onPress={() => setGuidedClip(null)} disabled={locked} testid="m-create-preset-clip-remove">
            {T.guided.remove}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function Running({ s }: { s: GuidedState }) {
  const progress = useCreateStore((c) => c.progress)
  const progressText = useCreateStore((c) => c.progressText)
  const progressPhase = useCreateStore((c) => c.progressPhase)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const phase = runPhase({ progress, phase: progressPhase, text: progressText })
  const clock = formatClock(s.startedAt ? (now - s.startedAt) / 1000 : 0)
  return (
    <div className="m-k-box m-k-box--pad m-k-run" data-testid="m-create-preset-running" data-state={s.submitting ? 'booking' : phase} aria-live="polite">
      <div className="m-k-run-line">{`${s.submitting ? T.guided.booking : T.phase[phase]} · ${clock}`}</div>
      <div className="m-k-run-ring">
        <Progress label={T.guided.running} />
      </div>
      <div className="m-cap">{T.guided.runningLeave}</div>
      <Button onPress={() => void cancelGuided()} busy={s.cancelling} testid="m-create-preset-cancel" el="K12.12">
        {s.cancelling ? T.guided.cancelling : T.guided.cancel}
      </Button>
    </div>
  )
}

function ResultMedia({ item }: { item: GalleryItem }) {
  const media = useItemMedia(item)
  if (media.state !== 'ok' || !media.url) {
    return (
      <div className="m-k-media">
        <MediaStateBox state={media.state === 'ok' ? 'refreshing' : media.state} onRetry={media.retry} />
      </div>
    )
  }
  if (item.type === 'image') {
    return (
      <button type="button" className="m-k-media" aria-label={T.guided.openResult} data-testid="m-create-preset-result-open" onClick={() => nav.push('/create/item/:id', { id: item.id })}>
        <img src={media.url} alt={itemName(item, 80)} onError={media.onError} />
      </button>
    )
  }
  return (
    <div className="m-k-media">
      {item.type === 'video' ? (
        <video src={media.url} controls playsInline preload="metadata" aria-label={itemName(item, 80)} onError={media.onError} />
      ) : (
        <audio src={media.url} controls preload="metadata" aria-label={itemName(item, 80)} onError={media.onError} />
      )}
    </div>
  )
}

function StepResult({ s }: { s: GuidedState }) {
  // Read through the store so a result that is signed again or removed shows at once.
  const item = useCreateStore((c) => {
    const done = s.done[s.index]
    return done ? c.gallery.find((g) => g.jobId === done.jobId || g.id === done.jobId) ?? null : null
  })
  if (!item) {
    return (
      <div className="m-k-pad">
        <Notice
          testid="m-create-preset-result-gone"
          actions={
            <Button compact onPress={() => nav.push('/create/gallery')} testid="m-create-preset-result-gallery">
              {T.guided.openGallery}
            </Button>
          }
        >
          {T.guided.resultGone}
        </Notice>
      </div>
    )
  }
  return (
    <div className="m-k-box" data-testid="m-create-preset-result" data-m-id={item.id} data-m-kind={item.type} data-el="K12.13">
      <ResultMedia item={item} />
      <div className="m-cap m-k-pad m-k-result-note">{T.guided.resultSaved}</div>
    </div>
  )
}

function Price({ s, view, missing }: { s: GuidedState; view: StepView; missing: Missing | null }) {
  const quota = useCloudAuthStore((c) => c.quota)
  const usable = priceUsable(s)
  const estimate = estimateOf(s)
  const short = usable && s.quote !== null && !!quota && quota.remaining.credits < s.quote
  const failed = !missing && !usable && !s.quoting && s.error !== null
  let value = ''
  let note: string | null = null
  if (usable && s.quote !== null) value = creditsLabel(s.quote)
  else if (estimate !== null && estimate > 0) value = T.guided.priceEstimate(creditsLabel(estimate))
  if (missing) note = missingText(missing)
  else if (failed) note = T.guided.priceFailed
  else if (!usable) note = T.guided.priceChecking
  else if (short) note = `${T.guided.notEnough}. ${T.walletShort(formatCredits(quota?.remaining.credits ?? 0))}`
  return (
    <div data-testid="m-create-preset-price" data-state={missing ? 'needs' : failed ? 'failed' : !usable ? 'checking' : short ? 'short' : 'known'} data-m-model={view.model}>
      <div className="m-k-foot-price" data-short={short ? '' : undefined}>
        <span>{T.guided.price}</span>
        <b data-testid="m-create-preset-price-value">{value}</b>
      </div>
      {note ? (
        <div className="m-cap" aria-live="polite">
          {note}
        </div>
      ) : null}
    </div>
  )
}

// ---------- the page ----------

function Unavailable() {
  return (
    <Page title={T.guided.title} screen="create-preset">
      <EmptyState
        title={T.guided.notFoundTitle}
        icon={Layers}
        testid="m-create-preset-missing"
        actions={
          <Button block onPress={() => nav.replace('/create/presets')} testid="m-create-preset-missing-back">
            {T.guided.backToPresets}
          </Button>
        }
      >
        {T.guided.notFoundText}
      </EmptyState>
    </Page>
  )
}

export default function PresetRunPage() {
  const { id } = useParams<{ id?: string }>()
  const { gate } = useGate()
  const wanted = guidedPresetById(id, { adult: adultPresetsAllowed() })
  const s = useGuided()
  const createBusy = useCreateStore((c) => c.isGenerating)
  const wantedId = wanted?.id
  useEffect(() => {
    if (wanted) openGuided(wanted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedId])
  const mine = !!wanted && s.preset?.id === wanted.id
  const view = mine ? viewOf(s) : null
  useGuidedPrice(s, view)

  if (!wanted) return <Unavailable />
  if (gate !== 'open' && gate !== 'checking') {
    return (
      <Page title={wanted.title} screen="create-preset">
        <EmptyState
          title={T.gateTitle}
          icon={Layers}
          testid="m-create-preset-gate"
          actions={
            <Button variant="cloud" block onPress={() => nav.switchTab('create')} testid="m-create-preset-gate-open">
              {T.guided.toCreate}
            </Button>
          }
        >
          {T.guided.gateText}
        </EmptyState>
      </Page>
    )
  }
  if (!mine || !view) {
    // Another preset is in the middle of a step: one runs at a time.
    const other = s.preset
    return (
      <Page title={wanted.title} screen="create-preset">
        {other && runBusy(s) ? (
          <Notice
            variant="warn"
            title={T.guided.otherTitle(other.title)}
            testid="m-create-preset-other"
            actions={
              <Button compact onPress={() => nav.replace('/create/presets/:id', { id: other.id })} testid="m-create-preset-other-open">
                {T.guided.openOther(other.title)}
              </Button>
            }
          >
            {T.guided.otherText}
          </Notice>
        ) : null}
      </Page>
    )
  }

  const busy = runBusy(s)
  const done = !!s.done[s.index]
  const locked = busy || done
  const draft = draftOf(s)
  const missing = stepMissing(view, draft)
  const usable = priceUsable(s)
  const fields = stepFields(view)
  const classic = classicControls(view)
  const moreCount = fields.other.length + (classic.negative ? 1 : 0)
  const word = promptWord(view.role)
  const host: SchemaHost = { model: view.model, options: s.options, set: setGuidedOption, disabled: locked }
  const seconds = classic.durations.length > 0 ? selectedVideoSeconds(view.model, Number(s.options.duration ?? 5) * 16, 16) : 0
  const hasSettings = fields.primary.length > 0 || classic.durations.length > 0 || classic.shotType || classic.voice || classic.voiceDescription || moreCount > 0

  const generate = () => {
    void withAiConsent(async () => {
      haptic('light')
      const refused = await runGuidedStep()
      if (refused === 'credits') signalCreditsExhausted('credits')
    })
  }
  const retry = () => {
    useGuided.setState({ error: null, round: s.round + 1 })
  }
  const startOver = async () => {
    const yes = await nav.confirm({ title: T.guided.startOverTitle, text: T.guided.startOverText, confirmLabel: T.guided.startOverConfirm, cancelLabel: T.guided.keep, testid: 'create-preset-start-over' })
    if (yes) startOverGuided()
  }
  const blocked = missing ? missingText(missing) : s.uploading ? T.guided.uploading : createBusy ? T.guided.busyElsewhere : !usable ? (s.error ? T.guided.priceFailed : T.guided.priceChecking) : undefined

  const footer = busy ? undefined : done ? (
    <div className="m-k-card-actions" data-testid="m-create-preset-after">
      <Button onPress={redoGuidedStep} label={T.guided.tryAgainLabel} testid="m-create-preset-again" el="K12.13">
        {T.guided.tryAgain}
      </Button>
      {view.last ? (
        <Button variant="primary" onPress={() => nav.push('/create/gallery')} testid="m-create-preset-done" el="K12.13">
          {T.guided.openGallery}
        </Button>
      ) : (
        <Button variant="primary" onPress={() => void nextGuidedStep()} label={T.guided.nextLabel(wanted.steps[s.index + 1].title)} testid="m-create-preset-next" el="K12.13">
          {T.guided.next}
        </Button>
      )}
    </div>
  ) : (
    <div className="m-k-gap">
      <Price s={s} view={view} missing={missing} />
      <Button variant="cloud" risk="paid" block icon={Sparkles} onPress={generate} disabled={blocked !== undefined} disabledReason={blocked} label={T.guided.generateStep(view.raw.title)} testid="m-create-preset-generate" el="K12.11">
        {T.guided.generate}
      </Button>
    </div>
  )

  return (
    <Page
      title={wanted.title}
      subtitle={wanted.steps.length > 1 ? T.guided.stepOf(s.index + 1, wanted.steps.length) : undefined}
      screen="create-preset"
      needsNetwork
      flush
      actions={guidedTouched(s) && !busy ? <IconButton icon={RotateCcw} label={T.guided.startOver} onPress={() => void startOver()} testid="m-create-preset-start-over" el="K12.14" /> : null}
      footer={footer}
    >
      <div className="m-k-gap m-k-guided" data-testid="m-create-preset" data-m-id={wanted.id} data-m-step={s.index} data-m-model={view.model} data-state={busy ? 'running' : done ? 'done' : 'input'}>
        <Steps s={s} />
        {wanted.steps.length < 2 || (s.index === 0 && wanted.note) ? (
          <div className="m-k-pad">
            {/* A preset of several steps names the step in the list above. */}
            {wanted.steps.length < 2 ? (
              <h2 className="m-k-guided-title" data-testid="m-create-preset-step-title">
                {view.raw.title}
              </h2>
            ) : null}
            {s.index === 0 && wanted.note ? <p className="m-cap">{wanted.note}</p> : null}
          </div>
        ) : null}

        {s.error ? (
          <div className="m-k-pad">
            <ErrorNotice message={s.error} stillBooked={false} onRetry={retry} retryDisabled={busy} inPlace onDismiss={() => useGuided.setState({ error: null })} testid="m-create-preset-error" />
          </div>
        ) : null}

        {busy ? <Running s={s} /> : null}
        {done && !busy ? <StepResult s={s} /> : null}

        {/* While a step renders, the page is the run alone. What was put in is kept and comes back. */}
        {done || busy ? null : (
          <>
            <ListGroup>
              <Row
                icon={Layers}
                title={T.guided.model}
                value={view.label}
                subtitle={view.hint ?? (stepHasChoice(view) ? undefined : T.guided.modelOnly)}
                label={stepHasChoice(view) ? T.guided.modelChange(view.label) : undefined}
                onPress={stepHasChoice(view) && !locked ? () => openSheet({ view: 'model' }) : undefined}
                testid="m-create-preset-model"
                el="K12.6"
              />
            </ListGroup>

            {view.inputs.map((input) => (
              <InputCard key={input.key} input={input} s={s} locked={locked} />
            ))}
            {view.needsGalleryClip ? <ClipCard s={s} locked={locked} /> : null}

            {view.promptShown && view.promptChoices ? (
              <ListGroup>
                <Row icon={Sparkles} title={T.guided.style} value={s.prompt || undefined} subtitle={s.prompt ? undefined : T.guided.styleNone} onPress={locked ? undefined : () => openSheet({ view: 'style' })} testid="m-create-preset-style" el="K12.8" />
              </ListGroup>
            ) : null}
            {view.promptShown && !view.promptChoices ? (
              <div className="m-k-sec">
                <TextArea
                  label={T.guided.prompt[word]}
                  placeholder={T.guided.promptPlaceholder[word]}
                  hint={view.promptRequired ? undefined : T.guided.promptOptional}
                  value={s.prompt}
                  onChange={setGuidedPrompt}
                  rows={3}
                  maxLength={4000}
                  disabled={locked}
                  testid="m-create-preset-prompt"
                  el="K12.8"
                />
                {view.ideas.length > 0 ? (
                  <div>
                    <Chip kind="action" icon={Lightbulb} onPress={() => openSheet({ view: 'ideas' })} disabled={locked} testid="m-create-preset-ideas" el="K12.9">
                      {T.guided.ideas}
                    </Chip>
                  </div>
                ) : null}
              </div>
            ) : null}

            {hasSettings ? (
              <section className="m-k-gap" data-testid="m-create-preset-settings" data-el="K12.10">
                <h3 className="m-label m-k-label">{T.guided.settings}</h3>
                {fields.primary.length > 0 ? <SchemaFields host={host} only={fields.primary} onOpen={(sub) => openSheet({ view: 'field', sub })} /> : null}
                {classic.durations.length > 1 ? (
                  <div className="m-k-sec">
                    <span className="m-label">{T.guided.duration}</span>
                    <Segmented
                      label={T.guided.duration}
                      value={String(seconds)}
                      onChange={(v) => setGuidedOption('duration', Number(v))}
                      options={classic.durations.slice(0, 6).map((d) => ({ value: String(d), label: T.run.seconds(d), disabled: locked, testid: `m-create-preset-length-${d}` }))}
                      testid="m-create-preset-length"
                    />
                  </div>
                ) : null}
                {classic.shotType ? (
                  <div className="m-k-sec">
                    <span className="m-label">{T.guided.shotType}</span>
                    <Segmented
                      label={T.guided.shotType}
                      value={s.options.shot_type === 'multi' ? 'multi' : 'single'}
                      onChange={(v) => setGuidedOption('shot_type', v)}
                      options={[
                        { value: 'single', label: T.guided.shotSingle, disabled: locked, testid: 'm-create-preset-shot-single' },
                        { value: 'multi', label: T.guided.shotMulti, disabled: locked, testid: 'm-create-preset-shot-multi' },
                      ]}
                      testid="m-create-preset-shot"
                    />
                  </div>
                ) : null}
                {classic.voiceDescription ? (
                  <div className="m-k-sec">
                    <TextArea label={T.guided.voiceDescription} hint={T.guided.voiceDescriptionHint} value={String(s.options.voice_description ?? '')} onChange={(v) => setGuidedOption('voice_description', v)} rows={2} maxLength={500} disabled={locked} testid="m-create-preset-voice-description" />
                  </div>
                ) : null}
                {classic.voice || moreCount > 0 ? (
                  <ListGroup>
                    {classic.voice ? (
                      <Row icon={AudioLines} title={T.guided.voice} value={String(s.options.voice ?? 'Serena').replaceAll('_', ' ')} onPress={locked ? undefined : () => openSheet({ view: 'voice' })} testid="m-create-preset-voice" />
                    ) : null}
                    {moreCount > 0 ? (
                      <Row icon={SlidersHorizontal} title={T.guided.more} subtitle={T.guided.moreSub(moreCount)} onPress={locked ? undefined : () => openSheet({ view: 'more' })} testid="m-create-preset-more" />
                    ) : null}
                  </ListGroup>
                ) : null}
              </section>
            ) : null}

            <p className="m-cap m-k-pad">{T.guided.billed}</p>
          </>
        )}
      </div>
    </Page>
  )
}
