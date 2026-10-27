/**
 * C6.6 Select text. Route /chat/:id/message/:messageId/text, page, strand 1.
 * The message as plain text that can be marked with the handles of the
 * system, which the transcript does not allow because a long press there
 * opens the sheet.
 */
import { Copy } from 'lucide-react'
import { useChatStore } from '../../../stores/chatStore'
import { nav, useParams } from '../../nav'
import { CHAT_STRINGS } from '../../strings/chat'
import { Button, EmptyState, IconButton, Page, toast } from '../../ui'
import { copyText } from './parts/adapters/handover'
import './parts/chat.css'
import { messageText } from './parts/logic/messages'

const S = CHAT_STRINGS

export default function MessageTextPage() {
  const { id, messageId } = useParams<{ id: string; messageId: string }>()
  const message = useChatStore((s) => s.conversations.find((c) => c.id === id)?.messages.find((m) => m.id === messageId))
  const text = message ? messageText(message) : ''

  const copyAll = () => {
    void copyText(text).then((ok) => {
      if (ok) toast(S.actions.copied, { testid: 'copied' })
      else toast(S.actions.copyFailed, { tone: 'error', testid: 'copy-failed' })
    })
  }

  return (
    <Page title={S.text.title} screen="chat-message-text" flush actions={message ? <IconButton icon={Copy} label={S.text.copyAll} onPress={copyAll} testid="m-chat-text-copy" /> : undefined}>
      {message ? (
        <div className="m-chat-page-pad">
          <p className="m-cap">{S.text.hint}</p>
          <div className="m-chat-select" data-testid="m-chat-text-body" tabIndex={0}>
            {text}
          </div>
        </div>
      ) : (
        <EmptyState
          title={S.text.gone}
          testid="m-chat-text-gone"
          actions={
            <Button variant="primary" onPress={() => void nav.back()} testid="m-chat-text-back">
              {S.chat.backToChats}
            </Button>
          }
        />
      )}
    </Page>
  )
}
