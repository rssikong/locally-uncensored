/**
 * Round 10, N16 of the check on Android: every start filled the console with
 * "Refused to apply inline style because it violates the following Content
 * Security Policy directive ...", although the policy allows inline styles.
 *
 * The cause was one <style> block in index.html. Tauri gives every <style>
 * and <script> element of the page a nonce and writes it into style-src and
 * script-src (tauri-utils, html.rs, inject_nonce_token; tauri, manager,
 * replace_csp_nonce). A browser ignores 'unsafe-inline' as soon as a nonce or
 * a hash stands in the same directive. From then on every style attribute
 * written in HTML was refused: the loading screen of index.html, the page
 * for a web view that is too old (public/webview-check.js sets the attribute),
 * and every style element a library adds at run time. On the desktop too,
 * with the same index.html and the same policy.
 *
 * So the page carries no style element, and the policy keeps meaning what
 * it says.
 *
 * Run: npx vitest run src/mobile/platform/__tests__/csp-inline-styles.test.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const HTML = read('index.html')
/** The page without its comments, which may name the elements they are about. */
const PAGE = HTML.replace(/<!--[\s\S]*?-->/g, '')

function directives(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const part of csp.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name) out[name] = sources
  }
  return out
}

/** Every configuration that sets a policy. Android has none of its own and takes the one of tauri.conf.json. */
const policies = readdirSync(resolve(root, 'src-tauri'))
  .filter((name) => /^tauri(\..+)?\.conf\.json$/.test(name))
  .map((name) => ({ name, security: JSON.parse(read(`src-tauri/${name}`)).app?.security as { csp?: string; dangerousDisableAssetCspModification?: unknown } | undefined }))
  .filter((entry) => typeof entry.security?.csp === 'string')

describe('inline styles stay allowed', () => {
  it('the page has no style element, so no nonce reaches style-src', () => {
    expect(PAGE).not.toMatch(/<style[\s>]/i)
  })

  it('the page has no inline script either: script-src allows none, and Tauri would add a hash for it', () => {
    const scripts = PAGE.match(/<script\b[^>]*>/gi) ?? []
    expect(scripts.length).toBeGreaterThan(0)
    for (const tag of scripts) expect(tag).toMatch(/\bsrc="\/[^"]+"/)
  })

  it('the page needs inline styles: its loading screen is styled with attributes', () => {
    expect(PAGE).toMatch(/<div id="splash" style="[^"]+"/)
    expect(PAGE).toMatch(/<body style="[^"]+"/)
  })

  it('every policy allows them in so many words, and nothing in the configuration writes a nonce or a hash there', () => {
    expect(policies.map((p) => p.name).sort()).toEqual(['tauri.conf.json', 'tauri.ios.conf.json'])
    for (const { name, security } of policies) {
      const style = directives(security!.csp!)['style-src']
      expect(style, name).toEqual(["'self'", "'unsafe-inline'"])
      expect(security!.csp, name).not.toMatch(/'nonce-|'sha(256|384|512)-/)
    }
  })

  it('what the first frame needs comes from files of the app, which the policy allows', () => {
    for (const file of ['/first-paint.css', '/first-paint.js', '/webview-check.js', '/fonts/lu-fonts.css']) {
      expect(PAGE).toContain(`"${file}"`)
      expect(() => read(`public${file}`)).not.toThrow()
    }
  })
})
