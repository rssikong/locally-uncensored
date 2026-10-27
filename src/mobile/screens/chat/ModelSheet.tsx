/**
 * C3 Model. Sheet "model", strand 1 (Chat core).
 *
 * Others open it with nav.openSheet('model', { onPick }). With `onPick` the
 * sheet only answers with the chosen name and changes nothing itself (C9,
 * C13). Without it the choice becomes the model of the chat, and the mode
 * follows the choice (C3.1): a cloud model switches to Cloud after the
 * question G11, an on device model switches back at once.
 *
 * Sub page "price:<model>": the price for 1,000 words in and out (C3.8).
 */
import { useEffect, useMemo, useState } from 'react'
import { Info, Search } from 'lucide-react'
import { useCloudSession } from '../../../hooks/useCloudSession'
import { useModels } from '../../../hooks/useModels'
import { formatBytes, formatContextWindow } from '../../../lib/formatters'
import { dismissEngineError, useEngineView } from '../../../lib/engine-view'
import { declaredVision } from '../../../lib/model-compatibility'
import { modelDisplayLabel } from '../../../lib/model-label'
import { filterRows, pickerGroups, pickerRows, PICKER_FILTERS, type PickerFilter, type PickerRow } from '../../../lib/model-picker'
import { STATEMENT_MARK_LABEL } from '../../../lib/unfiltered-mark'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import { useDownloadStore } from '../../../stores/downloadStore'
import { useModelStore } from '../../../stores/modelStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useUIStore } from '../../../stores/uiStore'
import { MOBILE_CHAT_MODELS } from '../../data/mobile-models'
import { displayModelName } from '../../../api/providers/model-name'
import { assessFit, fitModelOfFile, type FitDevice } from '../../lib/device-fit'
import { deviceFileLabel, factsOfChatModel } from '../../lib/model-facts'
import { nav, useSheet } from '../../nav'
import { getFitDevice } from '../../platform'
import { useCloudOnline } from '../../resilience/useOnline'
import { CHAT_STRINGS } from '../../strings/chat'
import { MODELS_STRINGS } from '../../strings/models'
import { BetaTag, Button, Chip, ChipGroup, EmptyState, Field, FitBadge, IconButton, ListGroup, Notice, Row, Segmented, Sheet, SkeletonRows, Spinner, Tag, toast, type FitLevel } from '../../ui'
import { readsImages } from '../models/parts/fit'
import { useModelsView } from '../models/parts/view'
import { enterCloud, leaveCloud } from '../settings/parts/cloud-mode'
import './parts/chat.css'
import { chatModelLabel } from './parts/model-name'
import { visionWay } from './parts/logic/chat-state'
import { imagesRowState, type ImagesRowState } from './parts/attach-rules'
import { modelReadsImages } from './parts/vision'
import { cheapestRow, creditsPer1000Words, downloadPercent, priceText, splitModels } from './parts/logic/model-rows'
import { offeredCloudRows, offeredPickerFilters, purchaseHint, storeCloudModels } from './parts/logic/policy'
import { DirectMark } from '../../policy/DirectMark'
import { unfilteredMarksShown } from '../../policy/unfiltered'
import { storePolicy } from './parts/policy'

const S = CHAT_STRINGS.model

/** The title over the sheet when it was opened to find a model that reads images. `ready`: the user has just chosen one. */
const VISION_TITLE: Record<ImagesRowState, string | undefined> = {
  ready: undefined,
  'none-installed': S.visionTitleNoneInstalled,
  'no-model': S.visionTitleNoModel,
  gone: S.visionTitleGone,
  'no-vision': S.visionTitle,
}

export interface ModelSheetProps {
  /** Answer with the chosen name instead of changing the model of the chat. */
  onPick?: (name: string) => void
  /** Open on this list. Default: the mode the app is in. */
  segment?: 'local' | 'cloud'
  /** Start with the filter Vision, after "This model cannot read images" (C4). */
  vision?: boolean
}

const FILTER_TEXT: Record<PickerFilter, string> = {
  marked: S.filterMarked,
  vision: S.filterVision,
  thinking: S.filterThinking,
  free: S.filterFree,
}

function useFitDevice(): FitDevice | null {
  const [device, setDevice] = useState<FitDevice | null>(null)
  useEffect(() => {
    let alive = true
    getFitDevice()
      .then(({ resolved }) => {
        if (alive && resolved.source !== 'unknown') setDevice(resolved.device)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return device
}

function PricePage({ row }: { row: PickerRow | undefined }) {
  return (
    <Sheet title={S.priceTitle}>
      <div className="m-chat-price" data-testid="m-chat-model-price-page">
        {row ? <strong>{row.label}</strong> : null}
        {row?.free ? <p className="m-cap">{S.priceFree}</p> : null}
        {row?.rates ? (
          <>
            <div>
              <div className="m-chat-price-row">
                <span>{S.priceIn}</span>
                <strong data-testid="m-chat-model-price-in">{S.priceCredits(priceText(creditsPer1000Words(row.rates.inputPerMillion)))}</strong>
              </div>
              <div className="m-chat-price-row">
                <span>{S.priceOut}</span>
                <strong data-testid="m-chat-model-price-out">{S.priceCredits(priceText(creditsPer1000Words(row.rates.outputPerMillion)))}</strong>
              </div>
            </div>
            <p className="m-cap">{S.priceNote}</p>
          </>
        ) : (
          <p className="m-cap">{S.priceNone}</p>
        )}
      </div>
    </Sheet>
  )
}

export default function ModelSheet() {
  const sheet = useSheet<ModelSheetProps | undefined>()
  const props = sheet.props ?? {}
  const { setActiveModel: activate, fetchModels, inventoryLoaded, inventoryRefreshing } = useModels()
  const { cloudAvailable } = useCloudSession()
  const authStatus = useCloudAuthStore((s) => s.status)
  const paidPlan = useCloudAuthStore((s) => s.paidPlan)
  const online = useCloudOnline()
  const engine = useEngineView()
  const device = useFitDevice()

  const allModels = useModelStore((s) => s.models)
  const activeModel = useModelStore((s) => s.activeModel)
  // One source for "chosen" against "in memory": src/lib/engine-view.ts. null while nobody knows.
  const inMemory = engine.state === 'ready' ? true : engine.state === 'not-loaded' ? false : null
  const appMode = useSettingsStore((s) => s.settings.appMode)
  const downloads = useDownloadStore((s) => s.downloads)

  // Asked once, when the sheet opens: is there a model on this phone that reads images. Without one
  // the sheet for "attach a photo" opens on LU Cloud, where such models are, instead of an empty list (M3).
  const [localVisionAtOpen] = useState(() => splitModels(useModelStore.getState().models).device.some((m) => declaredVision(m) === true))
  const [segment, setSegment] = useState<'local' | 'cloud'>(props.segment ?? (appMode === 'cloud' || (props.vision && (cloudAvailable || !localVisionAtOpen)) ? 'cloud' : 'local'))
  const [visionOnly, setVisionOnly] = useState(!!props.vision)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<ReadonlySet<PickerFilter>>(() => new Set<PickerFilter>(props.vision ? ['vision'] : []))
  const [retrying, setRetrying] = useState(false)

  const split = useMemo(() => splitModels(allModels), [allModels])
  const deviceRows = useMemo(() => (visionOnly ? split.device.filter((m) => declaredVision(m) === true) : split.device), [split.device, visionOnly])
  // The store switches (policy/unfiltered.ts): a build without the unfiltered catalogue lists no marked model. A build that
  // may not advertise shows no mark, no group head and no filter, and names the models the way the catalogue route does.
  const policy = useMemo(() => storePolicy(), [])
  const marksShown = unfilteredMarksShown(policy)
  const storeCloud = useMemo(() => storeCloudModels(split.cloud, policy), [split.cloud, policy])
  const cloudRows = useMemo(() => offeredCloudRows(pickerRows(storeCloud, paidPlan), policy.unfilteredCatalog), [storeCloud, paidPlan, policy])
  // The models this build shows under the mark "Direct" in place of a word in their name (switch directBadge).
  const directNames = useMemo(() => new Set(storeCloud.filter((m) => m.direct).map((m) => m.name)), [storeCloud])
  const shownCloud = useMemo(() => filterRows(cloudRows, query, filters), [cloudRows, query, filters])
  const cheapest = useMemo(() => cheapestRow(cloudRows), [cloudRows])
  const running = useMemo(() => Object.entries(downloads).filter(([, d]) => d.status !== 'complete'), [downloads])

  // Why the user was sent here from "Add to message": the title says that, and only speaks of a chosen model when
  // there is one that reads no images (check on the iPhone, round 22, N11).
  const visionAsk = imagesRowState(activeModel, allModels, (name) => modelReadsImages(name, allModels))
  const way = visionWay(split.device.some((m) => declaredVision(m) === true), MOBILE_CHAT_MODELS.some(readsImages))
  /** The Models tab on "Get new", whatever it showed last. With `vision` the catalogue is narrowed to models that read images. */
  const toCatalog = (vision = false) => {
    const view = useModelsView.getState()
    view.setSegment('new')
    if (vision) view.setFilters({ ...view.filters, fitsOnly: false, vision: true })
    nav.resetTo('models')
  }

  if (sheet.sub?.startsWith('price:')) {
    const name = sheet.sub.slice('price:'.length)
    return <PricePage row={cloudRows.find((r) => r.name === name)} />
  }

  /**
   * The radio of a model row. A tap on the model that is already chosen closes
   * the sheet and does not pick again (a pick loads the model). Where the sheet
   * picks for somebody else (props.onPick) that tap does nothing, as before.
   */
  const pickOrClose = (checked: boolean, pick: () => void) => ({
    checked,
    onSelect: () => (checked ? sheet.close() : pick()),
    reselect: checked && !props.onPick,
  })

  const pickLocal = (name: string) => {
    if (props.onPick) {
      props.onPick(name)
      sheet.close()
      return
    }
    // The one door of the mode (settings/parts/cloud-mode.ts). The sheet says it in its own words.
    if (leaveCloud({ quiet: true })) toast(S.backOnDevice, { testid: 'back-on-device' })
    dismissEngineError()
    void activate(name)
    sheet.close()
  }

  const pickCloud = async (name: string) => {
    if (props.onPick) {
      props.onPick(name)
      sheet.close()
      return
    }
    if (appMode !== 'cloud') {
      // G11 asks, and the one door switches. The tapped model is remembered right before the switch,
      // so the mode does not pick another one. False: the user stayed on the device.
      const entered = await enterCloud({ quiet: true, beforeSwitch: () => useUIStore.getState().setPendingCloudModel(name) })
      if (!entered) return
    }
    useModelStore.getState().setActiveModel(name)
    sheet.close()
  }

  const toggleFilter = (filter: PickerFilter) =>
    setFilters((current) => {
      const next = new Set(current)
      if (next.has(filter)) next.delete(filter)
      else next.add(filter)
      return next
    })

  const retryCatalog = () => {
    setRetrying(true)
    void fetchModels()
      .catch(() => {})
      .finally(() => setRetrying(false))
  }

  const fitOf = (name: string, size: number): { level: FitLevel; text?: string } => {
    if (!device || !(size > 0)) return { level: 'unknown' }
    // By name and size, like the list "Installed": another quantization of a catalogue model keeps that model's verdict.
    const result = assessFit({ device, model: fitModelOfFile(displayModelName(name), size) })
    // A small model packed very hard is tight for its answers, and the badge says that, like the card in Models.
    return { level: result.verdict, text: result.coarse ? MODELS_STRINGS.fit.coarse : undefined }
  }

  const localList = (
    <>
      {engine.state === 'error' && engine.note ? (
        <Notice
          variant="error"
          title={CHAT_STRINGS.engine.failed}
          testid="m-chat-model-engine-error"
          actions={
            <>
              {activeModel && split.device.some((m) => m.name === activeModel) ? (
                <Button
                  compact
                  variant="primary"
                  onPress={() => {
                    dismissEngineError()
                    void activate(activeModel)
                  }}
                  testid="m-chat-model-engine-retry"
                >
                  {CHAT_STRINGS.engine.retry}
                </Button>
              ) : null}
              <Button compact onPress={dismissEngineError} testid="m-chat-model-engine-dismiss">
                {CHAT_STRINGS.engine.dismiss}
              </Button>
            </>
          }
        >
          {engine.note}
        </Notice>
      ) : null}
      {split.device.length === 0 && split.providers.length === 0 ? (
        inventoryLoaded || !inventoryRefreshing ? (
          <EmptyState
            title={S.noLocal}
            testid="m-chat-model-empty"
            actions={
              <Button variant="primary" onPress={() => toCatalog()} testid="m-chat-model-get-more" el="C3.4">
                {S.getMore}
              </Button>
            }
          />
        ) : (
          <SkeletonRows rows={3} label={S.title} />
        )
      ) : null}
      {props.vision && split.device.length > 0 ? (
        <div className="m-chat-sheet-tools">
          <ChipGroup label={S.filters}>
            <Chip kind="filter" selected={visionOnly} onPress={() => setVisionOnly((on) => !on)} testid="m-chat-model-local-vision">
              {S.filterVision}
            </Chip>
          </ChipGroup>
          {visionOnly && deviceRows.length === 0 ? (
            <p className="m-cap" data-testid="m-chat-model-local-vision-none">
              {S.visionNoneLocal}
            </p>
          ) : null}
        </div>
      ) : null}
      {deviceRows.length > 0 ? (
        <ListGroup title={S.localGroup} role="radiogroup" label={S.localGroup}>
          {deviceRows.map((model) => {
            const checked = model.name === activeModel
            const fit = fitOf(model.name, model.size)
            const vision = declaredVision(model) ?? false
            // What the catalogue says about the model behind this file, in whatever packing: the marks of the card in Models.
            const facts = factsOfChatModel(model.name)
            // The row knows three states of its own: loading, failed, and chosen. Whether the chosen one is in memory is the tag below.
            const state = checked && (engine.state === 'loading' || engine.state === 'error') ? engine.state : 'none'
            return (
              <Row
                key={model.name}
                id={model.name}
                state={checked ? (state === 'none' ? 'ready' : state) : 'idle'}
                testid="m-chat-model-local"
                el="C3.2"
                title={chatModelLabel(allModels, model.name)}
                radio={pickOrClose(checked, () => pickLocal(model.name))}
                subtitle={
                  <span className="m-chat-model-sub">
                    <span className="m-chat-model-size">{model.size > 0 ? formatBytes(model.size) : S.sizeUnknown}</span>
                    {vision ? <Tag>{S.tagVision}</Tag> : null}
                    {facts?.thinking ? (
                      <span style={{ display: 'contents' }} data-testid="m-chat-model-local-thinking">
                        <Tag>{S.tagThinking}</Tag>
                      </span>
                    ) : null}
                    {facts?.tools ? (
                      <span style={{ display: 'contents' }} data-testid="m-chat-model-local-tools">
                        <Tag>{S.tagTools}</Tag>
                      </span>
                    ) : null}
                    {checked && state === 'loading' ? (
                      <>
                        <Spinner label={CHAT_STRINGS.engine.loading} />
                        <span>{CHAT_STRINGS.engine.loading}</span>
                      </>
                    ) : checked && state === 'error' ? (
                      <Tag>{CHAT_STRINGS.engine.failed}</Tag>
                    ) : checked && inMemory === true ? (
                      <Tag accent>{S.loaded}</Tag>
                    ) : checked && inMemory === false ? (
                      <span data-testid="m-chat-model-loads-later">{S.loadsOnSend}</span>
                    ) : null}
                    {/* Without a reading of this phone there is no verdict. The size next to it already says what is known. */}
                    {fit.level !== 'unknown' ? <FitBadge level={fit.level} text={fit.text} /> : null}
                  </span>
                }
              />
            )
          })}
        </ListGroup>
      ) : null}
      {running.length > 0 ? (
        <ListGroup title={S.downloadsGroup}>
          {running.map(([id, d]) => (
            <Row
              key={id}
              id={id}
              state={d.status}
              testid="m-chat-model-download"
              el="C3.3"
              title={deviceFileLabel(d.filename) ?? d.filename.replace(/\.gguf$/i, '')}
              subtitle={d.status === 'error' ? S.downloadStopped : d.status === 'paused' ? S.downloadPaused : S.downloadRow(downloadPercent(d.progress, d.total))}
              onPress={() => nav.resetTo('models', [{ route: '/models/downloads' }])}
            />
          ))}
        </ListGroup>
      ) : null}
      {split.providers.length > 0 ? (
        <ListGroup title={S.providersGroup} role="radiogroup" label={S.providersGroup}>
          {split.providers.map((model) => (
            <Row
              key={model.name}
              id={model.name}
              testid="m-chat-model-provider"
              el="C3.11"
              title={modelDisplayLabel(allModels, model.name)}
              subtitle={'providerName' in model ? model.providerName : undefined}
              radio={pickOrClose(model.name === activeModel, () => pickLocal(model.name))}
            />
          ))}
        </ListGroup>
      ) : null}
      {split.device.length > 0 || split.providers.length > 0 ? (
        <ListGroup>
          <Row title={S.getMore} onPress={() => toCatalog()} testid="m-chat-model-get-more" el="C3.4" />
        </ListGroup>
      ) : null}
    </>
  )

  let cloudList
  if (!cloudAvailable && authStatus !== 'signed-in') {
    cloudList =
      authStatus === 'probing' ? (
        <SkeletonRows rows={3} label={S.catalogLoading} />
      ) : (
        <EmptyState
          title={S.cloud}
          testid="m-chat-model-signin-state"
          actions={
            <Button variant="cloud" onPress={() => nav.resetTo('settings', [{ route: '/settings/account' }])} testid="m-chat-model-signin" el="C3.9">
              {S.signIn}
            </Button>
          }
        >
          {S.signInText}
        </EmptyState>
      )
  } else if (!cloudAvailable) {
    const hint = purchaseHint(storePolicy().purchase, { title: S.cloud, text: S.plansText, action: S.seePlans, textOnly: CHAT_STRINGS.policy.plansTextOnly, neutralTitle: S.cloud, neutralText: CHAT_STRINGS.policy.plansOff })
    cloudList = (
      <EmptyState
        title={hint.title}
        testid="m-chat-model-plans-state"
        actions={
          hint.action ? (
            <Button variant="cloud" onPress={() => nav.push('/cloud')} testid="m-chat-model-plans" el="C3.10">
              {hint.action}
            </Button>
          ) : undefined
        }
      >
        {hint.text}
      </EmptyState>
    )
  } else if (cloudRows.length === 0) {
    cloudList =
      (inventoryRefreshing || retrying || !inventoryLoaded) && online ? (
        <div data-testid="m-chat-model-catalog-loading">
          <SkeletonRows rows={4} label={S.catalogLoading} />
          <p className="m-cap m-pad">{S.catalogLoading}</p>
        </div>
      ) : (
        <Notice
          variant="error"
          testid="m-chat-model-catalog-error"
          actions={
            <Button compact variant="primary" busy={retrying} onPress={retryCatalog} testid="m-chat-model-catalog-retry">
              {S.tryAgain}
            </Button>
          }
        >
          {S.catalogError}
        </Notice>
      )
  } else {
    cloudList = (
      <>
        <div className="m-chat-sheet-tools">
          <Field label={S.search} hideLabel placeholder={S.search} type="search" icon={Search} clearable value={query} onChange={setQuery} testid="m-chat-model-search" el="C3.5" />
          <ChipGroup label={S.filters}>
            {offeredPickerFilters(PICKER_FILTERS, marksShown).map((filter) => (
              <Chip key={filter} kind="filter" selected={filters.has(filter)} onPress={() => toggleFilter(filter)} testid={`m-chat-model-filter-${filter}`} el="C3.6">
                {FILTER_TEXT[filter]}
              </Chip>
            ))}
          </ChipGroup>
        </div>
        {shownCloud.length === 0 ? (
          <EmptyState
            title={S.noMatch}
            icon={Search}
            testid="m-chat-model-nomatch"
            actions={
              <Button
                onPress={() => {
                  setQuery('')
                  setFilters(new Set())
                }}
                testid="m-chat-model-nomatch-action"
              >
                {S.clearFilters}
              </Button>
            }
          />
        ) : (
          // One group per family of models, each under its own head; a search shows one list of hits.
          pickerGroups(shownCloud, query.trim().length > 0).map((group) => (
          <ListGroup
            key={group.family ?? 'all'}
            title={group.family ?? S.cloudGroup}
            // The models under the statement head are new in LU Cloud: the head carries the Beta mark, as on the desktop.
            titleMark={group.family === STATEMENT_MARK_LABEL ? <BetaTag feature="direct-models" /> : undefined}
            role="radiogroup"
            label={group.family ?? S.cloudGroup}
            testid="m-chat-model-family"
          >
            {group.rows.map((row) => (
              <Row
                key={row.name}
                id={row.name}
                testid={row.name === cheapest ? 'm-chat-model-cloud-cheapest' : 'm-chat-model-cloud'}
                el="C3.7"
                title={row.label}
                radio={pickOrClose(row.name === activeModel, () => void pickCloud(row.name))}
                trailing={
                  <>
                    {directNames.has(row.name) ? <DirectMark testid="m-chat-model-direct" /> : null}
                    <IconButton icon={Info} label={S.priceFor(row.label)} onPress={() => sheet.pushSub(`price:${row.name}`)} testid="m-chat-model-price" el="C3.8" />
                  </>
                }
                subtitle={
                  <span className="m-chat-model-sub">
                    {row.context ? <span className="m-chat-model-size">{formatContextWindow(row.context)}</span> : null}
                    {row.mark === 'statement' ? <Tag accent>{S.tagStatement}</Tag> : null}
                    {row.mark === 'measured' ? <Tag>{S.tagMeasured}</Tag> : null}
                    {row.free ? <Tag accent>{S.tagFree}</Tag> : null}
                    {row.vision ? <Tag>{S.tagVision}</Tag> : null}
                    {row.thinking ? <Tag>{S.tagThinking}</Tag> : null}
                    {row.chatOnly ? <Tag>{S.tagChatOnly}</Tag> : null}
                    {row.limitedCapacity ? (
                      <span className="m-chat-model-note" data-testid="m-chat-model-limited">
                        {S.limitedCapacity}
                      </span>
                    ) : null}
                  </span>
                }
              />
            ))}
          </ListGroup>
          ))
        )}
      </>
    )
  }

  return (
    <Sheet title={S.title}>
      <div className="m-chat-sheet-tools">
        <Segmented
          label={S.segmentLabel}
          value={segment}
          onChange={setSegment}
          options={[
            { value: 'local', label: S.onDevice, testid: 'm-chat-model-segment-local' },
            { value: 'cloud', label: S.cloud, testid: 'm-chat-model-segment-cloud' },
          ]}
          testid="m-chat-model-segment"
          el="C3.1"
        />
      </div>
      {props.vision ? (
        <Notice
          title={VISION_TITLE[visionAsk]}
          testid="m-chat-model-vision-way"
          actions={
            way === 'catalog' ? (
              <Button compact variant="primary" onPress={() => toCatalog(true)} testid="m-chat-model-vision-catalog">
                {S.visionShowCatalog}
              </Button>
            ) : way === 'cloud' && segment !== 'cloud' ? (
              <Button compact variant="cloud" onPress={() => setSegment('cloud')} testid="m-chat-model-vision-cloud">
                {S.visionShowCloud}
              </Button>
            ) : undefined
          }
        >
          <span data-m-way={way} data-m-vision-ask={visionAsk}>{way === 'installed' ? S.visionInstalled : way === 'catalog' ? S.visionCatalog : S.visionCloud}</span>
        </Notice>
      ) : null}
      <div data-testid="m-chat-model-list" data-m-segment={segment} data-state={engine.state === 'not-loaded' ? 'ready' : engine.state} data-m-loaded={inMemory === null ? 'unknown' : inMemory ? 'yes' : 'no'}>
        {segment === 'local' ? localList : cloudList}
      </div>
    </Sheet>
  )
}

