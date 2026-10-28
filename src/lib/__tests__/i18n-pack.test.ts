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

  it('translates what a slot captured, not just the sentence around it', () => {
    // `Reset [[0]] to defaults` with [[0]] = "Voice & Remote" used to render
    // "将 Voice & Remote 重置为默认" — the sentence was translated, the thing
    // inside it was not, because the capture was pasted back verbatim.
    setDictionary({ 'Voice & Remote': '语音与远程' }, [['Reset {0} to defaults', '将 {0} 重置为默认']])
    expect(translate('Reset Voice & Remote to defaults')).toBe('将 语音与远程 重置为默认')
  })

  it('leaves a capture alone when the dictionary has no entry for it', () => {
    // Model names, numbers and paths must survive untouched: otherwise a slot
    // would start translating things nobody asked to translate.
    setDictionary({}, [['Reset {0} to defaults', '将 {0} 重置为默认']])
    expect(translate('Reset Qwen 3.8 27B to defaults')).toBe('将 Qwen 3.8 27B 重置为默认')
  })

  it('stops after one level, so a slot cannot chain translations forever', () => {
    // Without the depth guard, {0}→A→B→… would keep expanding.
    setDictionary({ A: '甲', 甲: '不该出现' }, [['Reset {0} to defaults', '将 {0} 重置为默认']])
    expect(translate('Reset A to defaults')).toBe('将 甲 重置为默认')
  })

  it('does not recurse when the slot captured the whole string', () => {
    // A pattern of nothing but a slot would otherwise call itself with the
    // same argument and never return.
    setDictionary({}, [['{0}', '前缀{0}']])
    expect(translate('anything')).toBe('前缀anything')
  })

  it('does not run patterns on a captured fragment', () => {
    // `{0} {1} run on LU Cloud.` splits lazily, so {1} can be half a sentence
    // ("big for this graphics card. Large chat models"). Re-parsing that with
    // `{0} chat models` produced the broken "Large 个对话模型".
    setDictionary({ 'Large chat models': '大型聊天模型' }, [['{0} chat models', '{0} 个对话模型']])
    expect(translate('Reset Large chat models to defaults')).toBeNull()
    expect(translate('Large chat models')).toBe('大型聊天模型')
  })

  it('matches a sentence that was cut before it reached the DOM', () => {
    // Model cards shorten catalogue copy to 89 characters + "…" in shortBlurb,
    // so the bridge never sees the whole sentence. Without this fallback the
    // longest blurbs stay English even though the translation exists.
    const full = "Google's own Q4 file from quantization-aware training, which is meant to hold quality at this size"
    setDictionary({ [full]: 'Google 官方量化感知训练的 Q4 文件，旨在在此规模下保持质量' }, [])
    const cut = `${full.slice(0, 40)}…`
    expect(translate(cut)).toBe('Google 官方量化感知训练的 Q4 文件，旨在在此规模下保持质量')
  })

  it('does not match a short ellipsis on a prefix guess', () => {
    // "Loading…" must go through the exact entry, never a prefix sweep: a
    // 7-character head could belong to anything.
    setDictionary({ 'Loading spinner is slow': '加载慢' }, [])
    expect(translate('Loading…')).toBeNull()
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
