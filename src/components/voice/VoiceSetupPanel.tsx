import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Download, Loader2, Mic } from 'lucide-react'
import { VoicePicker } from './VoicePicker'
import { VoiceWaves } from './VoiceWaves'
import type { VoiceLoopInstallStatus, VoiceLoopRequirements } from '../../api/voice-loop'
import {
  voiceSetupCredits,
  voiceSetupItems,
  voiceSetupProgress,
  voiceSetupTotals,
} from '../../lib/voice/setup-view'
import type { VoiceSetupMode } from '../../lib/voice/setup-view'

interface Props {
  mode: VoiceSetupMode
  requirements: VoiceLoopRequirements | null
  status: VoiceLoopInstallStatus | null
  loadError: string | null
  actionError: string | null
  onInstall: () => void
  onCancel: () => void
  onRetryLoad: () => void
  /** Choose the voice before the download. Without it the panel shows no choice. */
  onChooseVoice?: (voice: string) => void
  /** A choice is being written, the list waits for it. */
  choosingVoice?: boolean
}

const cardCls = 'rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.03]'
const baseCls = 'inline-flex items-center justify-center gap-1.5 t-control transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const primaryCls = `${baseCls} h-[var(--control-h-lg)] px-6 rounded-full bg-gray-900 !text-white hover:bg-gray-700 dark:bg-white dark:!text-gray-900 dark:hover:bg-gray-200`
const quietCls = `${baseCls} h-[var(--control-h-md)] px-3 rounded-md border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]`

function ErrorCard({ title, detail }: { title: string; detail: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 p-2.5 rounded-lg border border-red-300 dark:border-red-500/25 bg-red-50 dark:bg-red-500/[0.08] text-red-700 dark:text-red-300">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <div className="min-w-0 t-micro leading-relaxed">
        <div className="font-medium">{title}</div>
        <div className="whitespace-pre-wrap break-words">{detail}</div>
      </div>
    </div>
  )
}

function Progress({ status, onCancel }: { status: VoiceLoopInstallStatus; onCancel: () => void }) {
  const progress = voiceSetupProgress(status)
  const percent = progress.fraction === null ? null : Math.round(progress.fraction * 100)
  return (
    <div className={`${cardCls} p-3 space-y-2.5`} data-testid="voice-setup-progress">
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Setup steps">
        {progress.steps.map((step) => (
          <li
            key={step.key}
            aria-current={step.state === 'active' ? 'step' : undefined}
            className={`flex items-center gap-1 t-micro ${
              step.state === 'active'
                ? 'text-gray-900 dark:text-white font-medium'
                : step.state === 'done' ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400 dark:text-gray-600'
            }`}
          >
            {step.state === 'done' && <Check size={10} className="text-green-500" />}
            {step.state === 'active' && <Loader2 size={10} className="animate-spin" />}
            {step.label}
          </li>
        ))}
      </ol>
      <div role="status" className="t-body text-gray-800 dark:text-gray-200">{progress.headline}</div>
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="h-1.5 rounded-full bg-gray-200 dark:bg-white/[0.06] overflow-hidden"
      >
        {percent === null ? (
          <div className="h-full w-1/3 rounded-full bg-gray-500 dark:bg-white/50 animate-pulse" />
        ) : (
          <div className="h-full rounded-full bg-gray-700 dark:bg-white/70 transition-[width] duration-[var(--motion-slow)]" style={{ width: `${percent}%` }} />
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <div data-testid="voice-setup-line" className="min-w-0 truncate t-micro font-mono text-gray-500 dark:text-gray-400" title={progress.line}>
          {progress.line || ' '}
        </div>
        <button type="button" className={quietCls} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

/**
 * First visit to the Voice surface: what will be downloaded, why, and the
 * setup itself. Purely a view of the props, the logic is in
 * lib/voice/setup-view.ts and useVoiceSetup.
 */
export function VoiceSetupPanel({ mode, requirements, status, loadError, actionError, onInstall, onCancel, onRetryLoad, onChooseVoice, choosingVoice }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  if (mode === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center t-body text-gray-500">
        <Loader2 size={13} className="animate-spin mr-2" /> Checking the voice setup
      </div>
    )
  }

  if (mode === 'removing') {
    return (
      <div role="status" data-testid="voice-removing" className="flex-1 flex items-center justify-center t-body text-gray-500">
        <Loader2 size={13} className="animate-spin mr-2" /> Removing the voice engine
      </div>
    )
  }

  if (mode === 'unavailable' || !requirements) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="max-w-md mx-auto px-4 py-8 space-y-3">
          <ErrorCard title="Voice is not available right now." detail={loadError ?? 'The voice setup could not be read.'} />
          <button type="button" className={quietCls} onClick={onRetryLoad}>Try again</button>
        </div>
      </div>
    )
  }

  if (mode === 'unsupported') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="max-w-md mx-auto px-4 py-10 text-center space-y-2">
          <Mic size={20} className="mx-auto text-gray-400" />
          <h2 className="t-title text-gray-900 dark:text-white">Voice is not available on this computer</h2>
          <p role="status" className="t-body leading-relaxed text-gray-600 dark:text-gray-400">
            {requirements.unsupportedReason ?? 'This computer cannot run the voice engine.'}
          </p>
        </div>
      </div>
    )
  }

  const items = voiceSetupItems(requirements)
  const totals = voiceSetupTotals(requirements)
  const credits = voiceSetupCredits(requirements)
  const installing = mode === 'installing' && status
  const startLabel = mode === 'cancelled' ? 'Continue setup' : mode === 'failed' ? 'Try again' : 'Install'

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
      <div className="min-h-full max-w-md mx-auto px-4 py-6 flex flex-col justify-center gap-3">
        <VoiceWaves mood={installing ? 'starting' : 'idle'} className="h-24 shrink-0" />

        <div className="space-y-1.5 text-center">
          <h2 className="t-title text-gray-900 dark:text-white">Talk to your model</h2>
          <p className="t-body leading-relaxed text-gray-600 dark:text-gray-400">
            Speak with the chat model you have selected and hear it answer. Speech recognition and speech output run on
            this computer, after a one-time setup.
          </p>
        </div>

        {!totals.enoughSpace && (
          <ErrorCard title="Not enough free space." detail={`The setup needs ${totals.disk}. Free some space, then try again.`} />
        )}
        {mode === 'failed' && (
          <ErrorCard title="The setup did not finish." detail={status?.error ?? 'Something went wrong. What was already downloaded is kept.'} />
        )}
        {mode === 'cancelled' && (
          <p role="status" className="text-center t-micro leading-relaxed text-gray-500 dark:text-gray-400">
            The setup was cancelled. What was already downloaded is kept, continuing picks up where it stopped.
          </p>
        )}
        {actionError && <ErrorCard title="That did not work." detail={actionError} />}

        {onChooseVoice && requirements.voices.length > 1 && (
          <div className="mx-auto w-full max-w-[16rem] space-y-1" data-testid="voice-setup-voice">
            <label htmlFor="voice-setup-voice" className="block t-micro text-gray-500 dark:text-gray-400">Voice</label>
            <VoicePicker
              id="voice-setup-voice"
              voices={requirements.voices}
              value={requirements.voice}
              onChange={onChooseVoice}
              disabled={!!installing || choosingVoice}
            />
            <p className="t-micro leading-relaxed text-gray-500 dark:text-gray-400">
              The voice the answers are spoken in. You can change it later in the voice settings.
            </p>
          </div>
        )}

        {installing ? (
          <Progress status={installing} onCancel={onCancel} />
        ) : (
          <div className="flex justify-center pt-1">
            <button type="button" className={primaryCls} onClick={onInstall} disabled={!totals.enoughSpace || choosingVoice}>
              <Download size={13} /> {startLabel}
            </button>
          </div>
        )}

        <dl className="grid grid-cols-3 gap-2 t-micro text-center" aria-label="Setup size">
          {[
            ['Download', totals.download],
            ['Space needed', totals.disk],
            ['Free space', totals.free ?? 'unknown'],
          ].map(([label, value]) => (
            <div key={label} className="px-1 py-1">
              <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
              <dd className="font-mono text-gray-800 dark:text-gray-200">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="text-center">
          <button
            type="button"
            onClick={() => setDetailsOpen((value) => !value)}
            aria-expanded={detailsOpen}
            className="inline-flex items-center gap-1 t-micro text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            What is downloaded
            <ChevronDown size={11} className={'transition-transform ' + (detailsOpen ? 'rotate-180' : '')} />
          </button>
        </div>

        {detailsOpen && (
          <div className="space-y-2">
            <ul className={`${cardCls} divide-y divide-gray-200 dark:divide-white/[0.06]`} aria-label="What the setup downloads">
              {items.map((item) => (
                <li key={item.key} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 t-body text-gray-800 dark:text-gray-200">
                      <span className="truncate">{item.title}</span>
                      {item.installed && <Check size={11} className="shrink-0 text-green-500" aria-label="Installed" />}
                    </div>
                    <div className="t-micro leading-relaxed text-gray-500 dark:text-gray-400">{item.purpose}</div>
                  </div>
                  <div className="shrink-0 text-right t-micro font-mono text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {item.size}
                  </div>
                </li>
              ))}
            </ul>
            <p className="t-micro leading-relaxed text-gray-500 dark:text-gray-400 break-all">Stored in {requirements.installDir}</p>
            {credits.length > 0 && (
              <div className="space-y-0.5 t-micro leading-relaxed text-gray-500 dark:text-gray-500" aria-label="Credits">
                {credits.map((line) => <p key={line}>{line}</p>)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
