/**
 * Waechter ueber die Store-Unterlagen (mobile-docs/store/).
 *
 * Die Texte, die in die Konsolen der Stores kopiert werden, stehen in den
 * Eintraegen als Bloecke mit der Kennung `store`:
 *
 *   ```store play.title max=30
 *   ...
 *   ```
 *
 * Gehalten wird je Block:
 *  - dieselben Wortregeln wie in der App (e2e/mobile/store-rules.ts), im
 *    Preset des jeweiligen Stores: ein Store-Text wirbt mit nichts, was der
 *    Store-Bau nicht zeigen darf,
 *  - die Muster der Geraete-Abnahme (mobile-tests/checks/storeworte.mjs),
 *  - keine langen Striche,
 *  - die Laenge, die das Feld der Konsole erlaubt,
 *  - keine Preisaussage,
 *  - der Name der App ist in beiden Stores nur "LU" (entschieden 10.10.2026),
 *    und kein Text nennt den langen Namen des Desktop-Produkts oder ein Wort
 *    ueber Antworten ohne Ablehnungen,
 *  - jede Kennung in doppelten geschweiften Klammern steht in PLATZHALTER.md,
 *    und nur dort stehen die Werte, die David bestaetigen muss.
 *
 * Lauf: npx vitest run src/mobile/__tests__/store-unterlagen.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { FULL_NAME_SPELLINGS, PLAY_SENTENCE, SUPPORT_EMAIL, storeFindings, type GuardedPreset } from '../../../e2e/mobile/store-rules'
import { UNFILTERED_SPELLINGS, carriesUnfilteredWord } from '../policy/unfiltered-names'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const STORE = 'mobile-docs/store'
const read = (name: string) => readFileSync(join(root, STORE, name), 'utf8')

interface Block {
  id: string
  max: number
  text: string
}

function blocks(markdown: string): Block[] {
  return [...markdown.matchAll(/^```store (\S+) max=(\d+)\n([\s\S]*?)\n```$/gm)].map((m) => ({ id: m[1], max: Number(m[2]), text: m[3] }))
}

const ENTRIES: Array<{ file: string; preset: GuardedPreset; fields: string[] }> = [
  { file: 'PLAY-EINTRAG.md', preset: 'play', fields: ['play.title', 'play.short', 'play.full', 'play.review'] },
  {
    file: 'APPSTORE-EINTRAG.md',
    preset: 'appstore',
    fields: ['appstore.name', 'appstore.subtitle', 'appstore.promo', 'appstore.description', 'appstore.whatsnew', 'appstore.keywords', 'appstore.review'],
  },
]

/** Was ein Feld der Konsole hoechstens fasst. Der Block nennt dieselbe Zahl, hier steht sie fest. */
const LIMITS: Record<string, number> = {
  'play.title': 30,
  'play.short': 80,
  'play.full': 4000,
  'play.review': 4000,
  'appstore.name': 30,
  'appstore.subtitle': 30,
  'appstore.promo': 170,
  'appstore.description': 4000,
  'appstore.whatsnew': 4000,
  'appstore.keywords': 100,
  'appstore.review': 4000,
}

const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g
const placeholdersIn = (text: string) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1])
/** Der Text, wie er in der Konsole steht: die Kennungen sind dort Adressen und Namen, keine Woerter. */
const withoutPlaceholders = (text: string) => text.replace(PLACEHOLDER, ' ')

/** Preis und Kosten, ueber die Kaufwoerter der Wortregeln hinaus. */
const PRICE_CLAIMS = /\b(free|for free|gratis|no cost|costs?|cheap|trial|discount|per month|monthly|yearly|€|\$\d|\d+\s?(usd|eur|dollars?|euros?))\b|€|\$\d/i

interface DeviceRule {
  id: string
  befund: string
  zusatz?: boolean
  re: RegExp
}
let deviceRules: DeviceRule[] = []
beforeAll(async () => {
  // Die Muster der Geraete-Abnahme sind eine .mjs-Datei ausserhalb von src, deshalb zur Laufzeit geladen.
  const mod = (await import(/* @vite-ignore */ pathToFileURL(join(root, 'mobile-tests/checks/storeworte.mjs')).href)) as { STORE_MUSTER: DeviceRule[] }
  deviceRules = mod.STORE_MUSTER
})

describe('Store-Unterlagen: die Dateien sind da', () => {
  it('Play-Eintrag, App-Store-Eintrag und Platzhalter', () => {
    for (const name of ['PLAY-EINTRAG.md', 'APPSTORE-EINTRAG.md', 'PLATZHALTER.md']) expect(existsSync(join(root, STORE, name)), name).toBe(true)
  })

  for (const entry of ENTRIES) {
    it(`${entry.file} hat jeden Abschnitt, den die Konsole verlangt`, () => {
      const text = read(entry.file)
      const wanted =
        entry.preset === 'play'
          ? ['Titel', 'Kurzbeschreibung', 'Langbeschreibung', 'Schlagwoerter', 'Kategorie', 'Altersfreigabe', 'Datensicherheit', 'Hinweise fuer die Pruefer', 'Screenshots']
          : ['Name und Untertitel', 'Kurzbeschreibung', 'Langbeschreibung', 'Schlagwoerter', 'Kategorie', 'Altersfreigabe', 'Datenschutz', 'Hinweise fuer die Pruefer', 'Screenshots']
      for (const heading of wanted) expect(text, heading).toMatch(new RegExp(`^## \\d+\\. [^\\n]*${heading}`, 'm'))
      expect(blocks(text).map((b) => b.id).sort()).toEqual([...entry.fields].sort())
    })
  }
})

for (const entry of ENTRIES) {
  describe(`${entry.file}: die Texte fuer die Konsole (Preset ${entry.preset})`, () => {
    const all = blocks(read(entry.file))

    it('jeder Block nennt die Grenze seines Feldes und haelt sie', () => {
      expect(all.length).toBe(entry.fields.length)
      for (const b of all) {
        expect(b.max, b.id).toBe(LIMITS[b.id])
        // Eine Kennung wird in der Konsole zu einer Adresse: grosszuegig mit 60 Zeichen gerechnet.
        const length = b.text.replace(PLACEHOLDER, 'x'.repeat(60)).length
        expect(length, `${b.id}: ${length} Zeichen`).toBeLessThanOrEqual(b.max)
        expect(b.text.trim().length, b.id).toBeGreaterThan(0)
      }
    })

    it('kein Wort, das der Store-Bau der App nicht zeigen darf (store-rules.ts)', () => {
      for (const b of all) expect(storeFindings(withoutPlaceholders(b.text), entry.preset), b.id).toEqual([])
    })

    it('kein Treffer der Muster aus der Geraete-Abnahme (storeworte.mjs)', () => {
      expect(deviceRules.length).toBeGreaterThan(5)
      for (const b of all) {
        // Wie in der App: die Kontaktadresse darf stehen, im Play-Bau der eine Satz ohne Link.
        let text = withoutPlaceholders(b.text).split(SUPPORT_EMAIL).join(' ')
        if (entry.preset === 'play') text = text.split(PLAY_SENTENCE).join(' ')
        for (const rule of deviceRules) {
          if (rule.zusatz) continue
          // Eigene Anbieter, Fernzugriff und Zugangsschluessel sind im Play-Bau erlaubt (dort nur Hinweis).
          if (entry.preset === 'play' && rule.befund === 'IG-H4') continue
          const hits = [...text.matchAll(new RegExp(rule.re.source, rule.re.flags))].map((m) => m[0])
          expect(hits, `${b.id}: ${rule.id}`).toEqual([])
        }
      }
    })

    it('keine langen Striche, keine Preisaussage', () => {
      for (const b of all) {
        expect(b.text, b.id).not.toMatch(/[\u2012\u2013\u2014\u2015]/)
        expect(b.text, b.id).not.toMatch(/ -- | - /)
        expect(b.text.match(PRICE_CLAIMS)?.[0] ?? null, b.id).toBeNull()
      }
    })

    it('nichts, was dieser Bau nicht hat', () => {
      const text = all.map((b) => b.text).join('\n')
      if (entry.preset === 'appstore') {
        // Preset appstore: kein Fernzugriff, keine eigenen Anbieter, keine fremde Modelldatei, kein Android.
        expect(text).not.toMatch(/\bremote\b|your computer|your own (key|provider|model file)|gguf|android|google play/i)
      } else {
        expect(text).not.toMatch(/\biphone\b|\bios\b|app store/i)
        // Seit Runde 56 (18.10.2026, Option c): keine fremde Modelldatei und kein Modell, das fuer Inhalte ohne Ablehnung gemacht ist.
        expect(text).not.toMatch(/your own model file|model file|gguf|\bimport\b|\bdirect\b/i)
        // Der eine Satz steht, wenn ueberhaupt, woertlich da.
        expect(text.split(PLAY_SENTENCE).join(' ')).not.toMatch(/lu-labs\.ai/)
      }
    })

    it('die Schlagwoerter des App Store sind eine Liste mit Komma, ohne Wort aus dem Namen', () => {
      if (entry.preset !== 'appstore') return
      const keywords = all.find((b) => b.id === 'appstore.keywords')!.text
      const name = all.find((b) => b.id === 'appstore.name')!.text.toLowerCase()
      expect(keywords).not.toMatch(/, |\n/)
      const list = keywords.split(',')
      expect(new Set(list).size).toBe(list.length)
      for (const word of list) expect(name.split(/[^a-z0-9]+/), word).not.toContain(word)
    })
  })
}

/**
 * Entschieden am 10.10.2026: die App heisst in beiden Stores nur "LU". Kein
 * Text der Unterlagen, der in eine Konsole kopiert wird, nennt den langen
 * Namen oder ein Wort ueber Antworten ohne Ablehnungen, auch nicht als
 * Schlagwort. Was die App ist, sagen neutrale Woerter.
 */
describe('Store-Unterlagen: der Name ist LU, die Woerter sind neutral', () => {
  /** Auch der Block fuer die Pruefer (Kennung `review`), der die Woerter des Kaufens nennen darf. */
  const everyBlock = (markdown: string) => [...markdown.matchAll(/^```(?:store|review) (\S+) max=(\d+)\n([\s\S]*?)\n```$/gm)].map((m) => ({ id: m[1], max: Number(m[2]), text: m[3] }))

  it('der Name in beiden Stores ist genau "LU"', () => {
    const play = blocks(read('PLAY-EINTRAG.md')).find((b) => b.id === 'play.title')!
    const apple = blocks(read('APPSTORE-EINTRAG.md')).find((b) => b.id === 'appstore.name')!
    expect(play.text).toBe('LU')
    expect(apple.text).toBe('LU')
  })

  it('kein Block nennt den langen Namen, in keiner Schreibweise, und kein Wort der einen Liste', () => {
    // Die Regel greift: jede Schreibweise des Namens waere ein Fund.
    for (const spelling of ['Locally Uncensored', 'LocallyUncensored', 'locally-uncensored', 'locallyuncensored', 'locally_uncensored']) expect(FULL_NAME_SPELLINGS.test(spelling), spelling).toBe(true)
    expect(UNFILTERED_SPELLINGS.length).toBeGreaterThan(30)
    for (const entry of ENTRIES) {
      const all = everyBlock(read(entry.file))
      expect(all.length).toBeGreaterThanOrEqual(entry.fields.length)
      for (const b of all) {
        expect(FULL_NAME_SPELLINGS.test(b.text), `${b.id}: der lange Name`).toBe(false)
        expect(b.text, b.id).not.toMatch(/\buncensor|\bunfilter|\babliterat|no refusals|\bnsfw\b|\bno filter\b|unzensiert|ungefiltert/i)
        for (const line of b.text.split('\n')) expect(carriesUnfilteredWord(line), `${b.id}: ${line.slice(0, 80)}`).toBe(false)
      }
    }
  })

  it('die Schlagwoerter und die Beschreibungen sagen mit neutralen Woertern, was die App ist', () => {
    const apple = blocks(read('APPSTORE-EINTRAG.md'))
    const keywords = apple.find((b) => b.id === 'appstore.keywords')!.text.split(',')
    for (const word of ['private ai', 'on device', 'offline', 'local models', 'chat', 'documents']) expect(keywords, word).toContain(word)
    for (const [file, id] of [['APPSTORE-EINTRAG.md', 'appstore.description'], ['PLAY-EINTRAG.md', 'play.full']] as const) {
      const text = blocks(read(file)).find((b) => b.id === id)!.text
      for (const word of [/on device/i, /without a connection/i, /documents/i, /\bchat\b/i]) expect(text, `${id}: ${word}`).toMatch(word)
    }
  })

  it('die Begruendung zu Richtlinie 3.1 fuer Apples Pruefer steht da, sagt was der Bau tut, und passt mit den Hinweisen in ein Feld', () => {
    const text = read('APPSTORE-EINTRAG.md')
    const all = everyBlock(text)
    const note = all.find((b) => b.id === 'appstore.review-purchases')
    expect(note, 'Block review appstore.review-purchases').toBeTruthy()
    const review = all.find((b) => b.id === 'appstore.review')!
    expect(note!.text.length).toBeLessThanOrEqual(note!.max)
    expect(review.text.replace(PLACEHOLDER, 'x'.repeat(60)).length + 2 + note!.text.length).toBeLessThanOrEqual(4000)
    for (const must of [/3\.1\.3\(f\)/, /free to download/i, /without an account/i, /paid web-based service/i, /no purchasing inside the app/i, /no call to action for purchase outside of the app/i, /no prices/i, /test account[^.]*has credits/i]) expect(note!.text, String(must)).toMatch(must)
    // Auch dieser Block nennt keine Adresse, keinen Betrag und keinen Weg zum Kauf.
    expect(note!.text).not.toMatch(/lu-labs\.ai|https?:|www\.|[$\u20ac]\s?\d|\b\d+\s?(eur|usd)\b/i)
    expect(note!.text).not.toMatch(/[\u2012\u2013\u2014\u2015]/)
    // Was der Block ueber den Bau sagt, steht im Preset.
    expect(text).toMatch(/purchase: 'none'/)
  })
})

describe('Platzhalter: an einer Stelle', () => {
  const defined = new Set(placeholdersIn(read('PLATZHALTER.md')))

  it('PLATZHALTER.md erklaert die Kennungen, die die Eintraege benutzen', () => {
    for (const entry of ENTRIES) {
      for (const id of placeholdersIn(read(entry.file))) expect(defined.has(id), `${entry.file}: {{${id}}}`).toBe(true)
    }
    for (const must of ['FIRMENNAME', 'SUPPORT_EMAIL', 'PRIVACY_URL', 'ACCOUNT_DELETE_URL', 'REVIEW_ACCOUNT_EMAIL', 'REVIEW_ACCOUNT_PASSWORD']) expect(defined.has(must), must).toBe(true)
  })

  it('die Eintraege tragen keine Adresse und keinen Namen selbst, nur die Kennung', () => {
    for (const entry of ENTRIES) {
      // Ausserhalb der Bloecke: der deutsche Begleittext. In den Bloecken haelt es der Test oben.
      const text = read(entry.file)
      expect(text.split(PLAY_SENTENCE).join(' '), entry.file).not.toMatch(/https?:\/\/|[\w.]+@[\w.-]+\.[a-z]{2,}/i)
    }
  })

  it('kein Passwort, keine Team-ID, kein Schluessel in den Unterlagen', () => {
    for (const name of ['PLAY-EINTRAG.md', 'APPSTORE-EINTRAG.md', 'PLATZHALTER.md']) {
      const text = read(name)
      expect(text, name).not.toMatch(/-----BEGIN|(?:store|key)Password=\S|AuthKey_[A-Z0-9]{6,}/)
      // Eine Team-ID waeren zehn Zeichen aus Grossbuchstaben und Ziffern mit mindestens einer Ziffer.
      const ids = [...text.matchAll(/\b(?=[A-Z0-9]{10}\b)(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10}\b/g)].map((m) => m[0])
      expect(ids, name).toEqual([])
    }
  })
})
