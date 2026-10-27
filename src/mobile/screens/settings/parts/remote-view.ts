/** What the state box of E15 says for each state of the remote link. Pure. */
import { SETTINGS_STRINGS } from '../../../strings/settings'

const T = SETTINGS_STRINGS.remote

export interface RemoteLine {
  title: string
  /** The next step for this state. Never the introduction of the page a second time (N19). */
  text: string
  tone: 'info' | 'warn' | 'error'
}

export function remoteLine(status: string, address: string): RemoteLine {
  const name = address || 'the desktop'
  switch (status) {
    case 'connected':
      return { title: T.stateConnected(name), text: T.stepConnected, tone: 'info' }
    case 'connecting':
    case 'pairing':
      return { title: T.stateConnecting, text: address, tone: 'info' }
    case 'needs-code':
      return { title: T.stateNeedsCode(name), text: T.stepNeedsCode, tone: 'warn' }
    case 'offline':
      return { title: T.stateOffline(name), text: T.stepOffline, tone: 'warn' }
    case 'blocked':
      return { title: T.stateBlocked(name), text: T.stepBlocked, tone: 'error' }
    default:
      return address ? { title: T.statePaired(name), text: T.stepPaired, tone: 'info' } : { title: T.stateOff, text: T.stateOffText, tone: 'info' }
  }
}

/** Pure: the sentence of the box, with the time the desktop was last reached where that is known and says something. */
export function remoteBoxText(line: RemoteLine, status: string, lastReached: string | null): string {
  const showsLast = lastReached && status !== 'connecting' && status !== 'pairing'
  return [line.text, showsLast ? `${T.lastSeen(lastReached)}.` : ''].filter(Boolean).join(' ')
}
