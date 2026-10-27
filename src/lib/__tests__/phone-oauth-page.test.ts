/**
 * Check on the iPhone, round 22, N5: "Continue with Google" and "Continue
 * with GitHub" opened no browser. The provider page went through
 * `plugin:shell|open`, which starts a program, and an iPhone has none to
 * start. Now it goes through the plugin lu-native, two ways:
 * the sign-in sheet of the system on iOS, the browser on Android.
 *
 * Run: npx vitest run src/lib/__tests__/phone-oauth-page.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OAUTH_CALLBACK_SCHEME, showPhoneOAuthPage } from '../phone-oauth-page'
import { MOBILE_OAUTH_REDIRECT } from '../oauth-callback-url'

const PAGE = 'https://auth.example.org/authorize?provider=google'

describe('the provider page on a phone', () => {
  it('the scheme the sheet waits for is the one of the redirect, and the redirect did not move', () => {
    expect(MOBILE_OAUTH_REDIRECT).toBe('lu://oauth/callback')
    expect(OAUTH_CALLBACK_SCHEME).toBe('lu')
  })

  it('iPhone: the sheet of the system, and the link it hands back', async () => {
    const webAuth = vi.fn(async () => 'lu://oauth/callback?code=abc')
    const openExternal = vi.fn(async () => {})
    expect(await showPhoneOAuthPage(PAGE, { webAuth, openExternal })).toEqual({ kind: 'returned', url: 'lu://oauth/callback?code=abc' })
    expect(webAuth).toHaveBeenCalledWith(PAGE, 'lu')
    // The app is not left: no browser on top of the sheet.
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('iPhone: closing the sheet is cancelled, not an error, and opens nothing else', async () => {
    const openExternal = vi.fn(async () => {})
    expect(await showPhoneOAuthPage(PAGE, { webAuth: async () => null, openExternal })).toEqual({ kind: 'cancelled' })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('iPhone: a sheet that fails is a failure. No second page hides why', async () => {
    const openExternal = vi.fn(async () => {})
    const webAuth = vi.fn(async () => { throw new Error('The sign-in page could not be shown. Try again.') })
    await expect(showPhoneOAuthPage(PAGE, { webAuth, openExternal })).rejects.toThrow('The sign-in page could not be shown. Try again.')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('an iOS app older than the command takes the browser of the system', async () => {
    const openExternal = vi.fn(async () => {})
    for (const refusal of ['Command plugin:lu-native|web_auth not found', 'lu-native.web_auth not allowed. Command not allowed by ACL', 'unknown command web_auth']) {
      const webAuth = vi.fn(async () => { throw new Error(refusal) })
      expect(await showPhoneOAuthPage(PAGE, { webAuth, openExternal }), refusal).toEqual({ kind: 'opened' })
    }
    expect(openExternal).toHaveBeenCalledTimes(3)
    expect(openExternal).toHaveBeenCalledWith(PAGE)
  })

  it('Android: the browser of the system, through the opener of the plugin', async () => {
    const openExternal = vi.fn(async () => {})
    expect(await showPhoneOAuthPage(PAGE, { openExternal })).toEqual({ kind: 'opened' })
    expect(openExternal).toHaveBeenCalledWith(PAGE)
  })

  it('a browser that does not open is a failure, so nobody waits for it', async () => {
    const openExternal = vi.fn(async () => { throw new Error('No app on this phone can open this link.') })
    await expect(showPhoneOAuthPage(PAGE, { openExternal })).rejects.toThrow('No app on this phone can open this link.')
  })

  it('the real bridge is what it takes when nobody hands one in: both doors are the ones of lu-native', () => {
    const code = readFileSync(join(__dirname, '..', 'phone-oauth-page.ts'), 'utf8')
    expect(code).toContain("await import('./lu-native')")
    const bridge = readFileSync(join(__dirname, '..', 'lu-native.ts'), 'utf8')
    expect(bridge).toContain("call<{ cancelled?: boolean; url?: string } | null>('web_auth', { url, callbackScheme })")
    expect(bridge).toContain("await call('open_external', { url })")
  })
})
