/**
 * C13 Group chat. Route /chat/:id/group, kind page, tab chat, strand 2 (Agent and knowledge).
 *
 * Two to four models answer each message in turn (lib/group-chat). The list
 * lives on the conversation (`groupModels`), the persona of one participant
 * in `groupPersonas`. The switch keeps the list while it holds one model, so
 * "on, then add the second" works; the group itself runs from two models up.
 */
import { MessageSquareOff, Plus, X } from 'lucide-react'
import { GROUP_CHAT_MAX } from '../../../lib/group-chat'
import { useChatStore } from '../../../stores/chatStore'
import { useModelStore } from '../../../stores/modelStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { offeredPersonas } from '../../policy/personas'
import { nav, useParams } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Button, EmptyState, IconButton, ListGroup, Notice, Page, Row, toast } from '../../ui'
import './parts/agent.css'
import { NEW_CHAT, useConversation } from './parts/chat-ref'
import { addBlock, groupRuns, seedGroup } from './parts/group-logic'
import { localCount, modelLabel, whereOf } from './parts/model-names'

const S = T.groupChat
const NONE: string[] = []

export default function GroupChatPage() {
  const { id } = useParams<{ id: string }>()
  const conversation = useConversation(id)
  const models = useModelStore((s) => s.models)
  const activeModel = useModelStore((s) => s.activeModel)
  const personas = offeredPersonas(useSettingsStore((s) => s.personas))

  if (id === NEW_CHAT || !conversation) {
    return (
      <Page title={S.title} screen="chat-group">
        <EmptyState title={id === NEW_CHAT ? S.newChat : S.gone} icon={MessageSquareOff} testid="m-group-nochat" />
      </Page>
    )
  }

  const group = conversation.groupModels ?? NONE
  const on = group.length > 0
  const full = addBlock(group) === 'full'
  const locals = localCount(group)

  const setGroup = (next: string[]) => useChatStore.getState().setGroupModels(id, next)

  const add = () => {
    nav.openSheet('model', {
      onPick: (name: string) => {
        const current = useChatStore.getState().conversations.find((c) => c.id === id)?.groupModels ?? []
        const block = addBlock(current, name)
        if (block === 'already') {
          toast(S.already, { testid: 'group-already' })
          return
        }
        if (block === 'full') {
          toast(S.addFull(GROUP_CHAT_MAX), { testid: 'group-full' })
          return
        }
        setGroup([...current, name])
      },
    })
  }

  return (
    <Page title={S.title} screen="chat-group">
      <ListGroup>
        <Row
          title={S.enable}
          subtitle={S.enableSub}
          switch={{
            checked: on,
            onChange: (next) => {
              if (next) setGroup(seedGroup(conversation.model, activeModel))
              else {
                setGroup([])
                toast(S.turnedOff, { testid: 'group-off' })
              }
              // A switch that has nothing to start from still has to lead somewhere: ask for the first model.
              if (next && seedGroup(conversation.model, activeModel).length === 0) add()
            },
          }}
          testid="m-group-switch"
          el="C13.1"
        />
      </ListGroup>

      {!on ? (
        <p className="m-ag-text" data-testid="m-group-off">
          {S.off}
        </p>
      ) : (
        <>
          <ListGroup title={S.participants} testid="m-group-list">
            {group.map((model) => {
              const name = modelLabel(model, models)
              const personaId = conversation.groupPersonas?.[model]
              const persona = personaId ? personas.find((p) => p.id === personaId) : undefined
              return (
                <Row
                  key={model}
                  title={name}
                  subtitle={whereOf(model) === 'cloud' ? S.cloud : S.onDevice}
                  value={persona ? persona.name : S.personaFollow}
                  label={S.personaOf(name)}
                  onPress={() => nav.openSheet('agent-group-persona', { chatId: id, model })}
                  chevron={false}
                  trailing={<IconButton icon={X} label={S.removeName(name)} onPress={() => setGroup(group.filter((m) => m !== model))} testid={`m-group-remove-${group.indexOf(model)}`} el="C13.3" />}
                  testid={`m-group-member-${group.indexOf(model)}`}
                  el="C13.3"
                />
              )
            })}
          </ListGroup>
          <div className="m-ag-actions">
            <Button block icon={Plus} disabled={full} disabledReason={S.addFull(GROUP_CHAT_MAX)} onPress={add} testid="m-group-add" el="C13.2">
              {S.add}
            </Button>
          </div>
          {!groupRuns(group) ? (
            <Notice variant="info" testid="m-group-one">
              {S.addOne}
            </Notice>
          ) : (
            <p className="m-ag-text" data-testid="m-group-cost" data-el="C13.4">
              {locals === group.length ? S.costLocal(group.length) : S.cost(group.length)}
            </p>
          )}
          {locals > 1 ? (
            <Notice variant="info" testid="m-group-both-local">
              {S.bothLocal}
            </Notice>
          ) : null}
          <p className="m-ag-text">{S.agentNote}</p>
        </>
      )}
    </Page>
  )
}
