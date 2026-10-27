/**
 * E12 Provider. Route /settings/providers/:id, page, strand 5 (Account, cloud, settings).
 *
 * One provider the user brings a key for: switch it on, save or replace the
 * key, test the connection, remove it. A saved key is never shown again, not
 * even in part; the page only says that one is saved.
 */
import { useState } from 'react'
import { PlugZap, Trash2 } from 'lucide-react'
import { getProvider } from '../../../api/providers'
import { useProviderStore } from '../../../stores/providerStore'
import { nav, useParams } from '../../nav'
import { isOnline } from '../../platform'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { Button, ErrorState, Field, ListGroup, Notice, Page, Row, toast } from '../../ui'
import { Block, Hint } from './parts/layout'
import { SecretField } from './parts/PasswordField'
import { cleanBaseUrl, findOwnProvider, isOwnNetworkAddress, looksLikeKey, slotOf, testFailure, type OwnProvider } from './parts/providers'

const T = SETTINGS_STRINGS.providers

type TestState = { kind: 'idle' } | { kind: 'running' } | { kind: 'ok'; text: string } | { kind: 'failed'; text: string }

function Detail({ provider }: { provider: OwnProvider }) {
  const isAnthropic = provider.kind === 'anthropic'
  const isCustom = provider.id === 'custom'
  const slot = slotOf(provider)
  const config = useProviderStore((s) => s.providers[slot])

  const hasKey = !!config?.apiKey
  const enabled = !!config?.enabled
  const savedUrl = isCustom ? (config?.baseUrl ?? '') : provider.baseUrl

  const [key, setKey] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [url, setUrl] = useState(savedUrl)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })

  /** An extra slot exists only once something was saved for it. */
  const ensureSlot = (baseUrl: string): boolean => {
    if (isAnthropic) return true
    const store = useProviderStore.getState()
    if (store.providers[slot]?.baseUrl === baseUrl) return true
    return store.addCompatProvider({ slug: provider.id, name: provider.name, baseUrl, isLocal: isOwnNetworkAddress(baseUrl) }) !== null
  }

  const setEnabled = (next: boolean) => {
    useProviderStore.getState().setProviderConfig(slot, { enabled: next })
  }

  const saveKey = () => {
    if (!looksLikeKey(key)) {
      setKeyError(T.testNeedsKey)
      return
    }
    if (!savedUrl || !ensureSlot(savedUrl)) {
      setKeyError(T.useNeedsUrl)
      return
    }
    setKeyError(null)
    useProviderStore.getState().setProviderApiKey(slot, key.trim())
    // The typed key leaves the page at once: from here on it is only "saved".
    setKey('')
    setTest({ kind: 'idle' })
    toast(T.keySavedToast, { testid: 'provider-key-saved' })
  }

  const removeKey = async () => {
    const yes = await nav.confirm({ title: T.keyRemoveQuestion, text: T.keyRemoveText, confirmLabel: T.keyRemoveConfirm, tone: 'danger', testid: 'provider-key-remove' })
    if (!yes) return
    const store = useProviderStore.getState()
    store.setProviderConfig(slot, { enabled: false })
    store.setProviderApiKey(slot, '')
    setTest({ kind: 'idle' })
    toast(T.keyRemovedToast, { testid: 'provider-key-removed' })
  }

  const saveUrl = () => {
    const clean = cleanBaseUrl(url)
    if (!clean) {
      setUrlError(T.baseUrlInvalid)
      return
    }
    // A new address drops the key saved for the old one (the store does
    // that), so a key is never sent to a host it was not typed for.
    const hadKey = hasKey && !!savedUrl && savedUrl !== clean
    if (!ensureSlot(clean)) {
      setUrlError(T.baseUrlInvalid)
      return
    }
    setUrlError(null)
    setUrl(clean)
    setTest({ kind: 'idle' })
    toast(hadKey ? T.baseUrlSavedKeyGone : T.baseUrlSaved, { testid: 'provider-url-saved' })
  }

  const runTest = async () => {
    if (test.kind === 'running') return
    if (!isOnline()) {
      setTest({ kind: 'failed', text: T.testOffline })
      return
    }
    setTest({ kind: 'running' })
    try {
      if (isAnthropic) {
        const ok = await getProvider(slot).checkConnection()
        setTest(ok ? { kind: 'ok', text: T.testOkPlain } : { kind: 'failed', text: T.testBadKey })
      } else {
        const models = await getProvider(slot).listModels()
        setTest({ kind: 'ok', text: T.testOk(models.length) })
      }
    } catch (err) {
      const why = testFailure(err, isOnline())
      setTest({ kind: 'failed', text: why === 'bad-key' ? T.testBadKey : why === 'offline' ? T.testOffline : T.testUnreachable })
    }
  }

  const remove = async () => {
    const yes = await nav.confirm({ title: T.removeQuestion, text: T.removeText, confirmLabel: T.removeConfirm, tone: 'danger', testid: 'provider-remove' })
    if (!yes) return
    // Anthropic goes back to its shipped, switched off slot; an extra slot is removed with its key.
    useProviderStore.getState().resetProvider(slot)
    toast(T.removedToast, { testid: 'provider-removed' })
    nav.back()
  }

  const needsUrl = isCustom && !savedUrl
  const useBlocked = !hasKey ? T.useNeedsKey : needsUrl ? T.useNeedsUrl : undefined
  const testBlocked = needsUrl ? T.useNeedsUrl : !hasKey ? T.testNeedsKey : undefined
  const touched = hasKey || enabled || (isCustom && !!savedUrl)

  return (
    <Page title={provider.name} screen="settings-provider">
      <div data-testid="m-settings-provider-state" data-key={hasKey ? 'saved' : 'none'} data-enabled={enabled ? 'yes' : 'no'}>
        <ListGroup>
          <Row
            title={T.use}
            disabled={!!useBlocked && !enabled}
            disabledReason={useBlocked}
            switch={{ checked: enabled, onChange: setEnabled }}
            testid="m-settings-provider-use"
            el="E12.2"
          />
        </ListGroup>
        <Notice testid="m-settings-provider-note">{isAnthropic ? T.anthropicNote : T.compatNote}</Notice>

        {isCustom ? (
          <Block lead>
            <Field
              label={T.baseUrl}
              type="url"
              inputMode="url"
              autoComplete="url"
              value={url}
              onChange={(value) => {
                setUrl(value)
                setUrlError(null)
              }}
              placeholder={T.baseUrlPlaceholder}
              hint={T.baseUrlHint}
              error={urlError ?? undefined}
              clearable
              onSubmit={saveUrl}
              testid="m-settings-provider-url"
              el="E12.4"
            />
            <Button block onPress={saveUrl} disabled={url.trim() === savedUrl} testid="m-settings-provider-url-save">
              {T.baseUrlSave}
            </Button>
          </Block>
        ) : null}

        <Block lead>
          <Hint strong testid="m-settings-provider-key-state">
            {hasKey ? T.keySaved : T.keyNone}
          </Hint>
          <SecretField
            label={hasKey ? T.keyNew : T.apiKey}
            value={key}
            onChange={(value) => {
              setKey(value)
              setKeyError(null)
            }}
            placeholder={provider.keyPlaceholder}
            autoComplete="off"
            error={keyError ?? undefined}
            onSubmit={saveKey}
            testid="m-settings-provider-key"
            paste={{ label: T.paste, testid: 'm-settings-provider-key-paste' }}
            el="E12.3"
          />
          <Button variant="primary" block disabled={!key.trim()} onPress={saveKey} testid="m-settings-provider-key-save" el="E12.3">
            {hasKey ? T.keyReplace : T.keySave}
          </Button>
          {hasKey ? (
            <Button variant="quiet" block icon={Trash2} onPress={() => void removeKey()} risk="destructive" testid="m-settings-provider-key-delete" el="E12.3">
              {T.keyRemove}
            </Button>
          ) : null}
          <Hint>{T.keyStorage}</Hint>
        </Block>

        <Block>
          <Button
            block
            icon={PlugZap}
            busy={test.kind === 'running'}
            label={test.kind === 'running' ? T.testing : undefined}
            disabled={!!testBlocked}
            disabledReason={testBlocked}
            onPress={() => void runTest()}
            testid="m-settings-provider-test"
            el="E12.5"
          >
            {T.test}
          </Button>
        </Block>
        {test.kind === 'ok' ? <Notice testid="m-settings-provider-test-ok">{test.text}</Notice> : null}
        {test.kind === 'failed' ? (
          <Notice variant="error" testid="m-settings-provider-test-failed">
            {test.text}
          </Notice>
        ) : null}

        {touched ? (
          <Block lead>
            <Button variant="danger" block icon={Trash2} onPress={() => void remove()} risk="destructive" testid="m-settings-provider-delete" el="E12.6">
              {T.remove}
            </Button>
          </Block>
        ) : null}
      </div>
    </Page>
  )
}

export default function ProviderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const provider = findOwnProvider(id, T.custom)
  if (!provider) {
    return (
      <Page title={T.title} screen="settings-provider">
        <ErrorState
          testid="m-settings-provider-unknown"
          actions={
            <Button onPress={() => nav.replace('/settings/providers')} testid="m-settings-provider-back">
              {T.backToList}
            </Button>
          }
        >
          {T.unknown}
        </ErrorState>
      </Page>
    )
  }
  return <Detail key={provider.id} provider={provider} />
}
