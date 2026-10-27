/**
 * ADAPTER: names the user gave trained characters, kept on this phone.
 *
 * TODO(geruest-wuensche/create.md, point 7): api/cloud/loras.ts can list and
 * delete a character, it cannot rename one. DESIGN.md K10.2 has "Rename".
 * Until the cloud has the call, the name is a label on this phone only.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '../../../../../lib/storage-quota'

interface CharacterNames {
  names: Record<string, string>
  rename: (id: string, name: string) => void
  forget: (id: string) => void
}

export const useCharacterNames = create<CharacterNames>()(
  persist(
    (set) => ({
      names: {},
      rename: (id, name) => set((s) => ({ names: { ...s.names, [id]: name.trim().replace(/\s+/g, ' ').slice(0, 40) } })),
      forget: (id) =>
        set((s) => {
          const { [id]: _gone, ...rest } = s.names
          return { names: rest }
        }),
    }),
    { name: 'lu-mobile-character-names', storage: safeJSONStorage() },
  ),
)
