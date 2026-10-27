/**
 * Review N5: in the installed app the scripts of a previewed page do not run.
 * The frame is a srcdoc document and takes over the content security policy
 * of the app (script-src 'self' 'wasm-unsafe-eval'), which allows no inline
 * script. Measured with that policy in Chromium and in WebKit: the frame
 * reports two violations and sends nothing. The policy is not loosened for
 * this (it protects the whole app); the preview says what it shows instead.
 *
 * Run: npx vitest run src/mobile/screens/agent/__tests__/preview-scripts.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { withoutScripts, PREVIEW_CSP, PREVIEW_MESSAGE, PREVIEW_READY, noteScriptsBlocked, pageWantsScripts, scriptsKnownBlocked, previewDocument, readPreviewMessage, readPreviewReady } from '../parts/preview-doc'
import { AGENT_STRINGS } from '../../../strings/agent'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../../../..')

describe('the preview knows whether scripts run', () => {
  it('the reporter says "ready" first, with the token of its page view', () => {
    const doc = previewDocument('<p>x</p><script>go()</script>', 'html', 'p0xabc')
    const ready = doc.indexOf(`type:"${PREVIEW_READY}",token:"p0xabc"`)
    expect(ready).toBeGreaterThan(-1)
    // Before the page's own code.
    expect(ready).toBeLessThan(doc.indexOf('go()'))
  })

  it('reads only the ready message of its own view, and never takes it for an error', () => {
    expect(readPreviewReady({ type: PREVIEW_READY, token: 'p0xabc' }, 'p0xabc')).toBe(true)
    expect(readPreviewReady({ type: PREVIEW_READY, token: 'other' }, 'p0xabc')).toBe(false)
    expect(readPreviewReady({ type: PREVIEW_MESSAGE, token: 'p0xabc', message: 'boom' }, 'p0xabc')).toBe(false)
    expect(readPreviewReady(null, 'p0xabc')).toBe(false)
    expect(readPreviewMessage({ type: PREVIEW_READY, token: 'p0xabc' }, 'p0xabc')).toBeNull()
  })

  it('only a page that has scripts is told about them', () => {
    expect(pageWantsScripts('<h1>Hello</h1><style>h1{color:red}</style>')).toBe(false)
    expect(pageWantsScripts('<p>The word script and onclick in a text</p>')).toBe(false)
    expect(pageWantsScripts('<p>x</p><script>go()</script>')).toBe(true)
    expect(pageWantsScripts('<script src="a.js"></script>')).toBe(true)
    expect(pageWantsScripts('<button onclick="go()">Go</button>')).toBe(true)
  })

  it('the page shows the note only after the wait, only for its own view, and not next to an error', () => {
    const page = readFileSync(join(HERE, '../PreviewPage.tsx'), 'utf8')
    expect(page).toContain('const noScripts = wantsScripts && (!reporterOn || (waited === `${token}-${width}` && ready !== token))')
    expect(page).toMatch(/window\.setTimeout\(\(\) => setWaited\(view\), PREVIEW_READY_WAIT_MS\)/)
    expect(page).toMatch(/\{noScripts && pageError === null \? \(\s*<Notice title=\{S\.noScriptsTitle\} testid="m-preview-noscripts">/)
  })

  // Finding N10 of the Android review: the reporter is an inline script, the policy of the app refuses it, and the
  // refusal was an error in the console at every load of a page that has no script at all.
  it('a page without scripts gets the policy and no script of ours', () => {
    for (const code of ['<h1>Hello</h1>', '<style>p{color:red}</style><p>x</p>', '<p>The word script and onclick in a text</p>']) {
      const doc = previewDocument(code, 'html', 'p0xabc')
      expect(doc, code).toContain('Content-Security-Policy')
      expect(doc, code).not.toContain('<script')
      expect(doc, code).not.toContain(PREVIEW_READY)
    }
  })

  it('a page with scripts gets the reporter, unless the frames are known not to run scripts', () => {
    const code = '<button onclick="go()">Go</button>'
    expect(previewDocument(code, 'html', 'p0xabc')).toContain(PREVIEW_READY)
    expect(previewDocument(code, 'html', 'p0xabc', false)).not.toContain('<script')
    noteScriptsBlocked(false)
    expect(scriptsKnownBlocked()).toBe(false)
    noteScriptsBlocked(true)
    expect(scriptsKnownBlocked()).toBe(true)
    noteScriptsBlocked(false)
  })

  it('the page remembers what the first wait found out, and builds the next frame without the reporter', () => {
    const page = readFileSync(join(HERE, '../PreviewPage.tsx'), 'utf8')
    expect(page).toContain('const reporterOn = useMemo(() => wantsScripts && !scriptsKnownBlocked()')
    expect(page).toContain('previewDocument(block.code, block.language, token, reporterOn)')
    expect(page).toMatch(/noteScriptsBlocked\(true\)/)
  })

  it('says what is shown and what is not, without a dash', () => {
    const text = `${AGENT_STRINGS.preview.noScriptsTitle} ${AGENT_STRINGS.preview.noScripts}`
    expect(text).toMatch(/layout and the styles/)
    expect(text).toMatch(/scripts do not run inside the app/)
    expect(text).not.toMatch(/[–—]/)
  })

  it('the policy of the app still allows no inline script, on every platform', () => {
    for (const file of ['src-tauri/tauri.conf.json', 'src-tauri/tauri.ios.conf.json']) {
      const csp = (JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as { app: { security: { csp: string } } }).app.security.csp
      const scripts = /script-src ([^;]+)/.exec(csp)?.[1] ?? ''
      expect(scripts.trim(), file).toBe("'self' 'wasm-unsafe-eval'")
    }
    // The frame stays closed off: scripts allowed by the sandbox, never the same origin.
    expect(readFileSync(join(ROOT, 'src/lib/file-preview.ts'), 'utf8')).toMatch(/return allowScripts \? 'allow-scripts' : ''/)
  })

  // Round 12, F2. What the two policies do together in a browser is measured in e2e/mobile/agent.mobile.ts.
  it('the previewed page carries a policy of its own, in front of everything else in it', () => {
    for (const code of ['<h1 style="color: red">x</h1>', '<!doctype html><html><head><title>t</title></head><body><script>go()</script></body></html>', '<html><body>x</body></html>']) {
      const doc = previewDocument(code, 'html', 'p0xabc')
      const policy = doc.indexOf('<meta http-equiv="Content-Security-Policy"')
      expect(policy, code).toBeGreaterThan(-1)
      // The reporter stands only in a page that has scripts (N10), and then after the policy.
      if (pageWantsScripts(code)) expect(policy, code).toBeLessThan(doc.indexOf('<script>'))
      else expect(doc, code).not.toContain('<script')
      expect(doc.indexOf('<body'), code).toBeGreaterThan(policy)
    }
  })

  it('that policy allows the styles of the page and no network at all', () => {
    const rules = Object.fromEntries(PREVIEW_CSP.split(';').map((rule) => rule.trim().split(/\s+/)).map(([name, ...values]) => [name, values]))
    expect(rules['default-src']).toEqual(["'none'"])
    expect(rules['style-src']).toEqual(["'unsafe-inline'"])
    expect(rules['form-action']).toEqual(["'none'"])
    expect(rules['base-uri']).toEqual(["'none'"])
    // Nothing in it names a host, a scheme that reaches one, or the origin of the app.
    expect(PREVIEW_CSP).not.toMatch(/https?:|wss?:|\*|'self'/)
    expect(rules['connect-src']).toBeUndefined()
    expect(rules['frame-src']).toBeUndefined()
    // No quote in it, or it would end the attribute it stands in.
    expect(PREVIEW_CSP).not.toContain('"')
  })

  it('the policy of the app allows inline styles, and nothing in the start page makes Tauri add a nonce to it', () => {
    for (const file of ['src-tauri/tauri.conf.json', 'src-tauri/tauri.ios.conf.json']) {
      const csp = (JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as { app: { security: { csp: string } } }).app.security.csp
      expect(/style-src ([^;]+)/.exec(csp)?.[1].trim(), file).toBe("'self' 'unsafe-inline'")
    }
    expect(readFileSync(join(ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/<style[\s>]/i)
  })
})

// Short check of package 10 on iOS: a page with a script of its own gave four console lines in three views, the policy
// refusing the reporter and the page's script at every load. Where scripts are known not to run, the page goes in
// without them: the refusal is not repeated.
describe('a frame that is known not to run scripts gets the page without them', () => {
  const page = '<h1 onclick="go()">Title</h1><p>Text</p><script>function go(){ alert(1) }</script><button data-x="a>b" onmouseover=\'z()\'>Go</button>'

  it('has no script block and no handler left, and keeps the markup', () => {
    const doc = previewDocument(page, 'html', 'p0xabc', false)
    expect(doc).not.toMatch(/<script/i)
    expect(doc).not.toMatch(/\son[a-z]+\s*=/i)
    expect(doc).toContain('<h1>Title</h1>')
    expect(doc).toContain('<p>Text</p>')
    expect(doc).toContain('Content-Security-Policy')
  })

  it('leaves a page that is allowed to run its scripts as it was', () => {
    const doc = previewDocument(page, 'html', 'p0xabc', true)
    expect(doc).toContain('function go()')
    expect(doc).toContain('onclick="go()"')
  })

  it('stays quick on a large page', () => {
    const big = '<div class="a b" id="x" data-k="v">' + '<span style="color:red" onclick="f()">row</span>'.repeat(6000) + '</div>' + '<div a="1" b b b b b b b b b b b b b b b b b b'.repeat(200)
    const started = Date.now()
    expect(withoutScripts(big)).not.toContain('onclick')
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('does not touch words in the text', () => {
    expect(withoutScripts('<p>write onclick= in an attribute</p>')).toBe('<p>write onclick= in an attribute</p>')
  })
})
