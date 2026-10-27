/**
 * Durchsicht Runde 6, Schwerpunkt 6 (Kontextkuerzung am Handy).
 *
 * Der erste Test war der Beweis des Fehlers (damals mit it.fails markiert).
 * Seit Runde 7 ist der Fehler behoben und der Test ein gewoehnlicher. Die
 * Tests darunter halten die Behebung fest.
 *
 * Run: npx vitest run src/lib/__tests__/durchsicht-r6-kontext.test.ts
 */
import { describe, expect, it } from 'vitest'
import { fitToWindow, questionOf } from '../phone-context-fit'
import { REASONING_CONTINUE_STEER } from '../reasoning-round'
import { isLoopSteer } from '../loop-steers'
import { planReconcileSteer } from '../plan-reconcile'
import { unbackedLinksSteer } from '../unbacked-links'
import { ANKUENDIGUNG_STEER } from '../../api/agents/ankuendigung'

const page = (n: number) => `Line of a website with numbers 12345 and words. `.repeat(n)

describe('Durchsicht R6: ein Steuersatz der Agentenschleife gilt als "die Frage"', () => {
  it('die Frage des Nutzers bleibt in der Anfrage, auch wenn die Schleife danach einen Steuersatz als user-Nachricht angehaengt hat', () => {
    const question = 'Read the page about the harbour of Tromso and tell me when the ferry leaves on Sunday.'
    const messages = [
      { role: 'system', content: page(160) },
      { role: 'user', content: question },
      { role: 'assistant', content: page(45), tool_calls: [{ id: 'a', type: 'function', function: { name: 'web_fetch', arguments: '{"url":"https://example.com/a"}' } }] },
      { role: 'tool', tool_call_id: 'a', content: page(400) },
      { role: 'assistant', content: page(45) },
      // useAgentChat haengt solche Saetze als role "user" an (REASONING_CONTINUE_STEER, planReconcileSteer, unbackedLinksSteer).
      { role: 'user', content: REASONING_CONTINUE_STEER },
      { role: 'assistant', content: page(45), tool_calls: [{ id: 'b', type: 'function', function: { name: 'web_fetch', arguments: '{"url":"https://example.com/b"}' } }] },
      { role: 'tool', tool_call_id: 'b', content: page(400) },
    ]
    const fit = fitToWindow(messages, 4096)
    expect(fit.changed).toBe(true)
    // Gewuenscht (Kopfkommentar der Datei: "never the question being answered").
    expect(fit.messages.some((m) => m.role === 'user' && m.content === question)).toBe(true)
  })

  it('zur Einordnung: Werkzeugaufruf und Werkzeugergebnis bleiben dabei ein Paar (kein verwaistes tool)', () => {
    const messages = [
      { role: 'system', content: page(40) },
      { role: 'user', content: 'First question.' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'web_fetch', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'a', content: page(400) },
      { role: 'assistant', content: page(60) },
      { role: 'user', content: 'Second question.' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'b', type: 'function', function: { name: 'web_fetch', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'b', content: page(400) },
    ]
    const fit = fitToWindow(messages, 2048)
    const calls = new Set<string>()
    for (const m of fit.messages) {
      for (const c of ((m as { tool_calls?: Array<{ id: string }> }).tool_calls ?? [])) calls.add(c.id)
      if (m.role === 'tool') expect(calls.has((m as { tool_call_id: string }).tool_call_id)).toBe(true)
    }
  })
})

const QUESTION = 'Read the page about the harbour of Tromso and tell me when the ferry leaves on Sunday.'
const call = (id: string) => ({ role: 'assistant', content: page(45), tool_calls: [{ id, type: 'function', function: { name: 'web_fetch', arguments: `{"url":"https://example.com/${id}"}` } }] })
const result = (id: string) => ({ role: 'tool', tool_call_id: id, content: page(400) })
const hasQuestion = (list: Array<{ role: string; content?: unknown }>) => list.some((m) => m.role === 'user' && m.content === QUESTION)

describe('Runde 7, Befund 2: die Frage ist die letzte ECHTE Nutzernachricht', () => {
  it('die Steuersaetze mit eigener Quelle werden als solche erkannt, eine Frage nie', () => {
    expect(isLoopSteer(REASONING_CONTINUE_STEER)).toBe(true)
    expect(isLoopSteer(ANKUENDIGUNG_STEER)).toBe(true)
    expect(isLoopSteer(planReconcileSteer({ done: 7, total: 31, next: 'Write the "summary" file' }))).toBe(true)
    expect(isLoopSteer(unbackedLinksSteer(['https://nowhere.example/q?a=1']))).toBe(true)
    expect(isLoopSteer(unbackedLinksSteer(['https://x.example/', 'https://y.example/', 'https://z.example/', 'https://w.example/']))).toBe(true)
    for (const typed of [QUESTION, 'Stop', 'Your own todo list shows nothing, why?', 'Stop: tell me a joke without these links', '', undefined, 7]) {
      expect(isLoopSteer(typed)).toBe(false)
    }
  })

  it('ohne Angabe des Aufrufers: jeder Steuersatz mit Quelle laesst die Frage stehen', () => {
    const steers = [
      REASONING_CONTINUE_STEER,
      planReconcileSteer({ done: 1, total: 4, next: 'Fetch the timetable' }),
      unbackedLinksSteer(['https://invented.example/ferry']),
    ]
    for (const steer of steers) {
      const fit = fitToWindow([
        { role: 'system', content: page(160) },
        { role: 'user', content: QUESTION },
        call('a'), result('a'),
        { role: 'assistant', content: page(45) },
        { role: 'user', content: steer },
        call('b'), result('b'),
      ], 4096)
      expect(fit.changed).toBe(true)
      expect(hasQuestion(fit.messages), steer.slice(0, 40)).toBe(true)
      expect(fit.over).toBe(false)
    }
  })

  it('mit Angabe des Aufrufers: auch ein Satz, den niemand kennt, gilt nicht als Frage', () => {
    // So schreibt die Schleife mehrere Saetze an Ort und Stelle (useAgentChat.ts), ohne eigene Quelle.
    const inPlace = 'web_fetch is switched off for this conversation in the tool permissions, so it was not run. Do not call it again.'
    const messages = [
      { role: 'system', content: page(160) },
      { role: 'user', content: 'An older question that may go.' },
      { role: 'assistant', content: page(60) },
      { role: 'user', content: QUESTION },
      // Vor der ersten Runde angehaengt, ebenfalls als user (Plananker, Fanout).
      { role: 'user', content: 'Resume the plan: 2 of 5 steps are done.' },
      call('a'), result('a'),
      { role: 'user', content: inPlace },
      call('b'), result('b'),
    ]
    expect(isLoopSteer(inPlace)).toBe(false)
    // Die Schleife liest die Frage, bevor sie selbst etwas anhaengt.
    expect(questionOf(messages.slice(0, 4))).toBe(QUESTION)
    const fit = fitToWindow(messages, 4096, 0, QUESTION)
    expect(fit.changed).toBe(true)
    expect(hasQuestion(fit.messages)).toBe(true)
    expect(fit.messages.some((m) => m.content === 'An older question that may go.')).toBe(false)
    // Ohne die Angabe waere der unbekannte Satz "die Frage" gewesen: das ist der Grund fuer die Angabe.
    expect(hasQuestion(fitToWindow(messages, 4096).messages)).toBe(false)
  })

  it('ein langer Lauf: die Frage und der Systemtext bleiben, die aeltesten Runden des Laufs gehen, kein tool verwaist', () => {
    const system = page(160)
    const messages: Array<{ role: string; content: string; tool_calls?: Array<{ id: string }>; tool_call_id?: string }> = [
      { role: 'system', content: system },
      { role: 'user', content: QUESTION },
    ]
    for (let i = 0; i < 30; i++) {
      messages.push(call(`r${i}`) as never, result(`r${i}`))
      if (i % 7 === 3) messages.push({ role: 'user', content: REASONING_CONTINUE_STEER })
    }
    const fit = fitToWindow(messages, 4096, 0, QUESTION)
    expect(fit.over).toBe(false)
    expect(fit.messages[0]).toBe(messages[0])
    expect(fit.messages[1].content).toBe(QUESTION)
    // Die Runde, die gerade lief, ist noch da.
    expect(fit.messages.some((m) => m.tool_call_id === 'r29')).toBe(true)
    expect(fit.messages.some((m) => m.tool_call_id === 'r0')).toBe(false)
    const calls = new Set<string>()
    for (const m of fit.messages) {
      for (const c of m.tool_calls ?? []) calls.add(c.id)
      if (m.role === 'tool') expect(calls.has(m.tool_call_id as string)).toBe(true)
    }
  })

  it('die Frage wird erst gekuerzt, wenn sonst nichts mehr zu kuerzen ist, und nie entfernt', () => {
    const pasted = `Summarize this for me: ${page(900)}`
    const messages = [
      { role: 'system', content: page(40) },
      { role: 'user', content: QUESTION },
      { role: 'assistant', content: page(300) },
      { role: 'user', content: pasted },
    ]
    // Ein langer Text daneben: er wird gekuerzt, die Frage bleibt ganz.
    const roomy = fitToWindow([messages[0], { role: 'user', content: QUESTION }, { role: 'assistant', content: page(300) }, { role: 'user', content: REASONING_CONTINUE_STEER }], 2048)
    expect(roomy.messages.some((m) => m.content === QUESTION)).toBe(true)
    // Die Frage allein ist groesser als das Fenster: sie bleibt als Nachricht, gekuerzt.
    const fit = fitToWindow(messages, 2048)
    const last = fit.messages[fit.messages.length - 1]
    expect(last.role).toBe('user')
    expect((last.content as string).startsWith('Summarize this for me:')).toBe(true)
    expect((last.content as string).length).toBeLessThan(pasted.length)
    expect(fit.messages[0]).toBe(messages[0])
    expect(fit.over).toBe(false)
  })
})
