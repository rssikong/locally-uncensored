/**
 * G4 the error screen. Owned by strand 6 (Remote and resilience).
 *
 * Replaces the shell when it cannot start or when a render error reaches the
 * top. It stands outside the router (which may be the thing that broke), so
 * it uses no nav.confirm and no toast: the question before the reset and the
 * result of "Copy report" are states of this same screen.
 *
 * What it promises, and keeps:
 *   - Nothing is deleted. "Restart LU" loads the app again with everything
 *     in place, after the chat that was being written has reached the disk.
 *   - "Copy report" puts the error and the device figures on the clipboard
 *     (lib/diagnostics.ts, buildDiagnosticsReport). No chat text is in it.
 *     When the clipboard refuses, the report is shown to select by hand.
 *   - "Reset settings and restart" asks first and keeps chats and models.
 *
 * G4.2 "Restore from backup" is not offered: the only restore the app has
 * writes the whole backup over what is on the phone, and the backup can be
 * older than the chats on screen. A button that can lose data does not
 * belong on a screen that promises none is lost (wish in remote.md).
 *
 *   - **G4 Fehlerschirm.** Ersetzt die Shell, wenn sie nicht starten kann. "LU could not start." Ein Satz
 *     Grund. G4.1 "Try again", G4.2 "Restore from backup", G4.3 "Share log", G4.4 "Reset settings and
 *     restart".
 */
import { useEffect, useState } from 'react'
import { resetSettingsAndReload } from '../../lib/fatal-error'
import { buildDiagnosticsReport } from '../lib/diagnostics'
import { markWarmReload } from '../nav/restore'
import { useNavStore } from '../nav/store'
import { copyText } from '../platform/clipboard'
import { COMMON } from '../strings/common'
import { REMOTE_STRINGS } from '../strings/remote'
import { Button, ErrorState } from '../ui'

const S = REMOTE_STRINGS.fatal

/** How long the restart waits for the last chat write, at most. */
export const FLUSH_BUDGET_MS = 1500
const STACK_LINES = 12

function errorLines(error: unknown): string[] {
  if (error instanceof Error) {
    const stack = (error.stack ?? '').split('\n').slice(0, STACK_LINES).join('\n')
    return [`Error: ${error.name}: ${error.message}`, stack ? `Stack:\n${stack}` : '']
  }
  if (typeof error === 'string' && error) return [`Error: ${error}`]
  return ['Error: unknown']
}

function whereItHappened(): string {
  try {
    const state = useNavStore.getState()
    const stack = state.flow ? state.flowStack : state.stacks[state.tab]
    const top = stack.at(-1)
    return top ? `Screen: ${top.route}` : ''
  } catch {
    return ''
  }
}

/** The report as plain text: the error, where it happened, the device figures. Never throws, never holds chat text. */
export function buildFatalReport(error: unknown): string {
  let figures = ''
  try {
    figures = buildDiagnosticsReport()
  } catch {
    figures = 'LU diagnostics\nNot available'
  }
  const head = ['LU error report', ...errorLines(error), whereItHappened()].filter((line) => line !== '')
  return [...head, '', figures].join('\n')
}

/** Write what the chat store still holds in memory, bounded, so the restart loses no line. Never throws. */
export async function flushBeforeRestart(budgetMs: number = FLUSH_BUDGET_MS): Promise<void> {
  try {
    const chats = import('../../stores/chatStore').then((m) => m.flushChatPersist())
    // The chats with a desktop have their own store and their own pending write.
    const remoteChats = import('../screens/remote/parts/session').then((m) => m.remoteSession().flush())
    const flushed = Promise.allSettled([chats, remoteChats])
    await Promise.race([flushed, new Promise<void>((resolve) => setTimeout(resolve, budgetMs))])
  } catch {
    /* a store that cannot write now could not have written before either */
  }
}

/**
 * `running` says the app had started when the error came (the boundary of the
 * shell). Then the title and the sentence say so: "LU could not start." is not
 * true for an app the user was just using. One title at a time, never both.
 */
export function FatalScreen({ error, running = false }: { error?: unknown; running?: boolean }) {
  const [asking, setAsking] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no')
  const [report, setReport] = useState('')
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : ''

  useEffect(() => {
    // The moment the screen appears: save what was being written.
    void flushBeforeRestart()
  }, [])

  const restart = async () => {
    if (restarting) return
    setRestarting(true)
    await flushBeforeRestart()
    // The app restarts itself: it comes back on the page it was on, not in a new chat (round 57).
    markWarmReload()
    window.location.reload()
  }

  const copy = async () => {
    const text = buildFatalReport(error)
    setReport(text)
    setCopied((await copyText(text)) ? 'yes' : 'failed')
  }

  const reset = async () => {
    await flushBeforeRestart()
    resetSettingsAndReload()
  }

  return (
    <div className="m-app" data-testid="m-fatal-screen" data-el="G4" data-m-phase={running ? 'running' : 'start'}>
      <div className="m-stack">
        <div className="m-page">
          <div className="m-body">
            {asking ? (
              <ErrorState
                title={COMMON.fatalResetQuestion}
                actions={
                  <>
                    <Button variant="danger" risk="destructive" block onPress={() => void reset()} testid="m-fatal-reset-confirm">
                      {COMMON.fatalResetConfirm}
                    </Button>
                    <Button block onPress={() => setAsking(false)} testid="m-fatal-reset-cancel">
                      {COMMON.cancel}
                    </Button>
                  </>
                }
              >
                {COMMON.fatalResetText}
              </ErrorState>
            ) : (
              <ErrorState
                title={running ? COMMON.fatalRunningTitle : COMMON.fatalTitle}
                actions={
                  <>
                    <Button variant="primary" block busy={restarting} onPress={() => void restart()} testid="m-fatal-retry" el="G4.1">
                      {S.restart}
                    </Button>
                    <Button block onPress={() => void copy()} testid="m-fatal-copy" el="G4.3">
                      {S.copyReport}
                    </Button>
                    <Button block onPress={() => setAsking(true)} testid="m-fatal-reset" el="G4.4">
                      {COMMON.fatalReset}
                    </Button>
                  </>
                }
              >
                {running ? COMMON.fatalRunningText : COMMON.fatalText}
                <span style={{ display: 'block', marginTop: 8 }} data-testid="m-fatal-safe">
                  {S.safe}
                </span>
                {detail ? (
                  <span className="m-mono m-t3" style={{ display: 'block', marginTop: 8, overflowWrap: 'anywhere' }} data-testid="m-fatal-detail">
                    {detail}
                  </span>
                ) : null}
              </ErrorState>
            )}
            {!asking && copied !== 'no' ? (
              <div className="m-pad" style={{ paddingBottom: 'calc(var(--m-safe-bottom) + var(--m-s4))' }}>
                <p role="status" className="m-cap" style={{ textAlign: 'center', marginBottom: 'var(--m-s3)' }} data-testid="m-fatal-copy-result" data-m-copied={copied}>
                  {copied === 'yes' ? S.reportCopied : S.reportNotCopied}
                </p>
                {copied === 'failed' ? (
                  <pre className="m-dev-report m-mono" aria-label={S.reportLabel} data-testid="m-fatal-report">
                    {report}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
