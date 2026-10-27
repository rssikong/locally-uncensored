/**
 * "Open link?" (C2.34). Sheet "chat-link", opened with { url } when a link
 * in an answer is tapped. It shows the whole address before anything leaves
 * the app; a model can write any address under any words.
 */
import { nav, useSheet } from '../../nav'
import { copyText, isAllowedExternalUrl, openExternal } from '../../platform'
import { CHAT_STRINGS } from '../../strings/chat'
import { Button, Notice, Sheet, toast } from '../../ui'
import './parts/chat.css'

const S = CHAT_STRINGS.link

export default function LinkSheet() {
  const sheet = useSheet<{ url?: string } | undefined>()
  const url = sheet.props?.url ?? ''
  const allowed = isAllowedExternalUrl(url)

  const open = () => {
    void openExternal(url).then((result) => {
      if (result.opened) nav.closeSheet()
      else toast(result.reason === 'blocked' ? S.blocked : S.failed, { tone: 'error', testid: 'link-failed' })
    })
  }
  const copy = () => {
    void copyText(url).then((ok) => {
      if (ok) {
        toast(S.copied, { testid: 'copied' })
        nav.closeSheet()
      } else {
        toast(CHAT_STRINGS.actions.copyFailed, { tone: 'error', testid: 'copy-failed' })
      }
    })
  }

  return (
    <Sheet
      title={S.title}
      footer={
        <div className="m-chat-stack">
          <Button variant="primary" block disabled={!allowed} disabledReason={S.blocked} onPress={open} risk="leaves-app" testid="m-chat-link-open">
            {S.open}
          </Button>
          <Button block disabled={!url} onPress={copy} testid="m-chat-link-copy">
            {S.copy}
          </Button>
          <Button variant="quiet" block onPress={() => sheet.close()} testid="m-chat-link-cancel">
            {S.cancel}
          </Button>
        </div>
      }
    >
      {url ? (
        <p className="m-chat-url" data-testid="m-chat-link-url">
          {url}
        </p>
      ) : (
        <Notice variant="info" testid="m-chat-link-empty">
          {S.blocked}
        </Notice>
      )}
    </Sheet>
  )
}
