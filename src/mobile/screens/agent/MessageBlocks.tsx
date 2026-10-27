/**
 * SLOT in C2, filled by strand 2 (Agent and knowledge).
 *
 * Strand 1 renders the transcript and calls <MessageBlocks /> for the parts
 * of an answer that are not plain text:
 *
 *   before  the thinking block (C2.20), the tool line and the band of
 *           several calls (C2.21), with the notes the model wrote between them
 *   after   the compaction block (C2.25), and the line under an answer that
 *           names search results although no tool ran
 *
 * The answer text, the sources and the notices under it belong to the chat
 * page. The props are the contract between the two strands.
 */
import { BookmarkCheck, BookmarkX, Brain, FoldVertical, Layers, SearchX, StickyNote } from 'lucide-react'
import { summarySections } from '../../../lib/compact-summary'
import { formatCount } from '../../../lib/formatters'
import { useChatStore } from '../../../stores/chatStore'
import { useGenerationStore } from '../../../stores/generationStore'
import { useMemoryStore } from '../../../stores/memoryStore'
import type { CompactionRecord, Message } from '../../../types/chat'
import { AGENT_STRINGS as T } from '../../strings/agent'
import './parts/agent.css'
import { Icon } from '../../ui'
import { claimsDoneWithoutStep, claimsResultsWithoutTool, compactionsAfter, orderedSearchDidNotRun, summarizeCalls, thoughtTail, userTextBefore, viewBlocks, type BlockItem } from './parts/blocks'
import { Fold } from './parts/Fold'
import { questionOf, rememberOutcome } from './parts/remember-request'
import { ToolCallRow } from './parts/ToolCallRow'

export interface MessageBlocksProps {
  chatId: string
  message: Message
  /** before: above the text of the answer (thinking, tools). after: below it (compaction). */
  position: 'before' | 'after'
}

function Note({ item }: { item: Extract<BlockItem, { kind: 'note' }> }) {
  return (
    <Fold title={item.phase === 'thinking' ? T.tools.thought : T.tools.note} icon={item.phase === 'thinking' ? Brain : StickyNote} testid="m-chat-note" el="C2.20">
      {() => <div className="m-ag-thought">{item.text}</div>}
    </Fold>
  )
}

function Items({ items, nested }: { items: BlockItem[]; nested?: boolean }) {
  return (
    <>
      {items.map((item) => (item.kind === 'call' ? <ToolCallRow key={item.call.id} call={item.call} nested={nested} /> : <Note key={item.id} item={item} />))}
    </>
  )
}

function Before({ chatId, message }: { chatId: string; message: Message }) {
  const view = viewBlocks(message)
  const running = useGenerationStore((s) => !!s.generating[chatId])
  const isLast = useChatStore((s) => {
    const conversation = s.conversations.find((c) => c.id === chatId)
    return conversation?.messages[conversation.messages.length - 1]?.id === message.id
  })
  const live = running && isLast
  if (!view.thinking && view.items.length === 0) return null
  const band = view.calls.length > 1 ? summarizeCalls(view.calls) : null
  return (
    <div className="m-stackv" data-testid="m-chat-blocks">
      {view.thinking ? (
        // While the model thinks the block stands open and shows the end of the thought as it grows, so a
        // long thought reads as progress and not as a hang (H4). With the answer it folds away again.
        <Fold key={live ? 'live' : 'done'} title={live ? T.tools.thinking : T.tools.thought} icon={Brain} defaultOpen={live} testid="m-chat-thinking" el="C2.20">
          {() => (
            <div className="m-ag-thought" data-live={live ? '' : undefined}>
              {live ? thoughtTail(view.thinking) : view.thinking}
            </div>
          )}
        </Fold>
      ) : null}
      {band ? (
        <Fold
          title={band.state === 'running' ? T.tools.stepsRunning(band.count) : band.state === 'failed' ? T.tools.stepsFailed(band.count, band.failed) : T.tools.steps(band.count)}
          icon={Layers}
          state={band.state}
          defaultOpen={band.state === 'running'}
          testid="m-chat-steps"
          el="C2.21"
        >
          {() => <Items items={view.items} nested />}
        </Fold>
      ) : (
        <Items items={view.items} />
      )}
    </div>
  )
}

function Compaction({ record }: { record: CompactionRecord }) {
  const saved = record.tokensBefore - record.tokensAfter
  return (
    <Fold
      title={T.tools.compacted}
      sub={[T.tools.compactedCount(record.replaced), record.trigger === 'auto' ? T.tools.compactedAuto : null].filter(Boolean).join('. ')}
      meta={saved > 0 ? `${formatCount(record.tokensBefore)} > ${formatCount(record.tokensAfter)}` : undefined}
      icon={FoldVertical}
      testid="m-chat-compacted"
      el="C2.25"
    >
      {() => {
        const sections = summarySections(record.summary)
        return (
          <>
            <span className="m-cap">{T.tools.compactedExplain}</span>
            {sections.length > 0 ? (
              sections.map((section) => (
                <div className="m-ag-kv" key={section.heading}>
                  <span>{section.heading}</span>
                  <div className="m-ag-pre m-ag-pre--plain">{section.body}</div>
                </div>
              ))
            ) : (
              <span className="m-cap">{T.tools.compactedUnreadable}</span>
            )}
          </>
        )
      }}
    </Fold>
  )
}

/** The answer names search results or sources, and no tool ran for it: said under the answer, once the run has ended. */
function NoToolRan({ chatId, message }: { chatId: string; message: Message }) {
  const running = useGenerationStore((s) => !!s.generating[chatId])
  // The user ordered a search and none ran: the second reason for a line here.
  const asked = useChatStore((s) => {
    const conversation = s.conversations.find((c) => c.id === chatId)
    return conversation ? userTextBefore(conversation.messages, message.id) : undefined
  })
  if (running) return null
  const claims = claimsResultsWithoutTool(message)
  if (!claims && !orderedSearchDidNotRun(asked, message)) return null
  return (
    <div className="m-chat-hint" data-testid="m-chat-no-tool">
      <Icon icon={SearchX} small />
      <span>{claims ? T.tools.noToolRan : T.tools.noSearchRan}</span>
    </div>
  )
}

/** The answer says something was done, and every step of the run was declined or failed: said under the answer. */
function NothingWasDone({ chatId, message }: { chatId: string; message: Message }) {
  const running = useGenerationStore((s) => !!s.generating[chatId])
  if (running || !claimsDoneWithoutStep(message)) return null
  return (
    <div className="m-chat-hint" data-testid="m-chat-nothing-done">
      <Icon icon={SearchX} small />
      <span>{T.tools.nothingWasDone}</span>
    </div>
  )
}

function Compactions({ chatId, message }: { chatId: string; message: Message }) {
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === chatId))
  if (!conversation?.compactions?.length) return null
  const records = compactionsAfter(conversation.messages, conversation.compactions, message.id)
  if (records.length === 0) return null
  return (
    <div className="m-stackv" data-testid="m-chat-compactions">
      {records.map((record) => (
        <Compaction key={record.id} record={record} />
      ))}
    </div>
  )
}

/**
 * The message before this answer asked to remember something (parts/remember-request.ts): the line says
 * that it is in Memory, or that nothing was kept because the request named nothing. Without it the only
 * word on the matter is the model's "I have noted" (acceptance on Android with 8 GB, B8).
 */
function Remembered({ chatId, message }: { chatId: string; message: Message }) {
  const running = useGenerationStore((s) => !!s.generating[chatId])
  const question = useChatStore((s) => questionOf(s.conversations.find((c) => c.id === chatId)?.messages ?? [], message.id))
  // Read so the line follows the memories: one that is deleted later takes its line along.
  useMemoryStore((s) => s.entries)
  if (running || message.role !== 'assistant') return null
  const outcome = rememberOutcome(question)
  if (!outcome) return null
  return (
    <div className="m-chat-hint" data-testid="m-chat-remembered" data-state={outcome}>
      <Icon icon={outcome === 'saved' ? BookmarkCheck : BookmarkX} small />
      <span>{outcome === 'saved' ? T.tools.rememberSaved : T.tools.rememberNothing}</span>
    </div>
  )
}

function After({ chatId, message }: { chatId: string; message: Message }) {
  return (
    <>
      <Remembered chatId={chatId} message={message} />
      <NoToolRan chatId={chatId} message={message} />
      <NothingWasDone chatId={chatId} message={message} />
      <Compactions chatId={chatId} message={message} />
    </>
  )
}

export function MessageBlocks({ chatId, message, position }: MessageBlocksProps) {
  if (message.role !== 'assistant') return null
  return position === 'before' ? <Before chatId={chatId} message={message} /> : <After chatId={chatId} message={message} />
}
