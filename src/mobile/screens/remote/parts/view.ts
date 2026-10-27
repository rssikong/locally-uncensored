/**
 * Pure helpers of the remote screens: what a state means for the user. No
 * React, no store, no clock of their own, so every rule here has a test.
 */
import type { RemoteRoute } from '../../../remote/pairingLink'
import { displayAddress, normalizePasscode, parsePairingInput, PASSCODE_LENGTH, type PairingTarget } from '../../../remote/pairingLink'
import { REMOTE_TOOL_NEEDS, type RemoteAgentStep } from '../../../remote/remoteAgent'
import type { RemotePermissions } from '../../../remote/remoteClient'
import { connectionEverWorked, type RemoteChat, type RemoteClientState, type RemoteConnection, type RemoteMessage, type RemoteStatus } from '../../../remote/remoteClientStore'
import { RemoteOpenPairingError, type RemoteErrorInfo } from '../../../remote/remoteErrors'
import { onWifi } from '../../../remote/reconnect'
import { REMOTE_STRINGS as S } from '../../../strings/remote'
import { displayModelName } from '../../../../api/providers/model-name'

export function routeLabel(route: RemoteRoute): string {
  return S.route[route]
}

/** Whole seconds until `retryAt`, never negative. */
export function secondsLeft(retryAt: number | null, now: number): number {
  if (!retryAt) return 0
  return Math.max(0, Math.ceil((retryAt - now) / 1000))
}

/**
 * The error as the pairing screens show it (round 57, David). A desktop on
 * Wi-Fi that this phone never paired with and that does not answer is, most
 * of the time, a computer whose pairing panel is not open: the page asks for
 * that ("Open pairing on your computer") instead of "Cannot reach". A desktop
 * that worked before, and every internet link, keep the real sentence.
 */
export function shownError(
  error: RemoteErrorInfo | null,
  connection: Pick<RemoteConnection, 'route' | 'pairedAt' | 'lastOkAt' | 'pin'> | null | undefined,
): RemoteErrorInfo | null {
  if (!error || (error.code !== 'unreachable' && error.code !== 'timeout')) return error
  if (!connection || connection.pin || connectionEverWorked(connection)) return error
  if (connection.route !== 'lan' && connection.route !== 'loopback') return error
  return new RemoteOpenPairingError(error.detail ?? error.code).toInfo()
}

/** Which of the two fields of R2 an error belongs under. */
export function errorField(error: RemoteErrorInfo | null): 'address' | 'passcode' | 'notice' | null {
  if (!error) return null
  switch (error.code) {
    case 'invalid-address':
    case 'unreachable':
    case 'timeout':
    case 'not-lu':
    case 'protocol':
      return 'address'
    case 'invalid-code':
    case 'rate-limited':
    case 'session-expired':
      return 'passcode'
    default:
      return 'notice'
  }
}

/** Pure: the address as a person would type it. Wi-Fi addresses lose "http://", a secure one keeps its "https://". */
export function typedAddress(target: Pick<PairingTarget, 'baseUrl' | 'secure'>): string {
  return target.secure ? target.baseUrl : target.baseUrl.replace(/^http:\/\//, '')
}

export interface ConnectStart {
  address: string
  /** Six digits a pairing link brought along, else empty. Lives in the page only. */
  passcode: string
  /** Address (and code) came from a link, not from the user: the page says so and never connects by itself. */
  fromLink: boolean
}

/**
 * Pure: what R2 shows when it opens.
 *
 * A pairing link that was just handed over (lu://remote..., G14 "Continue")
 * wins over everything: it is what the user asked for a moment ago. Then
 * what was typed before, then the desktop that is set up, then a link offer
 * that was not answered yet (address only, the offer keeps its code).
 */
export function connectStart(input: {
  handed: Pick<PairingTarget, 'baseUrl' | 'secure' | 'code'> | null
  draft: { address: string; fromLink: boolean }
  connectionAddress: string | null
  offeredAddress: string | null
}): ConnectStart {
  if (input.handed) return { address: typedAddress(input.handed), passcode: input.handed.code ?? '', fromLink: true }
  if (input.draft.address) return { address: input.draft.address, passcode: '', fromLink: input.draft.fromLink }
  if (input.connectionAddress) return { address: input.connectionAddress, passcode: '', fromLink: false }
  if (input.offeredAddress) return { address: input.offeredAddress, passcode: '', fromLink: true }
  return { address: '', passcode: '', fromLink: false }
}

export interface ConnectInput {
  /** The target, or null when the address cannot be read. */
  target: PairingTarget | null
  /** Six digits, or null. */
  code: string | null
  /** Something was typed into the code field that is not six digits. */
  codeIncomplete: boolean
}

/** Pure: read the two fields of R2. A code inside the address ("address 123456", a link) counts when the code field is empty. */
export function readConnectInput(address: string, passcode: string): ConnectInput {
  const target = parsePairingInput(address)
  const typed = passcode.trim()
  const own = normalizePasscode(typed)
  return {
    target,
    code: own ?? (typed ? null : (target?.code ?? null)),
    codeIncomplete: typed.length > 0 && !own,
  }
}

/** Pure: only digits and the separators people copy along, cut to what a code can be. */
export function cleanPasscodeInput(value: string): string {
  return value.replace(/[^\d\s-]/g, '').slice(0, PASSCODE_LENGTH + 2)
}

export type Platform = 'ios' | 'android' | null

/**
 * The list under "What to check" when the desktop does not answer. Depends
 * on how the desktop is reached: a dead internet link has one cause, a
 * silent Wi-Fi address several.
 */
export function unreachableChecks(input: { route: RemoteRoute | null; os: Platform; deviceOnline: boolean }): string[] {
  const { route, os, deviceOnline } = input
  const out: string[] = []
  if (!deviceOnline) out.push(S.checks.phoneOffline)
  if (route === 'tunnel' || route === 'public') {
    out.push(S.checks.open, S.checks.tunnel)
    return out
  }
  out.push(S.checks.open, S.checks.sameWifi, S.checks.guest, S.checks.firewall)
  if (os === 'ios') out.push(S.checks.iosLocal)
  out.push(S.checks.address)
  return out
}

export type MessageAction = 'retry' | 'enter-code' | 'reconnect' | null

export interface MessageFooter {
  text: string
  tone: 'quiet' | 'warn' | 'error'
  action: MessageAction
  /** Title above the text, for the box under a lost answer. */
  title?: string
}

/**
 * What stands under an answer that did not end well, and the one button next
 * to it. Only the last message of a chat gets a button: an older one cannot
 * be asked again without the ones after it.
 */
export function messageFooter(message: RemoteMessage, isLast: boolean, status: RemoteStatus): MessageFooter | null {
  if (message.role !== 'assistant') return null
  const connected = status === 'connected'
  const again: MessageAction = !isLast ? null : connected ? 'retry' : status === 'needs-code' || status === 'pairing' ? 'enter-code' : 'reconnect'
  switch (message.state) {
    case 'stopped':
      return { text: S.chat.stopped, tone: 'quiet', action: again }
    case 'interrupted':
      if (message.error?.code === 'connection-lost') {
        return { title: S.chat.connectionLostTitle, text: message.error.message, tone: 'error', action: isLast ? (connected ? 'retry' : 'reconnect') : null }
      }
      return { text: message.error?.message ?? S.chat.interrupted, tone: 'warn', action: again }
    case 'failed': {
      const text = message.error?.message ?? S.chat.interrupted
      if (message.error?.code === 'session-expired') return { text, tone: 'error', action: isLast ? (connected ? 'retry' : 'enter-code') : null }
      if (message.error?.code === 'unreachable' || message.error?.code === 'timeout') {
        return { title: S.chat.connectionLostTitle, text, tone: 'error', action: isLast ? (connected ? 'retry' : 'reconnect') : null }
      }
      return { text, tone: 'error', action: again }
    }
    default:
      return null
  }
}

/**
 * A question without any answer under it (the app was closed in the instant
 * between the two). It can be asked again, or the connection comes first.
 */
export function unansweredAction(status: RemoteStatus): Exclude<MessageAction, null> {
  if (status === 'connected') return 'retry'
  return status === 'needs-code' || status === 'pairing' ? 'enter-code' : 'reconnect'
}

export function actionLabel(action: Exclude<MessageAction, null>): string {
  return action === 'retry' ? S.chat.tryAgain : action === 'enter-code' ? S.chat.enterCode : S.chat.reconnect
}

/** Why the send button is blocked right now, or undefined when it is free. `foreign`: the chat belongs to another desktop. */
export function sendBlocked(state: Pick<RemoteClientState, 'status' | 'streamingChatId'>, chatId: string, foreign = false): string | undefined {
  if (state.streamingChatId && state.streamingChatId !== chatId) return S.chat.sendBlockedBusy
  if (state.status !== 'connected') return S.chat.sendBlockedOffline
  if (foreign) return S.chat.sendBlockedOther
  return undefined
}

/** Does this chat belong to a desktop other than the one that is set up? A chat without a desktop belongs to whichever is used next. */
export function isForeignChat(chat: Pick<RemoteChat, 'baseUrl'>, connection: { baseUrl: string } | null): boolean {
  return chat.baseUrl !== null && connection !== null && chat.baseUrl !== connection.baseUrl
}

/** Newest first. */
export function sortedChats(chats: readonly RemoteChat[]): RemoteChat[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** One line under the title of a chat row: the last thing that was said. */
export function chatPreview(chat: RemoteChat): string {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const text = chat.messages[i].content.replace(/\s+/g, ' ').trim()
    if (text) return text.length > 120 ? `${text.slice(0, 117)}...` : text
  }
  return S.home.emptyChatPreview
}

/** "now", "5 min ago", "3 h ago", "2 d ago", then the date. */
export function relativeTime(at: number, now: number): string {
  if (!at) return ''
  const diff = Math.max(0, now - at)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min} min ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** The name a desktop goes by on this phone: the computer name when the desktop sends one, else the address. */
export function desktopName(connection: { address: string; hostName?: string } | null): string {
  return connection?.hostName || connection?.address || ''
}

/**
 * Pure: the small line under "Connected to <name>". Only when the name is the
 * computer's own (else the name already is the address). On Wi-Fi its
 * address; over the internet "via internet link": the Wi-Fi address is not
 * the way the phone goes then (device test 20.10.2026), and the address of
 * the tunnel is not written out.
 */
export function connectedSubline(connection: Pick<RemoteConnection, 'address' | 'hostName' | 'via' | 'baseUrl'> | null): string | null {
  if (!connection?.hostName) return null
  return onWifi(connection) ? connection.address : S.home.viaInternet
}

/** The name of the desktop a chat was held with: the remembered name, else its address. '' for a chat without a desktop. */
export function chatDesktopName(
  baseUrl: string | null,
  connection: { baseUrl: string; address: string; hostName?: string } | null,
  known: ReadonlyArray<{ baseUrl: string; address: string; name?: string }>,
): string {
  if (!baseUrl) return ''
  if (connection?.baseUrl === baseUrl) return desktopName(connection)
  const remembered = known.find((desktop) => desktop.baseUrl === baseUrl)
  return remembered?.name || remembered?.address || displayAddress(baseUrl)
}

/** An empty chat of this desktop that can be used again, so "New remote chat" never piles up blank ones. */
export function reusableEmptyChat(chats: readonly RemoteChat[], baseUrl: string | null = null): RemoteChat | undefined {
  return chats.find((c) => c.messages.length === 0 && (c.baseUrl === null || c.baseUrl === baseUrl))
}

export interface ChatGroup {
  /** The desktop of the group, or null for chats that have none yet. */
  baseUrl: string | null
  /** True for the desktop that is set up right now. */
  current: boolean
  chats: RemoteChat[]
}

/**
 * Pure: the chats with something in them, by desktop. The desktop that is
 * set up comes first (chats without a desktop count as its own, they are
 * continued there), then the others by their newest chat.
 */
export function groupChatsByDesktop(chats: readonly RemoteChat[], currentBaseUrl: string | null): ChatGroup[] {
  const groups = new Map<string, ChatGroup>()
  for (const chat of sortedChats(chats)) {
    if (chat.messages.length === 0) continue
    const baseUrl = chat.baseUrl ?? currentBaseUrl
    const key = baseUrl ?? ''
    let group = groups.get(key)
    if (!group) {
      group = { baseUrl, current: baseUrl !== null && baseUrl === currentBaseUrl, chats: [] }
      groups.set(key, group)
    }
    group.chats.push(chat)
  }
  const all = [...groups.values()]
  return [...all.filter((g) => g.current), ...all.filter((g) => !g.current)]
}

/** Pure: what Agent mode can do on this desktop, as words for one sentence. */
export function agentAbilities(permissions: RemotePermissions | null, createTools: readonly string[] = []): string[] {
  const out: string[] = [S.options.abilityWeb]
  if (permissions?.filesystem) out.push(S.options.abilityFiles)
  if (permissions?.shell) out.push(S.options.abilityShell)
  // A17: images and videos made with Create of the computer, when this phone may.
  if (createTools.includes('image_generate')) out.push(S.options.abilityImages)
  if (createTools.includes('video_generate')) out.push(S.options.abilityVideos)
  return out
}

/** Pure: a readable name for a tool step. Unknown tools keep their own name. */
export function stepTitle(step: Pick<RemoteAgentStep, 'tool'>): string {
  return (S.steps.tools as Record<string, string>)[step.tool] ?? step.tool
}

/** Pure: the switch on the desktop a tool needs, in the words of the connection sheet. '' when it needs none. */
export function stepPermissionName(step: Pick<RemoteAgentStep, 'tool' | 'needsPermission'>): string {
  const key = step.needsPermission || REMOTE_TOOL_NEEDS[step.tool] || ''
  if (key === 'filesystem') return S.connection.filesystem
  if (key === 'shell') return S.connection.shell
  if (key === 'downloads') return S.connection.downloads
  if (key === 'process_control') return S.connection.processControl
  return key
}

/**
 * Pure: the name of a desktop model for the screen. A Windows desktop with
 * the LU engine names a model by its whole file path
 * ("C:\\Users\\...\\Qwen3.5-9B-Q4_K_M.gguf"); the chip and the list show the
 * file name without the folder and without ".gguf". What is sent to the
 * desktop stays the real id.
 */
export function remoteModelLabel(model: string): string {
  const name = displayModelName(model ?? '').trim()
  if (!name) return ''
  // Only a file path loses its folders: an Ollama name such as "hf.co/user/model:Q4" stays as it is.
  const isFile = name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name) || /\.gguf$/i.test(name)
  if (!isFile) return name
  const file = name.split(/[\\/]/).filter(Boolean).pop() ?? name
  return file.replace(/\.gguf$/i, '') || file
}
