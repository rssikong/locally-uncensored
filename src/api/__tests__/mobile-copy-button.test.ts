/**
 * The Copy buttons of the browser page (mobile-client/client.js, served by
 * src-tauri/src/mobile_page.rs). On the plain http page in the Wi-Fi the
 * browser has no navigator.clipboard (secure contexts only), the call threw
 * before its .catch and the button did nothing. Now the page falls back to a
 * hidden textarea and execCommand('copy'), and the button says "Copied" or
 * "Copy failed". The shipped functions run here with a small stand in DOM.
 */
import { describe, it, expect, vi } from 'vitest'
import { clientSource, loadFromClient } from './mobile-client-shell'

interface FakeEl {
  tag: string
  value: string
  style: Record<string, string>
  innerHTML: string
  attrs: Record<string, string>
  setAttribute: (k: string, v: string) => void
  getAttribute: (k: string) => string | null
  removeAttribute: (k: string) => void
  focus: () => void
  select: () => void
  setSelectionRange: (a: number, b: number) => void
  _copyRestore?: (() => void) | null
  _copyTimer?: unknown
}

function el(tag: string): FakeEl {
  const e: FakeEl = {
    tag, value: '', style: {}, innerHTML: '', attrs: {},
    setAttribute: (k, v) => { e.attrs[k] = v },
    getAttribute: (k) => (k in e.attrs ? e.attrs[k] : null),
    removeAttribute: (k) => { delete e.attrs[k] },
    focus: () => {}, select: () => {}, setSelectionRange: () => {},
  }
  return e
}

function page(opts: { clipboard?: unknown; secure?: boolean; execOk?: boolean }) {
  const body: FakeEl[] = []
  const copied: string[] = []
  const timers: (() => void)[] = []
  const document = {
    createElement: (t: string) => el(t),
    body: {
      appendChild: (e: FakeEl) => { body.push(e) },
      removeChild: (e: FakeEl) => { body.splice(body.indexOf(e), 1) },
    },
    execCommand: (cmd: string) => {
      if (cmd !== 'copy') return false
      const ta = body.find((e) => e.tag === 'textarea')
      if (opts.execOk === false || !ta) return false
      copied.push(ta.value)
      return true
    },
  }
  const navigator = opts.clipboard === undefined ? {} : { clipboard: opts.clipboard }
  const window = { isSecureContext: opts.secure ?? false }
  const setTimeout = (fn: () => void) => { timers.push(fn); return timers.length }
  const fns = loadFromClient<{
    copyText: (text: string, btn: FakeEl | null) => void
    legacyCopy: (text: string) => boolean
    flashCopy: (btn: FakeEl, ok: boolean) => void
  }>(['copyText', 'legacyCopy', 'flashCopy'], { document, navigator, window, setTimeout, clearTimeout: () => {} })
  return { ...fns, body, copied, timers }
}

function button(): FakeEl {
  const b = el('button')
  b.innerHTML = '<span class="material-symbols-outlined">icon</span>'
  b.setAttribute('title', 'Copy')
  return b
}

describe('the Copy button of the browser page', () => {
  it('on http in the Wi-Fi (no navigator.clipboard) copies through a hidden textarea and says Copied', () => {
    const p = page({})
    const btn = button()
    expect(() => p.copyText('hello\nworld', btn)).not.toThrow()
    expect(p.copied).toEqual(['hello\nworld'])
    expect(p.body).toHaveLength(0) // the textarea is gone again
    expect(btn.innerHTML).toContain('Copied')
    expect(btn.getAttribute('data-copy-state')).toBe('copied')
    expect(btn.getAttribute('title')).toBe('Copied')
    // A moment later the button is as before.
    p.timers.forEach((t) => t())
    expect(btn.innerHTML).toContain('icon')
    expect(btn.getAttribute('title')).toBe('Copy')
    expect(btn.getAttribute('data-copy-state')).toBeNull()
  })

  it('says Copy failed when the browser refuses both ways', () => {
    const p = page({ execOk: false })
    const btn = button()
    p.copyText('x', btn)
    expect(btn.innerHTML).toContain('Copy failed')
    expect(btn.getAttribute('data-copy-state')).toBe('failed')
  })

  it('takes the clipboard API where the page is secure, and falls back when it rejects', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const p = page({ clipboard: { writeText }, secure: true })
    const btn = button()
    p.copyText('code', btn)
    expect(writeText).toHaveBeenCalledWith('code')
    await Promise.resolve()
    await Promise.resolve()
    expect(btn.innerHTML).toContain('Copied')
    expect(p.copied).toEqual([])

    const rejecting = page({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, secure: true })
    const b2 = button()
    rejecting.copyText('code', b2)
    await new Promise((r) => setTimeout(r, 0))
    expect(rejecting.copied).toEqual(['code'])
    expect(b2.innerHTML).toContain('Copied')
  })

  it('a clipboard API that throws at once does not stop the fallback', () => {
    const p = page({ clipboard: { writeText: () => { throw new Error('NotAllowed') } }, secure: true })
    const btn = button()
    p.copyText('x', btn)
    expect(p.copied).toEqual(['x'])
    expect(btn.innerHTML).toContain('Copied')
  })

  it('the message and the code block buttons hand themselves over, and nothing calls the clipboard bare', () => {
    const src = clientSource()
    expect(src).toContain("window._copyMsg('+i+',this)")
    expect(src).toContain("window._copyCodeKey(\\''+key+'\\',this)")
    expect(src).not.toMatch(/navigator\.clipboard\.writeText\(/)
  })
})
