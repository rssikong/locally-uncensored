/**
 * The hint at the top of the browser page (mobile-client/client.js): the LU
 * app is the better way in. It links the download page, says nothing about
 * credits, and stays hidden once closed. The shipped function runs here.
 */
import { describe, it, expect } from 'vitest'
import { clientSource, loadFromClient } from './mobile-client-shell'

const H = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const svgIcon = () => '<svg></svg>'

function hint(ios: string) {
  return loadFromClient<{ appHintHtml: (ua: string, hidden: boolean) => string }>(
    ['APP_LINK_ANDROID', 'APP_LINK_IOS', 'appHintHtml'].filter((n) => n !== 'APP_LINK_IOS' || !ios),
    { H, svgIcon, ...(ios ? { APP_LINK_IOS: ios } : {}) },
  ).appHintHtml
}

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'

describe('the app hint on the browser page', () => {
  it('on Android points to the download page, can be closed, and names no credits', () => {
    const html = hint('')(ANDROID, false)
    expect(html).toContain('href="https://lu-labs.ai/android"')
    expect(html).toContain('window._hideAppHint()')
    expect(html).toContain('aria-label="Hide this hint"')
    expect(html.toLowerCase()).not.toContain('credit')
  })

  it('once hidden it stays away', () => {
    expect(hint('')(ANDROID, true)).toBe('')
  })

  it('on an iPhone only with an App Store link', () => {
    expect(hint('')(IPHONE, false)).toBe('')
    expect(hint('https://apps.apple.com/app/id1')(IPHONE, false)).toContain('href="https://apps.apple.com/app/id1"')
  })

  it('sits under the header of the shell and remembers the close in this browser', () => {
    const src = clientSource()
    expect(src).toContain("appHintHtml(navigator.userAgent, appHintHidden())")
    expect(src).toContain("var APP_HINT_KEY = 'lu-remote-app-hint-hidden';")
    expect(src.indexOf('appHintHtml(navigator.userAgent')).toBeGreaterThan(src.indexOf("'<div class=\"app-header\">'"))
  })
})
