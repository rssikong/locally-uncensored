/**
 * The connection to the desktop in detail. Sheet "remote-connection",
 * strand 6: computer name (when the desktop sends one), address, way, version, paired since, what the desktop allows
 * (read only, it is changed there), and the two ways to end it.
 */
import { REMOTE_STRINGS as S } from '../../strings/remote'
import { Button, ListGroup, Row, Sheet } from '../../ui'
import { nav } from '../../nav'
import { disconnectAfterAsking, forgetAfterAsking } from './parts/actions'
import { useRemote } from './parts/session'
import { routeLabel } from './parts/view'
import './parts/remote.css'

function when(at: number | null): string {
  if (!at) return S.connection.notPaired
  return new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function RemoteConnectionSheet() {
  const connection = useRemote((s) => s.connection)
  const status = useRemote((s) => s.status)
  const permissions = useRemote((s) => s.permissions)
  const hasToken = useRemote((s) => s.token !== '')

  if (!connection) {
    return (
      <Sheet title={S.connection.title}>
        <p className="m-remote-sheet-text" data-testid="m-remote-connection-none">
          {S.connection.none}
        </p>
      </Sheet>
    )
  }

  const allowed = (on: boolean | undefined) => (on ? S.connection.allowed : S.connection.notAllowed)
  const end = async (how: () => Promise<boolean>) => {
    if (await how()) nav.closeSheet()
  }

  return (
    <Sheet title={S.connection.title}>
      <ListGroup testid="m-remote-connection-facts">
        {connection.hostName ? <Row title={S.connection.name} value={connection.hostName} testid="m-remote-connection-name" /> : null}
        <Row title={S.connection.address} value={connection.address} testid="m-remote-connection-address" />
        <Row title={S.connection.status} value={S.status[status]} testid="m-remote-connection-status" />
        <Row title={S.connection.route} value={routeLabel(connection.route)} />
        <Row title={S.connection.version} value={connection.serverVersion || S.connection.versionUnknown} />
        <Row title={S.connection.pairedSince} value={when(hasToken ? connection.pairedAt : null)} />
      </ListGroup>
      <p className="m-remote-sheet-text">{connection.secure ? S.connection.secure : S.connection.insecure}</p>
      {permissions ? (
        <>
          <ListGroup title={S.connection.permissionsTitle} testid="m-remote-connection-permissions">
            <Row title={S.connection.filesystem} value={allowed(permissions.filesystem)} />
            <Row title={S.connection.shell} value={allowed(permissions.shell)} />
            <Row title={S.connection.downloads} value={allowed(permissions.downloads)} />
            <Row title={S.connection.processControl} value={allowed(permissions.process_control)} />
          </ListGroup>
          <p className="m-remote-sheet-text">{S.connection.permissionsHint}</p>
        </>
      ) : null}
      <div className="m-remote-sheet-actions">
        {hasToken ? (
          <Button risk="destructive" block variant="danger" onPress={() => void end(disconnectAfterAsking)} testid="m-remote-connection-disconnect">
            {S.home.disconnect}
          </Button>
        ) : null}
        <Button risk="destructive" block variant="danger" onPress={() => void end(forgetAfterAsking)} testid="m-remote-connection-forget">
          {S.home.forget}
        </Button>
      </div>
    </Sheet>
  )
}
