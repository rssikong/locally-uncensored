/**
 * A2 Pick a starter model. Route /setup/model, onboarding step, strand 4.
 *
 * One small model to get running. The list comes from the phone catalogue
 * (data/mobile-models.ts), the verdict and the proposal from the memory of
 * THIS phone (lib/device-fit.ts). Too large models are shown and cannot be
 * picked. The download runs through the same door as in Models.
 *
 * Elements of DESIGN.md: A2.1 back, A2.2 segment, A2.3 model card (radio),
 * A2.4 download, A2.5 skip, A2.6 pause and resume, A2.7 cancel, A2.8
 * continue, A2.9 use this model.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { formatBytes } from '../../../lib/formatters'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import type { MobileModel } from '../../data/mobile-models'
import { MOBILE_CHAT_MODELS } from '../../data/mobile-models'
import { nav } from '../../nav'
import { useOnline } from '../../resilience/useOnline'
import { MODELS_STRINGS as S } from '../../strings/models'
import { Button, FitBadge, Notice, OfflineIcon, Page, Segmented, SkeletonCards, Tag, toast } from '../../ui'
import { Block, CardHead, CardName, FootStack, ItemCard, MonoLine, Para, useScreenFit } from '../models/parts/bits'
import { planOfCatalog } from '../models/parts/catalog'
import { useDevice } from '../models/parts/device'
import { isFailure } from '../models/parts/download-state'
import { answersPoorly, deviceLine, fitOfCatalogModel, fitWord, type FitView } from '../models/parts/fit'
import { fileOf, useInstalled } from '../models/parts/installed'
import { listsUnfiltered, shownFacts, startersFor, storePolicy } from '../models/parts/policy'
import { useRecheck } from '../models/parts/recheck'
import { startDownload } from '../models/parts/start-download'
import { Transfer, useTransferKind } from '../models/parts/Transfer'
import { useUseInChat } from '../models/parts/use-in-chat'
import { installModelsWatch } from '../models/parts/watch'
import { useFlow } from './parts/flow'
import { Steps } from './parts/Steps'

type Kind = 'mainstream' | 'unfiltered'


function tooLargeToast(fit: FitView): void {
  toast(fit.needBytes > 0 ? S.fit.tooLargeToast(formatBytes(fit.needBytes), formatBytes(fit.usableBytes)) : S.fit.tooSmallDevice, { testid: 'too-large' })
}

interface StarterCardProps {
  model: MobileModel
  fit: FitView
  recommended: boolean
  selected: boolean
  installed: boolean
  locked: boolean
  onPick: () => void
}

function StarterCard({ model, fit, recommended, selected, installed, locked, onPick }: StarterCardProps) {
  const tooLarge = fit.level === 'too-large' && !installed
  // Without marks the description of a model that does not refuse is left out: it says exactly that.
  const shown = shownFacts(storePolicy(), model)
  return (
    <ItemCard testid="m-onboarding-model-card" id={model.id} state={tooLarge ? 'too-large' : selected ? 'selected' : 'idle'} selected={selected}>
      <CardHead
        label={S.setupModel.cardName(model.name, formatBytes(model.sizeBytes), fitWord(fit))}
        testid={recommended ? 'm-onboarding-model-recommended' : tooLarge ? 'm-onboarding-model-item-toolarge' : 'm-onboarding-model-item'}
        el="A2.3"
        radio={{ checked: selected, disabled: tooLarge || locked }}
        onPress={() => {
          if (tooLarge) tooLargeToast(fit)
          else if (!locked) onPick()
        }}
      >
        <CardName>{model.name}</CardName>
        <MonoLine parts={[formatBytes(model.sizeBytes)]} />
        {recommended || installed || model.thinking || model.agent === true ? (
          <span className="m-tags">
            {recommended ? <Tag accent>{S.common.recommended}</Tag> : null}
            {installed ? <Tag>{S.common.installed}</Tag> : null}
            {model.thinking ? <Tag>{S.models.tagThinking}</Tag> : null}
            {/* The same marks as the card of the catalogue: this card showed "Thinking" alone (acceptance Android 8 GB, B14). */}
            {model.agent === true ? (
              <span style={{ display: 'contents' }} data-testid="m-onboarding-model-tools">
                <Tag>{S.models.tagTools}</Tag>
              </span>
            ) : null}
          </span>
        ) : null}
        {shown.description ? <span className="m-cap">{shown.description}</span> : null}
        {answersPoorly(model) ? (
          <span className="m-cap" style={{ color: 'var(--m-warn)' }} data-testid="m-onboarding-model-weak">
            {S.models.weakNote}
          </span>
        ) : null}
        <FitBadge level={fit.level} text={fitWord(fit)} testid="m-onboarding-model-fit" />
        {tooLarge && fit.short ? (
          <span className="m-cap" data-testid="m-onboarding-model-toolarge-hint">
            {fit.short}
          </span>
        ) : null}
      </CardHead>
    </ItemCard>
  )
}

export default function SetupModelPage() {
  const [choice, setChoice] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const { ready, device, freeBytes } = useDevice()
  const installed = useInstalled()
  const online = useOnline()
  const { checking, recheck } = useRecheck()
  const signedIn = useCloudAuthStore((s) => s.status === 'signed-in')
  const picked = useFlow((s) => s.picked)
  const setPicked = useFlow((s) => s.setPicked)
  const [kind, setKind] = useState<Kind>(() => (MOBILE_CHAT_MODELS.find((m) => m.filename === picked)?.uncensored ? 'unfiltered' : 'mainstream'))
  const setChatModel = useUseInChat()
  const policy = useMemo(() => storePolicy(), [])
  const list = useMemo(() => startersFor(policy, device, kind === 'unfiltered'), [device, kind, policy])

  useEffect(() => {
    installModelsWatch()
  }, [])

  // A download of this flow holds the choice: its card stays the chosen one until it is done or cancelled.
  const pickedKind = useTransferKind(picked ?? '')
  const pickedModel = picked ? MOBILE_CHAT_MODELS.find((m) => m.filename === picked) : undefined
  const moving = !!pickedModel && pickedKind !== null && pickedKind !== 'done'
  // Without a choice made on this page (a restart in the middle of the flow), the remembered pick stays the chosen card.
  const remembered = choice === null && pickedModel ? list.models.find((m) => m.id === pickedModel.id) : undefined
  const model = moving ? pickedModel : (list.models.find((m) => m.id === choice) ?? remembered ?? list.recommended ?? null)
  const fit = model ? fitOfCatalogModel(model, device) : null
  const file = model ? fileOf(installed.files, model.filename) : undefined
  const fetchedHere = !!model && !!file && picked === model.filename
  const failed = moving && pickedKind !== null && isFailure(pickedKind)
  const loading = !ready || !installed.ready
  const { short } = useScreenFit()

  const next = () => nav.push('/setup/documents')

  const download = async () => {
    if (!model || !fit || starting) return
    setStarting(true)
    try {
      const outcome = await startDownload({ name: model.name, files: planOfCatalog(model), fit })
      if (outcome === 'started' || outcome === 'installed') setPicked(model.filename)
    } finally {
      setStarting(false)
    }
  }

  const takeThis = async () => {
    if (!model || !file) return
    setPicked(model.filename)
    await setChatModel(file)
    next()
  }

  const skip = () => {
    if (signedIn) toast(S.setupModel.cloudOnlyToast, { testid: 'cloud-only' })
    next()
  }

  // The parts of the footer. On a screen that is short for its text (320x568 at 200 percent, a phone on its side)
  // only the main button stays down there; progress, the hint and "Skip" move into the page, right under the
  // line about this phone, so the list keeps its room and nothing has to be scrolled inside the footer.
  const continueButton = (primary: boolean) => (
    <Button variant={primary ? 'primary' : 'default'} block testid="m-onboarding-next" el="A2.8" onPress={next}>
      {S.common.continue}
    </Button>
  )
  const skipButton = (
    <Button variant="quiet" block testid="m-onboarding-skip" el="A2.5" onPress={skip}>
      {signedIn ? S.setupModel.skipCloud : S.common.skip}
    </Button>
  )
  let main: ReactNode
  let aside: ReactNode = null
  if (moving && model) {
    main = continueButton(!failed)
    aside = failed ? null : <Transfer id={model.filename} name={model.name} screen="onboarding" els={{ pause: 'A2.6', cancel: 'A2.7' }} />
  } else if (model && file) {
    const ready = (
      <p className="m-cap" style={{ margin: 0 }} data-testid="m-onboarding-model-ready">
        {fetchedHere ? S.setupModel.done(model.name) : S.setupModel.alreadyHere}
      </p>
    )
    if (fetchedHere) {
      main = continueButton(true)
      aside = ready
    } else {
      main = (
        <Button variant="primary" block testid="m-onboarding-use" el="A2.9" label={S.setupModel.useThisName(model.name)} onPress={() => void takeThis()}>
          {S.setupModel.useThis}
        </Button>
      )
      aside = (
        <>
          {ready}
          {short ? skipButton : null}
        </>
      )
    }
  } else if (!loading && !list.anyRuns) {
    main = continueButton(true)
  } else {
    main = (
      <Button
        variant="primary"
        block
        icon={Download}
        testid="m-onboarding-download"
        el="A2.4"
        busy={starting}
        disabled={loading || !model || !online}
        disabledReason={!online ? S.common.noInternet : !model && !loading ? S.setupModel.pick : undefined}
        label={model ? S.common.downloadName(model.name, formatBytes(model.sizeBytes)) : S.common.download}
        onPress={() => void download()}
      >
        {model ? S.common.downloadSize(formatBytes(model.sizeBytes)) : S.common.download}
      </Button>
    )
    aside = short ? skipButton : null
  }
  // Where "Skip" stands on a screen with room: under the main button, as DESIGN.md draws it.
  const skipBelow = !short && !moving && !(model && file && fetchedHere) && (loading || list.anyRuns || !!(model && file))
  const footer = short ? (
    main
  ) : (
    <>
      {aside}
      {main}
      {skipBelow ? skipButton : null}
    </>
  )

  return (
    <Page title={S.setupModel.title} screen="onboarding-model" footer={<FootStack>{footer}</FootStack>}>
      <Steps step={1} />
      <Para>{S.setupModel.lead}</Para>
      <Para cap testid="m-onboarding-model-device">
        {ready ? deviceLine(device, freeBytes, true) : S.device.loading}
      </Para>
      {short && aside ? (
        <Block>
          <div className="m-stackv" data-testid="m-onboarding-model-aside">
            {aside}
          </div>
        </Block>
      ) : null}
      {/* The tab "Unfiltered" is there only where the build lists such models (parts/policy.ts listsUnfiltered). */}
      {listsUnfiltered(policy) ? (
        <Block>
          <Segmented<Kind>
            label={S.setupModel.segment}
            testid="m-onboarding-model-segment"
            el="A2.2"
            value={kind}
            onChange={(value) => {
              if (moving) return
              setKind(value)
              setChoice(null)
            }}
            options={[
              { value: 'mainstream', label: S.setupModel.mainstream, testid: 'm-onboarding-model-segment-mainstream', disabled: moving && kind !== 'mainstream' },
              { value: 'unfiltered', label: S.setupModel.unfiltered, testid: 'm-onboarding-model-segment-unfiltered', disabled: moving && kind !== 'unfiltered' },
            ]}
          />
        </Block>
      ) : null}
      {!online && !moving ? (
        <Notice
          variant="warn"
          icon={OfflineIcon}
          testid="m-onboarding-model-offline"
          actions={
            <Button compact testid="m-onboarding-model-offline-retry" busy={checking} onPress={recheck}>
              {checking ? S.common.checking : S.common.tryAgain}
            </Button>
          }
        >
          {S.setupModel.offline}
        </Notice>
      ) : null}
      {failed && model ? <Transfer id={model.filename} name={model.name} screen="onboarding" els={{ pause: 'A2.6', cancel: 'A2.7' }} /> : null}
      {loading ? (
        <SkeletonCards cards={3} label={S.common.loadingCatalog} testid="m-onboarding-model-loading" />
      ) : !list.anyRuns ? (
        <Notice testid="m-onboarding-model-nofit">{S.setupModel.noFit}</Notice>
      ) : null}
      {loading ? null : (
        <div role="radiogroup" aria-label={S.setupModel.list} data-testid="m-onboarding-model-list">
          {list.models.map((item) => (
            <StarterCard
              key={item.id}
              model={item}
              fit={fitOfCatalogModel(item, device)}
              recommended={list.recommended?.id === item.id}
              selected={model?.id === item.id}
              installed={!!fileOf(installed.files, item.filename)}
              locked={moving}
              onPick={() => setChoice(item.id)}
            />
          ))}
        </div>
      )}
    </Page>
  )
}
