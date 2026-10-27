/**
 * The model of a shared chat (A17). Sheet "remote-shared-model": the models
 * of the computer (/api/tags), shown without folder and ".gguf"; the pick is
 * sent as `model` with the next messages of the chat.
 */
import { Boxes } from 'lucide-react'
import { useSheet } from '../../nav'
import { useEffect } from 'react'
import { refreshChatModels, setSharedChatModel, useSharedChats } from '../../remote/sharedChatStore'
import { REMOTE_STRINGS as S } from '../../strings/remote'
import { EmptyState, ListGroup, Row, Sheet } from '../../ui'
import { useRemote } from './parts/session'
import { remoteModelLabel } from './parts/view'
import './parts/remote.css'

export default function SharedModelSheet() {
  const sheet = useSheet<{ chatId?: string } | undefined>()
  const chatId = sheet.props?.chatId ?? ''
  const tags = useRemote((s) => s.models)
  const list = useSharedChats((s) => s.modelList)
  const current = useSharedChats((s) => s.chatModels[chatId] ?? (s.chats[chatId]?.model || s.list.find((c) => c.id === chatId)?.model || list?.default || ''))
  useEffect(() => {
    void refreshChatModels(tags)
  }, [tags])
  const models = list?.models ?? tags.map((name) => ({ name, label: name }))
  return (
    <Sheet title={S.shared.modelTitle} testid="m-remote-shared-model-sheet">
      <p className="m-remote-sheet-text">{S.shared.modelSub}</p>
      {models.length === 0 ? (
        <EmptyState icon={Boxes} title={S.model.emptyTitle} testid="m-remote-shared-model-empty">
          {S.model.emptyText}
        </EmptyState>
      ) : (
        <ListGroup role="radiogroup" label={S.shared.model} testid="m-remote-shared-model-list">
          {models.map((m, i) => (
            <Row
              key={m.name}
              title={m.label === m.name ? remoteModelLabel(m.name) : m.label}
              radio={{
                checked: m.name === current,
                onSelect: () => {
                  setSharedChatModel(chatId, m.name)
                  sheet.close()
                },
              }}
              testid={`m-remote-shared-model-${i}`}
            />
          ))}
        </ListGroup>
      )}
    </Sheet>
  )
}
