/**
 * The steps several remote screens share: open a chat, leave the connect
 * page for the right place, end a session after asking.
 */
import { sharesChats } from '../../../remote/sharedChats'
import type { SendOutcome } from '../../../remote/remoteClientStore'
import { nav } from '../../../nav'
import { REMOTE_STRINGS as S } from '../../../strings/remote'
import { toast } from '../../../ui/Toast'
import { forgetKnownDesktop } from './knownDesktops'
import { remote } from './session'
import { desktopName, reusableEmptyChat } from './view'

/** The route of the page under the visible one, or null at a root. */
export function routeBelowTop(): string | null {
  const state = nav.getState()
  const stack = state.flow ? state.flowStack : state.stacks[state.tab]
  return stack.length >= 2 ? stack[stack.length - 2].route : null
}

/** A chat to write into: the empty one that is already there, or a new one. */
export function freshChatId(): string {
  const state = remote()
  const empty = reusableEmptyChat(state.chats, state.connection?.baseUrl ?? null)
  if (empty) {
    state.selectChat(empty.id)
    return empty.id
  }
  return state.newChat()
}

export function openRemoteChat(id: string): void {
  remote().selectChat(id)
  nav.push('/remote/chat/:id', { id })
}

export function openNewRemoteChat(): void {
  nav.push('/remote/chat/:id', { id: freshChatId() })
}

/**
 * The pairing worked. Coming from a chat (a session that ran out in the
 * middle of it) the way leads back into that chat; from anywhere else into a
 * fresh chat, with the list one step back.
 */
export function leaveConnectPageConnected(): void {
  const name = desktopName(remote().connection)
  toast(S.connect.connected(name), { testid: 'remote-connected' })
  if (routeBelowTop() === '/remote/chat/:id') {
    nav.back()
    return
  }
  // A17: a computer that shares its chats leads to their list (Remote desktop), not to a chat on the phone.
  if (sharesChats(remote().features)) {
    nav.back()
    return
  }
  nav.replace('/remote/chat/:id', { id: freshChatId() })
}

/** Ask, then end the session. The address stays, the chats stay. */
export async function disconnectAfterAsking(): Promise<boolean> {
  const name = desktopName(remote().connection)
  const yes = await nav.confirm({
    title: S.home.disconnectQuestion(name),
    text: S.home.disconnectText,
    confirmLabel: S.home.disconnect,
    tone: 'danger',
    testid: 'remote-disconnect',
  })
  if (!yes) return false
  await remote().disconnect()
  toast(S.home.disconnected, { testid: 'remote-disconnected' })
  return true
}

/** Ask, then end the session and drop the address. The chats stay. */
export async function forgetAfterAsking(): Promise<boolean> {
  const connection = remote().connection
  const name = desktopName(connection)
  const yes = await nav.confirm({
    title: S.home.forgetQuestion(name),
    text: S.home.forgetText,
    confirmLabel: S.home.forget,
    tone: 'danger',
    testid: 'remote-forget',
  })
  if (!yes) return false
  await remote().forget()
  if (connection) forgetKnownDesktop(connection.baseUrl)
  toast(S.home.forgotten, { testid: 'remote-forgotten' })
  return true
}

/** What a send, a retry or a resend that did not start means for the user. True when something was said. */
export function sayOutcome(outcome: SendOutcome, chatId: string): boolean {
  if (outcome === 'no-model') {
    toast(S.chat.noModelToast, { testid: 'remote-no-model' })
    nav.openSheet('remote-model', { chatId })
    return true
  }
  if (outcome === 'other-desktop') {
    toast(S.chat.otherDesktopToast, { tone: 'error', testid: 'remote-other-desktop' })
    return true
  }
  if (outcome === 'images-lost') {
    toast(S.chat.imagesLostToast, { tone: 'error', testid: 'remote-images-lost' })
    return true
  }
  return false
}

/**
 * The same for "Regenerate" and "Edit and resend", which are started from a
 * sheet: there a run in flight or a lost desktop is said too, because the
 * button that started it is already gone.
 */
export function sayResendOutcome(outcome: SendOutcome, chatId: string): void {
  if (sayOutcome(outcome, chatId)) return
  if (outcome === 'busy') toast(S.chat.busyToast, { testid: 'remote-busy' })
  else if (outcome === 'not-connected') toast(S.chat.notConnectedToast, { tone: 'error', testid: 'remote-not-connected' })
}
