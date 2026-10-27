/**
 * K14 Batch. Route /create/batch, page, strand 3 (Create).
 *
 * Several photos from the library run through the same tool with the same
 * settings, one after the other. K14.1 "Add more", K14.2 the X of a row,
 * K14.3 "Start" with the price of the whole list, K14.4 "Stop after this
 * one", K14.5 a result row that opens the viewer (K7).
 *
 * There is no folder import on a phone. The photo picker takes several.
 */
import { useEffect, useState } from 'react'
import { Images, Plus, X } from 'lucide-react'
import { useCloudCreate } from '../../../hooks/useCloudCreate'
import { MAX_BATCH_IMAGES, batchCoverage, type BatchStatus } from '../../../lib/batch-edit'
import { signalCreditsExhausted } from '../../../lib/credits-exhausted'
import { mediaRefFrom } from '../../../components/create/experimental/mediaRef'
import { useCreateStore } from '../../../stores/createStore'
import { nav } from '../../nav'
import { pickPhotos } from '../../platform/files'
import { CREATE_STRINGS as T } from '../../strings/create'
import { Button, EmptyState, IconButton, ListGroup, Notice, Page, Progress, Row, Tag, toast } from '../../ui'
import { addSourceFiles } from './parts/actions'
import { removeBatchEntry, requestBatchStop, runBatchNow, useBatchStore } from './parts/batch-runner'
import { checkFile } from './parts/files'
import { useCreateFacts } from './parts/facts'
import { creditsLabel } from './parts/params'
import { purchaseView, withAiConsent } from './parts/policy'
import { PriceOwner } from './parts/PriceOwner'
import { installCreateServices, refreshQuota } from './parts/services'
import { itemName, useGalleryItem } from './parts/ui'
import './parts/create.css'

function ResultRow({ name, itemId }: { name: string; itemId: string }) {
  const item = useGalleryItem(itemId)
  if (!item) return null
  return (
    <Row
      icon={Images}
      title={name}
      subtitle={itemName(item)}
      label={T.batch.openResult(name)}
      onPress={() => nav.push('/create/item/:id', { id: itemId })}
      testid="m-create-batch-result"
      el="K14.5"
    />
  )
}

export default function BatchPage() {
  const f = useCreateFacts()
  const sources = useCreateStore((s) => s.batchSources)
  const run = useCreateStore((s) => s.batchRun)
  const prompt = useCreateStore((s) => s.prompt)
  const progress = useCreateStore((s) => s.progress)
  const report = useBatchStore((s) => s.report)
  const results = useBatchStore((s) => s.results)
  const stopping = useBatchStore((s) => s.stopping)
  const pacing = useBatchStore((s) => s.pacing)
  const { generate } = useCloudCreate({ onQuotaChange: () => void refreshQuota() })
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    installCreateServices()
  }, [])

  const offered = f.facts.batch && !f.needsMask
  const running = run !== null
  // While it runs the list on screen is the one the batch started with.
  const rows = running ? run.names.map((name, i) => ({ name, url: run.thumbs[i], status: run.statuses[i] })) : sources.map((s) => ({ name: s.name, url: s.url, status: 'waiting' as BatchStatus }))
  const n = rows.length
  const each = f.cost
  const total = each !== null ? each * n : null
  const remaining = f.quota ? f.quota.remaining.credits : null
  const covered = each !== null && remaining !== null ? batchCoverage(remaining, each, n) : n

  const add = async () => {
    setAdding(true)
    try {
      const picked = await pickPhotos({ multiple: true })
      const files = picked.map((p) => p.file)
      if (files.length === 0) return
      const st = useCreateStore.getState()
      if (st.batchSources.length < 2) {
        // Nothing waits yet: the first photo becomes the source, all of them the list.
        const res = await addSourceFiles(files)
        if (!res.ok && res.message) toast(res.message, { tone: 'error', testid: 'create-batch-problem' })
        else if (res.ok && res.batch < 2) toast(T.batch.needTwo, { testid: 'create-batch-need-two' })
        return
      }
      const usable = files.filter((file) => checkFile(file, 'image') === null)
      const have = st.batchSources
      const next = [...have]
      for (const file of usable) {
        if (next.length >= MAX_BATCH_IMAGES) break
        if (next.some((r) => r.name === file.name && r.blob.size === file.size)) continue
        next.push(mediaRefFrom(file))
      }
      useBatchStore.getState().set({ report: null })
      st.setBatchSources(next)
      if (usable.length < files.length) toast(T.file.skipped(files.length - usable.length), { testid: 'create-batch-skipped' })
    } finally {
      setAdding(false)
    }
  }

  const reason = !offered ? T.batch.notOffered : n < 2 ? T.batch.needTwo : f.block === 'no-prompt' ? T.batch.noPrompt : f.block && f.block !== 'no-source' ? T.block[f.block] : undefined
  const start = () => {
    if (reason || running) return
    if (f.wallet !== 'ok' || covered === 0) {
      signalCreditsExhausted(f.wallet !== 'ok' ? f.wallet : 'credits')
      return
    }
    void withAiConsent(() => {
      void runBatchNow(generate)
    })
  }

  if (n === 0 && results.length === 0) {
    return (
      <Page title={T.batch.title} screen="create-batch">
        <EmptyState
          title={T.batch.empty}
          icon={Images}
          testid="m-create-batch-empty"
          actions={
            <Button variant="primary" block busy={adding} onPress={() => void add()} risk="sensor" testid="m-create-batch-add" el="K14.1">
              {T.batch.pick}
            </Button>
          }
        >
          {offered ? T.batch.emptyText : T.batch.notOffered}
        </EmptyState>
      </Page>
    )
  }

  const doneCount = run ? run.statuses.filter((s) => s === 'done' || s === 'failed').length : 0
  const purchase = purchaseView().mode
  return (
    <Page
      title={T.batch.title}
      subtitle={n > 0 ? T.batch.sub(n) : undefined}
      screen="create-batch"
      needsNetwork
      flush
      footer={
        running ? (
          <Button block disabled={stopping} disabledReason={stopping ? T.batch.stopping : undefined} onPress={requestBatchStop} testid="m-create-batch-stop" el="K14.4">
            {T.batch.stop}
          </Button>
        ) : n > 0 ? (
          <Button variant="cloud" risk="paid" block onPress={start} disabled={!!reason} disabledReason={reason} testid="m-create-batch-start" el="K14.3">
            {total !== null ? T.batch.start(creditsLabel(total)) : T.batch.startPlain}
          </Button>
        ) : (
          <Button block variant="primary" onPress={() => void nav.back()} testid="m-create-batch-back">
            {T.common.back}
          </Button>
        )
      }
    >
      <PriceOwner />
      <div className="m-k-sec">
        <p className="m-k-card-sub" data-testid="m-create-batch-what">
          {T.batch.what(T.tool[f.tool].name)}
          {each !== null ? ` ${T.batch.each(creditsLabel(each))}.` : ''}
        </p>
        {f.promptShown && prompt.trim() ? (
          <p className="m-k-viewer-prompt" data-testid="m-create-batch-prompt">
            {prompt.trim()}
          </p>
        ) : null}
        {running ? (
          <Progress
            label={T.batch.progress}
            tone="cloud"
            value={(doneCount + Math.max(0, Math.min(1, progress / 100))) / Math.max(1, n)}
            hidePercent
            detail={pacing ? T.batch.waitingPace : T.batch.summary(doneCount, n)}
            testid="m-create-batch-progress"
          />
        ) : null}
        {!running && n > 0 && covered < n && covered > 0 ? (
          <Notice variant="warn" testid="m-create-batch-covers">
            {T.batch.covers(covered, n)}
            {purchase === 'text-only' ? ` ${T.policy.plansElsewhere}` : ''}
          </Notice>
        ) : null}
        {!running && report ? (
          <Notice variant={report.stop && report.stop !== 'cancelled' ? 'warn' : 'info'} title={report.pending.length === 0 ? T.batch.doneAll(report.done) : T.batch.summary(report.done, report.total)} testid="m-create-batch-report">
            {[
              report.failed.length ? T.batch.failed(report.failed.length) : '',
              report.stop === 'cancelled' ? T.batch.stopped : report.stop === 'credits' ? (purchase === 'none' ? T.policy.creditsNeutral : T.batch.stoppedCredits) : report.stop ? T.batch.stoppedOther : '',
              report.pending.length > 0 && n > 1 ? T.batch.leftReady : '',
            ]
              .filter(Boolean)
              .join(' ') || T.batch.resultsBelow}
          </Notice>
        ) : null}
      </div>
      {n > 0 ? (
        <ListGroup>
          {rows.map((row, i) => (
            <div className="m-rowwrap" key={`${row.name}:${i}`} data-testid="m-create-batch-item" data-state={row.status}>
              <div className="m-row">
                <img className="m-k-batch-thumb" src={row.url} alt="" loading="lazy" decoding="async" />
                <span className="m-row-text">
                  <span className="m-row-title">{row.name}</span>
                </span>
                <span className="m-row-end">
                  <Tag accent={row.status === 'running' || row.status === 'done'}>{T.batch.status[row.status]}</Tag>
                </span>
              </div>
              {running ? null : <IconButton icon={X} label={T.batch.remove(row.name)} onPress={() => void removeBatchEntry(i)} testid="m-create-batch-remove" el="K14.2" />}
            </div>
          ))}
        </ListGroup>
      ) : null}
      {!running && n > 0 && n < MAX_BATCH_IMAGES ? (
        <div className="m-k-sec">
          <Button icon={Plus} busy={adding} onPress={() => void add()} risk="sensor" testid="m-create-batch-add" el="K14.1">
            {T.batch.addMore}
          </Button>
        </div>
      ) : null}
      {results.length > 0 ? (
        <ListGroup title={T.batch.results}>
          {results.map((r) => (
            <ResultRow key={r.itemId} name={r.name} itemId={r.itemId} />
          ))}
        </ListGroup>
      ) : null}
    </Page>
  )
}
