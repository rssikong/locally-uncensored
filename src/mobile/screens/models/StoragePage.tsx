/**
 * E14 Storage and downloads. Route /settings/storage, strand 4.
 *
 * E14.1 storage bar (Models, Chats and files, Free), E14.2 one row per
 * installed model with "Delete", E14.3 clean up partial downloads, E14.4
 * download speed limit, E14.5 Wi-Fi only, E14.6 Hugging Face token, E14.7
 * clear cached results.
 *
 * E14.4 is shown only where the native layer says it can hold a download to
 * a limit (downloadLimitSupported): on Android, whose plugin carries the
 * transfer itself. On iOS the system carries it in a background URLSession,
 * which has no limit to set, so the control is not there (DESIGN.md: a
 * control that sets a number nobody reads would be a lie).
 *
 * "Import a model file" (round 4): the system's file picker, then a native
 * copy into the model folder (platform/model-import.ts). Only where the
 * store allows models from outside the catalogue (customModelUrl): a store
 * that locks foreign addresses locks foreign files as well.
 */
import { useEffect, useState } from 'react'
import { ArrowDownToLine, Eraser, FolderInput, Trash2 } from 'lucide-react'
import { formatBytes } from '../../../lib/formatters'
import { useDownloadStore } from '../../../stores/downloadStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { nav } from '../../nav'
import { cancelModelImport, downloadLimitSupported, importModelFile, modelImportSupported, setDownloadLimit } from '../../platform'
import { MODELS_STRINGS as S } from '../../strings/models'
import { Button, Field, IconButton, ListGroup, Notice, Page, Progress, Row, Segmented, toast } from '../../ui'
import { activeDownloadCount } from './downloads-badge'
import { deletePartials, partialsOf } from './parts/adapters/downloads'
import { hasHfToken, removeHfToken, saveHfToken } from './parts/adapters/hf-token'
import { setPref, usePref } from './parts/adapters/prefs'
import { Block, Fact, Para } from './parts/bits'
import { refreshDevice, useDevice } from './parts/device'
import { deleteModel, useEngine } from './parts/engine'
import { displayName, isDocumentModel, refreshInstalled, useInstalled } from './parts/installed'
import { storePolicy } from './parts/policy'
import { appDataBytes, clearCachedResults, storageIsLow, storageShares } from './parts/storage'
import { useNotifySwitch } from './parts/notify'
import { riskMark } from './parts/risk'
import { withoutPaths } from '../../lib/no-paths'

const LIMITS = [0, 1, 5, 10] as const

function limitText(mb: number): string {
  return mb > 0 ? S.storage.speedValue(mb) : S.storage.speedOff
}

/** The copy of an import that is running: which file, and how far. */
interface Copying {
  name: string
  /** 0 to 1, or null while the size of the file is not known. */
  share: number | null
}

function StorageBar({ modelBytes, chatBytes, freeBytes }: { modelBytes: number; chatBytes: number; freeBytes: number | null }) {
  const shares = storageShares(modelBytes, chatBytes, freeBytes)
  const free = freeBytes === null ? S.storage.unknownFree : formatBytes(freeBytes)
  const part = (share: number, color: string) => (share > 0 ? <span style={{ flex: `${Math.max(share, 0.01)} 1 0`, minWidth: 2, background: color }} /> : null)
  return (
    <div className="m-card" data-testid="m-settings-storage-bar" data-el="E14.1">
      <div className="m-stackv" style={{ gap: 'var(--m-s3)' }}>
        <span className="m-card-title">{S.storage.bar}</span>
        <div role="img" aria-label={S.storage.barName(formatBytes(modelBytes), formatBytes(chatBytes), free)} style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--m-hair)' }}>
          {part(shares.models, 'var(--m-accent)')}
          {part(shares.chats, 'var(--m-cloud)')}
          {part(shares.free, 'var(--m-hair)')}
        </div>
        <Fact label={S.storage.models} value={formatBytes(modelBytes)} testid="m-settings-storage-models" />
        <Fact label={S.storage.chats} value={formatBytes(chatBytes)} testid="m-settings-storage-chats" />
        <Fact label={S.storage.free} value={free} testid="m-settings-storage-free" />
      </div>
    </div>
  )
}

export default function StoragePage() {
  const { files } = useInstalled()
  const { freeBytes } = useDevice()
  const engine = useEngine()
  const orphans = useDownloadStore((s) => s.orphans)
  const downloads = useDownloadStore((s) => activeDownloadCount(s.downloads))
  const wifiOnly = usePref('wifiOnly')
  const notify = useNotifySwitch()
  const limit = useSettingsStore((s) => s.settings.downloadLimitMBps) || 0
  const partials = partialsOf(orphans)
  const [canLimit, setCanLimit] = useState(false)
  const [canImport, setCanImport] = useState(false)
  const [picking, setPicking] = useState(false)
  const [copying, setCopying] = useState<Copying | null>(null)
  const [importError, setImportError] = useState('')
  const [chatBytes, setChatBytes] = useState(0)
  const [token, setToken] = useState('')
  const [stored, setStored] = useState(false)
  const [tokenError, setTokenError] = useState('')
  const [saving, setSaving] = useState(false)
  const modelBytes = files.reduce((sum, f) => sum + (f.size || 0), 0)

  useEffect(() => {
    let alive = true
    refreshDevice()
    void appDataBytes().then((bytes) => {
      if (alive) setChatBytes(bytes)
    })
    void hasHfToken().then((has) => {
      if (alive) setStored(has)
    })
    void useDownloadStore.getState().scanOrphans?.()
    void downloadLimitSupported().then((yes) => {
      if (alive) setCanLimit(yes)
      // Native code keeps its own copy of the number. After a restored backup the two can differ: the setting wins.
      if (yes) void setDownloadLimit(useSettingsStore.getState().settings.downloadLimitMBps || 0)
    })
    if (storePolicy().customModelUrl) {
      void modelImportSupported().then((yes) => {
        if (alive) setCanImport(yes)
      })
    }
    return () => {
      alive = false
    }
  }, [])

  const cleanUp = async () => {
    if (partials.count === 0) {
      toast(S.models.cleanupNone, { testid: 'cleanup-none' })
      return
    }
    const yes = await nav.confirm({ title: S.models.cleanupTitle, text: S.models.cleanupText(formatBytes(partials.bytes)), confirmLabel: S.models.cleanupConfirm, cancelLabel: S.common.keep, tone: 'danger', testid: 'cleanup' })
    if (!yes) return
    const freed = await deletePartials()
    refreshDevice()
    toast(S.models.cleanupDone(formatBytes(freed)), { testid: 'cleanup-done' })
  }

  const setLimit = async (value: string) => {
    const mb = Number(value) || 0
    const held = await setDownloadLimit(mb)
    if (!held) {
      toast(S.storage.speedFailed, { tone: 'error', testid: 'speed-limit-failed' })
      return
    }
    // The setting is what the page shows and what travels with a backup; native code holds the number itself.
    useSettingsStore.getState().updateSettings({ downloadLimitMBps: mb })
    toast(S.storage.speedSet(limitText(mb)), { testid: 'speed-limit' })
  }

  const importFile = async () => {
    if (picking) return
    setPicking(true)
    setImportError('')
    let copied = false
    const result = await importModelFile((received, total, fileName) => {
      copied = true
      setCopying({ name: fileName.replace(/\.gguf$/i, ''), share: total > 0 ? Math.min(1, received / total) : null })
    })
    setCopying(null)
    setPicking(false)
    refreshDevice()
    if (result.status === 'imported') {
      await refreshInstalled()
      toast(S.storage.importDone((result.fileName ?? '').replace(/\.gguf$/i, '')), { testid: 'import-done' })
      return
    }
    if (result.status === 'cancelled') {
      // Closing the picker needs no word. Stopping a copy that ran does.
      if (copied) toast(S.storage.importCancelled, { testid: 'import-cancelled' })
      return
    }
    setImportError((result.message ? withoutPaths(result.message) : '') || (result.status === 'unavailable' ? S.storage.importUnavailable : S.storage.importFailed))
  }

  const saveToken = async () => {
    const value = token.trim()
    if (!value || saving) return
    setSaving(true)
    setTokenError('')
    const ok = await saveHfToken(value)
    setSaving(false)
    if (!ok) {
      setTokenError(S.storage.tokenFailed)
      return
    }
    setToken('')
    setStored(true)
    toast(S.storage.tokenSaved, { testid: 'token-saved' })
  }

  const removeToken = async () => {
    const ok = await removeHfToken()
    if (!ok) {
      setTokenError(S.storage.tokenFailed)
      return
    }
    setStored(false)
    toast(S.storage.tokenRemoved, { testid: 'token-removed' })
  }

  const clearCache = async () => {
    const res = await clearCachedResults()
    void appDataBytes().then(setChatBytes)
    if (res.removed === 0) toast(S.storage.cacheEmpty, { testid: 'cache-empty' })
    else toast(res.freedBytes > 0 ? S.storage.cacheCleared(formatBytes(res.freedBytes)) : S.storage.cacheClearedPlain, { testid: 'cache-cleared' })
  }

  return (
    <Page title={S.storage.title} screen="settings-storage">
      {storageIsLow(freeBytes) ? (
        <Notice variant="warn" title={S.storage.lowTitle} testid="m-settings-storage-low">
          {S.storage.low(formatBytes(freeBytes ?? 0))}
        </Notice>
      ) : null}
      <StorageBar modelBytes={modelBytes} chatBytes={chatBytes} freeBytes={freeBytes} />

      <ListGroup title={S.storage.installed}>
        {files.length === 0 ? (
          <Row title={S.storage.none} testid="m-settings-storage-none" />
        ) : (
          files.map((file) => {
            const name = isDocumentModel(file) ? S.models.documentModel : displayName(file)
            return (
              <div key={file.path} data-testid="m-settings-storage-model" data-m-id={file.name} data-state={file.path === engine.loadedPath ? 'loaded' : 'installed'}>
                <Row
                  title={name}
                  subtitle={[formatBytes(file.size), file.path === engine.loadedPath ? S.common.loaded : null].filter(Boolean).join(' · ')}
                  trailing={<IconButton icon={Trash2} label={S.storage.deleteName(name)} {...riskMark('destructive')} testid="m-settings-storage-delete" el="E14.2" onPress={() => void deleteModel(file, engine.loadedPath)} />}
                />
              </div>
            )
          })
        )}
        {canImport ? (
          copying ? (
            <div className="m-card" data-testid="m-settings-storage-import-progress">
              <div className="m-stackv" style={{ gap: 'var(--m-s3)' }}>
                <Progress label={S.storage.importCopying(copying.name)} value={copying.share ?? undefined} detail={S.storage.importCopying(copying.name)} />
                <div className="m-rowh">
                  <Button compact variant="quiet" testid="m-settings-storage-import-cancel" onPress={() => void cancelModelImport()}>
                    {S.storage.importCancel}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Row icon={FolderInput} chevron={false} title={S.storage.importFile} subtitle={S.storage.importFileSub} testid="m-settings-storage-import" onPress={() => void importFile()} />
          )
        ) : null}
      </ListGroup>
      {importError ? (
        <Notice variant="warn" title={S.storage.importFailedTitle} testid="m-settings-storage-import-error">
          {importError}
        </Notice>
      ) : null}

      <ListGroup title={S.storage.downloads}>
        <Row icon={ArrowDownToLine} title={S.storage.openDownloads} subtitle={downloads > 0 ? S.models.badge(downloads) : undefined} testid="m-settings-storage-downloads" onPress={() => nav.push('/models/downloads')} />
        <Row
          icon={Trash2}
          chevron={false}
          title={S.storage.cleanup}
          subtitle={partials.count > 0 ? S.models.cleanupSize(partials.count, formatBytes(partials.bytes)) : S.models.cleanupNone}
          {...riskMark('destructive')} testid="m-settings-storage-partials-clear"
          el="E14.3"
          onPress={() => void cleanUp()}
        />
        <Row title={S.storage.wifiOnly} subtitle={S.storage.wifiOnlySub} testid="m-settings-storage-wifi" el="E14.5" switch={{ checked: wifiOnly, onChange: (on) => setPref('wifiOnly', on) }} />
        {/* Android 13 and newer. The app asks once, at the first download; after that only the settings of the system change it (parts/notify.ts). */}
        {notify.status && notify.status !== 'not-needed' ? (
          <Row
            title={S.notify.row}
            subtitle={notify.status === 'granted' ? `${S.notify.rowOn} ${S.notify.rowOnHint}` : notify.status === 'open' ? S.notify.rowOpen : S.notify.rowRefused}
            testid="m-settings-storage-notify"
            state={notify.status}
            risk="leaves-app"
            switch={{ checked: notify.status === 'granted', onChange: () => void notify.toggle() }}
          />
        ) : null}
      </ListGroup>

      {canLimit ? (
        <>
          <h2 className="m-label m-group-label">{S.storage.speedLimit}</h2>
          <Block>
            <Segmented
              label={S.storage.speedLimit}
              testid="m-settings-storage-limit"
              el="E14.4"
              value={String(LIMITS.includes(limit as (typeof LIMITS)[number]) ? limit : 0)}
              onChange={(value) => void setLimit(value)}
              options={LIMITS.map((mb) => ({ value: String(mb), label: limitText(mb), testid: `m-settings-storage-limit-${mb}` }))}
            />
          </Block>
        </>
      ) : null}

      {/* Store switch gatedModelToken: a build with the fixed catalogue has no model that asks for a token, and no field for one. */}
      {storePolicy().gatedModelToken ? (
      <>
      <h2 className="m-label m-group-label">{S.storage.token}</h2>
      <Block>
        <div className="m-stackv">
          <Field label={S.storage.token} hideLabel type="password" autoComplete="off" placeholder="hf_..." value={token} onChange={setToken} hint={stored ? S.storage.tokenStored : S.storage.tokenHint} error={tokenError || undefined} pasteable onSubmit={() => void saveToken()} testid="m-settings-storage-token" el="E14.6" />
          <div className="m-rowh">
            <Button compact testid="m-settings-storage-token-save" busy={saving} disabled={!token.trim()} disabledReason={undefined} onPress={() => void saveToken()}>
              {S.storage.tokenSave}
            </Button>
            {stored ? (
              <Button compact variant="quiet" {...riskMark('destructive')} testid="m-settings-storage-token-remove" onPress={() => void removeToken()}>
                {S.storage.tokenRemove}
              </Button>
            ) : null}
          </div>
        </div>
      </Block>
      </>
      ) : null}

      <ListGroup>
        <Row icon={Eraser} title={S.storage.clearCache} subtitle={S.storage.clearCacheSub} {...riskMark('destructive')} testid="m-settings-storage-cache-clear" el="E14.7" chevron={false} onPress={() => void clearCache()} />
      </ListGroup>
      <Para cap>{S.downloads.footer}</Para>
    </Page>
  )
}
