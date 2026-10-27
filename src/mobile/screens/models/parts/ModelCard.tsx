/**
 * The model card of M1: name, size in mono, marks, the fit
 * verdict, and under it exactly one main action. The head opens M2.
 *
 * One card for all three sources: a model of the phone catalogue, a file
 * that is on this phone, a search hit from Hugging Face.
 */
import { Check, Download } from 'lucide-react'
import type { BundledModel } from '../../../../api/engine'
import { nav } from '../../../nav'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { Button, FitBadge, Tag } from '../../../ui'
import { CardHead, CardName, ItemCard, MonoLine } from './bits'
import { useEngineUi, type EngineView } from './engine'
import { fitWord, type FitView } from './fit'
import { Transfer, useTransferKind } from './Transfer'
import { shownFacts, storePolicy } from './policy'

/** Another packing of a catalogue model that stands for it on its card. */
export interface CardPacking {
  /** "IQ2_XXS". Empty when the file name does not say. */
  quant: string
  /** The name of the file on screen: "Qwen 3.5 2B IQ2_XXS". */
  name: string
  sizeText: string
  /** Further packings of the same model on this phone. */
  more: number
}

export interface CardModel {
  /** Route id of the detail page. */
  routeId: string
  name: string
  /** Download id: the file name. Empty while a search hit has no file yet. */
  filename: string
  sizeText: string
  quant?: string
  description?: string
  uncensored?: boolean
  tools?: boolean
  vision?: boolean
  /** A thinking model: it writes its reasoning before the answer (catalogue field `thinking`). */
  thinking?: boolean
  /** Did not answer a plain question in the measurement run. The card says so (vollstaendigkeit-2 M5). */
  weak?: boolean
}

export interface ModelCardProps {
  model: CardModel
  fit: FitView
  /** The file on this phone, when the model is installed. */
  file?: BundledModel
  engine: EngineView
  /** This model is the chat model. */
  chatModel: boolean
  onDownload: () => void
  onUseInChat: (file: BundledModel) => void
  onLoad: (file: BundledModel) => void
  onUnload: () => void
  /** A search hit whose size is still being read. */
  sizing?: boolean
  /** `file` is another packing of this catalogue model: the card says which one (parts/catalog.ts, catalogCardState). */
  packing?: CardPacking
  /** Another packing of this model is on its way. The card shows that download in place of its own offer. */
  transfer?: { id: string; name: string; quant: string }
  /** The listed file is on this phone and other packings are too: the card names them all (parts/catalog.ts, catalogCardState). */
  beside?: { listed: string; others: string[] }
}


export function ModelCard(props: ModelCardProps) {
  const { fit, file, engine, chatModel, onDownload, onUseInChat, onLoad, onUnload, sizing, packing, transfer, beside } = props
  // A store build shows no mark and no claim about answers without refusals, also not on a model that is already on the phone.
  const model = shownFacts(storePolicy(), props.model)
  const ownKind = useTransferKind(model.filename)
  const packingKind = useTransferKind(transfer?.id ?? '')
  // The download of the listed file is the card's own. Without one, the packing that is on its way is shown.
  const viaPacking = !!transfer && (ownKind === null || ownKind === 'done') && packingKind !== null && packingKind !== 'done'
  const kind = viaPacking ? packingKind : ownKind
  /** The name of what the card acts on: the packing on this phone, else the model. */
  const actsOn = packing?.name ?? model.name
  const busy = useEngineUi((s) => s.busy)
  const queued = useEngineUi((s) => !!file && s.queued?.path === file.path)
  const installed = !!file
  /** Another packing is on its way while this card's file is on the phone already: its download is shown under the buttons (A-05). */
  const packingMoving = !!transfer && packingKind !== null && packingKind !== 'done'
  const loaded = installed && engine.loadedPath === file.path
  const tooLarge = fit.level === 'too-large' && !installed
  const moving = !installed && kind !== null && kind !== 'done'
  /** This card's own model is the one on its way into memory. */
  const loadingHere = busy?.kind === 'loading' && busy.name === actsOn
  const state = installed ? (loaded ? 'loaded' : 'installed') : moving ? kind : tooLarge ? 'too-large' : 'available'

  return (
    <ItemCard testid={tooLarge ? 'm-models-item-toolarge' : 'm-models-item'} id={model.routeId} state={state ?? undefined}>
      <CardHead label={S.models.open(model.name)} testid="m-models-item-open" el="M1.5" onPress={() => nav.push('/models/:id', { id: model.routeId })}>
        <CardName>{model.name}</CardName>
        {/* The size alone. How the file is packed ("Q4_K_M") is a word for the detail page, where it is explained (acceptance Android, N2). */}
        <MonoLine parts={[model.sizeText]} />
        {model.tools || model.uncensored || model.vision || model.thinking || chatModel || loaded ? (
          <span className="m-tags">
            {chatModel ? <Tag accent>{S.models.chatModel}</Tag> : null}
            {loaded ? <Tag>{S.common.loaded}</Tag> : null}
            {model.vision ? <Tag>{S.models.tagVision}</Tag> : null}
            {model.thinking ? (
              <span style={{ display: 'contents' }} data-testid="m-models-item-thinking">
                <Tag>{S.models.tagThinking}</Tag>
              </span>
            ) : null}
            {model.tools ? (
              <span style={{ display: 'contents' }} data-testid="m-models-item-tools">
                <Tag>{S.models.tagTools}</Tag>
              </span>
            ) : null}
            {model.uncensored ? <Tag>{S.models.tagNoFilter}</Tag> : null}
          </span>
        ) : null}
        {model.weak ? (
          <span className="m-cap" style={{ color: 'var(--m-warn)' }} data-testid="m-models-item-weak">
            {S.models.weakNote}
          </span>
        ) : null}
        {sizing ? <span className="m-cap">{S.detail.variantsLoading}</span> : <FitBadge level={fit.level} text={fitWord(fit)} testid="m-models-item-fit" />}
        {tooLarge && fit.short ? (
          <span className="m-cap" data-testid="m-models-toolarge-hint">
            {fit.short}
          </span>
        ) : null}
      </CardHead>

      {installed ? (
        <>
        <div className="m-rowh">
          <span className="m-rowh m-cap" style={{ flex: '1 1 6rem', color: 'var(--m-ok)' }} data-testid="m-models-item-installed" data-m-packing={packing ? packing.quant || packing.name : beside ? [beside.listed, ...beside.others].join(' ') : undefined}>
            <Check className="m-icon m-icon--sm" aria-hidden="true" />
            {packing ? S.models.installedPacking(packing.quant || packing.name, packing.sizeText, packing.more) : beside ? S.models.installedPackings(beside.listed, beside.others) : S.common.installed}
          </span>
          {loaded ? (
            <Button compact variant="quiet" testid="m-models-unload" label={S.models.unloadName(actsOn)} disabled={!!busy} onPress={onUnload}>
              {S.models.unload}
            </Button>
          ) : (
            <Button compact variant="quiet" testid="m-models-load" label={S.models.loadName(actsOn)} busy={loadingHere} disabled={!!busy} onPress={() => onLoad(file)}>
              {S.models.load}
            </Button>
          )}
          {chatModel ? null : (
            // Not locked while ANOTHER model loads: the tap is kept and runs after it (parts/use-in-chat.ts). Never a tap without effect (N2).
            <Button compact testid="m-models-use" el="M1.9" label={queued ? `${S.models.useInChatName(actsOn)}, ${S.models.loadsAfter(busy?.name ?? '')}` : S.models.useInChatName(actsOn)} disabled={loadingHere || queued} onPress={() => onUseInChat(file)}>
              {S.models.useInChat}
            </Button>
          )}
          {queued ? (
            <span className="m-cap" style={{ flex: '1 1 100%' }} role="status" data-testid="m-models-item-queued">
              {S.models.loadsAfter(busy?.name ?? '')}
            </span>
          ) : busy && !loadingHere ? (
            <span className="m-cap" style={{ flex: '1 1 100%' }} data-testid="m-models-item-waiting">
              {S.models.engineBusy(busy.kind === 'loading' ? busy.name : '')}
            </span>
          ) : null}
        </div>
        {packingMoving && transfer ? (
          <>
            <span className="m-cap" data-testid="m-models-item-packing-loading" data-m-packing={transfer.quant || transfer.name}>
              {S.models.packingOnItsWay(transfer.quant || transfer.name)}
            </span>
            <Transfer id={transfer.id} name={transfer.name} screen="models" els={{ pause: 'M1.7', cancel: 'M1.8' }} inset />
          </>
        ) : null}
        </>
      ) : moving && viaPacking && transfer ? (
        <>
          <span className="m-cap" data-testid="m-models-item-packing-loading" data-m-packing={transfer.quant || transfer.name}>
            {S.models.packingOnItsWay(transfer.quant || transfer.name)}
          </span>
          <Transfer id={transfer.id} name={transfer.name} screen="models" els={{ pause: 'M1.7', cancel: 'M1.8' }} inset />
        </>
      ) : moving ? (
        <Transfer id={model.filename} name={model.name} screen="models" els={{ pause: 'M1.7', cancel: 'M1.8' }} inset />
      ) : tooLarge ? null : (
        <Button block icon={Download} testid="m-models-download" el="M1.6" label={S.common.downloadName(model.name, model.sizeText)} disabled={sizing} onPress={onDownload}>
          {model.sizeText ? S.common.downloadSize(model.sizeText) : S.common.download}
        </Button>
      )}
    </ItemCard>
  )
}
