/**
 * E19 Troubleshooting. Route /settings/troubleshooting, page, strand 5 (Account, cloud, settings).
 *
 * Three checks with a light and a sentence, the things a user can do
 * without help, and the diagnostics: what LU knows about this phone and the
 * engine, an engine self test, and a report to copy or share. "Share log"
 * hands over the end of the app's log file and the last crash record, read
 * through the native bridge. Nothing on this page is sent anywhere unless
 * the user shares it.
 */
import { useCallback, useEffect, useState } from 'react'
import { ClipboardCopy, FileText, Gauge, RefreshCw, RotateCcw, Share2, Wand2 } from 'lucide-react'
import { storageWriteFailures } from '../../../lib/storage-health'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import { usePermissionStore } from '../../../stores/permissionStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useVoiceStore } from '../../../stores/voiceStore'
import { nav } from '../../nav'
import { copyText, setThemePref, shareFile } from '../../platform'
import { useOnline } from '../../resilience/useOnline'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { Button, ListGroup, Notice, Page, Row, toast } from '../../ui'
import { APP_VERSION } from './parts/app-info'
import { readAppLog, type AppLog } from './parts/app-log'
import { WIFI_ONLY_DEFAULT } from '../../boot/wifi-default'
import { internetCheck, lightWord, resetAllText, runCloudCheck, runEngineCheck, type CheckResult, type Light } from './parts/checks'
import { buildLogText, buildReport, collectDiagnostics, diagnosticsRows, runEngineSelfTest, type DiagnosticsData } from './parts/diagnostics'
import { Block, Hint } from './parts/layout'
import { MOBILE_PREF_DEFAULTS, useMobilePrefs } from './parts/prefs'
import { sessionLog } from './parts/session-log'

const T = SETTINGS_STRINGS.troubleshooting
const C = SETTINGS_STRINGS.common

const BUSY: CheckResult = { light: 'busy', text: T.running }
const LIGHT_COLOR: Record<Light, string> = { ok: 'var(--m-ok)', warn: 'var(--m-warn)', bad: 'var(--m-err)', busy: 'var(--m-t3)' }

function CheckRow({ id, title, result }: { id: string; title: string; result: CheckResult }) {
  return (
    <div className="m-row" data-testid={`m-settings-troubleshooting-check-${id}`} data-light={result.light}>
      <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: '50%', flex: 'none', background: LIGHT_COLOR[result.light] }} />
      <span className="m-row-text">
        <span className="m-row-title">{title}</span>
        <span className="m-row-sub">{result.text}</span>
      </span>
      <span className="m-row-end">
        <span className="m-row-val">{lightWord(result.light)}</span>
      </span>
    </div>
  )
}

type SelfTest = { kind: 'idle' } | { kind: 'running' } | { kind: 'passed'; text: string } | { kind: 'failed'; text: string }

/** The time of day with seconds, in the format of the phone. */
function clockTime(): string {
  return new Date().toLocaleTimeString()
}

export default function TroubleshootingPage() {
  const online = useOnline()
  const [engine, setEngine] = useState<CheckResult>(BUSY)
  const [cloud, setCloud] = useState<CheckResult>(BUSY)
  const [checking, setChecking] = useState(false)
  const [data, setData] = useState<DiagnosticsData | null>(null)
  const [selfTest, setSelfTest] = useState<SelfTest>({ kind: 'idle' })
  const [sharing, setSharing] = useState<'report' | 'log' | null>(null)
  // When the checks and the figures were last read. A second run usually finds the same answers,
  // and without the time nothing on the page would say that the button did anything.
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [readAt, setReadAt] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  const runChecks = useCallback(async () => {
    setChecking(true)
    setEngine(BUSY)
    setCloud(BUSY)
    const [e, c] = await Promise.all([runEngineCheck(), runCloudCheck(useCloudAuthStore.getState().status === 'signed-in')])
    setEngine(e)
    setCloud(c)
    setChecking(false)
    setCheckedAt(clockTime())
  }, [])

  /** One read of everything: the figures, and the app log for the crash row. undefined: the log cannot be asked here. */
  const collect = useCallback(async (): Promise<{ data: DiagnosticsData; log: AppLog | null }> => {
    const log = await readAppLog()
    const next = await collectDiagnostics(APP_VERSION, useMobilePrefs.getState().lastSelfTest, log ? log.tail.lastCrash : undefined)
    return { data: next, log }
  }, [])

  const refresh = useCallback(async () => {
    setReading(true)
    try {
      setData((await collect()).data)
      setReadAt(clockTime())
    } finally {
      setReading(false)
    }
  }, [collect])

  // First look: the rows start as "Checking", so only the answers are set here.
  useEffect(() => {
    let alive = true
    void Promise.all([runEngineCheck(), runCloudCheck(useCloudAuthStore.getState().status === 'signed-in')]).then(([e, c]) => {
      if (!alive) return
      setEngine(e)
      setCloud(c)
    })
    void collect().then((read) => {
      if (alive) setData(read.data)
    })
    return () => {
      alive = false
    }
  }, [collect])

  /** The newest figures for a report, even when the rows on screen are a moment old. */
  const fresh = async (): Promise<{ data: DiagnosticsData; log: AppLog | null }> => {
    const read = await collect()
    setData(read.data)
    return read
  }

  const copy = async (testid: string, done: string) => {
    const ok = await copyText(buildReport((await fresh()).data))
    toast(ok ? done : C.copyFailed, { tone: ok ? 'default' : 'error', testid: ok ? testid : 'copy-failed' })
  }

  const share = async (kind: 'report' | 'log') => {
    if (sharing) return
    setSharing(kind)
    try {
      const read = await fresh()
      // The log: the end of the app's log file and the last crash record, read through the native bridge,
      // then what this session saw. Without the file (a browser preview) the text says that it is missing.
      const text = kind === 'report' ? buildReport(read.data) : buildLogText(read.data, sessionLog(), storageWriteFailures(), Date.now(), read.log)
      const result = await shareFile({ name: kind === 'report' ? 'lu-diagnostics.txt' : 'lu-log.txt', mime: 'text/plain', data: text, title: kind === 'report' ? T.reportTitle : T.shareLog })
      if (result.completed) toast(kind === 'report' ? T.reportShared : T.logShared, { testid: `${kind}-shared` })
      else toast(kind === 'report' ? T.reportCancelled : T.logCancelled, { testid: `${kind}-cancelled` })
    } catch {
      toast(kind === 'report' ? T.reportFailed : T.logFailed, { tone: 'error', testid: `${kind}-share-failed` })
    } finally {
      setSharing(null)
    }
  }

  const test = async () => {
    if (selfTest.kind === 'running') return
    setSelfTest({ kind: 'running' })
    const result = await runEngineSelfTest()
    if (result.ok) {
      const tps = result.tokensPerSecond >= 10 ? result.tokensPerSecond.toFixed(0) : result.tokensPerSecond.toFixed(1)
      const text = result.accelerator === 'gpu' ? T.selfTestPassedGpu(tps) : result.accelerator === 'cpu-fallback' ? T.selfTestPassedCpuFallback(tps) : T.selfTestPassedCpu(tps)
      useMobilePrefs.getState().setPref('lastSelfTest', { tokensPerSecond: result.tokensPerSecond, model: result.model, at: Date.now() })
      setSelfTest({ kind: 'passed', text })
    } else {
      const text =
        result.reason === 'no-engine'
          ? T.selfTestNoEngine
          : result.reason === 'no-model'
            ? T.selfTestNoModel
            : result.reason === 'busy'
              ? T.selfTestBusy
              : result.detail
                ? T.selfTestFailed(result.detail)
                : T.selfTestFailedPlain
      setSelfTest({ kind: 'failed', text })
    }
    void refresh()
    void runChecks()
  }

  const setupAgain = async () => {
    const yes = await nav.confirm({ title: T.setupQuestion, text: T.setupText, confirmLabel: T.setupConfirm, risk: 'destructive', testid: 'setup-again' })
    if (yes) nav.startFlow('onboarding')
  }

  const resetAll = async () => {
    const yes = await nav.confirm({ title: T.resetQuestion, text: resetAllText(useCloudAuthStore.getState().status === 'signed-in'), confirmLabel: T.resetConfirm, tone: 'danger', testid: 'settings-reset' })
    if (!yes) return
    useSettingsStore.getState().resetSettings()
    // The default of a phone, as on a fresh install (boot/wifi-default.ts): downloads wait for Wi-Fi.
    useSettingsStore.getState().updateSettings({ mobileDownloadWifiOnly: WIFI_ONLY_DEFAULT })
    useVoiceStore.getState().resetVoiceDefaults()
    usePermissionStore.getState().resetToDefaults()
    const prefs = useMobilePrefs.getState()
    prefs.setPref('switchCounter', MOBILE_PREF_DEFAULTS.switchCounter)
    prefs.setPref('systemVoiceFallback', MOBILE_PREF_DEFAULTS.systemVoiceFallback)
    prefs.setPref('teaserHintShown', MOBILE_PREF_DEFAULTS.teaserHintShown)
    setThemePref('system')
    toast(T.resetDone, { testid: 'settings-reset' })
  }

  const rows = data ? diagnosticsRows(data) : []

  return (
    <Page title={T.title} screen="settings-troubleshooting">
      <ListGroup title={T.groupChecks} testid="m-settings-troubleshooting-checks">
        <CheckRow id="engine" title={T.checkEngine} result={engine} />
        <CheckRow id="internet" title={T.checkInternet} result={internetCheck(online)} />
        <CheckRow id="cloud" title={T.checkCloud} result={online || cloud.light === 'busy' ? cloud : { light: 'warn', text: T.cloudOffline }} />
      </ListGroup>
      <Block>
        <Button block icon={RefreshCw} busy={checking} onPress={() => void runChecks()} testid="m-settings-troubleshooting-run" el="E19.1">
          {T.runAgain}
        </Button>
        {checkedAt ? <Hint testid="m-settings-troubleshooting-checked-at">{T.checkedAt(checkedAt)}</Hint> : null}
      </Block>

      <ListGroup title={T.groupActions}>
        <Row
          icon={Share2}
          title={T.shareLog}
          subtitle={T.shareLogSub}
          chevron={false}
          disabled={sharing === 'log'}
          onPress={() => void share('log')}
          risk="leaves-app" testid="m-settings-troubleshooting-share-log"
          el="E19.2"
        />
        <Row
          icon={ClipboardCopy}
          title={T.copyDetails}
          subtitle={T.copyDetailsSub}
          chevron={false}
          onPress={() => void copy('details-copied', T.detailsCopied)}
          testid="m-settings-troubleshooting-copy-details"
          el="E19.3"
        />
        <Row icon={Wand2} title={T.setupAgain} subtitle={T.setupAgainSub} chevron={false} onPress={() => void setupAgain()} risk="destructive" testid="m-settings-troubleshooting-setup" el="E19.4" />
        <Row icon={RotateCcw} title={T.reset} subtitle={T.resetSub} danger chevron={false} onPress={() => void resetAll()} risk="destructive" testid="m-settings-troubleshooting-reset" el="E19.5" />
      </ListGroup>

      <ListGroup title={T.diagTitle} testid="m-settings-troubleshooting-diagnostics">
        {rows.length === 0 ? <Row title={C.loading} testid="m-settings-troubleshooting-diag-loading" /> : null}
        {rows.map((row) => (
          <Row key={row.id} title={row.label} subtitle={row.note} value={row.value} testid={`m-settings-troubleshooting-diag-${row.id}`} />
        ))}
      </ListGroup>
      <Block>
        <Hint>{T.diagIntro}</Hint>
        <Button block icon={Gauge} busy={selfTest.kind === 'running'} label={selfTest.kind === 'running' ? T.selfTestRunning : undefined} onPress={() => void test()} testid="m-settings-troubleshooting-self-test">
          {T.selfTest}
        </Button>
        {selfTest.kind === 'running' ? <Hint strong>{T.selfTestRunning}</Hint> : null}
      </Block>
      {selfTest.kind === 'passed' ? <Notice testid="m-settings-troubleshooting-self-test-passed">{selfTest.text}</Notice> : null}
      {selfTest.kind === 'failed' ? (
        <Notice variant="warn" testid="m-settings-troubleshooting-self-test-failed">
          {selfTest.text}
        </Notice>
      ) : null}
      <Block>
        <Button variant="primary" block icon={ClipboardCopy} onPress={() => void copy('report-copied', T.reportCopied)} testid="m-settings-troubleshooting-copy-report">
          {T.copyReport}
        </Button>
        <Button block icon={FileText} onPress={() => void share('report')} risk="leaves-app" testid="m-settings-troubleshooting-share-report">
          {T.shareReport}
        </Button>
        <Button variant="quiet" block icon={RefreshCw} busy={reading} onPress={() => void refresh()} testid="m-settings-troubleshooting-refresh">
          {T.refresh}
        </Button>
        {readAt ? <Hint testid="m-settings-troubleshooting-read-at">{T.readAt(readAt)}</Hint> : null}
      </Block>
    </Page>
  )
}
