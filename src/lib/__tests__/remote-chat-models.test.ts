/**
 * The chat models a phone can pick carry the label the desktop's model
 * picker shows (lib/remote-chat-models.ts). Device test 20.10.2026: an
 * Ollama model from Hugging Face came out as its full hf.co path.
 */
import { describe, it, expect } from 'vitest'
import { chatModelChoices } from '../remote-chat-models'
import { modelDisplayLabel } from '../model-label'
import type { AIModel } from '../../types/models'

const text = (name: string, extra: Record<string, unknown> = {}) => ({ name, model: name, size: 1, type: 'text', provider: 'ollama', ...extra }) as unknown as AIModel

describe('chat models for the phone', () => {
  it('labels are the labels of the picker, also for hf.co models', () => {
    const models = [
      text('hf.co/SomeOrg/Some-Model-12B-GGUF:Q4_K_M'),
      text('hf.co/SomeOrg/Other-Model-GGUF/other-model-q8_0.gguf'),
      text('qwen2.5:0.5b'),
      text('lmstudio::google/gemma-3-12b', { provider: 'lmstudio' }),
      text('openai::my-entry', { provider: 'openai', displayName: 'My Model' }),
    ]
    const choices = chatModelChoices(models, 'local')
    expect(choices.map((c) => c.name)).toEqual(models.map((m) => m.name))
    for (const c of choices) expect(c.label).toBe(modelDisplayLabel(models, c.name))
    expect(choices[0].label).not.toContain('hf.co')
    expect(choices[1].label).not.toContain('/')
    expect(choices[1].label).not.toMatch(/\.gguf$/i)
    expect(choices[4].label).toBe('My Model')
  })

  it('picture and video rows are not chat models', () => {
    const models = [text('qwen2.5:0.5b'), { name: 'sdxl', type: 'image' } as unknown as AIModel, { name: 'wan', type: 'video' } as unknown as AIModel]
    expect(chatModelChoices(models, 'local').map((c) => c.name)).toEqual(['qwen2.5:0.5b'])
  })
})
