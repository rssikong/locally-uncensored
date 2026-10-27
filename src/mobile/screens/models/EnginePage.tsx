/**
 * E13 On device engine. Route /settings/engine, strand 4.
 *
 * What the engine runs right now and the few settings that matter on a
 * phone. E13.1 status card (model, where it computes, loaded context),
 * E13.2 unload, E13.3 context (only sizes this phone carries), E13.4
 * graphics acceleration (not on Android, which has no graphics path),
 * E13.5 threads, E13.7 unload in the background, E13.8 advanced (a page of
 * its own, /settings/engine/advanced), E13.9 reset. Next to them: restart and
 * a self test, and the engine notices (G10) as boxes.
 *
 * Every setting here acts on the phone engine (mobile-docs/ENGINE-NACHZUG.md
 * section 5). E13.6 "Keep model in memory" is gone: the phone engine never
 * locks memory. A change loads the model again, because the settings are
 * part of what the running engine is.
 */
import { useState } from 'react'
import { Activity, Power, RotateCw, SlidersHorizontal, Undo2 } from 'lucide-react'
import { useChatSendPending } from '../../../hooks/useChat'
import { nav } from '../../nav'
import { EngineNotices } from '../../resilience/EngineNotices'
import { MODELS_STRINGS as S } from '../../strings/models'
import { Button, Card, ListGroup, Notice, NumberField, Page, Row, Segmented, Spinner, toast } from '../../ui'
import { resetPrefs, setPref, usePref } from './parts/adapters/prefs'
import { Block, Fact, Para } from './parts/bits'
import { fitOfFile } from './parts/catalog'
import { useDevice } from './parts/device'
import { applyEngineSettings, applyEngineSettingsSoon, restartEngine, unloadModel, useEngine, useEngineUi } from './parts/engine'
import { contextChoices, contextText } from './parts/fit'
import { displayName, useInstalled } from './parts/installed'
import { sayApplied } from './parts/say'
import { runSelfTest, type SelfTestResult } from './parts/self-test'
import { contextChoiceOf, contextOptions, maxThreads, resetTuning, setTuning, tuningOfContextChoice, useTuning, usesGraphics } from './parts/tuning'
import { riskMark } from './parts/risk'
import { answerIsRunning } from './parts/restart-question'

const PHONE_MAX_CONTEXT = 4096

function oneDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1)
}

export default function EnginePage() {
  const engine = useEngine()
  const busy = useEngineUi((s) => s.busy)
  const installed = useInstalled()
  const { device } = useDevice()
  const tuning = useTuning()
  const background = usePref('unloadInBackground')
  const [testing, setTesting] = useState(false)
  // The result belongs to the engine as it ran when it was asked. An unload, a restart or another model voids it,
  // also when the same model comes back afterwards.
  const epoch = useEngineUi((s) => s.epoch)
  const [tested, setTested] = useState<{ path: string; epoch: number; result: SelfTestResult } | null>(null)
  if (tested && engine.answered && (engine.loadedPath !== tested.path || epoch !== tested.epoch)) setTested(null)
  const test = tested?.result ?? null
  // Android has no graphics path in the phone engine: the layers are always 0 there, so the switch would do nothing.
  const graphics = device?.platform !== 'android'
  const threadLimit = maxThreads(typeof navigator === 'undefined' ? null : navigator.hardwareConcurrency)

  const file = installed.files.find((f) => f.path === engine.loadedPath)
  const name = engine.loadedName ? displayName({ name: engine.loadedName }) : null
  const fit = file ? fitOfFile(file, device) : null
  const maxContext = fit && fit.maxContext > 0 ? Math.min(fit.maxContext, PHONE_MAX_CONTEXT) : PHONE_MAX_CONTEXT
  // One truth (M10): the marked segment is the size that is set, also when it was picked in the chat options.
  const choices = contextOptions(contextChoices(maxContext), tuning)
  const choice = contextChoiceOf(tuning)
  const state = busy?.kind === 'loading' ? 'loading' : engine.running ? (engine.status?.healthy === false ? 'starting' : 'running') : 'none'

  const setContext = (value: string) => {
    const next = tuningOfContextChoice(value)
    setTuning(next)
    void applyEngineSettings().then((outcome) => sayApplied(outcome, S.engine.contextApplied(value === 'auto' ? S.engine.contextAuto : contextText(next.ctx))))
  }

  // An answer that is being written is cut by the restart: asked first, and the answer may finish (P3).
  const restart = async () => {
    if (answerIsRunning(useChatSendPending.getState().pending)) {
      const go = await nav.confirm({ title: S.engine.restartAnsweringTitle, text: S.engine.restartAnsweringText, confirmLabel: S.engine.restartAnsweringConfirm, cancelLabel: S.engine.restartAnsweringCancel, testid: 'engine-restart-answering' })
      if (!go) return
    }
    const ok = await restartEngine(name ?? '')
    toast(ok ? S.engine.restarted : S.engine.restartFailed, { tone: ok ? undefined : 'error', testid: ok ? 'engine-restarted' : 'engine-restart-failed' })
  }

  const selfTest = async () => {
    if (testing) return
    if (!engine.loadedName || !engine.loadedPath) {
      toast(S.engine.selfTestNoModel, { testid: 'engine-selftest-nomodel' })
      return
    }
    const path = engine.loadedPath
    setTesting(true)
    setTested(null)
    try {
      const result = await runSelfTest(engine.loadedName)
      setTested({ path, epoch: useEngineUi.getState().epoch, result })
    } finally {
      setTesting(false)
    }
  }

  const reset = async () => {
    const yes = await nav.confirm({ title: S.engine.resetTitle, text: S.engine.resetText, confirmLabel: S.engine.resetConfirm, cancelLabel: S.common.keep, tone: 'danger', testid: 'engine-reset' })
    if (!yes) return
    resetTuning()
    resetPrefs()
    toast(S.engine.resetDone, { testid: 'engine-reset-done' })
    // The running model still carries the old values. Load it again, quietly unless that fails.
    const outcome = await applyEngineSettings()
    if (outcome === 'failed') sayApplied(outcome)
  }

  return (
    <Page title={S.engine.title} screen="settings-engine">
      <div data-testid="m-settings-engine-status" data-state={state} data-el="E13.1">
        <Card title={S.engine.status}>
          {state === 'none' ? (
            <div className="m-stackv">
              <strong>{S.engine.none}</strong>
              <span className="m-cap">{S.engine.noneText}</span>
              <Button compact testid="m-settings-engine-models" onPress={() => nav.resetTo('models')}>
                {S.engine.openModels}
              </Button>
            </div>
          ) : (
            <div className="m-stackv">
              <span className="m-rowh">
                {state === 'running' ? null : <Spinner label={S.engine.starting} />}
                <strong data-testid="m-settings-engine-state">{state === 'running' ? S.engine.running : state === 'loading' ? S.notices.loading(busy?.name ?? '') : S.engine.notAnswering}</strong>
              </span>
              {name ? <Fact label={S.engine.model} value={name} testid="m-settings-engine-model" /> : null}
              {engine.running ? (
                <>
                  <Fact label={S.engine.accelerator} value={engine.accelerator === 'gpu' ? S.engine.acceleratorGpu : engine.accelerator === 'cpu' ? S.engine.acceleratorCpu : S.engine.acceleratorUnknown} testid="m-settings-engine-accelerator" />
                  <Fact label={S.engine.context} value={engine.status?.ctx ? S.engine.contextValue(contextText(engine.status.ctx)) : S.detail.unknown} testid="m-settings-engine-context-loaded" />
                </>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <EngineNotices variant="box" />

      <ListGroup title={S.engine.actions}>
        <Row icon={Power} chevron={false} title={S.engine.unload} testid="m-settings-engine-unload" el="E13.2" disabled={!engine.running || !!busy} disabledReason={!engine.running ? S.engine.none : undefined} onPress={() => void unloadModel().then(() => toast(S.models.unloadedToast, { testid: 'unloaded' }))} />
        <Row
          icon={RotateCw}
          chevron={false}
          title={S.engine.restart}
          testid="m-settings-engine-restart"
          disabled={!engine.running || !!busy}
          disabledReason={!engine.running ? S.engine.none : undefined}
          onPress={() => void restart()}
        />
        <Row icon={Activity} chevron={false} title={S.engine.selfTest} testid="m-settings-engine-selftest" disabled={testing || !!busy} onPress={() => void selfTest()} />
      </ListGroup>
      {testing ? (
        <Block>
          <span className="m-rowh" data-testid="m-settings-engine-selftest-running">
            <Spinner label={S.engine.selfTestRunning} />
            <span className="m-cap">{S.engine.selfTestRunning}</span>
          </span>
        </Block>
      ) : test ? (
        <Notice variant={test.ok ? 'info' : 'error'} testid="m-settings-engine-selftest-result">
          {test.ok ? (test.firstMs > 0 ? S.engine.selfTestOk(`${oneDecimal(test.firstMs / 1000)} s`, oneDecimal(test.tokensPerSec)) : S.engine.selfTestOkPlain) : S.engine.selfTestFail}
        </Notice>
      ) : null}

      <h2 className="m-label m-group-label">{S.engine.contextSegment}</h2>
      <Block>
        <Segmented
          label={S.engine.contextSegment}
          testid="m-settings-engine-context"
          el="E13.3"
          value={choice}
          onChange={setContext}
          options={[{ value: 'auto', label: S.engine.contextAuto, testid: 'm-settings-engine-context-auto' }, ...choices.map((ctx) => ({ value: String(ctx), label: contextText(ctx), testid: `m-settings-engine-context-${ctx}` }))]}
        />
      </Block>
      <Para cap testid="m-settings-engine-context-hint">
        {file ? S.engine.contextHint(contextText(maxContext)) : S.engine.contextHintNone}
      </Para>

      <ListGroup title={S.engine.settings}>
        {graphics ? (
          <Row
            title={S.engine.gpu}
            subtitle={S.engine.gpuSub}
            testid="m-settings-engine-gpu"
            el="E13.4"
            switch={{
              checked: usesGraphics(tuning),
              onChange: (on) => {
                setTuning({ gpuLayers: on ? -1 : 0 })
                void applyEngineSettings().then((outcome) => sayApplied(outcome))
              },
            }}
          />
        ) : null}
        <Row title={S.engine.background} subtitle={S.engine.backgroundSub} testid="m-settings-engine-background" el="E13.7" switch={{ checked: background, onChange: (on) => setPref('unloadInBackground', on) }} />
      </ListGroup>
      {graphics ? null : (
        <Para cap testid="m-settings-engine-no-graphics">
          {S.engine.noGraphics}
        </Para>
      )}
      <h2 className="m-label m-group-label">{S.engine.threads}</h2>
      <Block>
        <NumberField
          label={S.engine.threads}
          value={Math.min(Math.max(0, tuning.threads), threadLimit)}
          min={0}
          max={threadLimit}
          step={1}
          format={(v) => (v === 0 ? S.engine.contextAuto : String(v))}
          onChange={(v) => {
            setTuning({ threads: v <= 0 ? -1 : v })
            applyEngineSettingsSoon((outcome) => sayApplied(outcome))
          }}
          testid="m-settings-engine-threads"
          el="E13.5"
        />
      </Block>
      <Para cap>{S.engine.threadsSub(threadLimit)}</Para>

      <ListGroup>
        <Row icon={SlidersHorizontal} title={S.engine.advanced} subtitle={graphics ? S.engine.advancedSub : S.engine.advancedSubNoGraphics} testid="m-settings-engine-advanced" el="E13.8" onPress={() => nav.push('/settings/engine/advanced')} />
      </ListGroup>
      <ListGroup>
        <Row icon={Undo2} danger chevron={false} title={S.engine.reset} {...riskMark('destructive')} testid="m-settings-engine-reset" el="E13.9" onPress={() => void reset()} />
      </ListGroup>
    </Page>
  )
}
