import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, resolveLocale, setLocale, t, translationFor } from '../i18n'
import { ZH_CN } from '../i18n/zh-CN'

/**
 * The locale rules are load-bearing for the fork, not decoration:
 *
 *  - under vitest the answer must be English, or every test that asserts on
 *    visible copy starts failing the moment a screen is translated, and the
 *    release workflow's `gate` job (which is `uses: ci.yml`) blocks the build;
 *  - the shipped app must answer Chinese without anybody setting anything;
 *  - a string upstream adds must fall back to itself, never to an empty label.
 */
beforeEach(() => setLocale('en', { reload: false }))
afterEach(() => setLocale('en', { reload: false }))

describe('locale resolution', () => {
  it('answers English under vitest, which is what keeps the suite green', () => {
    expect(resolveLocale()).toBe('en')
    expect(t('Chat')).toBe('Chat')
  })

  it('answers Chinese once the session is pinned to it', () => {
    setLocale('zh-CN', { reload: false })
    expect(resolveLocale()).toBe('zh-CN')
    expect(t('Chat')).toBe('聊天')
  })

  it('defaults to Chinese for a shipped build', () => {
    // The only reason this is not `resolveLocale()` here is the test-mode rule
    // above; the default is still what the app shows.
    expect(DEFAULT_LOCALE).toBe('zh-CN')
  })
})

describe('translation', () => {
  it('falls back to the English source for a string nobody translated', () => {
    setLocale('zh-CN', { reload: false })
    expect(t('A sentence upstream added yesterday')).toBe('A sentence upstream added yesterday')
  })

  it('fills named placeholders and leaves unknown ones alone', () => {
    ZH_CN['Delete {n} items'] = '删除 {n} 项'
    try {
      setLocale('zh-CN', { reload: false })
      expect(t('Delete {n} items', { n: 3 })).toBe('删除 3 项')
      expect(t('Delete {n} items')).toBe('删除 {n} 项')
      expect(t('Delete {n} items', { other: 1 })).toBe('删除 {n} 项')
    } finally {
      delete ZH_CN['Delete {n} items']
    }
  })

  it('does not touch a source string that carries no entry', () => {
    setLocale('zh-CN', { reload: false })
    expect(translationFor('Chat')).toBe('聊天')
    expect(translationFor('Chat', 'en')).toBeNull()
  })
})
