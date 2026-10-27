/**
 * R5 How it works. Route /remote/help, page, strand 6 (Remote and resilience).
 *
 * From mobile-docs/design/DESIGN.md (German, element texts in English):
 *
 *   **R5 How it works** (`/remote/help`)
 *   Reiner Text in drei Abschnitten (What it does, How to connect, What stays private), aus Sicht des Handys
 *   geschrieben. Element: R5.1 "Connect now" fuehrt zu R1.
 *
 * "Connect now" goes back when the page under this one already is a place
 * to connect from (R1 in the chat list, or R2). From anywhere else, the
 * settings for example, it opens R2: R1 is a segment of the chat list and
 * cannot be opened from outside (mobile-docs/geruest-wuensche/remote.md).
 */
import { nav, showChatsSegment, useChatsSegment } from '../../nav'
import { REMOTE_STRINGS as S } from '../../strings/remote'
import { Button, Page } from '../../ui'
import { routeBelowTop } from './parts/actions'
import { useScanSupport } from './parts/useScanSupport'
import './parts/remote.css'

const CONNECT_PLACES = new Set(['/chats', '/remote/connect'])

function Section({ title, lines }: { title: string; lines: readonly string[] }) {
  return (
    <section>
      <h2>{title}</h2>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </section>
  )
}

export default function RemoteHelpPage() {
  const connectNow = () => {
    const below = routeBelowTop()
    if (below === '/chats') {
      // R1 is the segment "Remote desktop" of the chat list right under this page.
      useChatsSegment.getState().setSegment('remote')
      void nav.back()
    } else if (below && CONNECT_PLACES.has(below)) void nav.back()
    else showChatsSegment('remote')
  }
  // A phone that cannot scan inside LU is not told to scan.
  const scan = useScanSupport()
  return (
    <Page
      title={S.help.title}
      screen="remote-help"
      flush
      footer={
        <Button variant="primary" block onPress={connectNow} testid="m-remote-help-connect" el="R5.1">
          {S.help.connectNow}
        </Button>
      }
    >
      <div className="m-remote-help" data-testid="m-remote-help-text">
        <Section title={S.help.whatTitle} lines={S.help.what} />
        <Section title={S.help.howTitle} lines={scan === 'none' ? S.help.how.map((line, index) => (index === 1 ? S.help.howTypeAddress : line)) : S.help.how} />
        <Section title={S.help.privateTitle} lines={S.help.private} />
      </div>
    </Page>
  )
}
