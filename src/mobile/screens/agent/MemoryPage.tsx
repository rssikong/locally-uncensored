/**
 * E7 Memory. Route /settings/memory, page, strand 2 (Agent and knowledge).
 *
 * What LU remembers: search, categories, the list, the learning switches,
 * sync with the account and export, import and delete. The store and the
 * sync are the desktop ones (stores/memoryStore, lib/memory-sync); this page
 * only lays them out for a phone.
 */
import { useEffect, useMemo, useState } from 'react'
import { Brain, CloudOff, Download, History, LogIn, Plus, RefreshCw, Search, Upload } from 'lucide-react'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import { describeMemoryImport, useMemoryStore } from '../../../stores/memoryStore'
import { useModelStore } from '../../../stores/modelStore'
import type { MemoryType } from '../../../types/agent-mode'
import { nav } from '../../nav'
import { pickFiles } from '../../platform'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Button, Chip, ChipGroup, EmptyState, Field, ListGroup, Notice, NumberField, Page, Progress, Row, toast } from '../../ui'
import './parts/agent.css'
import { useMemorySync } from './parts/adapters/memory-sync'
import { filterMemories, KEEP_MAX, keepOverride, looksLikeJson, MEMORY_TYPES, NEW_MEMORY, isOutdated, reviewCount } from './parts/memory-logic'
import { useActiveModelIsLocal } from './parts/model-state'
import { chatModelLabel } from '../chat/parts/model-name'

const S = T.memory

export default function MemoryPage() {
  const entries = useMemoryStore((s) => s.entries)
  const settings = useMemoryStore((s) => s.settings)
  const activeOwner = useMemoryStore((s) => s.activeMemoryOwner)
  const owner = useCloudAuthStore((s) => (s.status === 'signed-in' ? s.user?.id : undefined))
  const local = useActiveModelIsLocal()
  const models = useModelStore((s) => s.models)
  const activeModel = useModelStore((s) => s.activeModel)
  const learner = activeModel ? chatModelLabel(models, activeModel) : ''
  const sync = useMemorySync()

  const [query, setQuery] = useState('')
  const [type, setType] = useState<MemoryType | 'all'>('all')
  const [review, setReview] = useState(false)
  const [collectionError, setCollectionError] = useState(false)
  const [importNote, setImportNote] = useState<{ ok: boolean; text: string } | null>(null)
  // The review filter compares against one moment per page view, so the list does not shift while reading.
  const now = useMemo(() => Date.now(), [])

  // Another collection, or a different account: what the last sync said no longer applies.
  useEffect(() => {
    return () => useMemorySync.getState().reset()
  }, [activeOwner])

  const shown = filterMemories(entries, { query, type, review }, now)
  const toReview = reviewCount(entries, now)
  const keep = settings.maxMemoriesOverride ?? 0
  const update = useMemoryStore.getState().updateMemorySettings

  const pickCollection = (account: boolean) => {
    const ok = useMemoryStore.getState().selectMemoryCollection(account && owner ? owner : null)
    setCollectionError(!ok)
  }

  const importFile = async () => {
    const [picked] = await pickFiles({ accept: '.md,.markdown,.json,.txt' })
    if (!picked) return
    const before = useMemoryStore.getState()
    let content = ''
    try {
      content = await picked.file.text()
    } catch {
      setImportNote({ ok: false, text: S.importUnreadable })
      return
    }
    if (!content.trim()) {
      setImportNote({ ok: false, text: S.importUnreadable })
      return
    }
    const after = useMemoryStore.getState()
    if (after.entries !== before.entries || after.memoryCollectionRevision !== before.memoryCollectionRevision) {
      setImportNote({ ok: false, text: S.importChanged })
      return
    }
    const result = looksLikeJson(picked.name, content) ? after.importFromJSON(content) : after.importFromMarkdown(content)
    const found = result.added + result.updated + result.alreadyPresent > 0
    setImportNote({ ok: found, text: found ? describeMemoryImport(result) : S.importNone })
  }

  const deleteAll = async () => {
    const yes = await nav.confirm({
      title: S.deleteAllTitle,
      text: S.deleteAllText(entries.length),
      confirmLabel: S.deleteAllConfirm,
      tone: 'danger',
      requireText: 'DELETE',
      testid: 'memory-delete-all',
    })
    if (!yes) return
    useMemoryStore.getState().clearAll()
    toast(S.deletedAll, { testid: 'memory-deleted-all' })
  }

  const removeOlder = async () => {
    if (!activeOwner) return
    const yes = await nav.confirm({ title: S.olderRemoveTitle, text: S.olderRemoveText, confirmLabel: S.olderRemove, tone: 'danger', testid: 'memory-older-remove' })
    if (yes) void sync.removeOlder(activeOwner)
  }

  return (
    <Page
      title={S.title}
      screen="settings-memory"
      footer={
        <Button variant="primary" block icon={Plus} onPress={() => nav.push('/settings/memory/:id', { id: NEW_MEMORY })} testid="m-memory-add" el="E7.4">
          {S.add}
        </Button>
      }
    >
      <div className="m-ag-block">
        <Field label={S.search} hideLabel type="search" icon={Search} value={query} onChange={setQuery} placeholder={S.search} clearable testid="m-memory-search" el="E7.1" />
      </div>
      <ChipGroup label={S.filterLabel} role="radiogroup" testid="m-memory-types">
        <Chip kind="choice" selected={type === 'all'} onPress={() => setType('all')} testid="m-memory-type-all" el="E7.2">
          {S.all}
        </Chip>
        {MEMORY_TYPES.map((value) => (
          <Chip key={value} kind="choice" selected={type === value} onPress={() => setType(value)} testid={`m-memory-type-${value}`} el="E7.2">
            {S.types[value]}
          </Chip>
        ))}
      </ChipGroup>

      {review ? (
        <Notice
          variant="info"
          testid="m-memory-reviewing"
          actions={
            <Button compact onPress={() => setReview(false)} testid="m-memory-review-done">
              {S.reviewDone}
            </Button>
          }
        >
          {S.reviewing}
        </Notice>
      ) : null}

      {shown.length === 0 ? (
        entries.length === 0 ? (
          <EmptyState title={S.empty} icon={Brain} testid="m-memory-empty">
            {S.emptyText}
          </EmptyState>
        ) : review && !query && type === 'all' ? (
          <EmptyState title={S.reviewEmpty} icon={History} testid="m-memory-review-empty">
            {S.reviewEmptyText}
          </EmptyState>
        ) : (
          <EmptyState
            title={S.noMatch}
            icon={Search}
            testid="m-memory-nomatch"
            actions={
              <Button
                onPress={() => {
                  setQuery('')
                  setType('all')
                }}
                testid="m-memory-clear"
              >
                {S.clearSearch}
              </Button>
            }
          >
            {S.noMatchText}
          </EmptyState>
        )
      ) : (
        <ListGroup title={S.count(shown.length)} testid="m-memory-list">
          {shown.map((entry) => (
            <Row
              key={entry.id}
              title={entry.title || entry.content.slice(0, 60)}
              subtitle={[isOutdated(entry) ? S.outdated : null, entry.sensitive ? S.sensitive : null, S.types[entry.type] ?? entry.type].filter(Boolean).join(', ')}
              label={S.rowName(entry.title || entry.content.slice(0, 60))}
              onPress={() => nav.push('/settings/memory/:id', { id: entry.id })}
              testid={`m-memory-row-${entry.id}`}
              el="E7.3"
            />
          ))}
        </ListGroup>
      )}

      <ListGroup title={S.settingsTitle} testid="m-memory-settings">
        <Row
          title={S.learn}
          subtitle={local ? S.learnSub : S.learnSubCloud}
          switch={{ checked: settings.autoExtractEnabled, onChange: (on) => update({ autoExtractEnabled: on }) }}
          testid="m-memory-learn"
          el="E7.5"
        />
        {local && settings.autoExtractEnabled ? (
          // Which model learns: on a phone it is the small chat model, and it misses things (check 4 on Android, F1).
          <div className="m-ag-seg-row" data-testid="m-memory-learn-with">
            <span className="m-ag-seg-sub">{S.learnWith(learner)}</span>
          </div>
        ) : null}
        <Row
          title={S.outside}
          subtitle={S.outsideSub}
          switch={{ checked: settings.autoExtractEnabled && settings.autoExtractInAllModes, onChange: (on) => update({ autoExtractInAllModes: on }) }}
          disabled={!settings.autoExtractEnabled}
          disabledReason={S.outsideOff}
          testid="m-memory-outside"
          el="E7.6"
        />
        <div className="m-ag-seg-row" data-testid="m-memory-keep-row">
          <span className="m-ag-seg-title">{S.keep}</span>
          <span className="m-ag-seg-sub">{keep === 0 ? `${S.keepAuto}. ${S.keepAutoSub}` : `${S.keepValue(keep)}. ${S.keepSub}`}</span>
          <NumberField label={S.keep} value={keep} min={0} max={KEEP_MAX} onChange={(value) => update({ maxMemoriesOverride: keepOverride(value) })} testid="m-memory-keep" el="E7.7" />
        </div>
        <Row
          title={S.review}
          subtitle={S.reviewSub(toReview)}
          icon={History}
          disabled={toReview === 0}
          disabledReason={S.reviewSub(0)}
          onPress={() => {
            setReview(true)
            setQuery('')
            setType('all')
          }}
          chevron={false}
          testid="m-memory-review"
          el="E7.8"
        />
      </ListGroup>

      <h2 className="m-label m-group-label">{S.syncTitle}</h2>
      {!owner ? (
        <ListGroup testid="m-memory-sync-signedout">
          <Row title={S.signIn} subtitle={S.signInSub} icon={LogIn} onPress={() => nav.push('/settings/account')} testid="m-memory-signin" el="E7.9" />
        </ListGroup>
      ) : (
        <>
          <ListGroup testid="m-memory-sync">
            <Row
              title={S.collection}
              subtitle={S.collectionSub}
              switch={{ checked: activeOwner !== null, onChange: pickCollection, tone: 'cloud' }}
              disabled={sync.busy}
              testid="m-memory-collection"
              el="E7.9"
            />
            {activeOwner !== null ? (
              <>
                <Row title={S.allow} subtitle={S.allowSub} switch={{ checked: sync.allowed, onChange: sync.setAllowed, tone: 'cloud' }} disabled={sync.busy} testid="m-memory-allow" el="E7.9" />
                <Row
                  title={S.allowSensitive}
                  subtitle={S.allowSensitiveSub}
                  switch={{ checked: sync.allowed && sync.allowSensitive, onChange: sync.setAllowSensitive, tone: 'cloud' }}
                  disabled={!sync.allowed || sync.busy}
                  disabledReason={sync.allowed ? undefined : S.syncNeedsAllow}
                  testid="m-memory-allow-sensitive"
                  el="E7.9"
                />
                <Row
                  title={S.older}
                  subtitle={S.olderSub}
                  icon={History}
                  chevron={false}
                  disabled={!sync.allowed || sync.busy}
                  disabledReason={sync.allowed ? undefined : S.syncNeedsAllow}
                  onPress={() => void sync.bringOverOlder(activeOwner)}
                  testid="m-memory-older"
                  el="E7.11"
                />
              </>
            ) : null}
          </ListGroup>
          {collectionError ? (
            <Notice variant="error" testid="m-memory-collection-error">
              {S.collectionFailed}
            </Notice>
          ) : null}
          {activeOwner !== null ? (
            <div className="m-ag-actions">
              {sync.busy ? (
                <>
                  <Progress label={S.syncing} detail={sync.note?.text ?? S.syncing} testid="m-memory-syncing" />
                  <Button block onPress={sync.cancel} testid="m-memory-sync-cancel">
                    {S.cancelSync}
                  </Button>
                </>
              ) : (
                <Button block icon={RefreshCw} variant="cloud" disabled={!sync.allowed} disabledReason={S.syncNeedsAllow} onPress={() => void sync.run(activeOwner)} testid="m-memory-sync-now" el="E7.9">
                  {S.syncNow}
                </Button>
              )}
            </div>
          ) : null}
          {!sync.busy && sync.note ? (
            <Notice
              variant={sync.note.kind === 'error' ? 'error' : 'info'}
              icon={sync.note.kind === 'error' ? CloudOff : undefined}
              testid={`m-memory-sync-${sync.note.kind}`}
              actions={
                sync.note.kind === 'error' && activeOwner !== null ? (
                  <Button compact onPress={() => void sync.run(activeOwner)} testid="m-memory-sync-retry">
                    {T.common.tryAgain}
                  </Button>
                ) : sync.conflicts.length > 0 ? (
                  <Button compact onPress={() => nav.openSheet('agent-memory-conflict')} testid="m-memory-conflicts" el="E7.10">
                    {S.resolve}
                  </Button>
                ) : sync.olderCount !== null && sync.olderCount > 0 ? (
                  <Button risk="destructive" compact onPress={() => void removeOlder()} testid="m-memory-older-remove" el="E7.11">
                    {S.olderRemove}
                  </Button>
                ) : undefined
              }
            >
              {sync.note.text}
            </Notice>
          ) : null}
        </>
      )}

      <ListGroup title={S.dataTitle} testid="m-memory-data">
        <Row title={S.export} icon={Upload} disabled={entries.length === 0} disabledReason={S.exportEmpty} onPress={() => nav.openSheet('agent-memory-export')} testid="m-memory-export" el="E7.12" />
        <Row title={S.import} subtitle={S.importSub} icon={Download} chevron={false} onPress={() => void importFile()} testid="m-memory-import" el="E7.13" />
      </ListGroup>
      {importNote ? (
        <Notice variant={importNote.ok ? 'info' : 'error'} testid={importNote.ok ? 'm-memory-import-ok' : 'm-memory-import-error'}>
          {importNote.text}
        </Notice>
      ) : null}
      <div className="m-ag-actions">
        <Button risk="destructive" variant="danger" block disabled={entries.length === 0} disabledReason={S.deleteAllEmpty} onPress={() => void deleteAll()} testid="m-memory-delete-all" el="E7.14">
          {S.deleteAll}
        </Button>
      </div>
    </Page>
  )
}
