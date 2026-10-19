/**
 * Der Grundtext geht wirklich raus, auf jeder Oberflaeche.
 *
 * Der Fund, den dieser Test festhaelt: der Personenschalter steht bewusst auf
 * aus, und die Zusammensetzung fiel damit auf einen LEEREN Systemtext zurueck.
 * Die Person zu reparieren half nichts, weil die Person gar nicht gefragt
 * wurde. Gemessen am 10.09.2026 kostet ein leerer Systemtext sechs von 46
 * Katalogmodellen die Antwort.
 *
 * Run: npx vitest run src/lib/__tests__/system-prompt.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CHAT_BASE_ROLE,
  CHAT_BASE_SYSTEM_PROMPT,
  HOUSE_CONDUCT,
  HOUSE_RULES,
  HOUSE_SCOPE,
  buildChatSystemPrompt,
  withHouseConduct,
} from '../system-prompt'
import { BUILT_IN_PERSONAS, DEFAULT_SETTINGS } from '../constants'
import { groupSystemPrompt } from '../group-chat'
import { buildHermesToolPrompt } from '../../api/hermes-tool-calling'
import {
  buildAgentSystemPrompt,
  buildAgentSystemPromptLean,
  buildChatToolsSystemPrompt,
} from '../../hooks/useAgentChat'

const SRC = resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8')

/** Vokabular, das dem Modell erst die Kategorie beibringt, an der es haengt. */
const POLICY = /\b(refuse|decline|disallowed|nsfw|explicit content|inappropriate|content policy|guidelines)\b/i

describe('system prompt', () => {
  it('never sends an empty system prompt, whatever the persona switch says', () => {
    for (const conv of [
      {},
      { personaEnabled: false, systemPrompt: 'ignored while off' },
      { personaEnabled: true, systemPrompt: '' },
      { personaEnabled: true, systemPrompt: '   ' },
      { personaEnabled: undefined, systemPrompt: undefined },
    ]) {
      const built = buildChatSystemPrompt(conv as never)
      expect(built.trim().length).toBeGreaterThan(40)
      expect(built).toContain(HOUSE_CONDUCT)
    }
  })

  it('falls back to the base role only when no persona is in play', () => {
    expect(buildChatSystemPrompt({ personaEnabled: false, systemPrompt: 'x' }))
      .toBe(CHAT_BASE_SYSTEM_PROMPT)
  })

  it('lets an enabled persona carry the role and only appends the house part', () => {
    const devil = BUILT_IN_PERSONAS.find((p) => p.id === 'devil')!
    const built = buildChatSystemPrompt({ personaEnabled: true, systemPrompt: devil.systemPrompt })
    expect(built).toBe(`${devil.systemPrompt}\n\n${HOUSE_RULES}`)
    expect(built).not.toContain("You are the user's own model")
  })

  it('states no content rule, neither permitting nor forbidding', () => {
    expect(CHAT_BASE_SYSTEM_PROMPT).not.toMatch(POLICY)
    expect(HOUSE_CONDUCT).not.toMatch(POLICY)
    expect(HOUSE_SCOPE).not.toMatch(POLICY)
    // Und keine Assistenten-Floskel, die die antrainierte Vorsicht anzieht.
    expect(CHAT_BASE_SYSTEM_PROMPT).not.toMatch(/\bhelpful\b|\bharmless\b|\bassistant\b/i)
  })

  it('appends the house part to a surface prompt exactly once', () => {
    const surface = 'You are the Coding Agent inside LU.'
    const once = withHouseConduct(surface)
    expect(once).toContain(HOUSE_CONDUCT)
    expect(withHouseConduct(once)).toBe(once)
  })

  /**
   * Der Waechter gegen den Rueckfall. Wer die naechste Oberflaeche baut,
   * schreibt sonst wieder `personaEnabled === true ? conv.systemPrompt : ''`,
   * und der Grundtext ist still wieder weg.
   */
  it('leaves no assembly point that can fall back to an empty string', () => {
    for (const file of ['hooks/useChat.ts', 'hooks/useAgentChat.ts']) {
      expect(read(file)).not.toMatch(/personaEnabled === true \? conv\.systemPrompt : ''/)
      // R5-1: der Aufruf traegt jetzt den globalen Schalter als zweites
      // Argument, wie im Web.
      // GH #170: the chat's persona comes through withChatPersona, the same
      // resolution the Plugins menu shows.
      expect(read(file)).toContain('buildChatSystemPrompt(withChatPersona(conv, personas, activePersonaId), settings.personasEnabled !== false)')
    }
  })

  /**
   * R5-1: der Chat las nur den Schalter der Unterhaltung. Wer Personen global
   * abschaltete, bekam die eingefrorene Person weiter geschickt, und der
   * Schalter tat sichtbar nichts.
   */
  it('der globale Schalter schlaegt den Schalter der Unterhaltung', () => {
    const mitPerson = { systemPrompt: 'You are a pirate.', personaEnabled: true }
    expect(buildChatSystemPrompt(mitPerson, true)).toContain('You are a pirate.')
    const aus = buildChatSystemPrompt(mitPerson, false)
    expect(aus).not.toContain('You are a pirate.')
    expect(aus).toBe(CHAT_BASE_SYSTEM_PROMPT)
    // Negativkontrolle: wer nichts uebergibt, bekommt das Verhalten von vorher.
    expect(buildChatSystemPrompt(mitPerson)).toContain('You are a pirate.')
  })

  /**
   * R5-2: stand der globale Schalter auf an, kaperte eine global gewaehlte
   * Person jede neue Unterhaltung, und der Grundtext kam nicht zum Zug.
   */
  it('frische Einstellungen schicken keine Person', () => {
    expect(DEFAULT_SETTINGS.personasEnabled).toBe(false)
  })

  it('carries the conduct line on the coding surface too', () => {
    expect(read('hooks/useCodex.ts')).toContain('withHouseConduct(')
  })
})

/**
 * Die Reichweitenzeile (HOUSE_SCOPE, Auftrag vom 11.09.2026).
 *
 * Gemessen wird der Text, der am Ende im Nachrichtenarray steht, nicht die
 * Konstante: jede Oberflaeche setzt ihn anders zusammen, und genau dabei ist
 * er vorher verlorengegangen (der Vergleich schickte nur die Person).
 *
 * "Genau einmal" ist die zweite Haelfte des Beweises. Ein Satz, der zweimal im
 * selben Systemtext steht, ist kein doppelter Nachdruck, sondern ein Zeichen,
 * dass zwei Stellen ihn anhaengen und die naechste Aenderung nur eine davon
 * trifft.
 */
describe('die Reichweitenzeile haengt an jeder Oberflaeche mit einem Menschen davor', () => {
  const zaehle = (heuhaufen: string, nadel: string) => heuhaufen.split(nadel).length - 1
  const HERMES_TOOLS = [{ name: 'file_read', description: 'read a file', parameters: {} }]

  /** Rolle, Verhaltenszeile und Reichweitenzeile, jede genau einmal. */
  const traegtDenHausteil = (text: string, mitRolle = true) => {
    expect(zaehle(text, HOUSE_SCOPE)).toBe(1)
    expect(zaehle(text, HOUSE_CONDUCT)).toBe(1)
    if (mitRolle) expect(zaehle(text, CHAT_BASE_ROLE)).toBe(1)
  }

  it('Chat ohne Person', () => {
    traegtDenHausteil(buildChatSystemPrompt({}))
  })

  it('Chat mit Person: Person, Verhaltenszeile, Reichweitenzeile, keine Grundrolle', () => {
    const mit = buildChatSystemPrompt({ personaEnabled: true, systemPrompt: 'You are a pirate.' })
    traegtDenHausteil(mit, false)
    expect(zaehle(mit, 'You are a pirate.')).toBe(1)
    expect(mit).not.toContain(CHAT_BASE_ROLE)
  })

  it('Agent, alle vier Zweige des Hooks', () => {
    const basis = buildChatSystemPrompt({})
    traegtDenHausteil(buildAgentSystemPrompt(basis, 'file_read, file_write'))
    traegtDenHausteil(buildAgentSystemPromptLean(basis, 'file_read'))
    traegtDenHausteil(buildChatToolsSystemPrompt(basis))
    traegtDenHausteil(`${buildHermesToolPrompt(HERMES_TOOLS)}\n\n${basis}`)
  })

  it('Code, mit und ohne Hermes-Werkzeugtext', () => {
    const code = withHouseConduct('You are the Coding Agent inside LU.')
    traegtDenHausteil(code, false)
    const unterHermes = `${buildHermesToolPrompt(HERMES_TOOLS)}\n\n${code}`
    traegtDenHausteil(unterHermes, false)
    // Der Werkzeugvertrag verdraengt den Grundtext nicht, beide stehen da.
    expect(unterHermes).toContain('<tool_call>')
    expect(unterHermes).toContain('You are the Coding Agent inside LU.')
  })

  it('Gruppenchat: jedes Mitglied traegt ihn einmal', () => {
    const personaPrompt = buildChatSystemPrompt({})
    for (const m of ['modell-a', 'modell-b', 'modell-c']) {
      traegtDenHausteil(groupSystemPrompt(m, ['modell-a', 'modell-b', 'modell-c'], personaPrompt))
    }
  })

  // Entscheid vom 12.09.2026: der Vergleich schickt gar keine Person mehr,
  // nur den Grundtext. Der Fall "mit Person" steht hier weiter, weil der Chat
  // ihn hat; fuer den Vergleich zaehlt die erste Zeile.
  it('Grundtext ohne Person, und mit Person traegt die Person die Rolle', () => {
    traegtDenHausteil(
      buildChatSystemPrompt({ systemPrompt: undefined, personaEnabled: false }),
    )
    traegtDenHausteil(
      buildChatSystemPrompt({ systemPrompt: 'You are a pirate.', personaEnabled: true }),
      false,
    )
    // R2-8: die Vorgabeperson TRUG den Grundtext als ihren eigenen Text. Wer
    // sie einschaltete, bekam den Hausteil deshalb zweimal, einmal aus der
    // Person und einmal aus der Zusammensetzung. `withHouseConduct` hat den
    // Schutz dagegen seit jeher, `buildChatSystemPrompt` hatte ihn nicht.
    traegtDenHausteil(
      buildChatSystemPrompt({
        systemPrompt: BUILT_IN_PERSONAS.find((p) => p.id === 'unrestricted')!.systemPrompt,
        personaEnabled: true,
      }),
    )
  })

  /**
   * Der Vergleich schickte bis zum 11.09.2026 `persona.systemPrompt` roh und
   * mit ausgeschalteter Person gar keinen Systemtext. Diese Zeile darf nicht
   * zurueckkommen.
   */
  it('der Vergleich baut den Systemtext und schickt nicht mehr die nackte Person', () => {
    const quelle = read('hooks/useABCompare.ts')
    expect(quelle).toContain('buildChatSystemPrompt(')
    expect(quelle).not.toMatch(/content: persona\.systemPrompt/)
    // Und seit dem 12.09.2026 holt er die Person gar nicht mehr. Der
    // Koerperbeweis steht in hooks/__tests__/der-vergleich-schickt-keine-person.
    expect(quelle).not.toMatch(/getActivePersona/)
  })

  /**
   * Die Gegenseite des Auftrags: in einen Hilfsaufruf mit Formatvertrag gehoert
   * der Satz NICHT. Dort konkurriert er mit dem Vertrag (JSON, Werkzeugaufruf)
   * und kann die Ausgabe zerlegen, ohne dass es jemand merkt.
   */
  it('bleibt aus den Hilfsaufrufen mit Formatvertrag heraus', () => {
    for (const datei of [
      'lib/memory-extraction.ts',
      'lib/context-compaction.ts',
      'lib/compact-summary.ts',
      'lib/workflow-engine.ts',
      'api/agents/architect.ts',
      'api/agents/sub-agent.ts',
      'api/hermes-tool-calling.ts',
    ]) {
      expect(read(datei)).not.toMatch(/from '[^']*system-prompt'/)
      expect(read(datei)).not.toContain('HOUSE_')
    }
  })

  /**
   * Der Satz nennt keine Kategorie, und er nennt auch das Wort nicht, das auf
   * lu-labs.ai nicht stehen darf: die Webfassung dieser Datei landet im
   * Buendel, das ein Browser von dieser Domain laedt.
   */
  it('nennt keine Kategorie und kein Vokabular der Zahlungsbeziehung', () => {
    expect(HOUSE_SCOPE).not.toMatch(POLICY)
    expect(HOUSE_SCOPE).not.toMatch(
      /uncensored|unrestricted|unfiltered|no filter|content filter|nsfw|nudity|porn|sexual|adult/i,
    )
    expect(HOUSE_RULES).toBe(`${HOUSE_CONDUCT} ${HOUSE_SCOPE}`)
  })
})
