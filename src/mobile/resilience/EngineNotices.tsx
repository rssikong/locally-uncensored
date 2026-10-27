/**
 * G10 Engine notices. Owned by strand 4 (Models and onboarding).
 *
 * What the engine has to say, as lines in the notice area of the chat (C2
 * renders <EngineNotices />) and as boxes on the engine page (E13 renders
 * <EngineNotices variant="box" />):
 *
 *  - "Loading <model>"
 *  - the model could not start, with the reason, "Try again" and
 *    "Pick another model"
 *  - "The model was unloaded to free memory." with "Load again"
 *  - "Graphics acceleration is not available. LU is running on the
 *    processor, which is slower." with "Details"
 *  - on the engine pages only: the model runs, but not with the chosen
 *    flash attention and cache settings (`tuningNote` of the start), with
 *    the way to Advanced
 *
 * It reads the engine state the strand keeps (screens/models/parts/engine.ts)
 * and the failures the logic layer announces when the chat itself loads a
 * model (stores/luEngineSwitchStore.ts, tone "error").
 */
import { useState, type ReactNode } from 'react'
import { Cpu, Loader, SlidersHorizontal } from 'lucide-react'
import { useLuEngineSwitchStore } from '../../stores/luEngineSwitchStore'
import { nav } from '../nav'
import { loadModel, useEngine, useEngineUi } from '../screens/models/parts/engine'
import { MODELS_STRINGS as S } from '../strings/models'
import { Banner, Button, Notice } from '../ui'
import { phoneEngineNote, shortEngineNote } from '../screens/chat/parts/engine-note'

export interface EngineNoticesProps {
  /** line: slim lines for the chat. box: boxes for the engine page. */
  variant?: 'line' | 'box'
  /** Show this one notice only. The Advanced page shows the note about its own settings and nothing else. */
  only?: 'tuning'
}

/** The processor notice is said once per model and session, not on every page. */
const cpuSeen = new Set<string>()

export function EngineNotices({ variant = 'line', only }: EngineNoticesProps) {
  const engine = useEngine()
  const busy = useEngineUi((s) => s.busy)
  const failure = useEngineUi((s) => s.failure)
  const unloaded = useEngineUi((s) => s.unloaded)
  const tuningNote = useEngineUi((s) => s.tuningNote)
  const note = useLuEngineSwitchStore((s) => (s.tone === 'error' ? s.note : null))
  const [, setTick] = useState(0)
  const box = variant === 'box'
  const t = (part: string) => (box ? `m-settings-engine-notice-${part}` : `m-engine-notice-${part}`)
  const out: ReactNode[] = []

  const pickAnother = () => {
    useEngineUi.getState().setFailure(null)
    useLuEngineSwitchStore.getState().dismiss()
    if (box) nav.resetTo('models')
    else nav.openSheet('model')
  }

  if (only === 'tuning') {
    if (!tuningNote || !engine.running || busy) return null
    return (
      <div data-testid="m-settings-engine-notices">
        <Notice variant="warn" icon={SlidersHorizontal} testid={t('tuning')}>
          {tuningNote}
        </Notice>
      </div>
    )
  }

  if (busy?.kind === 'loading') {
    const text = S.notices.loading(busy.name)
    out.push(
      box ? (
        <Notice key="loading" icon={Loader} testid={t('loading')}>
          {text}
        </Notice>
      ) : (
        <Banner key="loading" icon={Loader} testid={t('loading')}>
          {text}
        </Banner>
      ),
    )
  }

  if (failure && !busy) {
    const gone = /no such file|not found|does not exist/i.test(failure.reason)
    const text = failure.memory ? S.notices.noMemory(failure.name) : gone ? S.notices.fileGone : [S.notices.failedName(failure.name), phoneEngineNote(failure.reason)].filter(Boolean).join(' ')
    out.push(
      <Notice
        key="failed"
        variant="error"
        testid={t('failed')}
        actions={
          <>
            {failure.path && !gone ? (
              <Button compact testid={t('retry')} onPress={() => void loadModel({ name: failure.path!.split(/[\\/]/).pop()!.replace(/\.gguf$/i, ''), path: failure.path! })}>
                {S.notices.tryAgain}
              </Button>
            ) : null}
            <Button compact variant="quiet" testid={t('pick')} onPress={pickAnother}>
              {S.notices.pickAnother}
            </Button>
          </>
        }
      >
        {text}
      </Notice>,
    )
  } else if (note && !busy) {
    out.push(
      <Notice
        key="note"
        variant="error"
        testid={t('failed')}
        actions={
          <>
            {/* Check Android package 16, N1 rest: where room is cramped the shorter label keeps both buttons in one
                line, so the note does not push the composer off the screen. The name stays the whole label. */}
            <Button compact testid={t('pick')} label={S.notices.pickAnother} onPress={pickAnother}>
              <span className="m-btn-long">{S.notices.pickAnother}</span>
              <span className="m-btn-short">{S.notices.pickAnotherShort}</span>
            </Button>
            <Button compact variant="quiet" testid={t('dismiss')} onPress={() => useLuEngineSwitchStore.getState().dismiss()}>
              {S.notices.dismiss}
            </Button>
          </>
        }
      >
        {shortEngineNote(note) ? (
          <>
            <span className="m-note-full">{phoneEngineNote(note)}</span>
            <span className="m-note-short">{shortEngineNote(note)}</span>
          </>
        ) : (
          phoneEngineNote(note)
        )}
      </Notice>,
    )
  }

  if (unloaded && !engine.running && !busy && !failure) {
    const again = () => void loadModel({ name: unloaded.name, path: unloaded.path })
    out.push(
      box ? (
        <Notice
          key="unloaded"
          variant="warn"
          testid={t('unloaded')}
          actions={
            <Button compact testid={t('load-again')} onPress={again}>
              {S.notices.loadAgain}
            </Button>
          }
        >
          {S.notices.unloaded}
        </Notice>
      ) : (
        <Banner key="unloaded" variant="warn" testid={t('unloaded')} action={{ label: S.notices.loadAgain, onPress: again }}>
          {S.notices.unloaded}
        </Banner>
      ),
    )
  }

  if (engine.fellBack && engine.loadedPath && !busy) {
    if (box) {
      out.push(
        <Notice key="cpu" variant="warn" icon={Cpu} testid={t('cpu')}>
          {[S.notices.cpu, engine.status?.sanityNote].filter(Boolean).join(' ')}
        </Notice>,
      )
    } else if (!cpuSeen.has(engine.loadedPath)) {
      const path = engine.loadedPath
      out.push(
        <Banner
            key="cpu"
            variant="warn"
            icon={Cpu}
            testid={t('cpu')}
            action={{
              label: S.notices.details,
              testid: t('cpu-details'),
              onPress: () => {
                cpuSeen.add(path)
                setTick((n) => n + 1)
                nav.push('/settings/engine')
              },
            }}
            // It can be closed without leaving the chat (round 5, N3). Said once per model and session either way.
            actions={[
              {
                label: S.notices.dismiss,
                testid: t('cpu-dismiss'),
                onPress: () => {
                  cpuSeen.add(path)
                  setTick((n) => n + 1)
                },
              },
            ]}
          >
            {S.notices.cpu}
          </Banner>,
      )
    }
  }

  // The model runs, but with the standard cache settings instead of the chosen ones. A matter of the engine pages, not of a chat.
  if (box && tuningNote && engine.running && !busy) {
    out.push(
      <Notice
        key="tuning"
        variant="warn"
        icon={SlidersHorizontal}
        testid={t('tuning')}
        actions={
          <Button compact testid={t('tuning-open')} onPress={() => nav.push('/settings/engine/advanced')}>
            {S.engine.tuningNoteAction}
          </Button>
        }
      >
        {tuningNote}
      </Notice>,
    )
  }

  if (out.length === 0) return null
  return <div data-testid={box ? 'm-settings-engine-notices' : 'm-engine-notices'}>{out}</div>
}
