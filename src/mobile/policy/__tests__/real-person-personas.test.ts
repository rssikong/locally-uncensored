/**
 * @vitest-environment jsdom
 *
 * Second check on Android, F11: the Play package listed built in personas
 * named "Morgan Freeman" and "Chef Ramsay". Decided 10.10.2026: the presets
 * play and appstore do not offer a built in persona that carries the name of
 * a real person or plays on a brand name. The open build is unchanged.
 * Switch `realPersonPersonas` (policy/storePolicy.ts), turned back by one line.
 *
 * Run: npx vitest run src/mobile/policy/__tests__/real-person-personas.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BUILT_IN_PERSONAS } from '../../../lib/constants'
import { useChatStore } from '../../../stores/chatStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { enforcePersonaPolicy, unlistedGroupPersonaPicks } from '../../boot/personas'
import { PERSONA_NAMESAKES, PLAIN_PERSONA_ID, REAL_PERSON_PERSONAS, STORE_HIDDEN_PERSONAS, allowedActivePersona, offeredPersonas, personaHidden, shownPersona } from '../personas'
import { STORE_PRESETS, setStorePresetForTests } from '../storePolicy'

const ids = (list: ReadonlyArray<{ id: string }>) => list.map((p) => p.id)

describe('which built in personas carry the name of a real person', () => {
  it('every built in persona is classified, and nothing else is', () => {
    expect(Object.keys(PERSONA_NAMESAKES).sort()).toEqual(ids(BUILT_IN_PERSONAS).sort())
    expect(BUILT_IN_PERSONAS).toHaveLength(25)
  })

  it('the three that are not invented are the narrator, the chef and the play on a product name', () => {
    expect([...REAL_PERSON_PERSONAS].sort()).toEqual(['chadgpt', 'gordon', 'narrator'])
    const name = (id: string) => BUILT_IN_PERSONAS.find((p) => p.id === id)!.name
    expect(name('narrator')).toBe('Morgan Freeman')
    expect(name('gordon')).toBe('Chef Ramsay')
    expect(name('chadgpt')).toBe('ChadGPT')
  })

  it('the classification is held against the personas themselves: a known name in a name or after "You are" is never "invented"', () => {
    // People and products an instruction could name. Not complete and not meant to be: it catches the two of the
    // check and their like, and a new persona still has to be classified by hand (first test).
    const known = /morgan freeman|gordon ramsay|ramsay|chatgpt|chadgpt|elon musk|trump|obama|taylor swift|einstein|steve jobs|snoop|attenborough|joe rogan|yoda|sherlock|darth vader|batman|shrek/i
    for (const persona of BUILT_IN_PERSONAS) {
      const speaksAs = /^you are ([^.,]+)/i.exec(persona.systemPrompt)?.[1] ?? ''
      if (known.test(persona.name) || known.test(speaksAs)) expect(PERSONA_NAMESAKES[persona.id], persona.id).not.toBe('invented')
    }
    // And no invented one is named like a person: two capitalised words that are a first and a last name.
    const invented = BUILT_IN_PERSONAS.filter((p) => PERSONA_NAMESAKES[p.id] === 'invented').map((p) => p.name)
    expect(invented).toEqual([
      'Helpful Assistant', 'Code Expert', 'Writing Coach', 'Research Analyst', 'Translator', 'No Filter', "Devil's Advocate", 'Sigma Grindset', 'Roast Master',
      'Conspiracy Brain', 'Drunk Professor', 'Supervillain', 'Time Traveler', 'Maximum Sarcasm', 'Unhinged Therapist', 'AI Pirate', 'Existential Crisis',
      'Gen Alpha Brain', 'L33T H4X0R', 'Confused Alien', 'Rizz Coach', 'Medieval Peasant',
    ])
  })
})

describe('the switch realPersonPersonas', () => {
  it('is on in the open build and off in both store builds', () => {
    expect(STORE_PRESETS.open.realPersonPersonas).toBe(true)
    expect(STORE_PRESETS.play.realPersonPersonas).toBe(false)
    expect(STORE_PRESETS.appstore.realPersonPersonas).toBe(false)
  })

  it('open lists all 25, unchanged and under their own names', () => {
    expect(offeredPersonas(BUILT_IN_PERSONAS, STORE_PRESETS.open)).toEqual([...BUILT_IN_PERSONAS])
  })

  for (const preset of ['play', 'appstore'] as const) {
    it(`${preset} lists neither "Morgan Freeman" nor "Chef Ramsay", and 20 remain`, () => {
      const shown = offeredPersonas(BUILT_IN_PERSONAS, STORE_PRESETS[preset])
      expect(shown.map((p) => p.name).filter((n) => /freeman|ramsay|chadgpt/i.test(n))).toEqual([])
      const gone = new Set([...STORE_HIDDEN_PERSONAS, ...REAL_PERSON_PERSONAS])
      expect(ids(shown)).toEqual(ids(BUILT_IN_PERSONAS).filter((id) => !gone.has(id)))
      expect(shown).toHaveLength(20)
      expect(shownPersona(BUILT_IN_PERSONAS.find((p) => p.id === 'narrator'), STORE_PRESETS[preset])).toBeUndefined()
      expect(shownPersona(BUILT_IN_PERSONAS.find((p) => p.id === 'gordon'), STORE_PRESETS[preset])).toBeUndefined()
    })
  }

  it('is a switch of its own: with it off and the other one on, only the three are gone and nothing is renamed', () => {
    const only = { unfilteredPersonas: true, realPersonPersonas: false }
    const shown = offeredPersonas(BUILT_IN_PERSONAS, only)
    expect(ids(shown)).toEqual(ids(BUILT_IN_PERSONAS).filter((id) => !REAL_PERSON_PERSONAS.includes(id)))
    expect(shown.find((p) => p.id === PLAIN_PERSONA_ID)?.name).toBe('No Filter')
    expect(personaHidden('roast', only)).toBe(false)
    expect(personaHidden('narrator', only)).toBe(true)
    // Turned back: the one line in the preset.
    expect(personaHidden('narrator', { unfilteredPersonas: false, realPersonPersonas: true })).toBe(false)
  })

  it('a persona the user wrote keeps its name, whatever it is', () => {
    const own = { id: 'own-1', name: 'Morgan Freeman', isBuiltIn: false }
    expect(offeredPersonas([own], STORE_PRESETS.play)).toEqual([own])
    expect(shownPersona(own, STORE_PRESETS.appstore)).toBe(own)
  })

  it('one that was active falls back to the default', () => {
    for (const id of REAL_PERSON_PERSONAS) expect(allowedActivePersona(id, STORE_PRESETS.play)).toBe(PLAIN_PERSONA_ID)
    expect(allowedActivePersona('pirate', STORE_PRESETS.play)).toBe('pirate')
    expect(allowedActivePersona('narrator', STORE_PRESETS.open)).toBe('narrator')
  })
})

describe('a store build that starts with such a persona in use', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [], activeConversationId: null })
  })
  afterEach(() => setStorePresetForTests(null))

  it('play: the active persona and a pick of a group chat are taken back at the start', () => {
    setStorePresetForTests('play')
    useSettingsStore.getState().setActivePersona('narrator')
    expect(unlistedGroupPersonaPicks({ 'lu-cloud::a': 'gordon', 'lu-cloud::b': 'pirate' })).toEqual(['lu-cloud::a'])
    enforcePersonaPolicy()
    expect(useSettingsStore.getState().activePersonaId).toBe(PLAIN_PERSONA_ID)
    // And when it is chosen again later, by a backup or an older page.
    useSettingsStore.getState().setActivePersona('gordon')
    expect(useSettingsStore.getState().activePersonaId).toBe(PLAIN_PERSONA_ID)
    // The list of the settings store itself is not changed: nothing is deleted from the phone.
    expect(useSettingsStore.getState().personas.some((p) => p.id === 'narrator')).toBe(true)
  })

  it('open: it stays', () => {
    setStorePresetForTests('open')
    useSettingsStore.getState().setActivePersona('narrator')
    enforcePersonaPolicy()
    expect(useSettingsStore.getState().activePersonaId).toBe('narrator')
    expect(unlistedGroupPersonaPicks({ 'lu-cloud::a': 'gordon' })).toEqual([])
  })
})
