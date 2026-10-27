import { useState } from 'react'
import { useActiveContextWindow } from '../../../../../hooks/useActiveContextWindow'
import { setEngineContextWindow } from '../../../../../lib/engine-context'
import { formatContextWindow } from '../../../../../lib/formatters'
import { getMobileContextCap } from '../../../../../lib/model-slot'
import { isModelVisible, KEEP_AFTER_COMPACT } from '../../../../../lib/run-compact-command'
import { computeContextFill } from '../../../../../lib/token-usage'
import { useSendSizeStore } from '../../../../../stores/sendSizeStore'
import { useSettingsStore } from '../../../../../stores/settingsStore'
import { MOBILE_MAX_CTX } from '../../../../lib/device-fit'
import { useSheet } from '../../../../nav'
import { AGENT_STRINGS as T } from '../../../../strings/agent'
import { Button, ListGroup, Notice, Progress, Row, Sheet, toast } from '../../../../ui'
import { usePhoneMeter } from '../../../chat/parts/ComposerParts'
import { useChatSend, wasSent } from '../adapters/chat-send'
import { useConversation } from '../chat-ref'
import type { ChatSettings } from './chat-settings'

const S = T.options.contextPage

/** The sizes offered for the engine on this phone. Never above what the phone carries. */
export const LOCAL_WINDOWS = [1024, 2048, 3072, 4096] as const
/** The sizes offered for what one answer sends to a cloud model. */
export const CLOUD_WINDOWS = [16384, 32768, 65536, 131072] as const

/** Pure: the window sizes a phone may pick for its own engine. `cap` 0 means the device is not known yet. */
export function localWindowChoices(cap: number): number[] {
  const top = cap > 0 ? Math.min(cap, MOBILE_MAX_CTX) : MOBILE_MAX_CTX
  return LOCAL_WINDOWS.filter((value) => value <= top)
}

/** Pure: the send windows offered for a cloud model with this own window. 0 means unknown: offer all. */
export function cloudWindowChoices(modelMax: number): number[] {
  return CLOUD_WINDOWS.filter((value) => (modelMax > 0 ? value < modelMax : true))
}

/** Pure: how full, 0 to 1, and whether to warn. */
export function fillShare(used: number, window: number): { share: number; near: boolean } {
  if (window <= 0) return { share: 0, near: false }
  const share = Math.min(1, Math.max(0, used / window))
  return { share, near: share >= 0.8 }
}

/** C5.13: how full the window is, how large it is, and "Compact now". */
export function ContextPage({ chat }: { chat: ChatSettings }) {
  const sheet = useSheet()
  const sender = useChatSend(chat.key)
  const [tick, setTick] = useState(0)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const ctx = useActiveContextWindow(tick)
  const conversation = useConversation(chat.key)
  const sent = useSendSizeStore((s) => s.byConv[chat.key])
  const tuning = useSettingsStore((s) => s.settings.builtinEngine)
  const cloudWindows = useSettingsStore((s) => s.settings.cloudSendWindowByModel)

  const messages = conversation?.messages ?? []
  const fill = computeContextFill(messages, sent ? { tokens: sent.tokens + sent.toolsTokens, atMessageCount: sent.atMessageCount } : undefined)
  const window = ctx.sendWindow > 0 ? ctx.sendWindow : ctx.contextWindow
  // A model of this phone: the figure of the chip, by the counting the request is cut with (round 16, F11).
  const meter = usePhoneMeter(chat.key, window)
  const used = meter ? meter.tokens : Math.min(fill.used, window)
  const total = meter ? meter.limit : window
  const { share, near } = meter ? { share: meter.percent / 100, near: meter.percent >= 80 || meter.state !== 'fits' } : fillShare(used, window)

  const local = ctx.provider === 'builtin'
  const cloud = ctx.provider === 'cloud' && ctx.adjustable && !!ctx.windowKey
  const choices = local ? localWindowChoices(getMobileContextCap()) : cloud ? cloudWindowChoices(ctx.modelMax) : []
  const chosen = local ? (tuning.ctxChosen && tuning.ctx > 0 ? tuning.ctx : 0) : cloud ? (cloudWindows?.[ctx.windowKey] ?? 0) : 0

  const apply = async (value: number) => {
    if (value === chosen || applying) return
    setApplyError(null)
    if (cloud) {
      const next = { ...(useSettingsStore.getState().settings.cloudSendWindowByModel ?? {}) }
      if (value > 0) next[ctx.windowKey] = value
      else delete next[ctx.windowKey]
      useSettingsStore.getState().updateSettings({ cloudSendWindowByModel: next })
      setTick((t) => t + 1)
      toast(S.applied, { testid: 'context-applied' })
      return
    }
    if (!local) return
    setApplying(true)
    try {
      // Writes the size and loads the running model again (lib/engine-context.ts).
      await setEngineContextWindow(value)
      toast(S.applied, { testid: 'context-applied' })
    } catch (err) {
      setApplyError(S.applyFailed(err instanceof Error ? err.message : String(err)))
    } finally {
      setApplying(false)
      setTick((t) => t + 1)
    }
  }

  const visible = messages.filter(isModelVisible).length
  const compactBlocked = !chat.saved ? T.options.needsSavedChat : sender.busy ? S.compactBusy : visible <= KEEP_AFTER_COMPACT ? S.compactTooShort : null

  return (
    <Sheet title={S.title}>
      <div className="m-ag-block" data-testid="m-options-context-fill">
        {window > 0 ? (
          <Progress label={S.fill} value={share} detail={S.fillOf(formatContextWindow(used), formatContextWindow(total))} state={near ? 'error' : 'running'} testid="m-options-context-bar" el="C5.13" />
        ) : (
          <span className="m-cap">{S.fillUnknown}</span>
        )}
        {window > 0 && messages.length === 0 ? <span className="m-cap">{S.fillEmpty}</span> : null}
      </div>
      {meter && meter.state !== 'fits' ? (
        <Notice variant="warn" testid={meter.state === 'trimmed' ? 'm-options-context-trimmed' : 'm-options-context-too-long'}>
          {meter.state === 'trimmed' ? S.trimmed : S.tooLong}
        </Notice>
      ) : near ? (
        <Notice variant="warn" testid="m-options-context-near">
          {S.nearFull}
        </Notice>
      ) : null}
      {choices.length > 0 ? (
        <>
          <ListGroup title={local ? S.windowTitleLocal : S.windowTitleCloud} role="radiogroup" label={S.windowLabel} testid="m-options-context-window">
            <Row title={S.auto} radio={{ checked: chosen === 0, onSelect: () => void apply(0) }} disabled={applying} testid="m-options-context-auto" el="C5.13" />
            {choices.map((value) => (
              <Row
                key={value}
                title={formatContextWindow(value)}
                radio={{ checked: chosen === value, onSelect: () => void apply(value) }}
                disabled={applying}
                testid={`m-options-context-${value}`}
                el="C5.13"
              />
            ))}
          </ListGroup>
          <p className="m-ag-text">{local ? S.localHint : S.cloudHint}</p>
        </>
      ) : (
        <p className="m-ag-text" data-testid="m-options-context-fixed">
          {S.fixedHint}
        </p>
      )}
      {applying ? (
        <div className="m-ag-block">
          <Progress label={S.applying} detail={S.applying} />
        </div>
      ) : null}
      {applyError ? (
        <Notice variant="error" testid="m-options-context-error">
          {applyError}
        </Notice>
      ) : null}
      <div className="m-ag-actions">
        <Button
          block
          disabled={!!compactBlocked}
          disabledReason={compactBlocked ?? undefined}
          onPress={() => {
            void sender.send('/compact').then((outcome) => {
              if (!wasSent(outcome)) return
              toast(S.compactStarted, { testid: 'compact-started' })
              sheet.close()
            })
          }}
          testid="m-options-compact"
          el="C5.13"
        >
          {S.compact}
        </Button>
        <span className="m-cap">{S.compactHint}</span>
      </div>
    </Sheet>
  )
}
