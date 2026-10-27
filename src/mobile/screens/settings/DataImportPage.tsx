/**
 * E16 Import chats. Route /settings/data/import, page, strand 5 (Account, cloud, settings).
 *
 * Reads an export of ChatGPT, Claude or Gemini on the phone, shows how many
 * chats it holds, and puts them into the chat list. The file never leaves
 * the phone. With "Make them searchable in chat" the same texts are also
 * indexed as documents of one chat, where the document model is set up.
 */
import { useEffect, useRef, useState } from 'react'
import { FileUp, MessagesSquare } from 'lucide-react'
import { embeddingBackendReady } from '../../../api/embed-availability'
import { parseExportFile, type ChatbotPlatform, type NormalisedConversation } from '../../../lib/parsers/chatbot-export'
import { useChatStore } from '../../../stores/chatStore'
import { useRAGStore } from '../../../stores/ragStore'
import { nav } from '../../nav'
import { pickFiles } from '../../platform'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { Button, ListGroup, Notice, Page, Progress, Row } from '../../ui'
import { isLargeFile } from './parts/data'
import { chatsAreWritten } from './parts/durable'
import { toConversations } from './parts/import-chats'
import { makeSearchable } from './parts/import-search'
import { Block, Hint } from './parts/layout'

const T = SETTINGS_STRINGS.dataImport

const PLATFORM: Record<ChatbotPlatform, string> = { chatgpt: T.platformChatgpt, claude: T.platformClaude, gemini: T.platformGemini, unknown: '' }

/** Id of the one chat that carries the imported texts as documents. */
const SEARCH_CHAT_ID = 'imported-search'

type Step =
  | { kind: 'pick' }
  | { kind: 'reading'; large: boolean }
  | { kind: 'error'; text: string }
  | { kind: 'found'; conversations: NormalisedConversation[]; skipped: number; platform: ChatbotPlatform }
  | { kind: 'importing'; done: number; total: number }
  /** Every chat is in the list and on its way into the storage of the phone. Not done yet. */
  | { kind: 'saving'; total: number }
  | { kind: 'done'; imported: number; indexFailed: number; notKept: number; cancelled: boolean; saved: boolean }

export default function DataImportPage() {
  const [step, setStep] = useState<Step>({ kind: 'pick' })
  const [searchable, setSearchable] = useState(false)
  const [canIndex, setCanIndex] = useState(false)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    let alive = true
    embeddingBackendReady(useRAGStore.getState().embeddingModel)
      .then((ready) => {
        if (alive) setCanIndex(ready)
      })
      .catch(() => {
        /* no document model here: the switch stays off, with its reason */
      })
    return () => {
      alive = false
      abort.current?.abort()
    }
  }, [])

  const choose = async () => {
    const picked = await pickFiles({ accept: '.json,.zip,application/json,application/zip' })
    const first = picked[0]
    if (!first) return
    setStep({ kind: 'reading', large: isLargeFile(first.size) })
    try {
      const result = await parseExportFile(first.file)
      if (result.conversations.length === 0) setStep({ kind: 'error', text: T.empty })
      else setStep({ kind: 'found', conversations: result.conversations, skipped: result.skipped, platform: result.detectedPlatform })
    } catch {
      setStep({ kind: 'error', text: T.unreadable })
    }
  }

  const run = async () => {
    if (step.kind !== 'found') return
    const source = step.conversations
    const controller = new AbortController()
    abort.current = controller
    const chats = toConversations(source, Date.now(), (c) => T.importedTitle(PLATFORM[c.platform], c.title))
    const total = chats.length
    setStep({ kind: 'importing', done: 0, total })

    // In slices, so the page can draw the progress and "Cancel" gets a turn.
    let imported = 0
    const SLICE = 20
    for (let at = 0; at < chats.length && !controller.signal.aborted; at += SLICE) {
      const slice = chats.slice(at, at + SLICE)
      useChatStore.getState().importConversations(slice, 'merge')
      imported += slice.length
      setStep({ kind: 'importing', done: imported, total })
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }

    let indexFailed = 0
    let notKept = 0
    if (searchable && canIndex && !controller.signal.aborted) {
      const model = useRAGStore.getState().embeddingModel
      const now = Date.now()
      useChatStore.getState().importConversations(
        [{ id: SEARCH_CHAT_ID, title: T.searchChatTitle, messages: [], model: '', systemPrompt: '', mode: 'lu', createdAt: now, updatedAt: now, personaEnabled: false }],
        'merge',
      )
      const outcome = await makeSearchable(source, SEARCH_CHAT_ID, model, controller.signal)
      indexFailed = outcome.failed
      notKept = outcome.notKept
      if (!controller.signal.aborted) useRAGStore.getState().setRagEnabled(SEARCH_CHAT_ID, true)
    }

    abort.current = null
    // "Imported" is only true once the chats are in the storage of the phone. Written out now, then read back.
    setStep({ kind: 'saving', total })
    const saved = await chatsAreWritten({ present: chats.slice(0, imported).map((c) => c.id) })
    setStep({ kind: 'done', imported, indexFailed, notKept, cancelled: controller.signal.aborted, saved })
  }

  return (
    <Page title={T.title} screen="settings-data-import">
      {/* One hint and one action in every step: in the middle of the room, not a form that starts at the top. */}
      <div data-m-sparse="" data-testid="m-settings-data-import-state" data-state={step.kind}>
        <Block lead>
          <Hint strong>{T.intro}</Hint>
          <Hint>{T.stays}</Hint>
        </Block>

        {step.kind === 'pick' || step.kind === 'error' ? (
          <>
            {step.kind === 'error' ? (
              <Notice variant="error" testid="m-settings-data-import-error">
                {step.text}
              </Notice>
            ) : null}
            <Block>
              <Button variant="primary" block icon={FileUp} onPress={() => void choose()} testid="m-settings-data-import-choose" el="E16.3">
                {step.kind === 'error' ? T.chooseAnother : T.choose}
              </Button>
            </Block>
          </>
        ) : null}

        {step.kind === 'reading' ? (
          <Block testid="m-settings-data-import-reading">
            <Progress label={T.reading} detail={T.reading} />
            {step.large ? <Notice variant="warn">{T.tooLarge}</Notice> : null}
          </Block>
        ) : null}

        {step.kind === 'found' ? (
          <>
            <Notice title={T.found(step.conversations.length, PLATFORM[step.platform])} testid="m-settings-data-import-found">
              {step.skipped > 0 ? T.skipped(step.skipped) : T.stays}
            </Notice>
            <ListGroup>
              <Row
                title={T.searchable}
                subtitle={T.searchableSub}
                disabled={!canIndex}
                disabledReason={T.searchableUnavailable}
                switch={{ checked: searchable && canIndex, onChange: setSearchable }}
                testid="m-settings-data-import-searchable"
                el="E16.3"
              />
            </ListGroup>
            <Block lead>
              <Button variant="primary" block onPress={() => void run()} testid="m-settings-data-import-run" el="E16.3">
                {T.importN(step.conversations.length)}
              </Button>
              <Button variant="quiet" block onPress={() => void choose()} testid="m-settings-data-import-another">
                {T.chooseAnother}
              </Button>
            </Block>
          </>
        ) : null}

        {step.kind === 'importing' ? (
          <Block testid="m-settings-data-import-progress">
            <Progress label={T.importing} value={step.total > 0 ? step.done / step.total : 0} detail={T.progress(step.done, step.total)} />
            <Button block onPress={() => abort.current?.abort()} testid="m-settings-data-import-cancel">
              {T.cancel}
            </Button>
          </Block>
        ) : null}

        {step.kind === 'saving' ? (
          <Block testid="m-settings-data-import-saving">
            <Progress label={T.saving} detail={T.saving} />
          </Block>
        ) : null}

        {step.kind === 'done' ? (
          <>
            <Notice title={step.cancelled ? T.cancelled(step.imported) : T.done(step.imported)} testid="m-settings-data-import-done">
              {T.doneText}
            </Notice>
            {!step.saved ? (
              <Notice variant="error" testid="m-settings-data-import-not-saved">
                {T.notSaved}
              </Notice>
            ) : null}
            {step.indexFailed > 0 ? (
              <Notice variant="warn" testid="m-settings-data-import-index-failed">
                {T.indexFailed(step.indexFailed)}
              </Notice>
            ) : null}
            {step.notKept > 0 ? (
              <Notice variant="error" testid="m-settings-data-import-not-kept">
                {T.indexNotKept(step.notKept)}
              </Notice>
            ) : null}
            <Block lead>
              <Button variant="primary" block icon={MessagesSquare} onPress={() => nav.switchTab('chat')} testid="m-settings-data-import-open-chats">
                {T.openChats}
              </Button>
              <Button variant="quiet" block onPress={() => setStep({ kind: 'pick' })} testid="m-settings-data-import-again">
                {T.chooseAnother}
              </Button>
            </Block>
          </>
        ) : null}
      </div>
    </Page>
  )
}
