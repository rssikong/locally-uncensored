/**
 * K10 Characters. Route /create/characters, page, strand 3 (Create).
 *
 * The shelf of trained characters of the account. K10.1 a card picks the
 * character for the next run and goes back to K1, K10.2 "More" opens the
 * sheet with Rename and Delete, K10.3 "New character" leads to K11, K10.4
 * is the card of a training that is still running, with Cancel.
 *
 * A training is a cloud job like any other: it is written down when it is
 * booked (lib/pending-cloud-jobs.ts) and so it is still listed here after
 * the app was closed and opened again.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { Check, Ellipsis, Plus, UserRound } from 'lucide-react'
import { CloudJobError, cancelJob } from '../../../api/cloud/jobs'
import { listLoras, type CloudLora } from '../../../api/cloud/loras'
import { RENDER_CANNOT_STOP, useCloudCreate } from '../../../hooks/useCloudCreate'
import { forgetPendingCloudJob } from '../../../lib/pending-cloud-jobs'
import { useCreateStore } from '../../../stores/createStore'
import { nav } from '../../nav'
import { CREATE_STRINGS as T } from '../../strings/create'
import { Button, EmptyState, Icon, IconButton, ListGroup, Notice, Page, Progress, Row, SkeletonRows, toast } from '../../ui'
import { setTool } from './parts/actions'
import { useCharacterNames } from './parts/adapters/character-names'
import { useGate } from './parts/facts'
import { formatClock } from './parts/params'
import { installCreateServices, refreshPending, refreshQuota, resumeNow, useRunStore } from './parts/services'
import './parts/create.css'

type Shelf = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; list: CloudLora[] }

function useElapsed(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

export default function CharactersPage() {
  const version = useCreateStore((s) => s.charactersVersion)
  const selected = useCreateStore((s) => s.selectedCharacter)
  const live = useCreateStore((s) => s.isGenerating && s.intent() === 'character' && s.characterTab === 'train')
  const liveProgress = useCreateStore((s) => s.progress)
  const liveName = useCreateStore((s) => s.triggerWord)
  const pending = useRunStore((s) => s.pending)
  const names = useCharacterNames((s) => s.names)
  const { cancel } = useCloudCreate({ onQuotaChange: () => void refreshQuota() })
  const [shelf, setShelf] = useState<Shelf>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [stopping, setStopping] = useState<string | null>(null)
  // Without a sign in there is no shelf to load: the page says so instead of blaming the connection.
  const signedOut = useGate().gate === 'signed-out'

  const trainings = pending.filter((p) => p.landing === 'character').sort((a, b) => b.startedAt - a.startedAt)
  const now = useElapsed(trainings.length > 0 || live)

  // Before the first paint: a training that is booked must not stand here as "uploading" for a moment.
  useLayoutEffect(() => {
    refreshPending()
  }, [])
  useEffect(() => {
    installCreateServices()
    refreshPending()
    resumeNow()
  }, [])
  useEffect(() => {
    // While a training is out, look for its end. The ledger changes when the result was fetched.
    if (trainings.length === 0 && !live) return
    // While the photos go up the job is not booked yet: look often, so the card changes the moment it is.
    const t = setInterval(
      () => {
        refreshPending()
        if (!live) resumeNow()
      },
      live ? 1000 : 5000,
    )
    return () => clearInterval(t)
  }, [trainings.length, live])

  useEffect(() => {
    let alive = true
    void listLoras()
      .then((list) => {
        if (alive) setShelf({ state: 'ready', list })
      })
      .catch(() => {
        if (alive) setShelf((s) => (s.state === 'ready' ? s : { state: 'failed' }))
      })
    return () => {
      alive = false
    }
  }, [version, attempt, trainings.length])

  const pick = (c: CloudLora) => {
    const name = names[c.id] ?? c.name
    setTool('character')
    const st = useCreateStore.getState()
    st.setCharacterTab('use')
    st.setSelectedCharacter({ id: c.id, name, triggerWord: c.trigger_word, family: c.base_family })
    toast(T.chars.picked(name), { testid: 'create-character-picked' })
    void nav.back()
  }

  const stop = useCallback(
    async (id: string | null) => {
      const cannotStop = () => toast(T.chars.trainingCannotStop, { tone: 'error', testid: 'create-training-cannot-stop' })
      // The run of this app answers a job that a GPU already took with a sentence, not with a throw.
      const liveCancel = async (): Promise<boolean> => {
        await cancel()
        if (useCreateStore.getState().error !== RENDER_CANNOT_STOP) return true
        useCreateStore.getState().setError(null)
        cannotStop()
        return false
      }
      if (id === null) {
        // Still uploading, as far as this page knows: the run is stopped. If it was booked in
        // this very moment and a GPU took it, that is said like everywhere else.
        await liveCancel()
        return
      }
      setStopping(id)
      try {
        if (live && trainings[0]?.id === id) {
          if (!(await liveCancel())) return
        } else {
          await cancelJob(id)
          forgetPendingCloudJob(id)
        }
        refreshPending()
        void refreshQuota()
        toast(T.chars.trainingCancelled, { testid: 'create-training-cancelled' })
      } catch (err) {
        // 409: the training is already running. Anything else did not reach the server or was refused,
        // and then the training is neither stopped nor lost: the user can try again.
        if (err instanceof CloudJobError && err.status === 409) cannotStop()
        else toast(T.chars.trainingCancelFailed, { tone: 'error', testid: 'create-training-cancel-failed' })
      } finally {
        setStopping(null)
      }
    },
    [cancel, live, trainings],
  )

  const uploading = live && trainings.length === 0
  const list = shelf.state === 'ready' ? shelf.list : []
  const nothing = shelf.state === 'ready' && list.length === 0 && trainings.length === 0 && !uploading

  return (
    <Page
      title={T.chars.title}
      screen="create-characters"
      needsNetwork
      flush
      footer={
        signedOut ? undefined : (
          <Button variant="primary" block icon={Plus} onPress={() => nav.push('/create/characters/new')} testid="m-create-character-new" el="K10.3">
            {T.chars.new}
          </Button>
        )
      }
    >
      {uploading ? (
        <div className="m-k-sec">
          <div className="m-k-card" data-testid="m-create-training" data-el="K10.4" data-state="uploading">
            <b className="m-k-card-title">{liveName ? T.chars.trainingName(liveName) : T.chars.training}</b>
            <Progress label={T.chars.trainingProgress} value={Math.max(0, Math.min(1, liveProgress / 100))} tone="cloud" detail={T.newChar.uploadingPlain} />
            <div className="m-k-card-actions">
              <Button compact onPress={() => void stop(null)} testid="m-create-training-cancel">
                {T.chars.trainingCancel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {trainings.length > 0 ? (
        <div className="m-k-sec">
          {trainings.map((job, i) => {
            const name = (typeof job.item?.name === 'string' && job.item.name) || (live && i === 0 ? liveName : '') || job.prompt
            return (
              <div className="m-k-card" key={job.id} data-testid="m-create-training" data-m-id={job.id} data-el="K10.4" data-state="training">
                <div className="m-k-card-head">
                  <span className="m-k-card-text">
                    <b className="m-k-card-title">{name ? T.chars.trainingName(name) : T.chars.training}</b>
                    <span className="m-k-card-sub">{T.chars.trainingText}</span>
                  </span>
                </div>
                <Progress label={T.chars.trainingProgress} tone="cloud" hidePercent detail={formatClock(Math.max(0, Math.round((now - job.startedAt) / 1000)))} />
                <div className="m-k-card-actions">
                  <Button compact busy={stopping === job.id} onPress={() => void stop(job.id)} testid="m-create-training-cancel">
                    {T.chars.trainingCancel}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
      {signedOut && shelf.state !== 'ready' ? (
        <EmptyState
          title={T.chars.signedOut}
          icon={UserRound}
          testid="m-create-characters-signed-out"
          actions={
            <Button variant="cloud" block onPress={() => nav.push('/cloud')} testid="m-create-characters-sign-in">
              {T.gateSignIn}
            </Button>
          }
        >
          {T.chars.signedOutText}
        </EmptyState>
      ) : null}
      {!signedOut && shelf.state === 'loading' ? <SkeletonRows rows={3} /> : null}
      {!signedOut && shelf.state === 'failed' ? (
        <div className="m-k-sec">
          <Notice
            variant="error"
            title={T.chars.loadFailed}
            testid="m-create-characters-failed"
            actions={
              <Button
                compact
                onPress={() => {
                  setShelf({ state: 'loading' })
                  setAttempt((n) => n + 1)
                }}
                testid="m-create-characters-retry"
              >
                {T.chars.retry}
              </Button>
            }
          >
            {T.chars.loadFailedText}
          </Notice>
        </div>
      ) : null}
      {nothing ? (
        <EmptyState title={T.chars.empty} icon={UserRound} testid="m-create-characters-empty">
          {T.chars.emptyText}
        </EmptyState>
      ) : null}
      {list.length > 0 ? (
        <ListGroup>
          {list.map((c) => {
            const name = names[c.id] ?? c.name
            const family = T.chars.families[c.base_family] ?? c.base_family
            return (
              <Row
                key={c.id}
                icon={UserRound}
                title={name}
                subtitle={`${T.chars.family(family)}. ${T.chars.trigger(c.trigger_word)}`}
                onPress={() => pick(c)}
                chevron={false}
                label={T.chars.use(name)}
                end={selected?.id === c.id ? <Icon icon={Check} small /> : undefined}
                trailing={<IconButton icon={Ellipsis} label={T.chars.more(name)} onPress={() => nav.openSheet('create-character', { id: c.id, name })} testid="m-create-character-more" el="K10.2" />}
                testid="m-create-character"
                el="K10.1"
              />
            )
          })}
        </ListGroup>
      ) : null}
    </Page>
  )
}
