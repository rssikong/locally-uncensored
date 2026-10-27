/**
 * Re-check on Android 8 GB, N2: a new chat as it comes (Agent off, Web search
 * on), "Search the web: who won the 2026 FIFA World Cup?", three of three no
 * search and no line saying so.
 *
 * Run: npx vitest run src/lib/__tests__/explicit-search.test.ts
 */
import { describe, expect, it } from 'vitest'
import { SEARCH_QUERY_MAX, explicitSearchQuery, withOrderedQuery, searchFallbackQuery, type SearchFallbackInput } from '../explicit-search'
import { detectChatToolCapability } from '../chat-tool-intent'

const ORDERS: Array<[string, string]> = [
    ['search the web for the latest stable version of Python', 'the latest stable version of Python'],
    ['Search the internet about solid state batteries', 'solid state batteries'],
    ['search online: cheapest train Berlin Prague', 'cheapest train Berlin Prague'],
    ['Please search the web for "tauri 2 android"', 'tauri 2 android'],
    ['Can you search the web for the weather in Oslo, please', 'the weather in Oslo'],
    ['Web search: rust 1.90 release notes', 'rust 1.90 release notes'],
    ['do a web search for mars sample return', 'mars sample return'],
    ['google who wrote Dune', 'who wrote Dune'],
    ['Google: opening hours Louvre', 'opening hours Louvre'],
    ['look up the population of Iceland online', 'the population of Iceland'],
    ['search for flights to Lisbon on the web.', 'flights to Lisbon'],
    ['Suche im Internet nach dem Wetter in Wien', 'dem Wetter in Wien'],
    ['such im Netz: Fahrplan Linie 5', 'Fahrplan Linie 5'],
    ['Bitte suche im Web nach Tauri Android', 'Tauri Android'],
    ['google mal nach Pfannkuchen Rezept', 'Pfannkuchen Rezept'],
    ['Recherchiere im Internet zu Wärmepumpen', 'Wärmepumpen'],
    ['Suche Rezepte für Kürbissuppe im Internet', 'Rezepte für Kürbissuppe'],
    ['schau im Netz nach dem Kurs von Bitcoin', 'dem Kurs von Bitcoin'],
]

/**
 * Round 10, the rest of N2: the order as a noun. The router of the chat does
 * not know these (its search verbs need a word boundary, "Websuche" has none
 * before "suche"), so they are held apart from the list above: only the send
 * path of a phone routes them (hooks/useChat.ts, tested in
 * hooks/__tests__/useChat-websuche-on-the-phone.test.ts).
 */
const NOUN_ORDERS: Array<[string, string]> = [
  ['Websuche: wer hat die Fussball-WM 2026 gewonnen?', 'wer hat die Fussball-WM 2026 gewonnen?'],
  ['Internetsuche: Fahrplan Linie 5', 'Fahrplan Linie 5'],
  ['Web-Suche nach Tauri Android', 'Tauri Android'],
  ['Internetsuche nach dem Wetter in Wien', 'dem Wetter in Wien'],
  ['Onlinesuche zu Wärmepumpen', 'Wärmepumpen'],
  ['Netzsuche - Kurs von Bitcoin', 'Kurs von Bitcoin'],
  ['Bitte mach eine Websuche zu Pfannkuchen Rezept', 'Pfannkuchen Rezept'],
  ['starte eine Internetsuche nach dem Fahrplan, bitte', 'dem Fahrplan'],
  ['websuche:Python 3.14', 'Python 3.14'],
]

describe('explicitSearchQuery: an order to search the web, and what to look for', () => {
  it('the sentence of the report', () => {
    expect(explicitSearchQuery('Search the web: who won the 2026 FIFA World Cup?')).toBe('who won the 2026 FIFA World Cup?')
  })

  it.each(ORDERS)('%s', (text, query) => {
    expect(explicitSearchQuery(text)).toBe(query)
  })

  it.each([
    // A question that would be better with a search is still the model's call.
    'who won the 2026 FIFA World Cup?',
    'What is the latest stable version of Python?',
    // Searching something that is not the web.
    'search my notes for the wifi password',
    'Search for bugs in this function',
    'suche in der Datei nach TODO',
    // Talking about a search.
    'How does a web search engine rank pages?',
    'I did a web search yesterday and found nothing',
    'Why can you not search the web?',
    // The order without anything to look for.
    'Search the web',
    'search the web: ?',
    'google',
    // An address is a page to read, the other tool.
    'Search the web: https://example.com/report.pdf',
    '',
  ])('not an order: %s', (text) => {
    expect(explicitSearchQuery(text)).toBeNull()
  })

  it.each(NOUN_ORDERS)('the order as a noun: %s', (text, query) => {
    expect(explicitSearchQuery(text)).toBe(query)
  })

  it.each([
    // Talking about a search, not ordering one: no colon, no dash, no preposition after the word.
    'Websuche ist kaputt',
    'Die Websuche hat gestern nichts gefunden',
    'Wie funktioniert eine Internetsuche?',
    'Internetsuche',
    'Websuche:',
    // A search that is not the web.
    'Dateisuche: TODO',
    'Volltextsuche nach Rechnung',
    // An address is a page to read.
    'Websuche: https://example.com/bericht.pdf',
  ])('not an order: %s', (text) => {
    expect(explicitSearchQuery(text)).toBeNull()
  })

  it('SONDE: the router of the chat does not know the noun, which is why the phone routes it itself', () => {
    // Should the shared router learn these one day, this turns red and the route of the phone can go.
    // Written with a hyphen ("Web-Suche") the verb stem stands at a word boundary, and the router does take it.
    for (const text of ['Websuche: wer hat die Fussball-WM 2026 gewonnen?', 'Internetsuche: Fahrplan Linie 5', 'Onlinesuche zu Wärmepumpen']) {
      expect(detectChatToolCapability(text), text).not.toBe('web')
    }
  })

  // Short check on Android, package 8: the whole request went out as the query.
  it('the query is the question, not the orders about the results that follow it', () => {
    expect(explicitSearchQuery('Search the web: what is the current stable version of Python? Open one result page and tell me the version with the source.')).toBe('what is the current stable version of Python?')
    expect(explicitSearchQuery('Search the web for the population of Iceland. Then summarise it in one sentence.')).toBe('the population of Iceland.')
    expect(explicitSearchQuery('Websuche: Einwohnerzahl Island. Antworte auf Deutsch und nenne die Quelle.')).toBe('Einwohnerzahl Island.')
    expect(explicitSearchQuery('google tide tables Hamburg! Please give me the next high water.')).toBe('tide tables Hamburg!')
    expect(explicitSearchQuery('Suche im Internet nach dem Wetter in Kiel. Danach nenne mir die Temperatur.')).toBe('dem Wetter in Kiel.')
  })

  it('a query of several sentences that are all question stays whole, and a dot inside a word ends nothing', () => {
    expect(explicitSearchQuery('Search the web: Python 3.12 release date. What changed in the parser?')).toBe('Python 3.12 release date. What changed in the parser?')
    expect(explicitSearchQuery('search the web for node.js 22 vs. deno 2 performance')).toBe('node.js 22 vs. deno 2 performance')
    expect(explicitSearchQuery('Search the web: who won the 2026 FIFA World Cup?')).toBe('who won the 2026 FIFA World Cup?')
    // "Read ..." as the whole query is a query.
    expect(explicitSearchQuery('search the web: open source licences explained')).toBe('open source licences explained')
  })

  it('a very long order is cut to a query a search takes', () => {
    const q = explicitSearchQuery(`search the web for ${'tea '.repeat(200)}`)
    expect(q).not.toBeNull()
    expect(q!.length).toBeLessThanOrEqual(SEARCH_QUERY_MAX)
  })

  it('every order is also a turn the chat routes to the tools (Agent off, Web search on)', () => {
    // Otherwise the loop that holds the order would never see it.
    for (const [text] of [['Search the web: who won the 2026 FIFA World Cup?', ''], ...ORDERS]) expect(detectChatToolCapability(text), text).toBe('web')
  })
})

describe('searchFallbackQuery: the model answered without a call', () => {
  const asReported: SearchFallbackInput = {
    userText: 'Search the web: who won the 2026 FIFA World Cup?',
    finalTurnWithoutCall: true,
    callsRunSoFar: 0,
    searchOffered: true,
    readOnly: false,
    alreadyDone: false,
  }

  it('SONDE: the case of the report gets its search, with the words of the user', () => {
    expect(searchFallbackQuery(asReported)).toBe('who won the 2026 FIFA World Cup?')
  })

  it('once per run', () => {
    expect(searchFallbackQuery({ ...asReported, alreadyDone: true })).toBeNull()
  })

  it('not when the model did call something, now or earlier in the run', () => {
    expect(searchFallbackQuery({ ...asReported, finalTurnWithoutCall: false })).toBeNull()
    expect(searchFallbackQuery({ ...asReported, callsRunSoFar: 1 })).toBeNull()
  })

  it('not when Web search is off or blocked: then nothing may search', () => {
    expect(searchFallbackQuery({ ...asReported, searchOffered: false })).toBeNull()
  })

  it('not in a read only turn', () => {
    expect(searchFallbackQuery({ ...asReported, readOnly: true })).toBeNull()
  })

  it('not for a question nobody ordered a search for (A-08 stays the model\'s own call)', () => {
    expect(searchFallbackQuery({ ...asReported, userText: 'who won the 2026 FIFA World Cup?' })).toBeNull()
  })
})

// Check on Android with 4 GB, F4.
describe('withOrderedQuery', () => {
  const call = (name: string, args: Record<string, unknown>) => ({ function: { name, arguments: args } })

  it('the first web_search gets the words of the user and keeps its other arguments', () => {
    const calls = [call('web_search', { query: 'Inzaehlung der Insel', maxResults: 3 }), call('web_search', { query: 'second' })]
    const out = withOrderedQuery(calls, 'Websuche: Einwohnerzahl Island')
    expect(out[0].function.arguments).toEqual({ query: 'Einwohnerzahl Island', maxResults: 3 })
    expect(out[1]).toBe(calls[1])
    // The list handed in is not changed.
    expect(calls[0].function.arguments.query).toBe('Inzaehlung der Insel')
  })

  it('hands back the same list when there is nothing to change', () => {
    const noOrder = [call('web_search', { query: 'x y' })]
    expect(withOrderedQuery(noOrder, 'How many people live in Iceland?')).toBe(noOrder)
    const noSearch = [call('web_fetch', { url: 'https://example.org' })]
    expect(withOrderedQuery(noSearch, 'Search the web: tides')).toBe(noSearch)
    const same = [call('web_search', { query: 'tides' })]
    expect(withOrderedQuery(same, 'Search the web: tides')).toBe(same)
    expect(withOrderedQuery([], 'Search the web: tides')).toEqual([])
  })

  it('a search behind another call is found', () => {
    const calls = [call('get_current_time', {}), call('web_search', { query: 'reworded' })]
    expect(withOrderedQuery(calls, 'Search the web: tides')[1].function.arguments.query).toBe('tides')
  })
})

