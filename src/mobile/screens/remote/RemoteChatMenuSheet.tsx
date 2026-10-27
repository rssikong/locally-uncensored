/**
 * Rename and delete a remote chat. Sheet "remote-chat-menu", strand 6
 * (C7 for R4, and the "More" button of a row in R1).
 */
import { Info, Pencil, Trash2 } from 'lucide-react'
import { nav, useSheet } from '../../nav'
import { REMOTE_STRINGS as S } from '../../strings/remote'
import { ListGroup, Row, Sheet, toast } from '../../ui'
import { remote, useRemote } from './parts/session'
import './parts/remote.css'

export default function RemoteChatMenuSheet() {
  const sheet = useSheet<{ chatId?: string; inChat?: boolean } | undefined>()
  const chatId = sheet.props?.chatId ?? ''
  const inChat = sheet.props?.inChat === true
  const chat = useRemote((s) => s.chats.find((c) => c.id === chatId))

  if (!chat) {
    return (
      <Sheet title={S.chatMenu.title}>
        <p className="m-remote-sheet-text" data-testid="m-remote-chat-menu-none">
          {S.chatMenu.none}
        </p>
      </Sheet>
    )
  }

  const rename = async () => {
    const title = await nav.prompt({
      title: S.chatMenu.renameQuestion,
      confirmLabel: S.chatMenu.renameConfirm,
      field: { label: S.chatMenu.renameField, initial: chat.title },
      testid: 'remote-rename',
    })
    if (title === null) return
    remote().renameChat(chat.id, title)
    nav.closeSheet()
  }

  const remove = async () => {
    const yes = await nav.confirm({
      title: S.chatMenu.deleteQuestion(chat.title),
      text: S.chatMenu.deleteText,
      confirmLabel: S.chatMenu.delete,
      tone: 'danger',
      testid: 'remote-delete-chat',
    })
    if (!yes) return
    nav.closeSheet()
    // The page of a chat that is gone has nothing to show: leave it first.
    if (inChat) nav.back()
    remote().deleteChat(chat.id)
    toast(S.chatMenu.deleted, { testid: 'remote-chat-deleted' })
  }

  const openConnection = () => {
    // One sheet at a time: this one closes, the details open in its place.
    nav.closeSheet()
    nav.openSheet('remote-connection')
  }

  return (
    <Sheet title={chat.title}>
      <ListGroup>
        <Row title={S.chatMenu.rename} icon={Pencil} chevron={false} onPress={() => void rename()} testid="m-remote-chat-menu-rename" />
        <Row title={S.chatMenu.connection} icon={Info} chevron={false} onPress={openConnection} testid="m-remote-chat-menu-connection" />
      </ListGroup>
      <ListGroup>
        <Row risk="destructive" title={S.chatMenu.delete} icon={Trash2} chevron={false} danger onPress={() => void remove()} testid="m-remote-chat-menu-delete" />
      </ListGroup>
    </Sheet>
  )
}
