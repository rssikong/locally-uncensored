/**
 * Point 4 of the mobile groundwork, the rules around the one model slot:
 * which chat model is picked by itself, how far an agent may raise the
 * context, what memory does without an embedder, and that nothing probes
 * Ollama or LM Studio on a device that has neither.
 *
 * Run: npx vitest run src/lib/__tests__/mobile-model-slot-rules.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { standOn } from '../../test-support/devices'

vi.mock('../memoryEmbedDB', () => ({
  loadVectors: vi.fn(async () => new Map()),
  saveVector: vi.fn(async () => undefined),
  deleteVector: vi.fn(async () => undefined),
  clearAll: vi.fn(async () => undefined),
  exportAll: vi.fn(async () => ({})),
  memoryVectorsRevision: () => 0,
}))

import { canAutoSelectChat, isBelowChatMinimum, chatRecommendationGroups } from '../chat-model-minimum'
import { useMemoryStore, __setMemoryEmbedFn } from '../../stores/memoryStore'
import { loadVectors } from '../memoryEmbedDB'
import { sourcesFromChunks, SOURCE_PREVIEW_CHARS } from '../rag-sources'
import { useChatStore } from '../../stores/chatStore'
import { buildRagSuffix } from '../rag-prompt'
import { exportAsMarkdown } from '../chat-export'
import type { Conversation } from '../../types/chat'

const src = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8')

afterEach(() => { vi.unstubAllGlobals(); __setMemoryEmbedFn() })

describe('the automatic chat model', () => {
  const small = { name: 'qwen3-1.7b-q4.gguf', details: { parameter_size: '1.7B' } }
  const big = { name: 'qwen3-8b-q4.gguf', details: { parameter_size: '8B' } }

  it('phone: a model below 7B may be the automatic choice, it is what fits', () => {
    standOn('android')
    expect(canAutoSelectChat(small)).toBe(true)
    expect(canAutoSelectChat(big)).toBe(true)
    expect(canAutoSelectChat({ name: 'sdxl', type: 'image' })).toBe(false)
  })

  it('phone: no "Below 7B" warning, and small models stay in the recommendations', () => {
    standOn('iphone')
    const tiny = { tags: ['1.7B'] } as Parameters<typeof isBelowChatMinimum>[0]
    expect(isBelowChatMinimum(tiny)).toBe(false)
    expect(chatRecommendationGroups([[tiny as never]])).toHaveLength(1)
  })

  it('desktop: the 7B floor and the warning are what they were', () => {
    standOn('windows')
    expect(canAutoSelectChat(small)).toBe(false)
    expect(canAutoSelectChat(big)).toBe(true)
    expect(canAutoSelectChat({ name: 'opaque-alias' })).toBe(false)
    const tiny = { tags: ['1.7B'] } as Parameters<typeof isBelowChatMinimum>[0]
    expect(isBelowChatMinimum(tiny)).toBe(true)
    expect(chatRecommendationGroups([[tiny as never]])).toHaveLength(0)
  })
})

describe('memory without an embedder', () => {
  const fact = { type: 'user' as const, title: 'Preference', description: 'Tea', content: 'Prefers tea over coffee', tags: [], source: 'chat' as const }

  beforeEach(() => {
    vi.mocked(loadVectors).mockClear()
    useMemoryStore.setState({ entries: [] })
  })

  it('phone: adding a memory does not embed it', async () => {
    standOn('android')
    const embed = vi.fn(async () => [[1, 0]])
    __setMemoryEmbedFn(embed)
    useMemoryStore.getState().addMemory(fact)
    await new Promise((r) => setTimeout(r, 0))
    expect(embed).not.toHaveBeenCalled()
    expect(loadVectors).not.toHaveBeenCalled()
  })

  it('phone: a send finds the memory by keyword and does not embed the question', async () => {
    standOn('iphone')
    useMemoryStore.getState().addMemory(fact)
    const embed = vi.fn(async () => [[1, 0]])
    __setMemoryEmbedFn(embed)
    const out = await useMemoryStore.getState().getMemoriesForPromptAsync('does the user like tea', 8192)
    expect(out).toContain('Prefers tea over coffee')
    expect(out).toBe(useMemoryStore.getState().getMemoriesForPrompt('does the user like tea', 8192))
    expect(embed).not.toHaveBeenCalled()
  })

  it('desktop: adding embeds in the background and a send embeds the question, as before', async () => {
    standOn('windows')
    const embed = vi.fn(async () => [[1, 0]])
    __setMemoryEmbedFn(embed)
    useMemoryStore.getState().addMemory(fact)
    await vi.waitFor(() => expect(embed).toHaveBeenCalledTimes(1))
    await useMemoryStore.getState().getMemoriesForPromptAsync('does the user like tea', 8192)
    expect(embed).toHaveBeenCalledTimes(2)
  })

  it('the model refresh and the install do not start the embedder on a single slot', () => {
    expect(src('hooks/useModels.ts')).toMatch(/async function resumeEmbedServer\(bundled: BundledModel\[\]\) \{[\s\S]{0,400}?if \(singleModelSlot\(\)\) return\n\s*if \(embedResumeLaeuft\) return/)
    expect(src('api/embed-install.ts')).toContain('if (!singleModelSlot()) await startBundledEmbed(`${destDir}/${filename}`)')
    expect(src('hooks/useMemory.ts')).toMatch(/if \(!singleModelSlot\(\)\) \{\s*const \[vec\] = await generateEmbeddings/)
  })
})

describe('nobody probes Ollama or LM Studio on a phone', () => {
  it('the call sites ask hasForeignBackends', () => {
    const rag = src('hooks/useRAG.ts')
    expect(rag).toMatch(/const checkContextWindow = async \(\) => \{[\s\S]{0,300}?if \(!hasForeignBackends\(\)\) return/)
    expect(rag).toMatch(/const ollamaReachable = isManagedBuiltinActive\(\) \|\| !hasForeignBackends\(\)\s*\? false/)
    expect(rag).toContain('if (isManagedBuiltinActive() || !hasForeignBackends()) {')
    expect(src('hooks/useActiveContextWindow.ts')).toMatch(/const info = hasForeignBackends\(\)\s*\? await getLmStudioModelContext\(modelId\)/)
  })
})

describe('the passages an answer was given', () => {
  const docs = [{ id: 'd1', name: 'Manual.pdf' }, { id: 'd2', name: 'Notes.txt' }]
  const chunks = [
    { documentId: 'd2', index: 4, content: 'Second   document,\n passage five. ' + 'x'.repeat(400) },
    { documentId: 'd1', index: 0, content: 'First document, first passage.' },
    { documentId: 'gone', index: 2, content: 'Orphan.' },
  ]

  it('names the document, keeps the passage number and a short preview, in prompt order', () => {
    const sources = sourcesFromChunks(chunks, docs)
    expect(sources.map((s) => s.documentName)).toEqual(['Notes.txt', 'Manual.pdf', 'Document'])
    expect(sources.map((s) => s.chunkIndex)).toEqual([4, 0, 2])
    expect(sources[0].preview.startsWith('Second document, passage five.')).toBe(true)
    expect(sources[0].preview.length).toBe(SOURCE_PREVIEW_CHARS)
    // Entry n is "[Source n+1]" in the block the model reads.
    expect(buildRagSuffix(chunks)).toContain('[Source 2]\nFirst document, first passage.')
  })

  it('the store writes them onto the message, and the export finally has a Sources block', () => {
    useChatStore.setState({
      conversations: [{
        id: 'c1', title: 'Doc chat', model: 'm', createdAt: 1, updatedAt: 1,
        messages: [
          { id: 'u', role: 'user', content: 'What does it say?', timestamp: 1 },
          { id: 'a', role: 'assistant', content: 'It says so.', timestamp: 2 },
        ],
      } as unknown as Conversation],
    })
    useChatStore.getState().updateMessageSources('c1', 'a', sourcesFromChunks(chunks, docs))
    const conv = useChatStore.getState().conversations[0]
    expect(conv.messages[1].sources).toHaveLength(3)
    expect(conv.messages[0].sources).toBeUndefined()
    const md = exportAsMarkdown(conv)
    expect(md).toContain('**Sources:**')
    expect(md).toContain('- Notes.txt (chunk 4)')
  })

  it('both sending paths write them right after retrieval', () => {
    for (const file of ['hooks/useChat.ts', 'hooks/useAgentChat.ts']) {
      expect(src(file), file).toMatch(
        /ragSuffix = buildRagSuffix\(ragContext\.chunks\)[\s\S]{0,300}?updateMessageSources\(\s*convId,\s*assistantMessage\.id,\s*sourcesFromChunks\(ragContext\.chunks, ragState\.documents\[convId\] \?\? \[\]\),/,
      )
    }
  })
})
