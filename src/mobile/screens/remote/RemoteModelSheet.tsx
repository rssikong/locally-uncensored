/**
 * The models of the desktop, for one remote chat. Sheet "remote-model",
 * strand 6. The model sheet C3 of strand 1 lists what is on this phone; this
 * one lists what the desktop answers on /api/tags.
 *
 * An empty list does not mean "all is well": the desktop answers with an
 * empty list when no model is loaded there, so the sheet says what to do.
 */
import { useState } from 'react'
import { Boxes, RefreshCw } from 'lucide-react'
import { useSheet } from '../../nav'
import { REMOTE_STRINGS as S } from '../../strings/remote'
import { Button, EmptyState, ListGroup, Row, Sheet } from '../../ui'
import { remote, useRemote } from './parts/session'
import { remoteModelLabel } from './parts/view'
import './parts/remote.css'

export default function RemoteModelSheet() {
  const sheet = useSheet<{ chatId?: string } | undefined>()
  const chatId = sheet.props?.chatId ?? ''
  const models = useRemote((s) => s.models)
  const status = useRemote((s) => s.status)
  const desktopModel = useRemote((s) => s.hostConfig?.model ?? '')
  const chosen = useRemote((s) => s.chats.find((c) => c.id === chatId)?.model ?? '')
  const [busy, setBusy] = useState(false)
  const connected = status === 'connected'

  const refresh = () => {
    setBusy(true)
    void remote()
      .refreshModels()
      .finally(() => setBusy(false))
  }

  const pick = (model: string) => {
    if (chatId) remote().setChatModel(chatId, model)
    sheet.close()
  }

  return (
    <Sheet
      title={S.model.title}
      footer={
        connected ? (
          <Button block icon={RefreshCw} busy={busy} onPress={refresh} testid="m-remote-model-refresh">
            {busy ? S.model.refreshing : S.model.refresh}
          </Button>
        ) : undefined
      }
    >
      {!connected ? (
        <p className="m-remote-sheet-text" data-testid="m-remote-model-offline">
          {S.model.notConnected}
        </p>
      ) : models.length === 0 ? (
        <EmptyState icon={Boxes} title={S.model.emptyTitle} testid="m-remote-model-empty">
          {S.model.emptyText}
        </EmptyState>
      ) : (
        <ListGroup role="radiogroup" label={S.model.groupLabel} testid="m-remote-model-list">
          {models.map((model, index) => (
            <Row
              key={model}
              title={remoteModelLabel(model)}
              subtitle={model === desktopModel ? S.model.desktopDefault : undefined}
              radio={{ checked: model === chosen, onSelect: () => pick(model) }}
              testid={`m-remote-model-${index}`}
            />
          ))}
        </ListGroup>
      )}
    </Sheet>
  )
}
