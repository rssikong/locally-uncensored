/**
 * A new chat on the computer (A17, `POST /remote-api/chats`). Sheet
 * "remote-new-shared": Chat, Agent or Code. The chat is shared at once and
 * shows up in the chat list of the computer as well.
 */
import { useEffect, useState } from 'react'
import { Code2, MessageSquare, Wrench } from 'lucide-react'
import { nav, useSheet } from '../../nav'
import { newSharedChat, refreshChatModels, useSharedChats } from '../../remote/sharedChatStore'
import type { SharedChatMode } from '../../remote/sharedChats'
import { REMOTE_STRINGS as S } from '../../strings/remote'
import { ListGroup, Notice, Row, Sheet } from '../../ui'
import { useRemote } from './parts/session'
import { remoteModelLabel } from './parts/view'
import './parts/remote.css'

export default function SharedNewChatSheet() {
  const sheet = useSheet()
  const [busy, setBusy] = useState<SharedChatMode | null>(null)
  const [error, setError] = useState('')
  const tags = useRemote((s) => s.models)
  const preset = useRemote((s) => s.hostConfig?.model ?? '')
  const list = useSharedChats((s) => s.modelList)
  const models = list?.models ?? tags.map((name) => ({ name, label: name }))
  const [chosen, setModel] = useState('')
  useEffect(() => {
    void refreshChatModels(tags)
  }, [tags])
  // The computer's default, else the model it shares with the page, else the first.
  const fallback = (list?.default && models.some((m) => m.name === list.default) ? list.default : '') || (models.some((m) => m.name === preset) ? preset : (models[0]?.name ?? ''))
  const model = chosen || fallback
  const start = async (mode: SharedChatMode) => {
    if (busy) return
    setBusy(mode)
    setError('')
    try {
      const id = await newSharedChat(mode, undefined, model || undefined)
      sheet.close()
      nav.push('/remote/shared/:id', { id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <Sheet title={S.shared.newTitle} testid="m-remote-new-shared">
      <p className="m-remote-sheet-text">{S.shared.newText}</p>
      {error ? (
        <Notice variant="error" testid="m-remote-new-shared-error">
          {error}
        </Notice>
      ) : null}
      {models.length > 1 ? (
        <ListGroup title={S.shared.model} role="radiogroup" testid="m-remote-new-shared-models">
          {models.map((m, i) => (
            <Row key={m.name} title={m.label === m.name ? remoteModelLabel(m.name) : m.label} radio={{ checked: m.name === model, onSelect: () => setModel(m.name) }} disabled={busy !== null} testid={`m-remote-new-shared-model-${i}`} />
          ))}
        </ListGroup>
      ) : null}
      <ListGroup>
        <Row icon={MessageSquare} title={S.shared.modeChat} subtitle={busy === 'chat' ? S.shared.creating : S.shared.modeChatSub} disabled={busy !== null} onPress={() => void start('chat')} testid="m-remote-new-shared-chat" />
        <Row icon={Wrench} title={S.shared.modeAgent} subtitle={busy === 'agent' ? S.shared.creating : S.shared.modeAgentSub} disabled={busy !== null} onPress={() => void start('agent')} testid="m-remote-new-shared-agent" />
        <Row icon={Code2} title={S.shared.modeCode} subtitle={busy === 'code' ? S.shared.creating : S.shared.modeCodeSub} disabled={busy !== null} onPress={() => void start('code')} testid="m-remote-new-shared-code" />
      </ListGroup>
    </Sheet>
  )
}
