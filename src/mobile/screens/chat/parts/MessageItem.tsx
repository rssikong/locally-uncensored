/**
 * One message of the transcript C2: the bubble of the user at the right, the
 * answer at the left without a bubble under the line "<monogram> <model>".
 *
 * Thinking, tool lines and the compaction block are not drawn here: they
 * belong to strand 2 and come in through <MessageBlocks> (C2.20, C2.21,
 * C2.25).
 */
import { memo, useMemo, useRef, useSyncExternalStore } from 'react'
import { AlertTriangle, Copy, Ellipsis, FileText, Flag, Hourglass, RefreshCw, Scissors, Square, Unlink, Volume2 } from 'lucide-react'
import type { Message } from '../../../../types/chat'
import { truncationNotice } from '../../../../lib/answer-notes'
import { FILE_ONLY_TEXT } from '../../../../lib/chat-files'
import { formatBytes } from '../../../../lib/formatters'
import { REFUSAL_NOTICE } from '../../../../lib/refusal-detect'
import { stripRejectedEcho } from '../../../../lib/rejected-call'
import { closeOpenMarkdown } from '../../../../lib/streaming-markdown'
import { stripFailureNoteEcho } from '../../../../lib/tool-failure-note'
import { stripModelNoise } from '../../../../lib/strip-model-noise'
import { formatThinkingTime } from '../../../../lib/thinking-clock'
import { unbackedLinksNotice } from '../../../../lib/unbacked-links'
import { useGenerationStore } from '../../../../stores/generationStore'
import { useModelStore } from '../../../../stores/modelStore'
import { useRAGStore } from '../../../../stores/ragStore'
import { nav } from '../../../nav'
import { MessageBlocks } from '../../agent/MessageBlocks'
import { useDocumentJob, useReadingProgress, waitingForDocumentText } from '../../agent/parts/slot-turn'
import { isDeviceModel } from '../../../lib/model-place'
import { holdsVisibleText, useDrawsNothing } from './blank-answer'
import { stoppedBySwitch, subscribeSwitchNote, switchNoteVersion } from './switched-under-answer'
import { MODEL_SWITCH_FINISH } from '../../../../lib/model-switch-stop'
import { CHAT_STRINGS } from '../../../strings/chat'
import { Button, Icon, IconButton, Monogram, Notice } from '../../../ui'
import { UserAvatar, useUserAvatar } from '../../settings/parts/UserAvatar'
import { chatModelLabel } from './model-name'
import { stoppedByUser } from './user-stop'
import { storeSentence } from '../../../policy/server-text'
import { directMarkShown, unfilteredMarksShown } from '../../../policy/unfiltered'
import { Sources } from './Sources'
import { isCloudModel } from './consent'
import { purchaseHint } from './logic/policy'
import { storePolicy } from './policy'
import { viewAnswer, type RunError } from './adapters/run-error'
import { ChatImage } from './ChatImage'
import { shownText } from './logic/chat-list'
import { encodeFileRef } from './logic/messages'
import { Markdown } from './Markdown'
import { useLongPress } from './useLongPress'

const S = CHAT_STRINGS

/** What a message can ask of the page. One stable object, so a finished message never renders again. */
export interface MessageHandlers {
  more: (message: Message) => void
  copy: (message: Message) => void
  regenerate: (message: Message) => void
  speak: (message: Message) => void
  /** Report this answer (store duty: one tap from every answer). */
  report: (message: Message) => void
  /** An answer that was cut when the app closed: go on from the part that is there. */
  continueAnswer: (message: Message) => void
  /** The model only thought: turn thinking off and ask again, in one tap. */
  answerWithoutThinking: (message: Message) => void
  newChat: () => void
  chooseModel: (segment: 'local' | 'cloud') => void
}

export interface MessageItemProps {
  chatId: string
  message: Message
  handlers: MessageHandlers
  /** The answer is still being written. */
  streaming?: boolean
  /** The last answer of the chat: it carries the action row and the error box. */
  last?: boolean
  /** A run is going in this chat: actions that start another one wait. */
  busy?: boolean
  /** This answer is being read aloud. */
  speaking?: boolean
  /** A tap on the speaker would really speak (parts/read-aloud.ts). Without that the button is not there. */
  canSpeak?: boolean
  /** How fast this answer was written, as a finished line. Only the answer measured last carries one. */
  speed?: string
  /** What a tap would cost: asking again goes to a cloud model, reading aloud to the voice of LU Cloud. */
  paid?: { regenerate: boolean; speak: boolean }
  /** The store asks for a report button at every answer (policy). */
  reportable?: boolean
  /** The refusal notice belongs under this answer (C2.26). */
  declined?: boolean
  /** Far from the end of a long chat: the browser may skip its layout. */
  skip?: boolean
  /** A cut answer of this chat can be gone on with in place (lib/continue-answer.ts). Without it the box offers "Regenerate". */
  continues?: boolean
}

function ErrorBox(props: { error: RunError; cloud: boolean; device?: boolean; switched?: boolean; busy?: boolean; onRetry: () => void; onContinue: () => void; handlers: MessageHandlers; partial?: boolean; inPlace?: boolean }) {
  const { cloud, device, busy, onRetry, handlers, partial, inPlace } = props
  // The reason is a sentence of the server or of the logic layer: a store build shows what it may show of it (policy/server-text.ts).
  const error = { ...props.error, detail: storeSentence(props.error.detail) }
  const E = S.errors
  const retry = (
    <Button compact variant="primary" disabled={busy} disabledReason={S.actions.busy} onPress={onRetry} testid="m-chat-error-action">
      {error.kind === 'interrupted' ? (partial ? (inPlace ? E.continue : E.regenerate) : E.askAgain) : E.tryAgain}
    </Button>
  )
  const local = (
    <Button compact onPress={() => handlers.chooseModel('local')} testid="m-chat-error-alt">
      {E.useLocal}
    </Button>
  )
  switch (error.kind) {
    case 'credits': {
      const hint = purchaseHint(storePolicy().purchase, { title: E.creditsTitle, text: E.creditsText, action: E.creditsAction, textOnly: S.policy.creditsTextOnly, neutralTitle: S.policy.cloudOffTitle, neutralText: S.policy.cloudOffText })
      return (
        <Notice
          variant="warn"
          title={hint.title}
          testid="m-chat-error"
          actions={
            <>
              {hint.action ? (
                <Button compact variant="cloud" onPress={() => nav.push('/cloud')} testid="m-chat-error-action">
                  {hint.action}
                </Button>
              ) : null}
              {local}
            </>
          }
        >
          {hint.text}
        </Notice>
      )
    }
    case 'session':
      return (
        <Notice
          variant="warn"
          title={E.sessionTitle}
          testid="m-chat-error"
          actions={
            <>
              <Button compact variant="primary" onPress={() => nav.openSheet('session')} testid="m-chat-error-action">
                {E.sessionAction}
              </Button>
              {local}
            </>
          }
        >
          {E.sessionText}
        </Notice>
      )
    case 'network':
      // A model on this phone has no connection that could drop: its stream broke because the engine
      // stopped under it. A sentence about the network there sends the user to check a thing that
      // was never involved (N2).
      if (device) {
        // The sentence says what the button does: go on inside the part that arrived, or write the answer again.
        const goesOn = !!partial && !!inPlace
        const action = goesOn ? (
          <Button compact variant="primary" disabled={busy} disabledReason={S.actions.busy} onPress={props.onContinue} testid="m-chat-error-action">
            {E.continue}
          </Button>
        ) : (
          retry
        )
        return (
          <Notice variant={props.switched ? 'warn' : 'error'} title={props.switched ? E.switchedTitle : E.deviceStoppedTitle} testid="m-chat-error" actions={action}>
            {goesOn ? E.deviceStoppedText : partial ? E.deviceStoppedAgain : E.deviceStoppedNothing}
          </Notice>
        )
      }
      return (
        <Notice
          variant="error"
          title={E.networkTitle}
          testid="m-chat-error"
          actions={
            <>
              {retry}
              {cloud ? local : null}
            </>
          }
        >
          {E.networkText}
        </Notice>
      )
    case 'engine':
      return (
        <Notice
          variant="error"
          title={E.engineTitle}
          testid="m-chat-error"
          actions={
            <>
              {retry}
              <Button compact onPress={() => handlers.chooseModel('local')} testid="m-chat-error-alt">
                {E.engineAction}
              </Button>
            </>
          }
        >
          {E.engineText}
          {error.detail ? <span className="m-cap"> {error.detail}</span> : null}
        </Notice>
      )
    case 'limit':
      // A request limit: the sentence of the server is the message itself, no title above it
      // (lib/request-limit.ts). The short wait the server named has already been sat out.
      return (
        <Notice variant="warn" testid="m-chat-error" actions={retry}>
          {error.detail}
        </Notice>
      )
    case 'interrupted':
      return (
        <Notice variant="info" title={E.interruptedTitle} testid="m-chat-error" actions={retry}>
          {partial ? (inPlace ? E.interruptedText : E.interruptedRegenerate) : E.interruptedNothing}
        </Notice>
      )
    case 'empty':
      return (
        <Notice variant="warn" title={E.emptyTitle} testid="m-chat-error" actions={retry}>
          {error.detail || E.emptyText}
        </Notice>
      )
    default:
      return (
        <Notice
          variant="error"
          title={E.genericTitle}
          testid="m-chat-error"
          actions={
            <>
              {retry}
              <Button compact onPress={() => handlers.chooseModel(cloud ? 'cloud' : 'local')} testid="m-chat-error-alt">
                {E.engineAction}
              </Button>
            </>
          }
        >
          {error.detail}
        </Notice>
      )
  }
}

function Attachments(props: { chatId: string; message: Message }) {
  const { chatId, message } = props
  const open = (fileId: string) => nav.push('/chat/:id/file/:fileId', { id: chatId, fileId })
  const hasFiles = !!message.files?.length
  const hasImages = !!message.images?.length
  if (!hasFiles && !hasImages) return null
  return (
    <div className="m-chat-media">
      {message.files?.map((file, i) => (
        <button
          type="button"
          key={`${file.sha256}-${i}`}
          className="m-chat-filecard"
          aria-label={S.message.fileCard(file.name)}
          data-testid="m-chat-file"
          data-el="C2.24"
          onClick={() => open(encodeFileRef({ kind: 'file', messageId: message.id, index: i }))}
        >
          <Icon icon={FileText} small />
          <span className="m-chat-filecard-text">
            <span>{file.name}</span>
            <span className="m-chat-filecard-sub">{formatBytes(file.size)}</span>
          </span>
        </button>
      ))}
      {message.images?.map((image, i) => (
        <ChatImage key={i} image={image} onOpen={() => open(encodeFileRef({ kind: 'image', messageId: message.id, index: i }))} />
      ))}
    </div>
  )
}

function UserMessage({ chatId, message, handlers, skip }: MessageItemProps) {
  const press = useLongPress(() => handlers.more(message))
  // The profile picture from Settings, Appearance. Without one the bubble stands alone, as before.
  // Only a picture the app made itself is drawn (settings/parts/UserAvatar.tsx).
  const avatar = useUserAvatar()
  const text = shownText(message)
  const fileOnly = !!message.files?.length && message.displayContent === FILE_ONLY_TEXT
  const bubble = fileOnly || !text ? null : <div className="m-chat-bubble">{text}</div>
  return (
    <div className="m-chat-msg" data-testid="m-chat-message" data-m-role="user" data-m-id={message.id} data-skip={skip ? '' : undefined} {...press}>
      <span className="m-sr">{S.chat.you}</span>
      <Attachments chatId={chatId} message={message} />
      {bubble && avatar ? (
        <div className="m-chat-userline">
          {bubble}
          <UserAvatar size={24} testid="m-chat-user-avatar" />
        </div>
      ) : (
        bubble
      )}
      <div className="m-chat-actions">
        <IconButton icon={Ellipsis} label={S.actions.moreForMessage} onPress={() => handlers.more(message)} testid="m-chat-message-more" el="C2.19" />
      </div>
    </div>
  )
}

/** Under an answer that has not started: a document is still being read, and the answer waits for it (N7). */
function WaitsForDocument() {
  const job = useDocumentJob()
  const progress = useReadingProgress()
  if (job !== 'reading') return null
  return (
    <div className="m-chat-hint" role="status" data-testid="m-chat-waits-for-document">
      <Icon icon={FileText} small />
      <span>{waitingForDocumentText(progress)}</span>
    </div>
  )
}

/**
 * Pure: does an answer that has not started wait for the model on this phone,
 * because that model is writing an answer in another chat? There is one such
 * model and it writes one answer at a time. An answer of a cloud model does
 * not wait for it, unless its chat has documents: their search needs the same
 * place in memory (api/rag.ts).
 */
export function waitsForOtherChat(
  chatId: string,
  usesPhone: boolean,
  generating: Readonly<Record<string, boolean>>,
  runs: Readonly<Record<string, { lane: string } | undefined>>,
): boolean {
  if (!usesPhone) return false
  return Object.keys(generating).some((id) => id !== chatId && generating[id] && runs[id]?.lane !== 'cloud')
}

/**
 * Under an answer that has not started: the model on this phone is busy in
 * another chat (round 9, N6 on Android: 92 seconds of an empty bubble with a
 * caret and no word about why).
 */
function WaitsForOtherChat({ chatId, device }: { chatId: string; device: boolean }) {
  const reading = useDocumentJob() === 'reading'
  const hasDocuments = useRAGStore((s) => !!s.ragEnabled[chatId] && (s.documents[chatId]?.length ?? 0) > 0)
  const waits = useGenerationStore((s) => waitsForOtherChat(chatId, device || hasDocuments, s.generating, s.runs))
  // A document that is being read has the more exact sentence (above).
  if (!waits || reading) return null
  return (
    <div className="m-chat-hint" role="status" data-testid="m-chat-waits-for-chat">
      <Icon icon={Hourglass} small />
      <span>{S.message.waitsForOtherChat}</span>
    </div>
  )
}

/**
 * Pure: is there nothing at all this answer would draw? Then it is an empty answer, whatever its stored
 * text holds. Thoughts, steps of an agent, files and pictures are something; so is the note about a
 * declined answer.
 */
export function answerShowsNothing(a: { streaming: boolean; hasText: boolean; thinking: boolean; blocks: boolean; artifacts: boolean; images: boolean; files: boolean; declined: boolean }): boolean {
  return !a.streaming && !a.hasText && !a.thinking && !a.blocks && !a.artifacts && !a.images && !a.files && !a.declined
}

function AnswerMessage({ chatId, message, handlers, streaming, last, busy, speaking, canSpeak, speed, paid, reportable, declined, skip, continues }: MessageItemProps) {
  const press = useLongPress(() => handlers.more(message))
  const modelName = useModelStore((s) => (message.modelId ? chatModelLabel(s.models, message.modelId) : ''))
  const cloud = isCloudModel(message.modelId)
  const device = isDeviceModel(message.modelId)
  const view = useMemo(() => viewAnswer(message, { cloud, streaming }), [message, cloud, streaming])
  const text = useMemo(() => {
    const toolDriven = !!message.agentBlocks?.length
    // `view.body` is the answer alone: a sentence the logic layer wrote into the text (a broken stream, a
    // used up budget, a failed agent run) is the error of this answer and is drawn below (G8).
    const own = stripModelNoise(view.body, { aggressive: toolDriven })
    // An agent run keeps its text in answer blocks. The text of an answer is drawn here; <MessageBlocks> draws thinking and tools only.
    const written =
      own.trim() || !toolDriven
        ? own
        : (message.agentBlocks ?? [])
            .filter((b) => b.phase === 'answer')
            .map((b) => stripModelNoise(b.content, { aggressive: true }))
            .filter(Boolean)
            .join('\n\n')
    // A small model gives the note for a declined step back word for word as its answer (Android 8 GB, B10).
    // The note is the app's and not an answer: it goes, and when nothing else was said the chat says what happened.
    // `view.body` comes without the note already, so the stored text is asked whether it was there.
    const clean = stripRejectedEcho(written)
    const echoed = clean.echoed || stripRejectedEcho(message.content ?? '').echoed
    if (echoed && !clean.text.trim()) return S.chat.declinedStep
    // The same for the note about a step that failed or ran out of time (iPhone review, N11).
    const failed = stripFailureNoteEcho(clean.text)
    return failed.echoed && !failed.text.trim() ? S.chat.failedStep : failed.text
  }, [view.body, message.agentBlocks, message.content])
  const storedText = holdsVisibleText(text)
  // A text that is stored and draws nothing is an empty answer (round 23, N16): asked of what is on screen.
  const answerRef = useRef<HTMLDivElement>(null)
  const blank = useDrawsNothing(answerRef, !streaming && storedText, text)
  const hasText = storedText && !blank
  // Stopped by the user while the model still thought: said as that, not as a failure of the model (round 22, N3).
  const userStopped = stoppedByUser(message)
  const thoughtOnly = !streaming && !hasText && !!(message.thinking ?? '').trim()
  // The logic layer says in its own sentence why the thinking left no answer (lib/answer-notes.ts). It is the reason under the thoughts, not the answer.
  const thoughtReason = thoughtOnly && view.error?.kind === 'empty' ? storeSentence(view.error.detail) : ''
  // An answer with nothing to show is never "done" without a word (check 4 on Android, F8: state done, no text,
  // no box). The stored text can hold something and still show nothing: tokens of the template, an empty
  // frame of tags, a note of the app given back (all taken out above). So "empty" is asked of what is drawn,
  // not only of what is stored (lib/message-error.ts).
  const shows = answerShowsNothing({
    streaming: !!streaming,
    hasText,
    thinking: !!(message.thinking ?? '').trim(),
    blocks: !!message.agentBlocks?.length,
    artifacts: !!message.artifacts?.length,
    images: !!message.images?.length,
    files: !!message.files?.length,
    declined: !!declined,
  })
  const found: RunError | null = view.error ?? (shows ? { kind: 'empty', detail: '' } : null)
  const error = streaming ? null : found && !(found.kind === 'empty' && (thoughtOnly || !!message.agentBlocks?.length || !!message.artifacts?.length || !last)) ? found : null
  // An earlier answer that is empty gets no "Try again" (the chat went on), but it gets its word.
  const emptyEarlier = !streaming && !last && !error && found?.kind === 'empty' && shows
  const cut = streaming ? null : truncationNotice(message.finishReason)
  // The user chose another model under this answer: the box and the line say that, not "interrupted" (parts/switched-under-answer.ts).
  // Read through the store of the notes, so a note written after the answer ended draws the bubble again.
  useSyncExternalStore(subscribeSwitchNote, switchNoteVersion)
  // The shared chat run names the change itself (lib/model-switch-stop.ts); the note covers an answer saved as a plain break.
  const switched = device && !streaming && (message.finishReason === MODEL_SWITCH_FINISH || (message.finishReason === 'disconnect' && stoppedBySwitch(message.id)))
  const unbacked = streaming ? null : unbackedLinksNotice(message.unbackedLinks)
  const showActions = !streaming && (hasText || !!error || thoughtOnly)

  return (
    <div
      className="m-chat-msg"
      data-testid="m-chat-message"
      data-m-role="assistant"
      data-m-id={message.id}
      data-state={streaming ? 'streaming' : error ? 'error' : 'done'}
      data-skip={skip ? '' : undefined}
      {...press}
    >
      <div className="m-chat-by" data-testid="m-chat-model-by">
        <Monogram size={14} />
        <span>{modelName || S.chat.answer}</span>
        {!streaming && message.thinkingMs && message.thinkingMs > 0 && (message.thinking ?? '').trim() ? (
          <span className="m-chat-thought" data-testid="m-chat-thought-for">
            {S.chat.thoughtFor(formatThinkingTime(message.thinkingMs))}
          </span>
        ) : null}
      </div>
      <MessageBlocks chatId={chatId} message={message} position="before" />
      <Attachments chatId={chatId} message={message} />
      {storedText || streaming ? (
        <div className="m-chat-answer" ref={answerRef} data-streaming={streaming ? '' : undefined} data-testid="m-chat-answer" hidden={blank}>
          {storedText ? <Markdown content={streaming ? closeOpenMarkdown(text) : text} chatId={chatId} messageId={message.id} /> : null}
        </div>
      ) : null}
      {streaming && !hasText && !(message.thinking ?? '').trim() ? <WaitsForDocument /> : null}
      {streaming && !hasText && !(message.thinking ?? '').trim() && !message.agentBlocks?.length ? <WaitsForOtherChat chatId={chatId} device={device} /> : null}
      {thoughtOnly ? (
        <div className="m-chat-hint" data-testid="m-chat-thought-only" data-m-stopped={userStopped ? '' : undefined}>
          <Icon icon={AlertTriangle} small />
          <span>{userStopped ? S.message.thoughtStopped : thoughtReason || S.message.thoughtOnly}</span>
          {last ? (
            <Button compact variant="primary" disabled={busy} disabledReason={S.actions.busy} onPress={() => handlers.answerWithoutThinking(message)} testid="m-chat-answer-no-thinking">
              {S.message.answerWithoutThinking}
            </Button>
          ) : null}
        </div>
      ) : null}
      {emptyEarlier ? (
        <div className="m-chat-hint" data-testid="m-chat-empty-earlier">
          <Icon icon={AlertTriangle} small />
          <span>{S.message.emptyEarlier}</span>
        </div>
      ) : null}
      {cut ? (
        <div className="m-chat-hint" data-testid="m-chat-cut">
          <Icon icon={Scissors} small />
          <span>{message.finishReason === 'length' ? S.message.cutLength : switched ? S.message.cutSwitched : device ? S.message.cutDevice : S.message.cutConnection}</span>
        </div>
      ) : null}
      {unbacked ? (
        <div className="m-chat-hint" data-testid="m-chat-unbacked">
          <Icon icon={Unlink} small />
          <span>{unbacked}</span>
        </div>
      ) : null}
      {message.artifacts?.length ? (
        <div className="m-chat-media">
          {message.artifacts.map((artifact) => (
            <button
              type="button"
              key={artifact.id}
              className="m-chat-filecard"
              aria-label={S.message.fileCard(artifact.name)}
              data-testid="m-chat-artifact"
              data-el="C2.24"
              onClick={() => nav.push('/chat/:id/file/:fileId', { id: chatId, fileId: encodeFileRef({ kind: 'artifact', messageId: message.id, artifactId: artifact.id }) })}
            >
              <Icon icon={FileText} small />
              <span className="m-chat-filecard-text">
                <span>{artifact.name}</span>
                <span className="m-chat-filecard-sub">{formatBytes(artifact.content.length)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <ErrorBox
          error={error}
          cloud={cloud}
          device={device}
          switched={switched}
          busy={busy}
          partial={hasText || !!(message.thinking ?? '').trim()}
          inPlace={hasText && !!continues}
          onRetry={() => (error.kind === 'interrupted' ? handlers.continueAnswer(message) : handlers.regenerate(message))}
          onContinue={() => handlers.continueAnswer(message)}
          handlers={handlers}
        />
      ) : null}
      {declined ? (
        <Notice
          variant="warn"
          testid="m-chat-refusal"
          actions={
            <Button compact onPress={handlers.newChat} testid="m-chat-refusal-new" el="C2.26">
              {S.refusal.newChat}
            </Button>
          }
        >
          {/* The sentence of the logic layer names the mark of the open build. A store build has another mark, or none. */}
          {unfilteredMarksShown() ? REFUSAL_NOTICE : directMarkShown() ? S.refusal.noticeDirect : S.refusal.noticePlain}
        </Notice>
      ) : null}
      {!streaming && message.sources?.length ? <Sources sources={message.sources} /> : null}
      <MessageBlocks chatId={chatId} message={message} position="after" />
      {showActions ? (
        <div className="m-chat-actions" data-testid={last ? 'm-chat-answer-actions' : undefined}>
          {last ? (
            <>
              <IconButton icon={Copy} label={S.actions.copy} disabled={!hasText} onPress={() => handlers.copy(message)} testid="m-chat-copy" el="C2.16" />
              <IconButton icon={RefreshCw} label={S.actions.regenerate} disabled={busy} risk={paid?.regenerate ? 'paid' : undefined} onPress={() => handlers.regenerate(message)} testid="m-chat-regenerate" el="C2.17" />
              {canSpeak || speaking ? (
                <IconButton
                  icon={speaking ? Square : Volume2}
                  label={speaking ? S.actions.stopReading : S.actions.readAloud}
                  pressed={!!speaking}
                  disabled={!hasText}
                  risk={paid?.speak && !speaking ? 'paid' : undefined}
                  onPress={() => handlers.speak(message)}
                  testid={speaking ? 'm-chat-speaking' : 'm-chat-speak'}
                  el="C2.18"
                />
              ) : null}
            </>
          ) : null}
          {reportable && hasText ? <IconButton icon={Flag} label={S.policy.reportAnswer} onPress={() => handlers.report(message)} testid="m-chat-report" el="C2.19" /> : null}
          <IconButton icon={Ellipsis} label={S.actions.moreForAnswer} onPress={() => handlers.more(message)} testid="m-chat-answer-more" el="C2.19" />
        </div>
      ) : null}
      {showActions && last && speed ? (
        <span className="m-chat-speed" data-testid="m-chat-speed">
          {speed}
        </span>
      ) : null}
    </div>
  )
}

function MessageItemImpl(props: MessageItemProps) {
  const { message } = props
  if (message.role === 'system') {
    return (
      <div className="m-chat-sysnote" role="note" aria-label={S.message.system} data-testid="m-chat-notice" data-m-id={message.id} data-tone={message.notice === 'warn' ? 'warn' : 'info'}>
        {message.content}
      </div>
    )
  }
  return message.role === 'user' ? <UserMessage {...props} /> : <AnswerMessage {...props} />
}

export const MessageItem = memo(MessageItemImpl)
