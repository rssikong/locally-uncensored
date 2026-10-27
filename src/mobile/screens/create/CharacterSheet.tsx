/**
 * K10.2 "More" of a character card. Sheet "create-character", opened with
 * nav.openSheet('create-character', { id, name }), strand 3 (Create).
 *
 * Rename and Delete. The cloud has no rename call, so the new name is kept
 * on this phone (parts/adapters/character-names.ts).
 */
import { Pencil, Trash2 } from 'lucide-react'
import { deleteLora } from '../../../api/cloud/loras'
import { useCreateStore } from '../../../stores/createStore'
import { nav, useSheet } from '../../nav'
import { useCloseOwnSheet } from './parts/ui'
import { CREATE_STRINGS as T } from '../../strings/create'
import { EmptyState, ListGroup, Row, Sheet, toast } from '../../ui'
import { useCharacterNames } from './parts/adapters/character-names'

export default function CharacterSheet() {
  const { props } = useSheet<{ id?: string; name?: string } | undefined>()
  // Rename and delete wait for an answer first. By then another sheet may be on top.
  const close = useCloseOwnSheet()
  const names = useCharacterNames()
  const id = props?.id
  if (!id) {
    return (
      <Sheet title={T.chars.actions}>
        <EmptyState title={T.result.gone} />
      </Sheet>
    )
  }
  const name = names.names[id] ?? props?.name ?? ''
  const rename = async () => {
    const next = await nav.prompt({ title: T.chars.renameTitle, confirmLabel: T.chars.renameConfirm, field: { label: T.chars.renameField, initial: name }, testid: 'create-character-rename' })
    if (next === null || !next.trim()) return
    names.rename(id, next)
    const st = useCreateStore.getState()
    if (st.selectedCharacter?.id === id) st.setSelectedCharacter({ ...st.selectedCharacter, name: next.trim().slice(0, 40) })
    toast(T.chars.renamed, { testid: 'create-character-renamed' })
    close()
  }
  const remove = async () => {
    const yes = await nav.confirm({ title: T.chars.deleteTitle(name), text: T.chars.deleteText, confirmLabel: T.chars.delete, tone: 'danger', testid: 'create-character-delete' })
    if (!yes) return
    try {
      await deleteLora(id)
      names.forget(id)
      const st = useCreateStore.getState()
      if (st.selectedCharacter?.id === id) st.setSelectedCharacter(null)
      st.bumpCharactersVersion()
      toast(T.chars.deleted, { testid: 'create-character-deleted' })
    } catch {
      toast(T.chars.deleteFailed, { tone: 'error', testid: 'create-character-delete-failed' })
    }
    close()
  }
  return (
    <Sheet title={name || T.chars.actions}>
      <ListGroup>
        <Row icon={Pencil} title={T.chars.rename} chevron={false} onPress={() => void rename()} testid="m-create-character-rename" el="K10.2" />
        <Row icon={Trash2} title={T.chars.delete} danger chevron={false} onPress={() => void remove()} testid="m-create-character-delete" el="K10.2" />
      </ListGroup>
    </Sheet>
  )
}
