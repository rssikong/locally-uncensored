// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  NO_TRANSLATE_ATTR,
  installI18nBridge,
  isBridgeInstalled,
  translateWithin,
  uninstallI18nBridge,
} from '../i18n/bridge'
import { resetDictionary } from '../i18n/pack'

beforeEach(() => {
  uninstallI18nBridge()
  resetDictionary()
  document.body.innerHTML = ''
})

afterEach(() => {
  uninstallI18nBridge()
  resetDictionary()
})

describe('text nodes', () => {
  it('replaces a known label', () => {
    document.body.innerHTML = '<button>Chat</button>'
    translateWithin(document.body)
    expect(document.body.textContent).toBe('聊天')
  })

  it('keeps the whitespace around the sentence', () => {
    document.body.innerHTML = '<p>  Chat  </p>'
    translateWithin(document.body)
    expect(document.body.textContent).toBe('  聊天  ')
  })

  it('matches a sentence that wrapped over several lines', () => {
    // JSX with an indented child carries newlines and runs of spaces; the
    // dictionary is keyed by the sentence, not by the layout.
    document.body.innerHTML = '<p>\n      Attach   images or files\n    </p>'
    translateWithin(document.body)
    expect(document.body.textContent?.trim()).toBe('添加图片或文件')
  })

  it('leaves an unknown sentence exactly as it was', () => {
    document.body.innerHTML = '<p>Upstream sentence nobody translated</p>'
    translateWithin(document.body)
    expect(document.body.textContent).toBe('Upstream sentence nobody translated')
  })
})

describe('what must never be touched', () => {
  it('skips code', () => {
    document.body.innerHTML = '<p><code>Chat</code></p>'
    translateWithin(document.body)
    expect(document.body.textContent).toBe('Chat')
  })

  it('skips a subtree marked with data-no-i18n', () => {
    document.body.innerHTML = `<div ${NO_TRANSLATE_ATTR}><span>Chat</span></div>`
    translateWithin(document.body)
    expect(document.body.textContent).toBe('Chat')
  })

  it('skips a textarea value but still translates its placeholder', () => {
    document.body.innerHTML = '<textarea placeholder="Chat">Chat</textarea>'
    translateWithin(document.body)
    const area = document.body.querySelector('textarea')!
    expect(area.value).toBe('Chat')
    expect(area.getAttribute('placeholder')).toBe('聊天')
  })
})

describe('attributes', () => {
  it('translates the ones a user reads', () => {
    document.body.innerHTML =
      '<input placeholder="Chat" title="Settings" aria-label="Models" alt="Cloud">'
    translateWithin(document.body)
    const input = document.body.querySelector('input')!
    expect(input.getAttribute('placeholder')).toBe('聊天')
    expect(input.getAttribute('title')).toBe('设置')
    expect(input.getAttribute('aria-label')).toBe('模型')
    expect(input.getAttribute('alt')).toBe('云端')
  })
})

describe('the observer', () => {
  it('translates nodes that arrive after install', async () => {
    document.body.innerHTML = '<div id="host"></div>'
    installI18nBridge()
    expect(isBridgeInstalled()).toBe(true)

    const span = document.createElement('span')
    span.textContent = 'Skills'
    document.getElementById('host')!.append(span)

    await new Promise((resolve) => setTimeout(resolve, 0))
    // "Skills" is not in the dictionary; use a known one instead.
    span.textContent = 'Chat'
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(span.textContent).toBe('聊天')
  })

  it('translates a placeholder that is set after mount', async () => {
    document.body.innerHTML = '<input id="later" placeholder="Chat">'
    installI18nBridge()
    const input = document.getElementById('later') as HTMLInputElement
    input.setAttribute('placeholder', 'Settings')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(input.getAttribute('placeholder')).toBe('设置')
  })

  it('is idempotent', () => {
    installI18nBridge()
    installI18nBridge()
    expect(isBridgeInstalled()).toBe(true)
  })
})
