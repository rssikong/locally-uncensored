import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ZH_CN, ZH_PATTERNS } from '../i18n/zh-CN'
import { findViolations, loadTerms, normalizeValue } from '../../../scripts/lib/i18n-terms.mjs'

/**
 * 一个英文词只对应一种中文（`src/lib/i18n/terms.json`）。
 *
 * 真正的阻断点在 `scripts/i18n-check.mjs` —— 巡检和发布都调它。这个文件不是门禁，
 * 它是**负向对照**：证明那条规则不是空壳。没有它，`terms.json` 被清空、路径写错、
 * 或者代码根本没接上，都会以"全绿"的样子通过。
 *
 * 归一的语义是"整条译文就是那个变体"。短语内部的「对话」是普通名词（一个对话、
 * 长对话），不是术语不一致 —— 见 terms.json 里 chat 的 rationale。
 */

const table = loadTerms(readFileSync, fileURLToPath(new URL('../i18n/terms.json', import.meta.url)))

const normalizing = table.terms.filter((term) => term.mode === 'normalize')

describe('术语表本身', () => {
  it('能加载，且不是空壳', () => {
    expect(table.terms.length).toBeGreaterThanOrEqual(9)
    expect(normalizing.length).toBeGreaterThanOrEqual(1)
  })

  it('每个 normalize 词都还有活可干（作用域内至少命中一条）', () => {
    // 照 no-built-in-engine-left-on-screen 的做法：豁免/规则必须仍然有用。
    // 一条永远匹配不到东西的规则，和没有这条规则是一样的，但它看起来像在守。
    for (const term of normalizing) {
      const hits = Object.keys(ZH_CN).filter((key) => term._en.test(key))
      expect(hits.length, `术语 ${term.id} 一条也没命中`).toBeGreaterThan(0)
    }
  })
})

describe('能看见违规', () => {
  it('整条译文是变体时抓得到', () => {
    const violations = findViolations({ 'New chat': '对话' }, [], table)
    expect(violations.map((v) => [v.term, v.actual, v.expected])).toEqual([['chat', '对话', '聊天']])
  })

  it('模式表里的替换串同样受管', () => {
    const violations = findViolations({}, [['Chat with {0}', '对话']], table)
    expect(violations.map((v) => v.table)).toEqual(['patterns'])
  })

  it('大小写不同的拉丁变体也算（令牌 / 令牌）', () => {
    const violations = findViolations({ 'Max tokens': '令牌' }, [], table)
    expect(violations.map((v) => v.term)).toEqual(['token'])
  })
})

describe('不误伤', () => {
  it('短语内部的「对话」不是违规', () => {
    // 这些是中文里的正常说法，替换会读成「一个聊天」「长聊天」
    for (const value of ['一个对话', '长对话和 RAG', 'Agent 模式必须在对话开始时启用', '本对话中已使用']) {
      expect(findViolations({ 'Open chat': value }, [], table), value).toEqual([])
    }
  })

  it('conversation 的「对话」永远不在 chat 的作用域内', () => {
    expect(findViolations({ 'Open a conversation': '对话' }, [], table)).toEqual([])
  })

  it('report 的词不产生违规（memory 的内存/记忆都正当）', () => {
    expect(findViolations({ 'Memory usage': '内存', 'Memory': '记忆' }, [], table)).toEqual([])
  })

  it('当前词典是干净的', () => {
    expect(findViolations(ZH_CN, ZH_PATTERNS, table)).toEqual([])
  })
})

describe('归一', () => {
  it('整条是变体时改写成 canonical', () => {
    expect(normalizeValue('New chat', '对话', table).value).toBe('聊天')
  })

  it('保留首尾空白（bridge 会把它放回去）', () => {
    expect(normalizeValue('New chat', ' 对话 ', table).value).toBe(' 聊天 ')
  })

  it('短语内部一个字符都不动', () => {
    expect(normalizeValue('Open chat', '打开对话窗口', table).value).toBe('打开对话窗口')
  })

  it('幂等', () => {
    const once = normalizeValue('New chat', '对话', table).value
    expect(normalizeValue('New chat', once, table).value).toBe(once)
  })
})
