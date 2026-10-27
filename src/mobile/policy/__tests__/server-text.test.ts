/**
 * A sentence from outside (LU Cloud, the logic layer) in a store build.
 * Apple 3.1.3(f): no purchasing inside the app, no call to action for
 * purchase outside of it. A sentence of the server is no exception, so what
 * is shown of one is held against the same rules as the texts of the app.
 */
import { describe, expect, it } from 'vitest'
import { storeFindings } from '../../../../e2e/mobile/store-rules'
import { phoneSentence } from '../../screens/create/parts/errors'
import { sentenceAllowed, storeSentence } from '../server-text'
import { STORE_PRESETS, setStorePresetForTests } from '../storePolicy'

const { open, play, appstore } = STORE_PRESETS

/** Sentences a server could send. Each carries something a store build must not show. */
const FROM_SERVER = [
  'Insufficient credits. Top up at https://lu-labs.ai/pricing to continue.',
  'You have run out of credits. Upgrade your plan to keep going.',
  'Rate limit reached. Visit lu-labs.ai to raise it.',
  'Too many requests. Subscribe to a paid plan for higher limits.',
  'Your payment is past due. Pay the open invoice on the website.',
  'Buy more credits to use this model.',
  'This model needs an account with credits.',
  'Only $9 per month.',
  'Your credits renew on the first.',
  'Model e2e-lab/Llama-3-Uncensored-8B is not available.',
  'lu-cloud::e2e-lab/Atlas-8B could not answer.',
  'The uncensored models are busy.',
  'Manage your account in the dashboard.',
]

describe('a sentence of the server', () => {
  it('open: is shown as it came', () => {
    for (const text of FROM_SERVER) expect(storeSentence(text, open)).toBe(text)
  })

  for (const [name, policy] of [['appstore', appstore], ['play', play]] as const) {
    it(`${name}: of the played sentences only what the store guard lets pass is shown, alone or among others`, () => {
      for (const text of FROM_SERVER) {
        const alone = storeSentence(text, policy)
        expect(storeFindings(alone, name), text).toEqual([])
        expect(alone, text).not.toMatch(/lu-labs|https?:|top up|upgrade|subscri|invoice|\$\d|::|uncensored|dashboard|website/i)
        const mixed = storeSentence(`The request was refused. ${text} Try again in a moment.`, policy)
        expect(storeFindings(mixed, name), text).toEqual([])
        expect(mixed.startsWith('The request was refused.'), text).toBe(true)
        expect(mixed.endsWith('Try again in a moment.'), text).toBe(true)
      }
      // A sentence that is one piece is gone as a whole.
      for (const text of ['Buy more credits to use this model.', 'Only $9 per month.', 'Your credits renew on the first.', 'The uncensored models are busy.', 'lu-cloud::e2e-lab/Atlas-8B could not answer.']) expect(storeSentence(text, policy), text).toBe('')
    })

    it(`${name}: what is shown of any mix passes the rules of the store guard, and a harmless sentence stays`, () => {
      const kept = ['The request was refused.', 'Too many requests, wait 20s.', 'This account has no credits left.', 'The server did not answer in time.', 'This run uses 300 credits.']
      for (const text of kept) expect(storeSentence(text, policy), text).toBe(text)
      const out = storeSentence([...kept, ...FROM_SERVER].join(' '), policy)
      expect(out.startsWith(kept.join(' '))).toBe(true)
      expect(storeFindings(out, name)).toEqual([])
    })
  }

  it('is judged sentence by sentence, and a line break ends a sentence too', () => {
    expect(storeSentence('No credits left.\nTop up on lu-labs.ai', appstore)).toBe('No credits left.')
    expect(sentenceAllowed('This account has no credits left.', appstore)).toBe(true)
    expect(sentenceAllowed('Add credits to go on.', appstore)).toBe(false)
    expect(storeSentence('', appstore)).toBe('')
    expect(storeSentence(null, appstore)).toBe('')
  })

  it('the reason of a failed run in Create goes through it', () => {
    try {
      setStorePresetForTests('appstore')
      expect(phoneSentence('The provider refused the run. Top up at lu-labs.ai/pricing')).toBe('The provider refused the run.')
      setStorePresetForTests('open')
      expect(phoneSentence('The provider refused the run. Top up at lu-labs.ai/pricing')).toBe('The provider refused the run. Top up at lu-labs.ai/pricing.')
    } finally {
      setStorePresetForTests(null)
    }
  })
})
