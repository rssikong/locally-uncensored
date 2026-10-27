/**
 * What can be done with one message of a remote chat. Sheet
 * "remote-message", strand 6 (C6 for R4).
 *
 * An answer of the desktop model: Copy, Regenerate (the answer and what came
 * after it are dropped, the question before it is asked again), and Report
 * wherever the build asks for it (policy/storePolicy.ts, reportContent): it
 * is an AI answer like any other. An own message: Copy, and Edit and resend
 * (sub page "edit": the changed text is sent, what came after is dropped).
 * Both do what the web page of the desktop does (mobile-client/client.js,
 * _regenMsg and _editMsg). "Copied" is said only after the clipboard took
 * the text.
 */
import { useState } from 'react'
import { Copy, Flag, Pencil, RefreshCw } from 'lucide-react'
import { useSheet } from '../../nav'
import { copyText } from '../../platform/clipboard'
import { openReport } from '../../policy/report'
import { storePolicy } from '../../policy/storePolicy'
import { REMOTE_STRINGS as S } from '../../strings/remote'
import { Button, ListGroup, Row, Sheet, TextArea, toast } from '../../ui'
import { sayResendOutcome } from './parts/actions'
import { remote, useRemote } from './parts/session'
import { isForeignChat } from './parts/view'
import './parts/remote.css'

function EditForm({ chatId, messageId, start, hasPhotos, blocked, onDone }: { chatId: string; messageId: string; start: string; hasPhotos: boolean; blocked: string | undefined; onDone: () => void }) {
  const [text, setText] = useState(start)
  const [empty, setEmpty] = useState(false)
  const send = () => {
    // A message with photos may be photos alone. Without them it needs words.
    if (!text.trim() && !hasPhotos) {
      setEmpty(true)
      return
    }
    onDone()
    void remote()
      .editAndResend(chatId, messageId, text)
      .then((outcome) => sayResendOutcome(outcome, chatId))
  }
  return (
    <Sheet
      title={S.message.editTitle}
      footer={
        <Button variant="primary" block onPress={send} disabled={blocked !== undefined} disabledReason={blocked} testid="m-remote-message-edit-send">
          {S.message.editSend}
        </Button>
      }
    >
      <div className="m-remote-sheet-form">
        <TextArea
          label={S.message.editField}
          hint={S.message.editHint}
          error={empty ? S.message.editEmpty : undefined}
          value={text}
          onChange={(next) => {
            setText(next)
            setEmpty(false)
          }}
          rows={5}
          maxLength={16000}
          autoFocus
          testid="m-remote-message-edit-text"
        />
      </div>
    </Sheet>
  )
}

export default function RemoteMessageSheet() {
  const sheet = useSheet<{ chatId?: string; messageId?: string } | undefined>()
  const chatId = sheet.props?.chatId ?? ''
  const messageId = sheet.props?.messageId ?? ''
  const chat = useRemote((s) => s.chats.find((c) => c.id === chatId))
  const status = useRemote((s) => s.status)
  const streaming = useRemote((s) => s.streamingChatId !== null)
  const connection = useRemote((s) => s.connection)
  const at = chat ? chat.messages.findIndex((m) => m.id === messageId) : -1
  const message = chat && at >= 0 ? chat.messages[at] : undefined

  if (!chat || !message) {
    return (
      <Sheet title={S.message.title}>
        <p className="m-remote-sheet-text" data-testid="m-remote-message-none">
          {S.message.none}
        </p>
      </Sheet>
    )
  }

  // Why the desktop cannot be asked again right now. A row that cannot work says so instead of doing nothing.
  const blocked = isForeignChat(chat, connection) ? S.message.whyForeign : streaming ? S.message.whyBusy : status !== 'connected' ? S.message.whyOffline : undefined

  if (sheet.sub === 'edit' && message.role === 'user') {
    return <EditForm chatId={chat.id} messageId={message.id} start={message.content} hasPhotos={!!message.images && message.images.length > 0} blocked={blocked} onDone={sheet.close} />
  }

  const copy = async () => {
    const ok = await copyText(message.content)
    sheet.close()
    toast(ok ? S.message.copied : S.message.copyFailed, { tone: ok ? 'default' : 'error', testid: ok ? 'remote-copied' : 'remote-copy-failed' })
  }

  const report = () => {
    // One sheet at a time: this one closes, the report sheet opens in its place.
    sheet.close()
    openReport({ kind: 'message', id: message.id, model: chat.model, source: 'local', excerpt: message.content })
  }

  const regenerate = () => {
    sheet.close()
    void remote()
      .regenerate(chat.id, message.id)
      .then((outcome) => sayResendOutcome(outcome, chat.id))
  }

  const isAnswer = message.role === 'assistant'
  // An answer can be made again when a question stands right before it.
  const canRegenerate = isAnswer && chat.messages[at - 1]?.role === 'user'
  const isLastAnswer = at === chat.messages.length - 1

  return (
    <Sheet title={S.message.title}>
      <ListGroup>
        {message.content ? <Row title={S.message.copy} icon={Copy} chevron={false} onPress={() => void copy()} testid="m-remote-message-copy" /> : null}
        {canRegenerate ? (
          <Row
            title={S.message.regenerate}
            subtitle={isLastAnswer ? S.message.regenerateSub : S.message.regenerateLaterSub}
            icon={RefreshCw}
            chevron={false}
            onPress={regenerate}
            disabled={blocked !== undefined}
            disabledReason={blocked}
            testid="m-remote-message-regenerate"
          />
        ) : null}
        {message.role === 'user' ? (
          <Row
            title={S.message.edit}
            subtitle={at === chat.messages.length - 1 ? undefined : S.message.editSub}
            icon={Pencil}
            onPress={() => sheet.pushSub('edit')}
            disabled={blocked !== undefined}
            disabledReason={blocked}
            testid="m-remote-message-edit"
          />
        ) : null}
        {isAnswer && storePolicy().reportContent ? <Row title={S.message.report} icon={Flag} chevron={false} onPress={report} testid="m-remote-message-report" /> : null}
      </ListGroup>
    </Sheet>
  )
}
