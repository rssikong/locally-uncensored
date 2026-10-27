/**
 * A17: one line above the remote pages that says how the phone reaches the
 * computer: on Wi-Fi, over the internet, reconnecting, or not reachable
 * (asleep or LU closed). Reconnecting runs by itself (remote/reconnect.ts);
 * "Try now" only skips the wait.
 */
import { LINE_TEXT, connectionLine, useReconnect } from '../../../remote/reconnect'
import { REMOTE_STRINGS as S } from '../../../strings/remote'
import { Button, Spinner } from '../../../ui'
import { remote, useRemote } from './session'

export function ConnectionLine() {
  const status = useRemote((s) => s.status)
  const connection = useRemote((s) => s.connection)
  const attempts = useReconnect((s) => s.attempts)
  const lanBlocked = useRemote((s) => s.lanBlocked)
  const kind = connectionLine({ status, connection, attempts })
  if (!kind) return null
  return (
    <div className="m-remote-line" role="status" aria-label={S.line.label} data-testid="m-remote-line" data-state={kind}>
      {kind === 'reconnecting' ? <Spinner label={LINE_TEXT.reconnecting} /> : <i className="m-remote-dot" data-state={kind} aria-hidden="true" />}
      <span className="m-grow">
        <span data-testid="m-remote-line-text">{LINE_TEXT[kind]}</span>
        {/* The computer's Wi-Fi is blocked (its firewall): the phone came over the internet instead. */}
        {kind === 'internet' && lanBlocked ? (
          <span className="m-cap m-remote-line-hint" data-testid="m-remote-line-lan-blocked">
            {S.line.lanBlocked}
          </span>
        ) : null}
      </span>
      {kind === 'unreachable' ? (
        <Button compact onPress={() => void remote().verifyConnection()} testid="m-remote-line-retry">
          {S.line.retryNow}
        </Button>
      ) : null}
    </div>
  )
}
