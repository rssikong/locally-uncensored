/**
 * What the connection to the desktop is doing right now, with the next
 * step. Shown on R1 (with the list of things to check) and above the
 * transcript of R4 (short). While everything is fine it renders nothing.
 *
 * The sentences about a failure come ready from the logic layer
 * (state.error.message); this component adds the title and the buttons.
 */
import { Link2Off, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react'
import { nav } from '../../../nav'
import { mobileOS } from '../../../platform/detect'
import { isOnline } from '../../../platform/network'
import { REMOTE_STRINGS as S } from '../../../strings/remote'
import { Button, Notice } from '../../../ui'
import { forgetAfterAsking } from './actions'
import { useRemote } from './session'
import { useScanSupport } from './useScanSupport'
import { desktopName, shownError, unreachableChecks } from './view'

export function ChecksList({ items, testid }: { items: readonly string[]; testid?: string }) {
  if (items.length === 0) return null
  return (
    <>
      <span className="m-remote-checks-title">{S.home.whatToCheck}</span>
      <ul className="m-remote-checks" data-testid={testid}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  )
}

export function ConnectionNotice({ where }: { where: 'home' | 'chat' }) {
  const status = useRemote((s) => s.status)
  const error = useRemote((s) => s.error)
  const connection = useRemote((s) => s.connection)
  const hydrated = useRemote((s) => s.hydrated)
  const verify = useRemote((s) => s.verifyConnection)
  const scan = useScanSupport()
  const name = desktopName(connection)
  const id = `m-remote-${where}`
  const canScan = scan === 'native' || scan === 'web'

  if (!hydrated || status === 'connected') return null

  if (status === 'unpaired') {
    if (where === 'home') return null
    return (
      <Notice
        title={S.chat.unpairedTitle}
        icon={Link2Off}
        testid={`${id}-unpaired`}
        actions={
          <Button compact variant="primary" onPress={() => nav.push('/remote/connect')} testid={`${id}-connect`}>
            {S.chat.connect}
          </Button>
        }
      >
        {S.chat.unpairedText}
      </Notice>
    )
  }

  if (status === 'connecting' || status === 'pairing') {
    return (
      <Notice title={status === 'pairing' ? S.home.pairing(name) : S.home.connecting(name)} icon={RefreshCw} testid={`${id}-connecting`}>
        {S.home.connectingText}
      </Notice>
    )
  }

  if (status === 'needs-code') {
    const ended = error?.code === 'session-expired'
    return (
      <Notice
        variant={error ? 'error' : 'info'}
        title={ended ? S.home.sessionEndedTitle : S.home.needsCodeTitle}
        testid={`${id}-needs-code`}
        actions={
          <>
            {error?.code === 'open-pairing' ? (
              // H1: the computer names itself only while its pairing panel is open. Read it again.
              <Button compact variant="primary" onPress={() => void verify()} testid={`${id}-retry`}>
                {S.home.tryAgain}
              </Button>
            ) : (
              <Button compact variant="primary" onPress={() => nav.push('/remote/connect')} testid={`${id}-enter-code`}>
                {S.home.enterCode}
              </Button>
            )}
            {where === 'home' ? (
              <Button risk="destructive" compact variant="danger" onPress={() => void forgetAfterAsking()} testid={`${id}-forget`}>
                {S.home.forget}
              </Button>
            ) : null}
          </>
        }
      >
        {error?.message ?? S.home.needsCodeText(name)}
      </Notice>
    )
  }

  if (status === 'blocked') {
    return (
      <Notice
        variant="error"
        icon={ShieldAlert}
        title={S.home.blockedTitle}
        testid={`${id}-blocked`}
        actions={
          <Button compact variant="primary" onPress={() => void verify()} testid={`${id}-retry`}>
            {S.home.tryAgainAfterRestart}
          </Button>
        }
      >
        {error?.message}
      </Notice>
    )
  }

  // offline
  const viaLink = connection?.route === 'tunnel' || connection?.route === 'public'
  // Round 57: a new desktop on Wi-Fi that does not answer most likely has no pairing panel open.
  const openPairing = shownError(error, connection)?.code === 'open-pairing'
  return (
    <Notice
      variant="error"
      icon={WifiOff}
      title={openPairing ? undefined : where === 'chat' ? S.chat.connectionLostTitle : S.home.unreachableTitle}
      testid={`${id}-offline`}
      actions={
        <>
          <Button compact variant="primary" onPress={() => void verify()} testid={`${id}-retry`}>
            {where === 'chat' ? S.chat.reconnect : S.home.tryAgain}
          </Button>
          {viaLink && canScan ? (
            <Button compact onPress={() => nav.push('/remote/scan')} risk="sensor" testid={`${id}-scan-new`}>
              {S.home.scanNew}
            </Button>
          ) : (
            <Button compact onPress={() => nav.push('/remote/connect')} testid={`${id}-enter`}>
              {S.home.enter}
            </Button>
          )}
        </>
      }
    >
      {shownError(error, connection)?.message}
      {where === 'home' ? (
        <ChecksList items={unreachableChecks({ route: connection?.route ?? null, os: mobileOS(), deviceOnline: isOnline() })} testid="m-remote-home-checks" />
      ) : null}
    </Notice>
  )
}
