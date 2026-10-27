/**
 * Personas in a store build (switches unfilteredPersonas and realPersonPersonas).
 *
 * Three things, and nothing is deleted from the phone for any of them:
 *  - The default persona sends no instruction of its own. The product calls
 *    it "No Filter", which reads like a promise. A store build shows the
 *    same persona as "No persona".
 *  - A few built in personas tell the model to drop its limits ("no topic is
 *    off limits", "unfiltered"). A store build does not list them, and one
 *    that was active before is no longer used (boot/personas.ts).
 *  - A few carry the name of a real person or play on a brand name
 *    ("Morgan Freeman", "Chef Ramsay", "ChadGPT"). A store build does not
 *    list them either, by a switch of its own (realPersonPersonas), and a
 *    chat that used one goes on with the default.
 *
 * Personas the user wrote are his own text and stay as they are.
 */
import { POLICY } from '../strings/policy'
import { storePolicy, type StorePolicy } from './storePolicy'

/** The default persona of the settings store: no instruction of its own. */
export const PLAIN_PERSONA_ID = 'unrestricted'

/** Built in personas a store build does not list. Held against the instructions themselves by policy/__tests__/gates.test.ts. */
export const STORE_HIDDEN_PERSONAS: readonly string[] = ['roast', 'chadgpt', 'therapist']

/**
 * Whose name a built in persona carries (switch realPersonPersonas).
 *
 *  - `invented`: a role nobody is ("AI Pirate", "Drunk Professor").
 *  - `real-person`: the name of a living person, or an instruction that says
 *    "you are" that person.
 *  - `brand`: a play on the name of somebody's product.
 *
 * Every built in persona stands here, so a new one cannot be added without
 * saying which kind it is (policy/__tests__/real-person-personas.test.ts).
 * The list was gone through on 10.10.2026 (mobile-docs/r12/funde.md, F11).
 * Names that an instruction only mentions (philosophers who died long ago,
 * a film, a word of the internet) do not make a persona that person.
 */
export type PersonaNamesake = 'invented' | 'real-person' | 'brand'

export const PERSONA_NAMESAKES: Readonly<Record<string, PersonaNamesake>> = {
  assistant: 'invented',
  coder: 'invented',
  writer: 'invented',
  researcher: 'invented',
  translator: 'invented',
  unrestricted: 'invented',
  devil: 'invented',
  sigma: 'invented',
  roast: 'invented',
  conspiracy: 'invented',
  'drunk-prof': 'invented',
  villain: 'invented',
  'time-traveler': 'invented',
  sarcasm: 'invented',
  // "ChadGPT": the name of OpenAI's product with one letter changed.
  chadgpt: 'brand',
  therapist: 'invented',
  pirate: 'invented',
  philosopher: 'invented',
  'gen-alpha': 'invented',
  // Named "Morgan Freeman" and told to narrate in his style.
  narrator: 'real-person',
  hacker: 'invented',
  // Named "Chef Ramsay"; the instruction begins "You are Gordon Ramsay" and names his show.
  gordon: 'real-person',
  alien: 'invented',
  rizz: 'invented',
  medieval: 'invented',
}

/** Built in personas a build without `realPersonPersonas` does not list. */
export const REAL_PERSON_PERSONAS: readonly string[] = Object.keys(PERSONA_NAMESAKES).filter((id) => PERSONA_NAMESAKES[id] !== 'invented')

/** Pure: does an instruction tell the model to drop its limits. */
export function dropsLimits(instruction: string): boolean {
  return /unfiltered|uncensored|no topic is off limits|off[- ]limits|inappropriate|nsfw|no (rules|limits|restrictions)|without (any )?(rules|limits|restrictions)/i.test(instruction)
}

interface PersonaLike {
  id: string
  name: string
  isBuiltIn?: boolean
}

type Switch = Pick<StorePolicy, 'unfilteredPersonas' | 'realPersonPersonas'>

/** Pure: is this built in persona left out of this build, for either of the two reasons. */
export function personaHidden(id: string, policy: Switch = storePolicy()): boolean {
  if (!policy.unfilteredPersonas && STORE_HIDDEN_PERSONAS.includes(id)) return true
  return !policy.realPersonPersonas && REAL_PERSON_PERSONAS.includes(id)
}

/** Pure: a persona as this build shows it, or undefined when this build does not list it. */
export function shownPersona<P extends PersonaLike>(persona: P | undefined, policy: Switch = storePolicy()): P | undefined {
  if (!persona || persona.isBuiltIn === false) return persona
  if (personaHidden(persona.id, policy)) return undefined
  if (!policy.unfilteredPersonas && persona.id === PLAIN_PERSONA_ID) return { ...persona, name: POLICY.plainPersonaName }
  return persona
}

/** Pure: the personas this build lists, under the names it shows. */
export function offeredPersonas<P extends PersonaLike>(personas: readonly P[], policy: Switch = storePolicy()): P[] {
  if (policy.unfilteredPersonas && policy.realPersonPersonas) return [...personas]
  return personas.flatMap((persona) => {
    const shown = shownPersona(persona, policy)
    return shown ? [shown] : []
  })
}

/** Pure: the id a build may keep as the active persona. A hidden one falls back to the default. */
export function allowedActivePersona(id: string, policy: Switch = storePolicy()): string {
  return personaHidden(id, policy) ? PLAIN_PERSONA_ID : id
}
