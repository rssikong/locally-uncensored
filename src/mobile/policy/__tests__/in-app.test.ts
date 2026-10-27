/**
 * The store switch `purchase: 'in-app'` (round 17): credits as an in-app
 * purchase of the system. Built, and in no preset.
 *
 * Three things are held here:
 *  1. No preset stands on 'in-app'. Putting one there is David's decision
 *     (mobile-docs/r17/in-app-kauf-gebaut.md), not something a merge does.
 *  2. With 'in-app' the app still shows no link and no pointer to another
 *     place to buy: towards the outside the value reads as 'none' on every
 *     surface that knows the switch.
 *  3. Every reader of the switch in src/mobile goes through one of the
 *     helpers that know all four values, so a new reader cannot treat
 *     'in-app' as "not none, so say something about buying".
 *
 * Run: npx vitest run src/mobile/policy/__tests__/in-app.test.ts
 */
import { afterEach, describe, expect, it } from 'vitest'
import { MOBILE_DIR, sourceFiles, stripComments } from '../../__tests__/scan'
import { purchaseHint } from '../../screens/chat/parts/logic/policy'
import { purchaseView } from '../../screens/create/parts/policy'
import { priceCopy } from '../../screens/settings/parts/price'
import { buyHint, creditsCopyFor, showsBuyLinks, showsBuyText } from '../../screens/settings/parts/store-rules'
import { storeSentence } from '../server-text'
import { STORE_PRESETS, STORE_PRESET_IDS, outwardPurchase, parsePurchase, setPurchaseForTests, setStorePresetForTests, storePolicy } from '../storePolicy'

afterEach(() => {
  setPurchaseForTests(null)
  setStorePresetForTests(null)
})

describe('no preset sells inside the app', () => {
  it('open, play and appstore keep the values they had', () => {
    expect(STORE_PRESET_IDS).toEqual(['open', 'play', 'appstore'])
    expect([STORE_PRESETS.open.purchase, STORE_PRESETS.play.purchase, STORE_PRESETS.appstore.purchase]).toEqual(['links', 'text-only', 'none'])
  })

  it('none of them is in-app: turning it on is a decision, one line in the preset', () => {
    for (const preset of Object.values(STORE_PRESETS)) expect(preset.purchase, preset.preset).not.toBe('in-app')
  })

  it('a build reads its preset as it stands while no test hands a value in', () => {
    for (const id of STORE_PRESET_IDS) {
      setStorePresetForTests(id)
      expect(storePolicy()).toBe(STORE_PRESETS[id])
    }
  })
})

describe('the value in-app, handed in for a test', () => {
  it('lies over the preset that is shown, changes nothing else, and is given back', () => {
    setStorePresetForTests('appstore')
    setPurchaseForTests('in-app')
    const { purchase, ...rest } = storePolicy()
    const { purchase: _before, ...preset } = STORE_PRESETS.appstore
    expect(purchase).toBe('in-app')
    expect(rest).toEqual(preset)
    // The preset itself is untouched.
    expect(STORE_PRESETS.appstore.purchase).toBe('none')
    setPurchaseForTests(null)
    expect(storePolicy()).toBe(STORE_PRESETS.appstore)
  })

  it('only the four values are a value', () => {
    expect(['links', 'text-only', 'none', 'in-app'].map(parsePurchase)).toEqual(['links', 'text-only', 'none', 'in-app'])
    for (const bad of ['', 'In-App', 'iap', 'true', null, undefined, 1]) expect(parsePurchase(bad)).toBeNull()
  })
})

describe('with in-app nothing points outside', () => {
  it('towards the outside in-app is none', () => {
    expect(outwardPurchase('in-app')).toBe('none')
    expect((['links', 'text-only', 'none'] as const).map(outwardPurchase)).toEqual(['links', 'text-only', 'none'])
  })

  it('no button to plans, no sentence about another place, no wording about plans', () => {
    expect(showsBuyLinks('in-app')).toBe(false)
    expect(showsBuyText('in-app')).toBe(false)
    expect(buyHint('in-app')).toBeNull()
  })

  it('"out of credits" reads as in a build that sells nothing', () => {
    for (const reason of ['credits', 'video_budget', 'trainings']) expect(creditsCopyFor(reason, 'in-app')).toEqual(creditsCopyFor(reason, 'none'))
  })

  it('the sheet that says what an answer uses has no button and no hint', () => {
    const count = (n: number) => String(n)
    for (const view of [{ kind: 'flash-unpaid', creditsLeft: 0 }, { kind: 'credits', creditsLeft: 0 }, { kind: 'flash-used-up', creditsLeft: 0 }] as const) {
      const copy = priceCopy(view, 'in-app', count)
      expect(copy).toEqual(priceCopy(view, 'none', count))
      expect(copy.buyLink).toBe(false)
      expect(copy.hint).toBeNull()
    }
  })

  it('the chat and Create read it as none', () => {
    const texts = { title: 'Out of credits', text: 'See plans.', action: 'See plans', textOnly: 'Plans are elsewhere.', neutralTitle: 'Cloud cannot answer', neutralText: 'Not available right now.' }
    expect(purchaseHint('in-app', texts)).toEqual({ title: 'Cloud cannot answer', text: 'Not available right now.', action: null })
    setStorePresetForTests('appstore')
    setPurchaseForTests('in-app')
    expect(purchaseView()).toEqual({ mode: 'none' })
    // And on top of every other preset too: the value never opens a link.
    for (const id of STORE_PRESET_IDS) {
      setStorePresetForTests(id)
      expect(purchaseView().mode, id).toBe('none')
    }
  })

  it('a sentence of the server about buying or about the website is still left out', () => {
    setStorePresetForTests('appstore')
    setPurchaseForTests('in-app')
    expect(storeSentence('You are out of credits. Top up at lu-labs.ai/pricing. Try again later.')).toBe('You are out of credits. Try again later.')
  })
})

describe('every reader of the switch knows all four values', () => {
  /** A read of the switch is fine on a line that hands it to one of these, or compares it with a value that is not 'none'. */
  const KNOWS = /showsBuyLinks\(|showsBuyText\(|buyHint\(|creditsCopyFor\(|priceCopy\(|purchaseHint\(|outwardPurchase\(|\.purchase\s*(===|!==)\s*'(links|text-only|in-app)'/
  /** Files that define the switch or only print it. */
  const EXEMPT = new Set(['mobile/policy/storePolicy.ts', 'mobile/dev/UiCatalogPage.tsx'])

  it('no file compares the switch with none, or passes it on raw', () => {
    const hits: string[] = []
    for (const file of sourceFiles(MOBILE_DIR, ['.ts', '.tsx'])) {
      if (file.rel.includes('__tests__/') || EXEMPT.has(file.rel)) continue
      stripComments(file.text)
        .split('\n')
        .forEach((line, at) => {
          // The switch as a value: not the name of a field, not the call of the store (deps.purchase(...)).
          if (!/\.purchase\b(?!\s*[:(])/.test(line)) return
          // The one assignment of the value to a name, judged where the name is used.
          if (/^\s*const purchase = storePolicy\(\)\.purchase\s*$/.test(line)) return
          if (!KNOWS.test(line)) hits.push(`${file.rel}:${at + 1} ${line.trim().slice(0, 120)}`)
        })
    }
    expect(hits).toEqual([])
  })

  it('a name that holds the raw value is only handed to the helpers', () => {
    // CreditsSheet and CloudGatePage keep `const purchase = storePolicy().purchase` and hand it to the helpers above.
    const hits: string[] = []
    for (const file of sourceFiles(MOBILE_DIR, ['.ts', '.tsx'])) {
      const code = stripComments(file.text)
      if (!/const purchase = storePolicy\(\)\.purchase\s*$/m.test(code)) continue
      code.split('\n').forEach((line, at) => {
        if (/\bpurchase\s*(===|!==)\s*'none'/.test(line)) hits.push(`${file.rel}:${at + 1} ${line.trim().slice(0, 120)}`)
      })
    }
    expect(hits).toEqual([])
  })
})
