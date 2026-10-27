/**
 * M4 Benchmark. Route /models/benchmark, strand 4 (Models and onboarding).
 *
 * Measures a model on THIS phone with the three standard prompts
 * (hooks/useBenchmark.ts): tokens per second and how many answers were
 * right. A model that is not loaded is loaded first, and the page says so.
 *
 * M4.1 model choice (installed only), M4.2 run, M4.3 stop, M4.4 result row
 * (opens the single values), M4.5 clear results.
 */
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Gauge, Play, Square, Trash2 } from 'lucide-react'
import { useBenchmark } from '../../../hooks/useBenchmark'
import { BENCHMARK_PROMPTS, type BenchmarkResult } from '../../../lib/benchmark-prompts'
import { getAccuracy, getAverageSpeed, useBenchmarkStore } from '../../../stores/benchmarkStore'
import { nav } from '../../nav'
import { MODELS_STRINGS as S } from '../../strings/models'
import { Button, EmptyState, FitBadge, Icon, ListGroup, Notice, Page, Progress, Row, toast } from '../../ui'
import { latestRuns } from './parts/bench'
import { Block, ItemCard, Para } from './parts/bits'
import { useDevice } from './parts/device'
import { fitOfFile } from './parts/catalog'
import { fitWord } from './parts/fit'
import { loadModel, useEngine, useEngineUi } from './parts/engine'
import { chatFiles, chatModelId, displayName, useInstalled } from './parts/installed'
import { showFittingModels, useModelsView } from './parts/view'
import { riskMark } from './parts/risk'

const BARE = /^openai::/

function oneDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1)
}

function seconds(ms: number): string {
  return `${oneDecimal(ms / 1000)} s`
}

function ResultRow({ id, runs }: { id: string; runs: BenchmarkResult[] }) {
  const [open, setOpen] = useState(false)
  const results = { [id]: runs }
  const name = displayName({ name: id.replace(BARE, '') })
  const speed = getAverageSpeed(results, id)
  const accuracy = getAccuracy(results, id)
  const checked = runs.filter((r) => r.correct !== undefined)
  const right = checked.filter((r) => r.correct).length
  return (
    <ItemCard testid="m-models-benchmark-result" id={id} state={open ? 'open' : 'closed'}>
      <button
        type="button"
        style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--m-s2)', width: '100%', minHeight: 'var(--m-touch)', textAlign: 'left', color: 'inherit', padding: 0 }}
        aria-expanded={open}
        aria-label={S.benchmark.rowName(name)}
        data-testid="m-models-benchmark-result-toggle"
        data-el="M4.4"
        onClick={() => setOpen(!open)}
      >
        <span className="m-stackv" style={{ flex: '1 1 auto', minWidth: 0, gap: 6 }}>
          <span className="m-card-title">{name}</span>
          <span className="m-mono" data-testid="m-models-benchmark-speed">{speed === null ? S.benchmark.noResults : S.benchmark.speed(oneDecimal(speed))}</span>
          {accuracy === null ? null : <span className="m-cap" data-testid="m-models-benchmark-accuracy">{S.benchmark.accuracy(right, checked.length)}</span>}
          <span className="m-cap">{S.benchmark.measured}</span>
        </span>
        <Icon icon={open ? ChevronUp : ChevronDown} small className="m-row-chev" />
      </button>
      {open ? (
        <div className="m-stackv" data-testid="m-models-benchmark-result-details">
          {latestRuns(runs).map((run) => (
            <div key={run.promptId} className="m-stackv" style={{ gap: 2 }}>
              <span className="m-cap">{S.benchmark.test(BENCHMARK_PROMPTS.find((p) => p.id === run.promptId)?.name ?? run.promptId)}</span>
              <span className="m-mono" style={{ overflowWrap: 'anywhere' }}>{S.benchmark.testLine(oneDecimal(run.tokensPerSec), seconds(run.timeToFirstToken), run.correct === undefined ? null : run.correct)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </ItemCard>
  )
}

export default function BenchmarkPage() {
  const installed = useInstalled()
  const { device } = useDevice()
  const engine = useEngine()
  const busy = useEngineUi((s) => s.busy)
  const failure = useEngineUi((s) => s.failure)
  const { runBenchmark, stopBenchmark } = useBenchmark()
  const results = useBenchmarkStore((s) => s.results)
  const isRunning = useBenchmarkStore((s) => s.isRunning)
  const step = useBenchmarkStore((s) => s.currentStep)
  const total = useBenchmarkStore((s) => s.totalSteps)
  const error = useBenchmarkStore((s) => s.error)
  const wanted = useModelsView((s) => s.benchModel)
  const [choice, setChoice] = useState<string | null>(wanted)
  const [loadFailed, setLoadFailed] = useState<string | null>(null)
  const files = chatFiles(installed.files)
  const file = files.find((f) => f.name === choice) ?? files.find((f) => f.path === engine.loadedPath) ?? files[0]
  const loaded = !!file && engine.loadedPath === file.path
  const ids = Object.keys(results).filter((id) => results[id].length > 0)
  const working = isRunning || busy?.kind === 'loading'

  useEffect(() => {
    // The pick from M2 is used once.
    if (wanted) useModelsView.getState().setBenchModel(null)
  }, [wanted])

  const run = async () => {
    if (!file || working) return
    setLoadFailed(null)
    useBenchmarkStore.getState().setError(null)
    if (!loaded) {
      const ok = await loadModel(file)
      if (!ok) {
        setLoadFailed(displayName(file))
        return
      }
    }
    await runBenchmark(chatModelId(file.name))
  }

  const clear = async () => {
    const yes = await nav.confirm({ title: S.benchmark.clearTitle, text: S.benchmark.clearText, confirmLabel: S.benchmark.clearConfirm, cancelLabel: S.common.keep, tone: 'danger', testid: 'benchmark-clear' })
    if (!yes) return
    useBenchmarkStore.getState().clearResults()
    toast(S.benchmark.cleared, { testid: 'benchmark-cleared' })
  }

  if (installed.ready && files.length === 0) {
    return (
      <Page title={S.benchmark.title} screen="models-benchmark">
        <EmptyState
          icon={Gauge}
          title={S.benchmark.emptyTitle}
          testid="m-models-benchmark-empty"
          actions={
            <Button variant="primary" testid="m-models-benchmark-getnew" onPress={() => { showFittingModels(); nav.resetTo('models') }}>
              {S.benchmark.getNew}
            </Button>
          }
        >
          {S.benchmark.empty}
        </EmptyState>
      </Page>
    )
  }

  return (
    <Page
      title={S.benchmark.title}
      screen="models-benchmark"
      footer={
        isRunning ? (
          <Button block icon={Square} testid="m-models-benchmark-stop" el="M4.3" onPress={stopBenchmark}>
            {S.benchmark.stop}
          </Button>
        ) : (
          <Button variant="primary" block icon={Play} testid="m-models-benchmark-run" el="M4.2" busy={busy?.kind === 'loading'} disabled={!file || !!busy} onPress={() => void run()}>
            {S.benchmark.run}
          </Button>
        )
      }
    >
      <ListGroup title={S.benchmark.pick} role="radiogroup" label={S.benchmark.pick}>
        {files.map((f) => (
          <div key={f.path} data-testid="m-models-benchmark-model" data-m-id={f.name} data-state={f === file ? 'selected' : 'idle'}>
            <Row
              title={displayName(f)}
              // The words of the badge come from the one place every other list takes them from (fitWord): a 2 bit packing of a small model read "Tight fit, may be slow" here alone (F13).
              subtitle={<FitBadge level={fitOfFile(f, device).level} text={f.path === engine.loadedPath ? S.common.loaded : fitWord(fitOfFile(f, device))} />}
              radio={{ checked: f === file, onSelect: () => setChoice(f.name) }}
              disabled={working}
              testid="m-models-benchmark-model-pick"
              el="M4.1"
            />
          </div>
        ))}
      </ListGroup>
      {file && !loaded && !working ? (
        <Para cap testid="m-models-benchmark-willload">
          {S.benchmark.willLoad(displayName(file))}
        </Para>
      ) : null}
      {busy?.kind === 'loading' && !isRunning ? (
        <Block>
          <Progress label={S.benchmark.loading(busy.name)} detail={S.benchmark.loading(busy.name)} testid="m-models-benchmark-loading" />
        </Block>
      ) : null}
      {isRunning ? (
        <Block>
          <div className="m-stackv" data-testid="m-models-benchmark-running">
            <Progress label={S.benchmark.title} value={total > 0 ? Math.max(0, step - 1) / total : undefined} detail={step > 0 ? S.benchmark.running(step, total) : S.benchmark.starting} meta={S.benchmark.keepOpen} testid="m-models-benchmark-progress" />
          </div>
        </Block>
      ) : null}
      {loadFailed ? (
        <Notice variant="error" testid="m-models-benchmark-loadfailed">
          {[S.benchmark.loadFailed(loadFailed), failure?.reason].filter(Boolean).join(' ')}
        </Notice>
      ) : error && !isRunning ? (
        <Notice variant="error" testid="m-models-benchmark-error">
          {S.benchmark.failed}
        </Notice>
      ) : null}
      <h2 className="m-label m-group-label">{S.benchmark.results}</h2>
      {ids.length === 0 ? (
        <Para cap testid="m-models-benchmark-noresults">
          {S.benchmark.noResults}
        </Para>
      ) : (
        <>
          <div data-testid="m-models-benchmark-results">
            {ids.map((id) => (
              <ResultRow key={id} id={id} runs={results[id]} />
            ))}
          </div>
          <ListGroup>
            <Row icon={Trash2} danger chevron={false} title={S.benchmark.clear} {...riskMark('destructive')} testid="m-models-benchmark-clear" el="M4.5" disabled={isRunning} onPress={() => void clear()} />
          </ListGroup>
        </>
      )}
    </Page>
  )
}
