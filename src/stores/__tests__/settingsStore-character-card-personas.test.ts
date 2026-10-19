/**
 * Personas gained two optional fields in 3.0.7 (card, imageDataUrl) without a
 * store version bump. Personas saved before still load, and card personas
 * survive both the current-version path and the migrate path.
 *
 * Run: npx vitest run src/stores/__tests__/settingsStore-character-card-personas.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const backing = new Map<string, string>()
const localStorageShim = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  key: (i: number) => [...backing.keys()][i] ?? null,
  get length() {
    return backing.size
  },
} as Storage

const KEY = 'chat-settings'
/** Must track STORE_VERSION in settingsStore. */
const CURRENT = 23

const OLD_PERSONA = { id: 'old', name: 'Pirate', icon: 'Anchor', systemPrompt: 'Talk like a pirate.', isBuiltIn: false }
const CARD_PERSONA = {
  id: 'card', name: 'Mira', icon: 'MessageCircle', systemPrompt: 'Write {{char}}.', isBuiltIn: false,
  imageDataUrl: 'data:image/jpeg;base64,AAAA',
  card: {
    description: 'd', personality: '', scenario: '', firstMessage: 'Hello {{user}}', exampleMessages: '',
    alternateGreetings: ['Hi'], systemPrompt: '', postHistoryInstructions: '', creatorNotes: 'n',
  },
}

function seed(personas: unknown[], version: number) {
  backing.set(KEY, JSON.stringify({
    state: { settings: {}, personas, activePersonaId: 'old', _version: version },
    version,
  }))
}

async function freshStore() {
  vi.resetModules()
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('localStorage', localStorageShim)
  const mod = await import('../settingsStore')
  return mod.useSettingsStore
}

describe('personas across the character card change', () => {
  beforeEach(() => backing.clear())

  it('keeps the version the test assumes', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../settingsStore.ts', import.meta.url), 'utf8')
    expect(src).toMatch(new RegExp(`const STORE_VERSION = ${CURRENT}\\b`))
  })

  it.each([CURRENT, CURRENT - 1])('loads old and card personas from a version %i blob', async (version) => {
    seed([OLD_PERSONA, CARD_PERSONA], version)
    const store = await freshStore()
    const { personas, activePersonaId } = store.getState()
    expect(personas.find((p) => p.id === 'old')).toEqual(OLD_PERSONA)
    expect(personas.find((p) => p.id === 'card')).toEqual(CARD_PERSONA)
    expect(activePersonaId).toBe('old')
    expect(store.getState().getActivePersona()?.card).toBeUndefined()
  })
})
