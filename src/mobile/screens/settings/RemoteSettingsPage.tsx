/**
 * E15 Remote desktop. Route /settings/remote, page, strand 5 (Account, cloud, settings).
 *
 * The state of the link to the user's own computer, and the three things one
 * does with it from Settings: connect or disconnect, read how it works, and
 * forget the desktop. Pairing, the code and the remote chats themselves are
 * pages of the remote strand; this page leads to them.
 */
import { useEffect, useState } from 'react'
import { Bell, HelpCircle, Link2, MessagesSquare, RefreshCw, Settings as SettingsIcon, Trash2, Unplug } from 'lucide-react'
import { REMOTE_STRINGS as RS } from '../../strings/remote'
import { askForNotices, noticeStatus, useRemoteNotices } from '../remote/parts/notices'
import { onLifecycle, openSystemSettings, type NotifyStatus } from '../../platform'
import { formatDate } from '../../../lib/formatters'
import { nav } from '../../nav'
import { connectionEverWorked, getRemoteClientStore, useRemoteClientStore } from '../../remote/remoteClientStore'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { Button, ListGroup, Notice, Page, Row, toast } from '../../ui'
import { Block, Hint } from './parts/layout'
import { remoteBoxText, remoteLine } from './parts/remote-view'

const T = SETTINGS_STRINGS.remote

export default function RemoteSettingsPage() {
  const liveStatus = useRemoteClientStore((s) => s.status)
  const liveConnection = useRemoteClientStore((s) => s.connection)
  // A desktop of this phone is one that worked at least once. An attempt that is running or that failed
  // ("took too long to answer") is not remembered and not shown here as one (check on the iPhone, round 22, N10).
  const connection = connectionEverWorked(liveConnection) ? liveConnection : null
  const status = connection ? liveStatus : 'unpaired'
  const address = connection?.address ?? ''
  const paired = !!connection
  // Paired over the sealed channel: "Disconnect" unpairs at the computer too.
  const sealed = !!connection?.pin
  const line = remoteLine(status, address)
  const actions = () => getRemoteClientStore().useStore.getState()

  const disconnect = async () => {
    await actions().disconnect()
    toast(sealed ? T.unpaired : T.disconnected, { testid: 'remote-disconnected' })
  }

  // "Try again" shows that it tries and says how it ended. A check that fails fast left the page exactly as it was (N15).
  const [retrying, setRetrying] = useState(false)
  const retry = async () => {
    if (retrying) return
    setRetrying(true)
    try {
      await actions().verifyConnection()
    } catch {
      /* the state of the store says what happened */
    } finally {
      setRetrying(false)
    }
    // Connected again is said by the box above. Still silent is said here, so the tap has an answer.
    if (actions().status === 'offline') toast(T.stillOffline(address || 'The desktop'), { tone: 'error', testid: 'remote-still-offline' })
  }

  // A17: notices of the computer while LU is not on the screen.
  // The switch is on only when the phone shows them: on in LU and allowed by the system.
  const noticesOn = useRemoteNotices((s) => s.on)
  const [permission, setPermission] = useState<NotifyStatus | null>(null)
  useEffect(() => {
    let alive = true
    const read = () => void noticeStatus().then((next) => alive && setPermission(next))
    read()
    // Back from the settings of the system: read again.
    const off = onLifecycle({ onForeground: read })
    return () => {
      alive = false
      off()
    }
  }, [])
  const allowed = permission === null || permission === 'granted' || permission === 'not-needed'
  const noticesShown = noticesOn && allowed
  const noticesDenied = noticesOn && permission === 'refused'
  const setNotices = async (on: boolean) => {
    useRemoteNotices.getState().setOn(on)
    // Turned on without the permission: the question of the system, where it may still come.
    if (on && permission === 'open') setPermission(await askForNotices())
  }
  const openSettings = async () => {
    const opened = await openSystemSettings()
    if (!opened.opened) toast(RS.notices.settingsFailed, { tone: 'error', testid: 'm-settings-remote-notices-settings-failed' })
  }

  const forget = async () => {
    const yes = await nav.confirm({ title: T.forgetQuestion, text: sealed ? T.forgetTextSealed : T.forgetText, confirmLabel: T.forgetConfirm, tone: 'danger', testid: 'remote-forget' })
    if (!yes) return
    await actions().forget()
    toast(T.forgotten, { testid: 'remote-forgotten' })
  }

  return (
    <Page title={T.title} screen="settings-remote">
      <Block lead>
        <Hint>{T.intro}</Hint>
      </Block>
      <div data-testid="m-settings-remote-state" data-state={status}>
        <Notice variant={line.tone} title={line.title} testid="m-settings-remote-status">
          {remoteBoxText(line, status, connection?.lastOkAt ? formatDate(connection.lastOkAt) : null)}
        </Notice>
      </div>

      <Block>
        {status === 'connected' ? (
          <>
            <Button variant="primary" block icon={MessagesSquare} onPress={() => nav.switchTab('chat')} testid="m-settings-remote-open-chats">
              {T.openChats}
            </Button>
            <Button block icon={Unplug} onPress={() => void disconnect()} risk="destructive" testid="m-settings-remote-disconnect" el="E15.1">
              {sealed ? T.unpair : T.disconnect}
            </Button>
          </>
        ) : status === 'offline' ? (
          <>
            <Button variant="primary" block icon={RefreshCw} busy={retrying} label={retrying ? T.retrying : undefined} onPress={() => void retry()} testid="m-settings-remote-retry">
              {T.retry}
            </Button>
            <Button block icon={Link2} onPress={() => nav.push('/remote/connect')} testid="m-settings-remote-connect" el="E15.1">
              {T.connect}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            block
            icon={Link2}
            busy={status === 'connecting' || status === 'pairing'}
            label={status === 'connecting' || status === 'pairing' ? T.stateConnecting : undefined}
            onPress={() => nav.push('/remote/connect')}
            testid="m-settings-remote-connect"
            el="E15.1"
          >
            {status === 'needs-code' ? T.enterCode : T.connect}
          </Button>
        )}
      </Block>

      <ListGroup testid="m-settings-remote-notices-group">
        <Row
          icon={Bell}
          title={RS.notices.setting}
          subtitle={RS.notices.settingSub}
          switch={{ checked: noticesShown, onChange: (on: boolean) => void setNotices(on) }}
          testid="m-settings-remote-notices"
        />
      </ListGroup>
      <Block>
        {noticesDenied ? (
          <div data-testid="m-settings-remote-notices-denied">
            <Hint>{RS.notices.denied}</Hint>
            <Button block icon={SettingsIcon} onPress={() => void openSettings()} risk="leaves-app" testid="m-settings-remote-notices-open-settings">
              {RS.notices.openSettings}
            </Button>
          </div>
        ) : (
          <Hint>{RS.notices.settingLimit}</Hint>
        )}
      </Block>

      <ListGroup>
        <Row icon={HelpCircle} title={T.how} onPress={() => nav.push('/remote/help')} testid="m-settings-remote-how" el="E15.2" />
        {paired ? <Row icon={Trash2} title={T.forget} danger chevron={false} onPress={() => void forget()} risk="destructive" testid="m-settings-remote-forget-delete" el="E15.3" /> : null}
      </ListGroup>
    </Page>
  )
}
