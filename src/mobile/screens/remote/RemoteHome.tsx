/**
 * SLOT in C1, filled by strand 6 (Remote and resilience).
 *
 * R1 Remote desktop is not a route. It is the second segment of /chats
 * ("On this phone" / "Remote desktop", C1.2). Strand 1 renders
 * <RemoteHome /> in the list area while that segment is chosen.
 *
 * From mobile-docs/design/DESIGN.md:
 *
 *   **R1 Remote desktop** (Segment in `/chats`)
 *   Zweck: Das Handy als Client eines Desktop-LU.
 *   Elemente:
 *   - R1.1 "Scan QR code": oeffnet R3.
 *   - R1.2 "Enter address and passcode": oeffnet R2.
 *   - R1.3 "How it works": oeffnet R5.
 *   - R1.4 (verbunden) Kopfzeile "Connected to <Name>" mit "Disconnect": trennt nach Rueckfrage.
 *   - R1.5 (verbunden) Remote-Chat-Zeile: oeffnet R4.
 *   - R1.6 (verbunden) "New remote chat": oeffnet R4 leer.
 *   Zustaende: Nicht verbunden: Erklaerung und R1.1 bis R1.3. Verbinden: "Connecting to <Adresse>". Desktop
 *   nicht erreichbar: "Could not reach your desktop. Is LU open there, and are both devices on the same
 *   network?" mit "Try again" und "Enter address and passcode". Passcode abgelehnt: "That passcode did not
 *   match." Sitzung beendet (Desktop hat neu gestartet): "The desktop ended the session. Scan the new code."
 *   Die Remote-Chats bleiben lesbar.
 *
 * The sentences for "not reachable", "wrong code" and "session ended" are
 * the ones of the logic layer (remote/remoteErrors.ts), which name the next
 * step; REMOTE-PROTOKOLL.md section 10 asks the screens not to invent others.
 */
import { useEffect, useState } from 'react'
import { CircleHelp, Info, KeyRound, ListTodo, Loader, MessageSquare, Monitor, MoreHorizontal, Plus, QrCode, X } from 'lucide-react'
import { FEATURE_TASKS, sharesChats } from '../../remote/sharedChats'
import { refreshSharedList, useSharedChats } from '../../remote/sharedChatStore'
import { ConnectionLine } from './parts/ConnectionLine'
import { nav } from '../../nav'
import { offerRemoteNotices } from './parts/notices'
import { REMOTE_STRINGS as S } from '../../strings/remote'
import { Button, EmptyState, IconButton, ListGroup, Row, SkeletonRows, Sparse } from '../../ui'
import { disconnectAfterAsking, openNewRemoteChat, openRemoteChat } from './parts/actions'
import { ConnectionNotice } from './parts/ConnectionNotice'
import { forgetKnownDesktop, type KnownDesktop } from './parts/knownDesktops'
import { remote, setConnectDraft, useKnownDesktops, useRemote } from './parts/session'
import { useScanSupport } from './parts/useScanSupport'
import { chatDesktopName, remoteModelLabel, chatPreview, connectedSubline, desktopName, groupChatsByDesktop, relativeTime, routeLabel } from './parts/view'
import './parts/remote.css'

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(timer)
  }, [everyMs])
  return now
}

function ChatList({ readOnly }: { readOnly: boolean }) {
  const chats = useRemote((s) => s.chats)
  const streamingChatId = useRemote((s) => s.streamingChatId)
  const connection = useRemote((s) => s.connection)
  const known = useKnownDesktops()
  const now = useNow(60_000)
  // A blank chat is a place to write into, not something to find again.
  const groups = groupChatsByDesktop(chats, connection?.baseUrl ?? null)
  if (groups.length === 0) return null
  // One desktop only, as before round 2: the plain title. Several: each group names its desktop.
  const single = groups.length === 1 && (groups[0].current || groups[0].baseUrl === null)
  return (
    <>
      {groups.map((group, index) => (
        <ListGroup
          key={group.baseUrl ?? 'none'}
          title={single ? S.home.chatsTitle : S.home.chatsOn(chatDesktopName(group.baseUrl, connection, known)) }
          testid={index === 0 ? 'm-remote-chats' : `m-remote-chats-${index}`}
          flat
        >
          {group.chats.map((chat) => (
            <Row
              key={chat.id}
              title={chat.title}
              icon={MessageSquare}
              subtitle={
                <>
                  <span className="m-remote-row-sub">{streamingChatId === chat.id ? S.home.answering : chatPreview(chat)}</span>
                  <span className="m-mono m-t3">{[remoteModelLabel(chat.model), relativeTime(chat.updatedAt, now)].filter(Boolean).join(', ')}</span>
                </>
              }
              chevron={false}
              onPress={() => openRemoteChat(chat.id)}
              trailing={
                <IconButton
                  icon={MoreHorizontal}
                  label={S.home.moreFor(chat.title)}
                  onPress={() => nav.openSheet('remote-chat-menu', { chatId: chat.id })}
                  testid={`m-remote-chat-more-${chat.id}`}
                />
              }
              testid={`m-remote-chat-row-${chat.id}`}
              el="R1.5"
            />
          ))}
        </ListGroup>
      ))}
      {readOnly ? <p className="m-remote-note">{S.home.chatsOfflineNote}</p> : groups.some((g) => !g.current && g.baseUrl !== null) ? <p className="m-remote-note" data-testid="m-remote-chats-other-note">{S.home.chatsOtherNote}</p> : null}
    </>
  )
}

/** A17: the shared chats of the computer (CHATS-V1), newest first, with "Working" and the number of new messages. */
function SharedList() {
  const list = useSharedChats((s) => s.list)
  const state = useSharedChats((s) => s.listState)
  const error = useSharedChats((s) => s.listError)
  const now = useNow(60_000)
  useEffect(() => {
    void refreshSharedList()
    // The list follows the computer while it is in sight: a chat shared there shows up here.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSharedList()
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [])
  if (state === 'loading' && list.length === 0) return <SkeletonRows rows={2} label={S.shared.loading} testid="m-remote-shared-list-loading" />
  if (state === 'error' && list.length === 0) {
    return (
      <EmptyState title={S.shared.listError} icon={Monitor} testid="m-remote-shared-list-error" actions={<Button onPress={() => void refreshSharedList()} testid="m-remote-shared-list-retry">{S.shared.tryAgain}</Button>}>
        {error}
      </EmptyState>
    )
  }
  if (list.length === 0) {
    return (
      <EmptyState title={S.shared.listEmptyTitle} icon={MessageSquare} testid="m-remote-shared-list-empty">
        {S.shared.listEmptyText}
      </EmptyState>
    )
  }
  return (
    <ListGroup title={S.shared.listTitle} testid="m-remote-shared-list" flat>
      {list.map((chat) => (
        <Row
          key={chat.id}
          title={chat.title}
          icon={chat.busy ? Loader : MessageSquare}
          subtitle={
            <span className="m-mono m-t3">
              {[chat.busy ? S.shared.working : S.shared.mode[chat.mode], remoteModelLabel(chat.model), chat.updatedAt ? relativeTime(chat.updatedAt, now) : ''].filter(Boolean).join(', ')}
            </span>
          }
          chevron={false}
          onPress={() => nav.push('/remote/shared/:id', { id: chat.id })}
          trailing={
            chat.unread > 0 ? (
              <span className="m-remote-badge" aria-label={S.shared.unreadLabel(chat.unread)} data-testid="m-remote-shared-unread">
                {chat.unread}
              </span>
            ) : undefined
          }
          testid="m-remote-shared-row"
        />
      ))}
    </ListGroup>
  )
}

function KnownList({ desktops }: { desktops: KnownDesktop[] }) {
  const now = useNow(60_000)
  if (desktops.length === 0) return null

  const use = (desktop: KnownDesktop) => {
    // The address is known, the code is not: the connect page checks the desktop and asks for it.
    setConnectDraft(desktop.address)
    void remote().connect(desktop.baseUrl)
    nav.push('/remote/connect')
  }
  const remove = async (desktop: KnownDesktop) => {
    const yes = await nav.confirm({
      title: S.home.knownRemoveQuestion(desktop.name || desktop.address),
      text: S.home.knownRemoveText,
      confirmLabel: S.home.remove,
      tone: 'danger',
      testid: 'remote-known-remove',
    })
    if (yes) forgetKnownDesktop(desktop.baseUrl)
  }

  return (
    <ListGroup title={S.home.knownTitle} testid="m-remote-known" flat>
      {desktops.map((desktop, index) => (
        <Row
          key={desktop.baseUrl}
          title={desktop.name || desktop.address}
          icon={Monitor}
          subtitle={
            <>
              {desktop.name ? <span className="m-mono m-t3">{desktop.address}</span> : null}
              <span>{desktop.route === 'tunnel' ? S.home.knownTunnelSub : S.home.knownSub(routeLabel(desktop.route), relativeTime(desktop.lastConnectedAt, now))}</span>
            </>
          }
          chevron={false}
          onPress={() => use(desktop)}
          trailing={
            <IconButton risk="destructive" icon={X} label={S.home.knownRemove(desktop.name || desktop.address)} onPress={() => void remove(desktop)} testid={`m-remote-known-remove-${index}`} />
          }
          testid={`m-remote-known-${index}`}
        />
      ))}
    </ListGroup>
  )
}

function Intro() {
  const scan = useScanSupport()
  const canScan = scan === 'native' || scan === 'web'
  return (
    <>
      <div className="m-remote-intro" data-testid="m-remote-intro">
        <h2>{S.home.introTitle}</h2>
        <p>{S.home.introText}</p>
        <ol className="m-remote-steps" aria-label={S.home.stepsLabel}>
          {S.home.steps.map((step, index) => {
            // A phone that cannot scan inside LU is not told to scan.
            const text = index === 1 && scan === 'none' ? S.home.stepTypeAddress : step
            return <li key={step}>{text}</li>
          })}
        </ol>
      </div>
      <div className="m-remote-actions">
        {canScan ? (
          <Button variant="primary" block icon={QrCode} onPress={() => nav.push('/remote/scan')} risk="sensor" testid="m-remote-scan" el="R1.1">
            {S.home.scan}
          </Button>
        ) : null}
        {/* Without a scanner, typing is the main way and gets the filled button. */}
        <Button variant={scan === 'none' ? 'primary' : 'default'} block icon={KeyRound} onPress={() => nav.push('/remote/connect')} testid="m-remote-enter" el="R1.2">
          {S.home.enter}
        </Button>
        <Button variant="quiet" block icon={CircleHelp} onPress={() => nav.push('/remote/help')} testid="m-remote-help" el="R1.3">
          {S.home.help}
        </Button>
      </div>
    </>
  )
}

function Connected() {
  const connection = useRemote((s) => s.connection)
  const chats = useRemote((s) => s.chats)
  const features = useRemote((s) => s.features)
  // The first time the computer is there: once "Get notified when your computer is done?".
  // A moment later: the connect page leaves first, and "Connected" is seen before the question.
  useEffect(() => {
    const timer = window.setTimeout(() => void offerRemoteNotices(nav.confirm), 900)
    return () => window.clearTimeout(timer)
  }, [])
  const name = desktopName(connection)
  const sub = connectedSubline(connection)
  const hasChats = chats.some((chat) => chat.messages.length > 0)
  // A17: a computer that shares its chats. The chat runs there; the phone shows it.
  const shared = sharesChats(features)

  if (shared) {
    return (
      <>
        <ConnectionLine />
        <div className="m-remote-connected" data-testid="m-remote-connected" data-el="R1.4">
          <div className="m-remote-connected-text">
            <span className="m-remote-connected-name">
              <i className="m-remote-dot" aria-hidden="true" />
              {S.home.connectedTo(name)}
            </span>
            {sub ? <span className="m-cap m-mono" data-testid="m-remote-connected-sub">{sub}</span> : null}
          </div>
          <IconButton icon={Info} label={S.home.details} onPress={() => nav.openSheet('remote-connection')} testid="m-remote-details" />
          <Button risk="destructive" compact variant="danger" onPress={() => void disconnectAfterAsking()} testid="m-remote-disconnect" el="R1.4">
            {S.home.disconnect}
          </Button>
        </div>
        <div className="m-remote-actions">
          <Button variant="primary" block icon={Plus} onPress={() => nav.openSheet('remote-new-shared')} testid="m-remote-new-shared" el="R1.6">
            {S.shared.newChat}
          </Button>
          {features.includes(FEATURE_TASKS) ? (
            <Button block icon={ListTodo} onPress={() => nav.openSheet('remote-tasks')} testid="m-remote-tasks-open">
              {S.shared.tasks}
            </Button>
          ) : null}
        </div>
        <SharedList />
        {hasChats ? <ChatList readOnly={false} /> : null}
      </>
    )
  }

  return (
    <>
      <div className="m-remote-connected" data-testid="m-remote-connected" data-el="R1.4">
        <div className="m-remote-connected-text">
          <span className="m-remote-connected-name">
            <i className="m-remote-dot" aria-hidden="true" />
            {S.home.connectedTo(name)}
          </span>
          {sub ? <span className="m-cap m-mono" data-testid="m-remote-connected-sub">{sub}</span> : null}
          <span className="m-cap">{S.home.connectedSub(connection ? routeLabel(connection.route) : '', connection?.serverVersion ?? '')}</span>
        </div>
        <IconButton icon={Info} label={S.home.details} onPress={() => nav.openSheet('remote-connection')} testid="m-remote-details" />
        <Button risk="destructive" compact variant="danger" onPress={() => void disconnectAfterAsking()} testid="m-remote-disconnect" el="R1.4">
          {S.home.disconnect}
        </Button>
      </div>
      <div className="m-remote-actions">
        <Button variant="primary" block icon={Plus} onPress={openNewRemoteChat} testid="m-remote-new-chat" el="R1.6">
          {S.home.newChat}
        </Button>
      </div>
      {hasChats ? (
        <ChatList readOnly={false} />
      ) : (
        <EmptyState title={S.home.chatsEmptyTitle} icon={MessageSquare} testid="m-remote-chats-empty">
          {S.home.chatsEmptyText}
        </EmptyState>
      )}
    </>
  )
}

export function RemoteHome() {
  const hydrated = useRemote((s) => s.hydrated)
  const status = useRemote((s) => s.status)
  const known = useKnownDesktops()
  const connection = useRemote((s) => s.connection)
  const chats = useRemote((s) => s.chats)

  let body
  if (!hydrated) {
    body = <SkeletonRows rows={3} label={S.home.loading} testid="m-remote-loading" />
  } else if (status === 'connected') {
    body = <Connected />
  } else {
    // Every desktop but the one the notice above is already about.
    const others = known.filter((desktop) => desktop.baseUrl !== connection?.baseUrl)
    const desktops = status === 'unpaired' ? known : others
    const parts = (
      <>
        <ConnectionLine />
        <ConnectionNotice where="home" />
        {status === 'unpaired' ? <Intro /> : null}
        <KnownList desktops={desktops} />
        <ChatList readOnly />
        {status === 'unpaired' ? null : (
          <div className="m-remote-actions">
            <Button variant="quiet" block icon={CircleHelp} onPress={() => nav.push('/remote/help')} testid="m-remote-help" el="R1.3">
              {S.home.help}
            </Button>
          </div>
        )}
      </>
    )
    // Nothing but the explanation, or the notice, and the buttons: that stands in the middle of the room. With a list
    // of desktops or of chats the page is a list and starts at the top.
    const lists = desktops.length > 0 || groupChatsByDesktop(chats, connection?.baseUrl ?? null).length > 0
    body = lists ? parts : <Sparse testid="m-remote-middle">{parts}</Sparse>
  }

  return (
    <div className="m-remote-home" data-m-sparse-box="" data-testid="m-remote-screen" data-el="R1" data-m-status={hydrated ? status : 'loading'}>
      {body}
    </div>
  )
}
