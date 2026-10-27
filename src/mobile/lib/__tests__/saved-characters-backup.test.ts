/**
 * Gap L3 (mobile-docs/r38/luecken.md): the saved characters of Create had no
 * copy outside IndexedDB, and on Android a full phone can make the WebView
 * drop all of IndexedDB at the next start. They now have one beside the
 * native store backup, and the start brings them back.
 *
 * The native side is played by a map with the same rules as
 * src-tauri/src/commands/saved_characters_backup.rs (ids are the sha256 of
 * the base64 text, an index must not name a missing photo, photos the index
 * does not name are removed). The test run has no IndexedDB, so the store is
 * the session map of lib/saved-characters behind the same functions; a
 * dropped database is that map cleared.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  photos: new Map<string, string>(),
  index: null as string | null,
  refuse: new Set<string>(),
  calls: [] as string[],
}))

async function sha(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}

vi.mock('../../../api/backend', () => ({
  isTauri: () => true,
  backendCall: async (cmd: string, args: Record<string, unknown> = {}) => {
    native.calls.push(cmd)
    switch (cmd) {
      case 'saved_characters_backup_missing':
        return (args.ids as string[]).filter((id) => !native.photos.has(id))
      case 'saved_characters_backup_put': {
        const { id, data } = args as { id: string; data: string }
        if (native.refuse.has(data)) throw new Error('The backup of saved characters is full.')
        if ((await sha(data)) !== id) throw new Error('Attachment checksum mismatch')
        native.photos.set(id, data)
        return null
      }
      case 'saved_characters_backup_write_index': {
        const index = args.index as string
        const rows = JSON.parse(index) as { photos: { id: string }[] }[]
        const named = new Set(rows.flatMap((r) => r.photos.map((p) => p.id)))
        for (const id of named) if (!native.photos.has(id)) throw new Error('A photo of a saved character is not in the backup yet.')
        native.index = index
        for (const id of [...native.photos.keys()]) if (!named.has(id)) native.photos.delete(id)
        return null
      }
      case 'saved_characters_backup_read_index':
        return native.index
      case 'saved_characters_backup_read_photo': {
        const data = native.photos.get(args.id as string)
        if (data === undefined) throw new Error('missing')
        return data
      }
    }
    throw new Error(`unexpected command ${cmd}`)
  },
}))
vi.mock('../../../lib/device-kind', () => ({ isMobile: () => true }))

import {
  __resetSavedCharacters, deleteSavedCharacter, listSavedCharacters, saveCharacter,
} from '../../../lib/saved-characters'
import {
  __resetSavedCharactersBackup, base64ToBytes, bytesToBase64, installSavedCharactersBackup, restoreSavedCharactersAtStart,
} from '../saved-characters-backup'

const photo = (text: string) => new Blob([text], { type: 'image/jpeg' })

/** What a dropped IndexedDB leaves: no character, the mirror registered again by the next start. */
function dropTheDatabase(): void {
  __resetSavedCharacters()
  installSavedCharactersBackup()
}

beforeEach(() => {
  __resetSavedCharacters()
  __resetSavedCharactersBackup()
  native.photos.clear()
  native.index = null
  native.refuse.clear()
  native.calls = []
  installSavedCharactersBackup()
})

describe('saved characters beside the native backup (gap L3)', () => {
  it('a saved character comes back after the whole database was dropped', async () => {
    await saveCharacter('Mira', [photo('one'), photo('two')])
    await saveCharacter('Odo', [photo('three')])
    dropTheDatabase()
    expect(await listSavedCharacters()).toEqual([])

    expect(await restoreSavedCharactersAtStart()).toBe('restored')
    const back = await listSavedCharacters()
    expect(back.map((c) => c.name).sort()).toEqual(['Mira', 'Odo'])
    const mira = back.find((c) => c.name === 'Mira')!
    expect(await Promise.all(mira.photos.map((p) => p.text()))).toEqual(['one', 'two'])
    expect(mira.photos[0].type).toBe('image/jpeg')
  })

  it('photos added to a character later are in the copy too, and a deleted character stays deleted', async () => {
    await saveCharacter('Mira', [photo('one')])
    await saveCharacter('mira', [photo('two')])
    const odo = await saveCharacter('Odo', [photo('three')])
    await deleteSavedCharacter(odo.character.id)
    expect(native.photos.size).toBe(2)
    dropTheDatabase()
    await restoreSavedCharactersAtStart()
    const back = await listSavedCharacters()
    expect(back.map((c) => c.name)).toEqual(['Mira'])
    expect(await Promise.all(back[0].photos.map((p) => p.text()))).toEqual(['one', 'two'])
  })

  it('a character saved before this version gets its copy at the next start', async () => {
    __resetSavedCharacters() // no mirror: what an older version did
    await saveCharacter('Old', [photo('old')])
    expect(native.index).toBeNull()
    installSavedCharactersBackup()
    expect(await restoreSavedCharactersAtStart()).toBe('synced')
    expect(JSON.parse(native.index!)).toHaveLength(1)
    dropTheDatabase()
    await restoreSavedCharactersAtStart()
    expect((await listSavedCharacters()).map((c) => c.name)).toEqual(['Old'])
  })

  it('a photo the backup refuses (full) keeps the rest of the copy, and the save itself still works', async () => {
    await saveCharacter('Mira', [photo('one')])
    native.refuse.add(bytesToBase64(await photo('big').arrayBuffer()))
    const r = await saveCharacter('Big', [photo('big')])
    expect(r.added).toBe(1)
    expect((await listSavedCharacters()).map((c) => c.name).sort()).toEqual(['Big', 'Mira'])
    dropTheDatabase()
    await restoreSavedCharactersAtStart()
    expect((await listSavedCharacters()).map((c) => c.name)).toEqual(['Mira'])
  })

  it('nothing in the copy and nothing in the store: nothing happens', async () => {
    expect(await restoreSavedCharactersAtStart()).toBe('skipped')
    expect(await listSavedCharacters()).toEqual([])
  })

  it('base64 goes there and back byte for byte', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 7) % 256)
    expect(new Uint8Array(base64ToBytes(bytesToBase64(bytes.buffer)))).toEqual(bytes)
  })
})
