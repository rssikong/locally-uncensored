/**
 * Zusammengefuehrter Stand statt Kette, und das anpassbare Fenster der
 * juengsten Zuege (3.0.7, Issue #151).
 *
 * Vorher schickte jede Nutzlast die ganze Kette der Zusammenfassungen. Jetzt
 * fuehrt eine neue Verdichtung den alten Stand mit den neuen Zuegen zu EINEM
 * Stand zusammen, und nur der geht mit. Was diese Datei festhaelt:
 *
 *  - Pfad, Zahl und offene Aufgabe aus dem alten Stand ueberleben, auch wenn
 *    die neuen Zuege sie nicht erwaehnen: mit einem gespielten Modell, das tut,
 *    was der Prompt verlangt, und mit einem, das sie fallen laesst (dann haengt
 *    die Pruefung danach sie wieder an).
 *  - Die Nutzlast traegt danach nur den neuesten Stand.
 *  - Scheitert die Zusammenfuehrung, bleibt die alte Kette und nichts geht
 *    verloren.
 *  - Wie viele juengste Nachrichten woertlich bleiben, haengt am Kontext.
 *  - Alte gespeicherte Chats mit Kette laden und funktionieren weiter.
 *
 * Ersetzt wird nur der Anbieter (der Modellaufruf) und die Fensterabfrage.
 * Speicher, Prompt, Lesen, Pruefen und Anwenden laufen echt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../api/providers', () => ({
  getProviderForModel: vi.fn(),
  getProviderIdFromModel: vi.fn(() => 'ollama'),
}))
vi.mock('../agent-num-ctx', () => ({
  resolveAgentNumCtxWithConfidence: vi.fn(),
}))

import { getProviderForModel } from '../../api/providers'
import { resolveAgentNumCtxWithConfidence } from '../agent-num-ctx'
import {
  runCompactForConversation,
  keepRecentCount,
  resolveSendWindow,
  KEEP_AFTER_COMPACT,
  KEEP_MIN,
  KEEP_MAX,
  compactOutcomeMessage,
} from '../run-compact-command'
import {
  applyStoredCompaction,
  chainToSend,
  compactSummaryBody,
  keepVerbatimFromPrevious,
  parseCompactSummary,
  renderCompactSummary,
  stateFromStored,
  COMPACT_OPEN,
  EMPTY_SUMMARY,
  type CompactSummary,
} from '../compact-summary'
import { useChatStore } from '../../stores/chatStore'
import type { CompactionRecord, Conversation, Message } from '../../types/chat'

const providerFor = getProviderForModel as unknown as ReturnType<typeof vi.fn>
const numCtx = resolveAgentNumCtxWithConfidence as unknown as ReturnType<typeof vi.fn>

const CHAT_ID = 'conv-merge'
const MODEL = 'qwen:4b'

// Was der alte Stand traegt und was die neuen Zuege NIE erwaehnen.
const PFAD = 'src/export/invoice-export.ts'
const ZAHL = '47,3'
const OFFEN = 'Hochladen der Exportdatei auf den Server steht noch aus.'
const BITTE = '"aber nie mehr als 3 Dateien auf einmal"'

const ALTER_STAND: CompactSummary = {
  ...EMPTY_SUMMARY,
  task: 'Rechnungsexport bauen.',
  requests: BITTE,
  progress: 'Export als CSV geschrieben.',
  facts: `Datei ${PFAD}, Summe ${ZAHL} Millionen Euro, Befehl \`npm run export -- --year 2026\`.`,
  open: OFFEN,
}

const satz = (
  id: string,
  summary: string,
  upToMessageId: string,
  extra: Partial<CompactionRecord> = {},
): CompactionRecord => ({
  id, summary, upToMessageId, replaced: 1, atMessageCount: 1,
  tokensBefore: 100, tokensAfter: 10, trigger: 'manual', at: 1, ...extra,
})

const lang = (i: number) =>
  `Zug ${i}: Die Spalten der Tabelle werden umbenannt und die Kopfzeile neu sortiert. `.repeat(4)

/** N sichtbare Nachrichten ab Nummer `ab`, abwechselnd Nutzer und Modell. */
const nachrichten = (n: number, ab = 0): Message[] =>
  Array.from({ length: n }, (_, k) => {
    const i = ab + k
    return { id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: lang(i), timestamp: 1 } as Message
  })

function chatMit(messages: Message[], compactions?: CompactionRecord[]) {
  const conv: Conversation = {
    id: CHAT_ID, title: 'T', messages, model: MODEL, systemPrompt: '',
    compactions, createdAt: 1, updatedAt: 1,
  }
  useChatStore.setState({ conversations: [conv] })
}

const gespeichert = () =>
  useChatStore.getState().conversations.find((c) => c.id === CHAT_ID)?.compactions ?? []

// ── Die gespielten Modelle ─────────────────────────────────────────────────

/** Der Teil eines Prompts zwischen zwei Markierungen. */
function zwischen(text: string, von: string, bis: string): string {
  const a = text.indexOf(von)
  const b = text.indexOf(bis)
  return a === -1 || b === -1 ? '' : text.slice(a + von.length, b).trim()
}

function alsAntwort(s: CompactSummary): string {
  return renderCompactSummary(s).split('\n').slice(2, -1).join('\n')
}

/**
 * Ein Modell, das tut, was der Prompt verlangt. Bei einer Zusammenfuehrung
 * uebernimmt es den alten Stand nach den Regeln des Prompts und fuegt aus den
 * neuen Zuegen eine Zeile hinzu. Ohne alten Stand fasst es nur die Zuege
 * zusammen.
 */
function gehorsam(prompt: string): string {
  const alt = zwischen(prompt, '--- PREVIOUS RECORD ---', '--- END PREVIOUS RECORD ---')
  const neu = zwischen(prompt, '--- NEW TURNS ---', '--- END NEW TURNS ---')
    || zwischen(prompt, '--- TRANSCRIPT ---', '--- END TRANSCRIPT ---')
  const ersterZug = neu.split('\n').find((l) => l.trim())?.slice(0, 40) ?? ''
  const neuerFakt = `Neue Spaltennamen festgelegt (${ersterZug.trim()}).`
  if (!alt) {
    return alsAntwort({ ...EMPTY_SUMMARY, task: 'Spalten umbenennen.', progress: neuerFakt })
  }
  const s = parseCompactSummary(alt)
  return alsAntwort({
    ...s,
    progress: [s.progress, neuerFakt].filter(Boolean).join('\n'),
  })
}

/** Ein Modell, das den alten Stand nur ungefaehr nacherzaehlt. */
function nachlaessig(): string {
  return alsAntwort({
    ...EMPTY_SUMMARY,
    task: 'Rechnungsexport bauen.',
    progress: 'Export geschrieben, Spalten umbenannt.',
    facts: 'Exportdatei liegt im Abrechnungsordner.',
  })
}

let modell: (prompt: string) => string
let prompts: string[]

beforeEach(() => {
  prompts = []
  modell = gehorsam
  providerFor.mockReset()
  providerFor.mockImplementation((name: string) => ({
    modelId: name,
    provider: {
      chatStream: async function* (_m: string, messages: Array<{ content: string }>) {
        const prompt = messages[0].content
        prompts.push(prompt)
        yield { content: modell(prompt), done: false }
        yield { content: '', done: true }
      },
    },
  }))
  numCtx.mockReset()
  numCtx.mockResolvedValue({ ctx: 0, gemessen: false })
  useChatStore.setState({ conversations: [] })
})

const lauf = (extra: Record<string, unknown> = {}) =>
  runCompactForConversation({
    conversationId: CHAT_ID, activeModel: MODEL, trigger: 'manual', window: 0, ...extra,
  })

/** Ein Chat mit einer alten Kette aus zwei Gliedern vor m9, wie vor 3.0.7 gespeichert. */
function alterChatMitKette() {
  const erster = renderCompactSummary({ ...ALTER_STAND, open: '', requests: '' })
  const zweiter = renderCompactSummary({ ...EMPTY_SUMMARY, requests: BITTE, open: OFFEN })
  chatMit(nachrichten(30), [satz('r1', erster, 'm4'), satz('r2', zweiter, 'm9')])
  return { erster, zweiter }
}

// ── Die Pruefung nach dem Lauf, ohne Modell ────────────────────────────────

describe('keepVerbatimFromPrevious', () => {
  it('haengt Pfad, Zahl, Befehl, offene Aufgabe und Bitte wieder an, wenn das Modell sie fallen laesst', () => {
    const neu = parseCompactSummary(nachlaessig())
    const { summary, restored } = keepVerbatimFromPrevious(ALTER_STAND, neu, 'user: Spalten umbenennen')
    const text = renderCompactSummary(summary)
    expect(text).toContain(PFAD)
    expect(text).toContain(ZAHL)
    expect(text).toContain('npm run export -- --year 2026')
    expect(summary.open).toContain(OFFEN)
    expect(summary.requests).toContain(BITTE)
    expect(restored).toBe(3)
  })

  it('laesst nichts doppelt stehen, was das Modell behalten hat', () => {
    const { summary, restored } = keepVerbatimFromPrevious(ALTER_STAND, { ...ALTER_STAND }, '')
    expect(restored).toBe(0)
    expect(summary).toEqual(ALTER_STAND)
  })

  it('eine offene Aufgabe, von der die neuen Zuege reden, darf das Modell schliessen', () => {
    const neu = { ...ALTER_STAND, open: '', progress: 'Exportdatei hochgeladen.' }
    const zuege = 'assistant: Das Hochladen der Exportdatei auf den Server ist erledigt.'
    const { summary } = keepVerbatimFromPrevious(ALTER_STAND, neu, zuege)
    expect(summary.open).toBe('')
  })

  it('ein Codeblock kommt als Ganzes zurueck, nicht zeilenweise', () => {
    const alt = { ...EMPTY_SUMMARY, facts: 'Aufruf:\n```\nnpm run export -- --year 2026\n```' }
    const { summary } = keepVerbatimFromPrevious(alt, { ...EMPTY_SUMMARY, task: 'x' }, '')
    expect(summary.facts).toContain('```\nnpm run export -- --year 2026\n```')
  })
})

// ── Der ganze Lauf ─────────────────────────────────────────────────────────

describe('Zusammenfuehren: aus der Kette wird ein Stand', () => {
  it('ein gehorsames Modell: alles aus dem alten Stand steht im neuen, der Datensatz ist zusammengefuehrt', async () => {
    alterChatMitKette()
    const r = await lauf()
    expect(r.ok).toBe(true)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('--- PREVIOUS RECORD ---')
    // Der Prompt bekommt den Stand der GANZEN Kette, nicht nur des letzten Glieds.
    expect(prompts[0]).toContain(PFAD)
    expect(prompts[0]).toContain(OFFEN)

    const rec = r.ok ? r.record : null
    expect(rec?.merged).toBe(true)
    for (const muss of [PFAD, ZAHL, OFFEN, BITTE, 'Neue Spaltennamen']) {
      expect(rec?.summary).toContain(muss)
    }
  })

  it('ein nachlaessiges Modell: die Pruefung haengt das Fehlende wieder an', async () => {
    alterChatMitKette()
    modell = (p) => (p.includes('--- PREVIOUS RECORD ---') ? nachlaessig() : gehorsam(p))
    const r = await lauf()
    expect(r.ok && r.record.merged).toBe(true)
    const s = r.ok ? r.record.summary : ''
    expect(s).toContain(PFAD)
    expect(s).toContain(ZAHL)
    expect(s).toContain(OFFEN)
    expect(s).toContain(BITTE)
  })

  it('die Nutzlast traegt danach nur den neuesten Stand', async () => {
    const { erster, zweiter } = alterChatMitKette()
    const r = await lauf()
    expect(r.ok).toBe(true)
    const records = gespeichert()
    expect(records).toHaveLength(3)
    // Die alten Datensaetze bleiben gespeichert, fuer Verlauf und Anzeige.
    expect(records[0].summary).toBe(erster)
    expect(records[1].summary).toBe(zweiter)

    const msgs = useChatStore.getState().conversations[0].messages
    const out = applyStoredCompaction(msgs, records)
    expect(out.rendered).toBe(records[2].summary)
    expect(out.rendered.split(COMPACT_OPEN)).toHaveLength(2)
    expect(out.rendered).toContain(PFAD)
  })

  it('eine dritte Verdichtung fuehrt den zusammengefuehrten Stand weiter, ohne ihn doppelt zu nehmen', async () => {
    alterChatMitKette()
    await lauf()
    // Der Chat waechst, dann noch einmal.
    const conv = useChatStore.getState().conversations[0]
    useChatStore.setState({
      conversations: [{ ...conv, messages: [...conv.messages, ...nachrichten(20, 30)] }],
    })
    prompts = []
    const r = await lauf()
    expect(r.ok && r.record.merged).toBe(true)
    const alt = zwischen(prompts[0], '--- PREVIOUS RECORD ---', '--- END PREVIOUS RECORD ---')
    // Nur der zusammengefuehrte Stand, nicht noch einmal die alten Glieder davor.
    expect(alt.split(PFAD)).toHaveLength(2)
    const records = gespeichert()
    const out = applyStoredCompaction(useChatStore.getState().conversations[0].messages, records)
    expect(out.rendered).toBe(records[records.length - 1].summary)
    expect(out.rendered).toContain(OFFEN)
  })
})

describe('Rueckfall: eine gescheiterte Zusammenfuehrung verliert nichts', () => {
  it('scheitert der Zusammenfuehrungsaufruf, wird wie frueher ein Kettenglied gespeichert und die Kette geht mit', async () => {
    const { erster, zweiter } = alterChatMitKette()
    modell = (p) => {
      if (p.includes('--- PREVIOUS RECORD ---')) throw new Error('backend weg')
      return gehorsam(p)
    }
    const r = await lauf()
    expect(r.ok).toBe(true)
    expect(prompts).toHaveLength(2)
    expect(r.ok && r.record.merged).toBeFalsy()

    const records = gespeichert()
    const out = applyStoredCompaction(useChatStore.getState().conversations[0].messages, records)
    expect(out.rendered).toBe([erster, zweiter, records[2].summary].join('\n\n'))
    expect(out.rendered).toContain(PFAD)
    expect(out.rendered).toContain(OFFEN)
  })

  it('eine unbrauchbare Antwort auf die Zusammenfuehrung faellt ebenso auf die Kette zurueck', async () => {
    alterChatMitKette()
    modell = (p) => (p.includes('--- PREVIOUS RECORD ---') ? '' : gehorsam(p))
    const r = await lauf()
    expect(r.ok && r.record.merged).toBeFalsy()
    expect(gespeichert()).toHaveLength(3)
  })

  it('scheitern beide Aufrufe, bleibt der Chat genau wie er war', async () => {
    alterChatMitKette()
    const vorher = gespeichert()
    modell = () => { throw new Error('backend weg') }
    const r = await lauf()
    expect(r.ok).toBe(false)
    expect(gespeichert()).toEqual(vorher)
  })

  it('ein Abbruch startet keinen zweiten Aufruf', async () => {
    alterChatMitKette()
    const ac = new AbortController()
    modell = () => { ac.abort(); throw new Error('aborted') }
    const r = await lauf({ signal: ac.signal })
    expect(r).toMatchObject({ ok: false, reason: 'aborted' })
    expect(prompts).toHaveLength(1)
  })
})

describe('Alte gespeicherte Chats', () => {
  const n = (id: string) => ({ id, role: 'user', content: `Nachricht ${id}` })
  const verlauf = ['a', 'b', 'c', 'd', 'e', 'f'].map(n)

  it('eine Kette ohne zusammengefuehrten Stand geht wie bisher ganz mit', () => {
    const records = [satz('1', 'S1', 'b'), satz('2', 'S2', 'd')]
    const out = applyStoredCompaction(verlauf, records)
    expect(out.rendered).toBe('S1\n\nS2')
    expect(out.messages.map((m) => m.id)).toEqual(['e', 'f'])
  })

  it('ab einem zusammengefuehrten Stand geht nur er und was danach kam mit', () => {
    const records = [
      satz('1', 'S1', 'a'), satz('2', 'S2', 'b', { merged: true }), satz('3', 'S3', 'd'),
    ]
    expect(applyStoredCompaction(verlauf, records).rendered).toBe('S2\n\nS3')
    expect(chainToSend(records, 1).map((r) => r.id)).toEqual(['2'])
  })

  it('ist der Anker des zusammengefuehrten Stands geloescht, gilt die Kette davor', () => {
    const records = [satz('1', 'S1', 'a'), satz('2', 'S2', 'b'), satz('3', 'S3', 'weg', { merged: true })]
    expect(applyStoredCompaction(verlauf, records).rendered).toBe('S1\n\nS2')
  })

  it('ein alter Chat mit Kette laesst sich weiter verdichten, und danach traegt die Nutzlast einen Stand', async () => {
    alterChatMitKette()
    const vorher = applyStoredCompaction(useChatStore.getState().conversations[0].messages, gespeichert())
    expect(vorher.rendered.split(COMPACT_OPEN)).toHaveLength(3)
    const r = await lauf()
    expect(r.ok).toBe(true)
    const nachher = applyStoredCompaction(useChatStore.getState().conversations[0].messages, gespeichert())
    expect(nachher.rendered.split(COMPACT_OPEN)).toHaveLength(2)
  })

  it('stateFromStored liest auch eine alte Zusammenfassung ohne Ueberschriften', () => {
    const s = stateFromStored([{ summary: 'nur loser Text ohne Abschnitte', upToMessageId: 'x' }])
    expect(s.rest).toBe('nur loser Text ohne Abschnitte')
    expect(compactSummaryBody(renderCompactSummary(s))).toContain('nur loser Text')
  })
})

describe('Anpassbares Fenster der juengsten Zuege', () => {
  const kurz = Array.from({ length: 40 }, () => ({ content: 'ok' }))
  const mittel = Array.from({ length: 40 }, () => ({ content: 'x'.repeat(2000) }))

  it('ohne bekanntes Fenster bleibt es bei der festen Zahl', () => {
    expect(keepRecentCount(kurz, 0)).toBe(KEEP_AFTER_COMPACT)
    expect(keepRecentCount(kurz, undefined)).toBe(KEEP_AFTER_COMPACT)
    expect(keepRecentCount(kurz, Number.NaN)).toBe(KEEP_AFTER_COMPACT)
  })

  it('mehr Kontext behaelt mehr Nachrichten woertlich', () => {
    const klein = keepRecentCount(mittel, 8192)
    const gross = keepRecentCount(mittel, 32768)
    expect(gross).toBeGreaterThan(klein)
  })

  it('nie weniger als das Minimum, auch wenn eine einzige Nachricht das Budget sprengt', () => {
    const riesig = Array.from({ length: 10 }, () => ({ content: 'x'.repeat(100_000) }))
    expect(keepRecentCount(riesig, 8192)).toBe(KEEP_MIN)
  })

  it('nie mehr als der Deckel, auch bei riesigem Fenster', () => {
    expect(keepRecentCount(kurz, 1_000_000)).toBe(KEEP_MAX)
  })

  it('der Lauf schneidet je nach Fenster an einer anderen Stelle', async () => {
    const lange = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `Zug ${i} ` + 'x'.repeat(2000), timestamp: 1,
    })) as Message[]
    chatMit(lange)
    const klein = await lauf({ window: 8192 })
    chatMit(lange)
    const gross = await lauf({ window: 32768 })
    expect(klein.ok && gross.ok).toBe(true)
    const kept = (r: typeof klein) => (r.ok ? 40 - r.record.replaced : -1)
    expect(kept(klein)).toBe(keepRecentCount(lange, 8192))
    expect(kept(gross)).toBe(keepRecentCount(lange, 32768))
    expect(kept(gross)).toBeGreaterThan(kept(klein))
  })

  it('ohne mitgegebenes Fenster fragt der Lauf das Fenster selbst ab', async () => {
    numCtx.mockResolvedValue({ ctx: 32768, gemessen: true })
    const lange = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `Zug ${i} ` + 'x'.repeat(2000), timestamp: 1,
    })) as Message[]
    chatMit(lange)
    const r = await runCompactForConversation({ conversationId: CHAT_ID, activeModel: MODEL, trigger: 'manual' })
    const { window } = await resolveSendWindow(MODEL)
    expect(window).toBeGreaterThan(0)
    expect(r.ok && 40 - r.record.replaced).toBe(keepRecentCount(lange, window))
  })
})

// ── Box-Lauf 3, Befund H3 ──────────────────────────────────────────────────
//
// Ein zweites /compact direkt nach nur kurzen neuen Zuegen rief das Modell
// zweimal umsonst auf (die Zusammenfuehrung scheiterte an der Groessenregel,
// der Rueckfall ebenso) und meldete danach "These turns are already short".

describe('Kurze neue Zuege: kein Modellaufruf umsonst', () => {
  const kurzeZuege = (n: number, ab: number): Message[] =>
    Array.from({ length: n }, (_, k) => {
      const i = ab + k
      return { id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `ok ${i}`, timestamp: 1 } as Message
    })

  function chatMitKurzenNeuenZuegen() {
    const stand = renderCompactSummary(ALTER_STAND)
    chatMit([...nachrichten(10), ...kurzeZuege(8, 10)], [satz('r1', stand, 'm9', { merged: true })])
  }

  it('kurze neue Zuege: 0 Modellaufrufe und dieselbe Meldung wie bisher', async () => {
    chatMitKurzenNeuenZuegen()
    const vorher = gespeichert()
    const r = await lauf()
    expect(prompts).toHaveLength(0)
    expect(r).toEqual({ ok: false, reason: 'unusable', detail: 'not-smaller' })
    expect(compactOutcomeMessage(r)).toMatch(/already short/)
    expect(gespeichert()).toEqual(vorher)
  })

  it('auch ohne alten Stand: kurze Zuege, kein Aufruf', async () => {
    chatMit(kurzeZuege(12, 0))
    const r = await lauf()
    expect(prompts).toHaveLength(0)
    expect(r).toMatchObject({ ok: false, detail: 'not-smaller' })
  })

  it('lange neue Zuege: wie bisher genau ein Aufruf, zusammengefuehrt', async () => {
    chatMit(nachrichten(30), [satz('r1', renderCompactSummary(ALTER_STAND), 'm9', { merged: true })])
    const r = await lauf()
    expect(prompts).toHaveLength(1)
    expect(r.ok && r.record.merged).toBe(true)
  })

  it('ein treuer Stand mit den neuen Bitten woertlich scheitert nicht an der Groessenregel', async () => {
    // Die neuen Zuege sind fast nur Bitten des Nutzers. Ein Stand, der den
    // alten Stand und diese Bitten Wort fuer Wort traegt, ist so lang wie
    // verlangt; die alte Regel zaehlte das gegen den halben Anteil der Zuege.
    const bitte = (i: number) =>
      `Bitte ab jetzt jede Exportdatei mit dem Datum im Namen speichern, Nummer ${i}, und nie ueberschreiben.`
    const neue: Message[] = Array.from({ length: 24 }, (_, k) => {
      const i = 10 + k
      return {
        id: `m${i}`, role: i % 2 ? 'assistant' : 'user',
        content: i % 2 ? 'ok' : bitte(i), timestamp: 1,
      } as Message
    })
    chatMit([...nachrichten(10), ...neue], [satz('r1', renderCompactSummary(ALTER_STAND), 'm9', { merged: true })])
    modell = (p) => {
      const alt = parseCompactSummary(zwischen(p, '--- PREVIOUS RECORD ---', '--- END PREVIOUS RECORD ---'))
      const neuText = zwischen(p, '--- NEW TURNS ---', '--- END NEW TURNS ---')
      const bitten = neuText.split('\n').filter((l) => l.startsWith('user: ')).map((l) => l.slice(6))
      return alsAntwort({
        ...alt,
        requests: [alt.requests, ...bitten].join('\n'),
        progress: `${alt.progress}\nDateinamen mit Datum vereinbart.`,
      })
    }
    const r = await lauf()
    expect(prompts).toHaveLength(1)
    expect(r.ok && r.record.merged).toBe(true)
    expect(r.ok && r.record.summary).toContain(bitte(22))
    expect(r.ok && r.record.summary).toContain(PFAD)
  })
})
