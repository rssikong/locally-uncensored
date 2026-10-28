import { afterEach, describe, expect, it } from 'vitest'
import {
  compilePattern,
  dictionarySize,
  resetDictionary,
  setDictionary,
  translate,
} from '../i18n/pack'
import { ZH_OVERRIDES } from '../i18n/overrides'

afterEach(() => resetDictionary())

describe('dictionary lookup', () => {
  it('finds an exact entry', () => {
    expect(translate('Chat')).toBe('聊天')
  })

  it('returns null for an unknown sentence instead of guessing', () => {
    expect(translate('A sentence upstream added yesterday')).toBeNull()
  })

  it('does not fall through to Object.prototype', () => {
    // A rendered word like "constructor" must not come back as a function.
    expect(translate('constructor')).toBeNull()
    expect(translate('toString')).toBeNull()
  })

  it('reports how many entries it carries', () => {
    expect(dictionarySize()).toBeGreaterThan(0)
  })
})

describe('patterns for strings with a value inside', () => {
  it('compiles one capture per slot', () => {
    const regex = compilePattern('Tasks ({0})')
    expect(regex.test('Tasks (3)')).toBe(true)
    expect(regex.test('Tasks')).toBe(false)
  })

  it('substitutes every slot, in the replacement order', () => {
    setDictionary({}, [['Remove {0} from {1}', '从 {1} 移除 {0}']])
    expect(translate('Remove chat from folder')).toBe('从 folder 移除 chat')
  })

  it('escapes the literal part of the pattern', () => {
    setDictionary({}, [['a.b ({0})', 'A（{0}）']])
    expect(translate('axb (1)')).toBeNull()
    expect(translate('a.b (1)')).toBe('A（1）')
  })

  it('prefers an exact entry over a pattern', () => {
    setDictionary({ 'Remove all': '全部移除' }, [['Remove {0}', '移除 {0}']])
    expect(translate('Remove all')).toBe('全部移除')
  })
})

describe('hand-maintained overrides', () => {
  it('wins over the generated dictionary and over patterns', () => {
    // "Remove" is a generated entry, so without the override this returns "移除".
    // The pipeline never writes overrides.ts, which is what makes this stable.
    ZH_OVERRIDES.Remove = '手动移除'
    try {
      setDictionary({ Remove: '移除' }, [['Remove {0}', '移除 {0}']])
      expect(translate('Remove')).toBe('手动移除')
      // 手动词条只按整串匹配，带变量的句子仍走模式 —— 这是有意的，
      // 否则一条 override 会连坐所有含这个词的句子。
      expect(translate('Remove x')).toBe('移除 x')
    } finally {
      delete ZH_OVERRIDES.Remove
    }
  })
})
