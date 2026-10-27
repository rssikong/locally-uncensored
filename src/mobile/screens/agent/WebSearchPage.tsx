/**
 * E9 Web search. Route /settings/search, page, strand 2 (Agent and knowledge).
 *
 * Which search the web tools use, the two optional keys, and a test search
 * that runs the same call the agent runs (lib/search-keys.ts, runWebSearch).
 *
 * A key goes into the key storage of the phone. The settings only know that
 * one is saved, so the page never shows a saved key again: it offers
 * "Replace" and "Remove". A key an older build left in the settings is moved
 * when the page opens.
 */
import { useEffect, useRef, useState } from 'react'
import { KeyRound, Search } from 'lucide-react'
import {
  moveLegacySearchKeys,
  removeSearchKey,
  runWebSearch,
  saveSearchKey,
  searchKeyIsSet,
  searchProviderUsable,
  type SearchKeyName,
} from '../../../lib/search-keys'
import { useSettingsStore } from '../../../stores/settingsStore'
import type { SearchProvider } from '../../../types/settings'
import { nav } from '../../nav'
import { webSearchKeysOffered } from '../../policy/gates'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Button, Field, Icon, ListGroup, Notice, Page, Row, toast } from '../../ui'
import './parts/agent.css'
import { deviceSaysOffline } from '../../../lib/search-offline'
import { readSearchAnswer, readSearchError, withoutKeyAdvice, type SearchOutcome } from './parts/search-logic'

const S = T.webSearch

interface KeyBlockProps {
  which: SearchKeyName
  label: string
  name: string
  el: string
  saved: boolean
  onChanged: () => void
}

function KeyBlock({ which, label, name, el, saved, onChanged }: KeyBlockProps) {
  const [draft, setDraft] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const save = async () => {
    if (!draft.trim() || busy) return
    setBusy(true)
    setProblem(null)
    const result = await saveSearchKey(which, draft)
    setBusy(false)
    if (result === 'stored') {
      setDraft('')
      setReplacing(false)
      onChanged()
      toast(S.saved, { testid: 'search-key-saved' })
      return
    }
    setProblem(result === 'no-keychain' ? S.noKeychain : S.saveFailed)
  }

  const remove = async () => {
    const yes = await nav.confirm({ title: S.removeTitle(name), text: S.removeText, confirmLabel: S.remove, tone: 'danger', testid: 'search-key-remove' })
    if (!yes) return
    if (!(await removeSearchKey(which))) {
      toast(S.removeFailed, { testid: 'search-key-remove-failed' })
      return
    }
    setDraft('')
    setReplacing(false)
    onChanged()
    toast(S.removed, { testid: 'search-key-removed' })
  }

  const editing = !saved || replacing
  return (
    <div className="m-ag-block m-stackv" data-testid={`m-search-${which}-block`} data-state={saved ? 'saved' : 'empty'}>
      {saved ? (
        <p className="m-ag-keyline" data-testid={`m-search-${which}-saved`} data-el={el}>
          <Icon icon={KeyRound} small />
          <span>{S.savedLine(name)}</span>
        </p>
      ) : null}
      {editing ? (
        // Field and "Save key" belong together: with the keyboard open both stay above the footer (ui/field-in-view.ts).
        <div className="m-stackv" data-m-field-group="">
          <Field
            label={saved ? S.newKey(name) : label}
            type="password"
            value={draft}
            onChange={(value) => {
              setDraft(value)
              setProblem(null)
            }}
            placeholder={S.keyPlaceholder}
            autoComplete="off"
            pasteable
            error={problem ?? undefined}
            onSubmit={() => void save()}
            testid={`m-search-${which}-key`}
            el={el}
          />
          <div className="m-ag-keyactions">
            <Button variant="primary" compact busy={busy} disabled={!draft.trim()} disabledReason={S.pasteFirst} onPress={() => void save()} label={S.saveName(name)} testid={`m-search-${which}-save`} el={el}>
              {S.save}
            </Button>
            {saved ? (
              <Button
                compact
                onPress={() => {
                  setReplacing(false)
                  setDraft('')
                  setProblem(null)
                }}
                label={S.keepName(name)}
                testid={`m-search-${which}-keep`}
                el={el}
              >
                {S.keep}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="m-ag-keyactions">
          <Button compact onPress={() => setReplacing(true)} label={S.replaceName(name)} testid={`m-search-${which}-replace`} el={el}>
            {S.replace}
          </Button>
          <Button risk="destructive" compact onPress={() => void remove()} label={S.removeName(name)} testid={`m-search-${which}-remove`} el={el}>
            {S.remove}
          </Button>
        </div>
      )}
    </div>
  )
}

export default function WebSearchPage() {
  const provider = useSettingsStore((s) => s.settings.searchProvider || 'auto')
  const braveSaved = useSettingsStore((s) => searchKeyIsSet(s.settings, 'brave'))
  const tavilySaved = useSettingsStore((s) => searchKeyIsSet(s.settings, 'tavily'))
  const keys = { braveKeyStored: braveSaved, tavilyKeyStored: tavilySaved }
  const [testing, setTesting] = useState(false)
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null)
  const keysOffered = webSearchKeysOffered()

  // The answer of a test search lands below the keys, under the fold of a
  // small phone. It is brought into view, or the button looks dead.
  const resultRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!outcome) return
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    resultRef.current?.scrollIntoView?.({ block: 'end', behavior: reduce ? 'auto' : 'smooth' })
  }, [outcome])

  // A key an older build kept with the settings moves into the key storage.
  useEffect(() => {
    void moveLegacySearchKeys()
  }, [])

  const pick = (next: SearchProvider) => {
    useSettingsStore.getState().updateSettings({ searchProvider: next })
    setOutcome(null)
  }

  const test = async () => {
    setTesting(true)
    setOutcome(null)
    try {
      // Without a network the search is not asked: the outcome is known, and it is not "search does not work".
      if (deviceSaysOffline()) setOutcome({ kind: 'offline' })
      else setOutcome(readSearchAnswer(await runWebSearch(S.testQuery, 3)))
    } catch (err) {
      setOutcome(readSearchError(err, { offline: deviceSaysOffline() }))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Page
      title={S.title}
      screen="settings-search"
      needsNetwork
      footer={
        <Button variant="primary" block icon={Search} busy={testing} onPress={() => void test()} testid="m-search-test" el="E9.4">
          {testing ? S.testing : S.test}
        </Button>
      }
    >
      {/* Store switch webSearchKeys: a build without keys of one's own has neither the choice nor the fields, and searches with the free search (G4). */}
      {keysOffered ? (
        <>
          <ListGroup title={S.providerTitle} role="radiogroup" testid="m-search-provider">
            <Row title={S.auto} subtitle={S.autoSub} radio={{ checked: provider === 'auto', onSelect: () => pick('auto') }} testid="m-search-provider-auto" el="E9.1" />
            <Row
              title={S.duckduckgo}
              subtitle={S.duckduckgoSub}
              radio={{ checked: provider === 'duckduckgo', onSelect: () => pick('duckduckgo') }}
              testid="m-search-provider-duckduckgo"
              el="E9.1"
            />
            <Row
              title={S.brave}
              subtitle={S.braveSub}
              radio={{ checked: provider === 'brave', onSelect: () => pick('brave') }}
              disabled={!searchProviderUsable('brave', keys)}
              disabledReason={S.needsKey(S.brave)}
              testid="m-search-provider-brave"
              el="E9.1"
            />
            <Row
              title={S.tavily}
              subtitle={S.tavilySub}
              radio={{ checked: provider === 'tavily', onSelect: () => pick('tavily') }}
              disabled={!searchProviderUsable('tavily', keys)}
              disabledReason={S.needsKey(S.tavily)}
              testid="m-search-provider-tavily"
              el="E9.1"
            />
          </ListGroup>

          <h2 className="m-label m-group-label">{S.keysTitle}</h2>
          <KeyBlock which="brave" label={S.braveKey} name={S.brave} el="E9.2" saved={braveSaved} onChanged={() => setOutcome(null)} />
          <KeyBlock which="tavily" label={S.tavilyKey} name={S.tavily} el="E9.3" saved={tavilySaved} onChanged={() => setOutcome(null)} />
          <p className="m-ag-text" data-testid="m-search-key-hint">
            {S.keyHint}
          </p>
        </>
      ) : (
        <p className="m-ag-text" data-testid="m-search-free-only">
          {S.freeOnly}
        </p>
      )}

      {outcome ? (
        <div ref={resultRef} className="m-stackv" data-testid="m-search-outcome">
          {outcome?.kind === 'ok' ? (
            <Notice variant={outcome.fallbackReason ? 'warn' : 'info'} testid="m-search-result" title={S.testOk(outcome.count, S.providerNames[outcome.provider] ?? outcome.provider)}>
              {outcome.fallbackReason ? S.testFallback(outcome.fallbackReason) : outcome.first ? `${S.firstResult}: ${outcome.first.title}` : S.firstResult}
              {outcome.skipped ? <p data-testid="m-search-result-skipped">{S.testSkipped(outcome.skipped)}</p> : null}
            </Notice>
          ) : null}
          {outcome?.kind === 'empty' ? (
            <Notice variant="warn" testid="m-search-result-empty">
              {S.testEmpty}
            </Notice>
          ) : null}
          {outcome?.kind === 'offline' ? (
            <Notice
              variant="warn"
              testid="m-search-result-offline"
              actions={
                <Button compact onPress={() => void test()} testid="m-search-retry-offline">
                  {T.common.tryAgain}
                </Button>
              }
            >
              {S.testOffline}
            </Notice>
          ) : null}
          {outcome?.kind === 'failed' ? (
            <Notice
              variant="error"
              testid="m-search-result-failed"
              actions={
                <Button compact onPress={() => void test()} testid="m-search-retry">
                  {T.common.tryAgain}
                </Button>
              }
            >
              {/* A build without key fields does not advise to add a key. */}
              {S.testFailed(keysOffered ? outcome.reason : withoutKeyAdvice(outcome.reason))}
            </Notice>
          ) : null}
        </div>
      ) : null}
    </Page>
  )
}
