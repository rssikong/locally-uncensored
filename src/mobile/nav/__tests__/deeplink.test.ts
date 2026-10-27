/** What a lu:// link offers. A link never acts on its own, it only offers (DESIGN.md G14). */
import { describe, expect, it } from 'vitest'
import { LINK_OFFER_TTL_MS, isOfferAlive, parseDeepLink } from '../deeplink'
import { parsePairingInput } from '../../remote/pairingLink'

describe('parseDeepLink', () => {
  it('never offers a sign in link: the real return is finished by the logic layer, any other cannot be finished', () => {
    expect(parseDeepLink('lu://oauth?code=abc&state=xyz')).toBeNull()
    expect(parseDeepLink('lu://auth/callback?code=1')).toBeNull()
    expect(parseDeepLink('lu://auth?code=1')).toBeNull()
    expect(parseDeepLink('lu://oauth/callback?code=1')).toBeNull()
  })

  it('reads a remote desktop address', () => {
    expect(parseDeepLink('lu://remote?address=192.168.0.12%3A8080')).toEqual({ kind: 'remote', url: 'lu://remote?address=192.168.0.12%3A8080', address: '192.168.0.12:8080' })
    expect(parseDeepLink('lu://remote')).toBeNull()
  })

  // Review N3: the offer and the Connect page used to read different names.
  it('offers exactly the links the Connect page can read, in every form', () => {
    const forms = [
      'lu://remote?url=http%3A%2F%2F192.168.1.20%3A11435%2Fmobile&code=123456',
      'lu://remote?u=192.168.1.20',
      'lu://remote?address=192.168.1.20',
      'lu://remote?host=192.168.1.20&code=123456',
      'lu://remote?host=192.168.1.20&port=11435',
      'lu:remote?url=192.168.1.20',
    ]
    for (const link of forms) {
      const offer = parseDeepLink(link)
      expect(offer, link).toMatchObject({ kind: 'remote', url: link, address: '192.168.1.20:11435' })
      // The same reader the store uses for "Continue".
      expect(parsePairingInput(offer!.url)?.baseUrl, link).toBe('http://192.168.1.20:11435')
    }
    // https keeps its scheme in what is shown.
    expect(parseDeepLink('lu://remote?url=https%3A%2F%2Fabc.trycloudflare.com%2Fmobile')?.address).toBe('https://abc.trycloudflare.com')
    // What the reader refuses is no offer: credentials in the address, a port that is none, no address.
    for (const bad of ['lu://remote?url=http%3A%2F%2Fuser%3Apw%40192.168.1.20', 'lu://remote?host=192.168.1.20&port=abc', 'lu://remote?code=123456', 'lu://remote?address=']) {
      expect(parseDeepLink(bad), bad).toBeNull()
      expect(parsePairingInput(bad), bad).toBeNull()
    }
  })

  it('ignores what is not ours', () => {
    expect(parseDeepLink('https://example.com/oauth?code=1')).toBeNull()
    expect(parseDeepLink('lu://something-else')).toBeNull()
    expect(parseDeepLink('not a link')).toBeNull()
    expect(parseDeepLink('')).toBeNull()
  })
})

describe('link offer', () => {
  it('expires', () => {
    const offer = parseDeepLink('lu://remote?url=192.168.1.20')
    if (!offer) throw new Error('offer expected')
    const stored = { offer, expiresAt: 1000 + LINK_OFFER_TTL_MS }
    expect(isOfferAlive(stored, 1000)).toBe(true)
    expect(isOfferAlive(stored, 1000 + LINK_OFFER_TTL_MS)).toBe(false)
    expect(isOfferAlive(null, 0)).toBe(false)
  })
})
