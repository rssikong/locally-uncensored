/** Pure logic behind the pages of the strand: documents, compare, tasks, preview, group chat and the settings pages. */
import { describe, expect, it } from 'vitest'
import type { AgentTask } from '../../../../lib/agent-tasks'
import { MemorySyncError } from '../../../../api/cloud/memory-sync'
import type { MemoryFile } from '../../../../types/agent-mode'
import type { WorkflowStep } from '../../../../types/agent-workflows'
import type { Persona } from '../../../../types/settings'
import { syncDoneText, syncFailureText } from '../parts/adapters/memory-sync'
import { compareBlock, formatRate, keptPair, questionOf, rateIsMeaningful } from '../parts/compare-logic'
import { documentKind, failureReason, isAbort, isPausedNow, passagesOf, pausedOnly } from '../parts/documents-logic'
import { slotTurnText } from '../parts/slot-turn'
import { EMBEDDER_NO_ROOM_ALONE_MESSAGE, NO_EMBED_MODEL_MOBILE_MESSAGE, SingleSlotConflictError } from '../../../../lib/model-slot'
import { addBlock, groupRuns, seedGroup } from '../parts/group-logic'
import { filterMemories, isOutdated, keepOverride, looksLikeJson, memoryFields, memoryProblem, needsReview, REVIEW_AFTER_MS, reviewCount, sourceKind } from '../parts/memory-logic'
import { localCount, modelLabel, whereOf } from '../parts/model-names'
import { changedBuiltIns, newPersonaId, personaProblem } from '../parts/persona-logic'
import { fencedBlocks, findPreviewBlock, isPreviewable, parsePreviewBlockId } from '../parts/preview-block'
import { PREVIEW_MESSAGE, readPreviewMessage, wideScale, WIDE_WIDTH, withPolicyOnly, withReporter } from '../parts/preview-doc'
import { readSearchAnswer, skippedTiers, withoutKeyAdvice } from '../parts/search-logic'
import { foldState, liveCount, orderTasks } from '../parts/tasks-logic'
import { isDraftDirty, useWorkflowDraft } from '../parts/workflow-draft'
import { createStep, firstQuestion, moveStep, operatorNeedsValue, removeStep, STEP_KINDS, stepProblem, stepSummary, workflowCommand, workflowProblem } from '../parts/workflow-logic'

describe('C8 documents', () => {
  it('a paused row is a reading that waits, not one that runs, and a file is matched by name and size', () => {
    const entries = [
      { id: 'a', name: 'a.pdf', size: 10, state: 'running' as const },
      { id: 'b', name: 'b.pdf', size: 20, state: 'paused' as const },
    ]
    expect(pausedOnly(entries).map((e) => e.id)).toEqual(['b'])
    expect(pausedOnly(undefined)).toEqual([])
    expect(isPausedNow(entries, { name: 'b.pdf', size: 20 })).toBe(true)
    expect(isPausedNow(entries, { name: 'b.pdf', size: 21 })).toBe(false)
    expect(isPausedNow(entries, { name: 'a.pdf', size: 10 })).toBe(false)
  })

  it('reads PDF, Word and text files and nothing else', () => {
    expect(documentKind('Plan.PDF')).toBe('pdf')
    expect(documentKind('a.docx')).toBe('docx')
    expect(documentKind('a.txt')).toBe('txt')
    expect(documentKind('photo.png')).toBeNull()
    expect(documentKind('noextension')).toBeNull()
  })

  it('lists the passages of one document, best first, with a whole percent', () => {
    const chunk = (id: string, documentId: string) => ({ id, documentId, content: id, embedding: [], index: 0 })
    const found = [
      { chunk: chunk('a', 'd1'), score: 0.4 },
      { chunk: chunk('b', 'd2'), score: 0.9 },
      { chunk: chunk('c', 'd1'), score: 0.826 },
      { chunk: chunk('d', 'd1'), score: 1.4 },
    ]
    expect(passagesOf(found, 'd1').map((p) => [p.id, p.percent])).toEqual([
      ['d', 100],
      ['c', 83],
      ['a', 40],
    ])
    expect(passagesOf(found, 'none')).toEqual([])
  })

  it('tells a stop from a real failure', () => {
    const abort = new Error('The operation was aborted')
    abort.name = 'AbortError'
    expect(isAbort(abort)).toBe(true)
    expect(isAbort(new Error('No text could be extracted'))).toBe(false)
    expect(isAbort('text')).toBe(false)
  })
})

describe('C9 compare', () => {
  const messages = [
    { id: 'q1', role: 'user' as const, content: 'One?', timestamp: 1 },
    { id: 'a1', role: 'assistant' as const, content: 'First', timestamp: 2 },
    { id: 'q2', role: 'user' as const, content: 'Two?', timestamp: 3 },
    { id: 'a2', role: 'assistant' as const, content: 'Second', timestamp: 4 },
  ]

  it('needs two different models', () => {
    expect(compareBlock('', 'b')).toBe('need-two')
    expect(compareBlock('a', 'a')).toBe('same')
    expect(compareBlock('a', 'b')).toBeNull()
  })

  it('"Keep this answer" takes the answer with the question it belongs to, under new ids', () => {
    expect(questionOf(messages, 3)?.id).toBe('q2')
    let n = 0
    const pair = keptPair(messages, 3, 'openai::b', () => `new-${++n}`, 100)
    expect(pair.map((m) => [m.id, m.role, m.content])).toEqual([
      ['new-1', 'user', 'Two?'],
      ['new-2', 'assistant', 'Second'],
    ])
    expect(pair[1].modelId).toBe('openai::b')
    expect(pair[1].timestamp).toBeGreaterThan(pair[0].timestamp)
  })

  it('there is nothing to keep of a question or of an empty answer', () => {
    expect(keptPair(messages, 0, 'm', () => 'x', 1)).toEqual([])
    expect(keptPair([{ id: 'a', role: 'assistant', content: '   ', timestamp: 1 }], 0, 'm', () => 'x', 1)).toEqual([])
  })

  it('shows the speed with one decimal below ten', () => {
    expect(formatRate(3.456)).toBe('3.5')
    expect(formatRate(42.4)).toBe('42')
    expect(formatRate(NaN)).toBe('0')
  })

  it('knows where a model runs and how it is called', () => {
    expect(whereOf('lu-cloud::big')).toBe('cloud')
    expect(whereOf('openai::small')).toBe('local')
    expect(localCount(['openai::a', 'lu-cloud::b', 'openai::c', ''])).toBe(2)
    expect(modelLabel('lu-cloud::big', [{ name: 'lu-cloud::big', displayName: 'Big Model' } as never])).toBe('Big Model')
    expect(modelLabel('openai::small', [])).toBe('small')
    // N1: a model of this phone reads as in the catalogue, not as its file or its routed id.
    expect(modelLabel('openai::SmolLM2-360M-Instruct-Q4_K_M', [])).toBe('SmolLM2 360M')
    expect(modelLabel('', [])).toBe('')
  })
})

describe('C10 tasks', () => {
  const task = (over: Partial<AgentTask>): AgentTask => ({ id: 't', convId: 'c', goal: 'g', context: '', status: 'running', background: true, startedAt: 1, toolCalls: 0, iterations: 0, inbox: [], reported: false, ...over })

  it('puts what still runs first, newest on top', () => {
    const list = [task({ id: 'done-new', status: 'done', startedAt: 9 }), task({ id: 'run-old', startedAt: 1 }), task({ id: 'run-new', startedAt: 5 }), task({ id: 'queued', status: 'queued', startedAt: 3 })]
    expect(orderTasks(list).map((t) => t.id)).toEqual(['run-new', 'queued', 'run-old', 'done-new'])
    expect(liveCount(list)).toBe(3)
  })

  it('colours a row by how the task ended', () => {
    expect(foldState(task({ status: 'done' }))).toBe('done')
    expect(foldState(task({ status: 'failed' }))).toBe('failed')
    expect(foldState(task({ status: 'cancelled' }))).toBe('denied')
    expect(foldState(task({ status: 'queued' }))).toBe('running')
  })
})

describe('C11 preview', () => {
  const text = ['Intro', '```html', '<h1>One</h1>', '```', 'text', '~~~js', 'let a = "```"', '~~~', '```', '<!doctype html><p>Two</p>', '```', '```html', '<p>never closed</p>'].join('\n')

  it('reads the block id of the address', () => {
    expect(parsePreviewBlockId('msg-1~2')).toEqual({ messageId: 'msg-1', index: 2 })
    expect(parsePreviewBlockId('a~b~0')).toEqual({ messageId: 'a~b', index: 0 })
    expect(parsePreviewBlockId('msg')).toBeNull()
    expect(parsePreviewBlockId('msg~x')).toBeNull()
    expect(parsePreviewBlockId('~1')).toBeNull()
    expect(parsePreviewBlockId('msg~-1')).toBeNull()
  })

  it('counts fenced blocks the way the chat does, also one that is never closed', () => {
    const blocks = fencedBlocks(text)
    expect(blocks.map((b) => b.language)).toEqual(['html', 'js', '', 'html'])
    expect(blocks[0].code).toBe('<h1>One</h1>')
    expect(blocks[1].code).toBe('let a = "```"')
    expect(blocks[3].code).toBe('<p>never closed</p>')
  })

  it('only a web page can be shown', () => {
    expect(findPreviewBlock(text, 0)?.code).toBe('<h1>One</h1>')
    expect(findPreviewBlock(text, 1)).toBeNull()
    expect(findPreviewBlock(text, 2)?.code).toContain('Two')
    expect(findPreviewBlock(text, 9)).toBeNull()
    expect(findPreviewBlock(undefined, 0)).toBeNull()
    expect(isPreviewable({ language: 'svg', code: '<svg/>' })).toBe(true)
    expect(isPreviewable({ language: '', code: 'plain words' })).toBe(false)
    expect(isPreviewable({ language: 'python', code: '<html>' })).toBe(false)
  })

  it('puts the error reporter in front of the page code without breaking the document', () => {
    const full = withReporter('<!doctype html><html><head><title>x</title></head><body></body></html>', 'tok1')
    expect(full.indexOf('<head>')).toBeLessThan(full.indexOf('<script>'))
    expect(full.indexOf('<script>')).toBeLessThan(full.indexOf('<title>'))
    expect(withReporter('<html><body>x</body></html>', 't').startsWith('<html><meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(withReporter('<!doctype html><p>x</p>', 't').startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(withReporter('<p>x</p>', 't').startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true)
  })

  it('the policy comes before anything the page puts in front of its head (r49)', () => {
    const policy = '<meta http-equiv="Content-Security-Policy"'
    // A script in front of the head.
    const early = withReporter('<!doctype html><html><script src="/x.js"></script><head><title>x</title></head><body></body></html>', 't')
    expect(early.indexOf(policy)).toBeGreaterThanOrEqual(0)
    expect(early.indexOf(policy)).toBeLessThan(early.indexOf('<script src="/x.js">'))
    // A header element of the body is not the head.
    const header = withReporter('<!doctype html><html><body><header>x</header><script src="/x.js"></script></body></html>', 't')
    expect(header.indexOf(policy)).toBeLessThan(header.indexOf('<body>'))
    // An empty comment that the parser closes at once.
    const comment = withReporter('<!--><script src="/x.js"></script>--><html><head></head></html>', 't')
    expect(comment.startsWith(policy)).toBe(true)
    // A quoted ">" in the html tag does not take the policy into the value.
    const quoted = withReporter('<!doctype html><html lang="a>b"><head></head></html>', 't')
    expect(quoted.indexOf(policy)).toBeGreaterThan(quoted.indexOf('lang="a>b">'))
    expect(quoted.slice(0, quoted.indexOf(policy))).toBe('<!doctype html><html lang="a>b"><head>')
    // The same rule without the reporter.
    expect(withPolicyOnly('<html><script src="/x.js"></script><head></head></html>').startsWith(`<html>${policy}`)).toBe(true)
  })

  it('a token cannot break out of the script and only its own view is heard', () => {
    expect(withReporter('<p/>', 'a"</script><x>')).not.toContain('a"</script><x>')
    expect(readPreviewMessage({ type: PREVIEW_MESSAGE, token: 'tok1', message: 'boom' }, 'tok1')).toBe('boom')
    expect(readPreviewMessage({ type: PREVIEW_MESSAGE, token: 'other', message: 'boom' }, 'tok1')).toBeNull()
    expect(readPreviewMessage({ type: 'something', token: 'tok1' }, 'tok1')).toBeNull()
    expect(readPreviewMessage('text', 'tok1')).toBeNull()
  })

  it('wide is scaled down to the screen and never up', () => {
    expect(wideScale(WIDE_WIDTH / 2)).toBe(0.5)
    expect(wideScale(WIDE_WIDTH * 2)).toBe(1)
    expect(wideScale(0)).toBe(1)
  })
})

describe('C13 group chat', () => {
  it('holds at most four models and none twice', () => {
    expect(addBlock(['a', 'b', 'c', 'd'])).toBe('full')
    expect(addBlock(['a'], 'a')).toBe('already')
    expect(addBlock(['a'], 'b')).toBeNull()
  })
  it('starts with the model of the chat and runs from two up', () => {
    expect(seedGroup('chat-model', 'active')).toEqual(['chat-model'])
    expect(seedGroup('', 'active')).toEqual(['active'])
    expect(seedGroup(undefined, null)).toEqual([])
    expect(groupRuns(['a'])).toBe(false)
    expect(groupRuns(['a', 'b'])).toBe(true)
  })
})

describe('E6 personas', () => {
  const p = (over: Partial<Persona>): Persona => ({ id: 'a', name: 'A', icon: 'User', systemPrompt: 'x', isBuiltIn: false, ...over })

  it('needs a name nobody else has and instructions', () => {
    const all = [p({ id: 'a', name: 'Editor' })]
    expect(personaProblem({ id: null, name: ' ', instructions: 'x' }, all)).toBe('name-empty')
    expect(personaProblem({ id: null, name: 'editor', instructions: 'x' }, all)).toBe('name-taken')
    expect(personaProblem({ id: 'a', name: 'Editor', instructions: 'x' }, all)).toBeNull()
    expect(personaProblem({ id: null, name: 'New', instructions: ' ' }, all)).toBe('instructions-empty')
  })

  it('finds the built in personas that were changed or are missing', () => {
    const first = [p({ id: 'one', isBuiltIn: true, name: 'One' }), p({ id: 'two', isBuiltIn: true, name: 'Two' }), p({ id: 'three', isBuiltIn: true, name: 'Three' })]
    const now = [p({ id: 'one', isBuiltIn: true, name: 'One' }), p({ id: 'two', isBuiltIn: true, name: 'Changed' }), p({ id: 'mine', name: 'Mine' })]
    expect(changedBuiltIns(now, first).map((x) => x.id)).toEqual(['two', 'three'])
    expect(changedBuiltIns(first, first)).toEqual([])
  })

  it('gives a new persona an id that does not exist yet', () => {
    expect(newPersonaId('My Editor!', [], () => 'r')).toBe('custom-my-editor')
    expect(newPersonaId('My Editor', [p({ id: 'custom-my-editor' })], () => 'r1')).toBe('custom-my-editor-r1')
    expect(newPersonaId('???', [], () => 'r')).toBe('custom-persona')
  })
})

describe('E7 memory', () => {
  const now = 1_000_000_000_000
  const m = (over: Partial<MemoryFile>): MemoryFile => ({ id: 'm', type: 'user', title: 'Title', description: '', content: 'Content', tags: [], createdAt: now, updatedAt: now, source: 'manual', ...over })

  it('hides outdated memories unless they are being reviewed', () => {
    const entries = [m({ id: 'fresh' }), m({ id: 'stale', stale: true }), m({ id: 'replaced', supersededBy: 'fresh' }), m({ id: 'old', updatedAt: now - REVIEW_AFTER_MS - 1, createdAt: 1 })]
    expect(isOutdated(entries[1])).toBe(true)
    expect(needsReview(entries[3], now)).toBe(true)
    expect(needsReview(m({ id: 'seen', updatedAt: 1, createdAt: 1, confirmedAt: now - 5 }), now)).toBe(false)
    expect(filterMemories(entries, { query: '', type: 'all', review: false }, now).map((e) => e.id).sort()).toEqual(['fresh', 'old'])
    expect(filterMemories(entries, { query: '', type: 'all', review: true }, now).map((e) => e.id).sort()).toEqual(['old', 'replaced', 'stale'])
    expect(reviewCount(entries, now)).toBe(3)
  })

  it('searches title, text and tags, and filters by category', () => {
    const entries = [m({ id: 'a', title: 'Coffee', content: 'black' }), m({ id: 'b', title: 'City', content: 'Lisbon', type: 'reference', tags: ['Travel'] })]
    expect(filterMemories(entries, { query: 'LISBON', type: 'all', review: false }, now).map((e) => e.id)).toEqual(['b'])
    expect(filterMemories(entries, { query: 'travel', type: 'all', review: false }, now).map((e) => e.id)).toEqual(['b'])
    expect(filterMemories(entries, { query: '', type: 'reference', review: false }, now).map((e) => e.id)).toEqual(['b'])
    expect(filterMemories(entries, { query: 'coffee', type: 'reference', review: false }, now)).toEqual([])
  })

  it('checks and shapes what the editor saves', () => {
    expect(memoryProblem({ title: ' ', text: 'x' })).toBe('title-empty')
    expect(memoryProblem({ title: 'x', text: ' ' })).toBe('text-empty')
    expect(memoryProblem({ title: 'x', text: 'y' })).toBeNull()
    const fields = memoryFields({ title: ` ${'t'.repeat(80)} `, text: ` ${'c'.repeat(200)} ` })
    expect(fields.title.length).toBe(60)
    expect(fields.content.length).toBe(200)
    expect(fields.description.length).toBe(120)
  })

  it('tells a JSON export from a Markdown one, by name first', () => {
    expect(looksLikeJson('a.json', '# x')).toBe(true)
    expect(looksLikeJson('a.md', '{"a":1}')).toBe(false)
    expect(looksLikeJson('export', '  [1]')).toBe(true)
    expect(looksLikeJson('export', '# Memories')).toBe(false)
  })

  it('"Keep at most" 0 means Auto', () => {
    expect(keepOverride(0)).toBeNull()
    expect(keepOverride(-3)).toBeNull()
    expect(keepOverride(7.4)).toBe(7)
    expect(keepOverride(999)).toBe(50)
    expect(sourceKind('manual')).toBe('manual')
    expect(sourceKind('auto:extraction')).toBe('auto')
  })

  it('says what a sync did and why one failed, without ever saying data is lost', () => {
    expect(syncDoneText({ uploaded: 2, downloaded: 1, omittedSensitive: 0, conflicts: [] })).toBe('Synced. 2 sent, 1 received.')
    expect(syncDoneText({ uploaded: 0, downloaded: 0, omittedSensitive: 1, conflicts: [{}] })).toContain('1 sensitive memory stayed on this phone.')
    expect(syncFailureText(new MemorySyncError('cancelled', 'x'))).toContain('cancelled')
    expect(syncFailureText(new MemorySyncError('conflict', 'x'))).toContain('Sync again')
    expect(syncFailureText(new Error('network down'))).toBe('Could not sync. Your memories are safe on this phone.')
  })
})

describe('E9 web search', () => {
  it('reads the answer of the search command into ok, empty or failed', () => {
    expect(readSearchAnswer({ provider: 'brave', results: [{ title: 'T', url: 'https://x.test', snippet: 's' }] })).toEqual({ kind: 'ok', count: 1, provider: 'brave', first: { title: 'T', url: 'https://x.test' }, fallbackReason: null, skipped: null })
    expect(readSearchAnswer({ provider: 'duckduckgo', providerError: 'bad key', results: [{ title: 'T', url: 'u' }] })).toMatchObject({ kind: 'ok', fallbackReason: 'bad key' })
    expect(readSearchAnswer({ results: [], error: 'No provider', providerError: 'bad key' })).toEqual({ kind: 'failed', reason: 'No provider bad key' })
    expect(readSearchAnswer({ results: [] })).toEqual({ kind: 'empty' })
    expect(readSearchAnswer(null)).toEqual({ kind: 'failed', reason: '' })
  })

  it('says which free search did not deliver when another one answered', () => {
    const answer = {
      provider: 'wikipedia',
      results: [{ title: 'Canberra', url: 'https://en.wikipedia.org/wiki/Canberra' }],
      tiers: [{ tier: 'DuckDuckGo', error: 'answered with a bot check instead of results (HTTP 202)' }],
    }
    expect(readSearchAnswer(answer)).toMatchObject({ kind: 'ok', provider: 'wikipedia', skipped: 'DuckDuckGo: answered with a bot check instead of results (HTTP 202).' })
    expect(skippedTiers({ tiers: [{ tier: 'DuckDuckGo' }, { error: 'x' }] })).toBeNull()
    expect(skippedTiers({})).toBeNull()
  })

  it('a build without key fields leaves the advice to add a key out and keeps the reasons', () => {
    // The wording of the search command (src-tauri/src/commands/search.rs, all_tiers_failed_text), on a phone.
    const said = 'All search tiers failed. DuckDuckGo: answered with a bot check instead of results (HTTP 202). Wikipedia: timed out. The free search is not dependable. Add a Brave or Tavily key under Settings, Web search for dependable search.'
    expect(withoutKeyAdvice(said)).toBe('All search tiers failed. DuckDuckGo: answered with a bot check instead of results (HTTP 202). Wikipedia: timed out.')
    expect(withoutKeyAdvice(said)).not.toMatch(/key|brave|tavily/i)
    expect(withoutKeyAdvice('No provider answered.')).toBe('No provider answered.')
    expect(withoutKeyAdvice('')).toBe('')
  })
})

describe('E10 workflows', () => {
  const steps = (): WorkflowStep[] => [createStep('user_input', 'a'), createStep('prompt', 'b'), createStep('condition', 'c'), createStep('loop', 'd')]

  it('offers six kinds of step and a new one of each says what is missing', () => {
    expect(STEP_KINDS).toHaveLength(6)
    for (const kind of STEP_KINDS) {
      const step = createStep(kind, 'x')
      expect(step.type).toBe(kind)
      expect(step.label.length).toBeGreaterThan(0)
      expect(stepProblem(step, [step]), kind).not.toBeNull()
      expect(stepSummary(step).length, kind).toBeGreaterThan(0)
    }
  })

  it('a filled step has no problem', () => {
    const all = steps()
    expect(stepProblem({ ...all[0], userInputPrompt: 'Which city?' }, all)).toBeNull()
    expect(stepProblem({ ...all[1], prompt: 'Summarize {{last_output}}' }, all)).toBeNull()
    expect(stepProblem({ ...all[2], condition: { ...all[2].condition!, value: 'rain', thenStepId: 'a' } }, all)).toBeNull()
    expect(stepProblem({ ...all[2], condition: { ...all[2].condition!, operator: 'truthy' } }, all)).toBeNull()
    expect(stepProblem({ ...all[3], loop: { ...all[3].loop!, bodyStepIds: ['b'], condition: { ...all[3].loop!.condition, value: 'done' } } }, all)).toBeNull()
    expect(stepProblem({ ...createStep('tool', 't'), toolName: 'web_search', toolArgTemplates: { query: 'x' } }, all)).toBeNull()
    expect(stepProblem({ ...createStep('memory_save', 'm'), memorySave: { type: 'reference', titleTemplate: 'T', contentTemplate: '{{last_output}}' } }, all)).toBeNull()
    expect(operatorNeedsValue('falsy')).toBe(false)
    expect(operatorNeedsValue('equals')).toBe(true)
  })

  it('a branch that points at a removed step and a loop without a body are named', () => {
    const all = steps()
    expect(stepProblem({ ...all[2], condition: { ...all[2].condition!, value: 'x', thenStepId: 'gone' } }, all)).toContain('gone')
    expect(stepProblem({ ...all[3], loop: { ...all[3].loop!, bodyStepIds: ['d'] } }, all)).toContain('at least one step')
    expect(stepProblem({ ...createStep('tool', 't'), toolName: 'web_search' }, all)).toContain('Search for')
  })

  it('a workflow needs a name, a step, and steps that can run', () => {
    expect(workflowProblem({ name: ' ', description: '', steps: [] })).toEqual({ kind: 'name' })
    expect(workflowProblem({ name: 'x', description: '', steps: [] })).toEqual({ kind: 'steps' })
    const bad = workflowProblem({ name: 'x', description: '', steps: [{ ...createStep('prompt', 'a'), prompt: 'ok' }, createStep('prompt', 'b')] })
    expect(bad).toMatchObject({ kind: 'step', index: 1 })
    expect(workflowProblem({ name: 'x', description: '', steps: [{ ...createStep('prompt', 'a'), prompt: 'ok' }] })).toBeNull()
  })

  it('moves a step up and down and stops at the ends', () => {
    const all = steps()
    expect(moveStep(all, 'b', -1).map((s) => s.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(moveStep(all, 'b', 1).map((s) => s.id)).toEqual(['a', 'c', 'b', 'd'])
    expect(moveStep(all, 'a', -1).map((s) => s.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(moveStep(all, 'd', 1).map((s) => s.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(moveStep(all, 'nope', 1).map((s) => s.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('removing a step also removes every pointer to it', () => {
    const all = steps()
    all[2] = { ...all[2], condition: { ...all[2].condition!, thenStepId: 'b', elseStepId: 'a' } }
    all[3] = { ...all[3], loop: { ...all[3].loop!, bodyStepIds: ['a', 'b'] } }
    const next = removeStep(all, 'b')
    expect(next.map((s) => s.id)).toEqual(['a', 'c', 'd'])
    expect(next[1].condition).toMatchObject({ thenStepId: '', elseStepId: 'a' })
    expect(next[2].loop?.bodyStepIds).toEqual(['a'])
  })

  it('starts a workflow with the same words a user would type', () => {
    expect(workflowCommand('Research Topic', ' cats ')).toBe('run workflow Research Topic: cats')
    expect(workflowCommand('Daily')).toBe('run workflow Daily')
    expect(firstQuestion({ steps: [{ ...createStep('user_input', 'a'), userInputPrompt: 'Which city?' }] })).toBe('Which city?')
    expect(firstQuestion({ steps: [createStep('prompt', 'a')] })).toBeNull()
    expect(firstQuestion({ steps: [] })).toBeNull()
  })

  it('the draft knows when it differs from what it started from, and nothing is written before Save', () => {
    const drafts = useWorkflowDraft.getState()
    drafts.discardAll()
    drafts.open('new', null)
    expect(isDraftDirty(useWorkflowDraft.getState().drafts.new)).toBe(false)
    drafts.patch('new', { name: 'Briefing' })
    const stepId = drafts.addStep('new', 'prompt')
    expect(stepId).toBeTruthy()
    drafts.updateStep('new', stepId!, { prompt: 'Hello' })
    const draft = useWorkflowDraft.getState().drafts.new
    expect(isDraftDirty(draft)).toBe(true)
    expect(draft.steps[0]).toMatchObject({ type: 'prompt', prompt: 'Hello' })
    // A second open for the same key keeps the draft: the step page and the builder share it.
    drafts.open('new', null)
    expect(useWorkflowDraft.getState().drafts.new.name).toBe('Briefing')
    drafts.remove('new', stepId!)
    drafts.patch('new', { name: '' })
    expect(isDraftDirty(useWorkflowDraft.getState().drafts.new)).toBe(false)
    expect(drafts.addStep('unknown', 'prompt')).toBeNull()
    drafts.discard('new')
    expect(useWorkflowDraft.getState().drafts.new).toBeUndefined()
  })
})

describe('why a document was not added (B1)', () => {
  it('a memory reason keeps its own sentence and is never "Could not read this file"', () => {
    const reason = failureReason(new SingleSlotConflictError(EMBEDDER_NO_ROOM_ALONE_MESSAGE))
    expect(reason).toBe(EMBEDDER_NO_ROOM_ALONE_MESSAGE)
    expect(reason).toMatch(/memory/)
  })
  it('size, a missing document model and an empty file keep their sentences too', () => {
    const tooLarge = Object.assign(new Error('"a.pdf" is too large for this device (30 MB, the limit is 20 MB).'), { code: 'document_too_large' })
    expect(failureReason(tooLarge)).toMatch(/too large/)
    expect(failureReason(new Error(NO_EMBED_MODEL_MOBILE_MESSAGE))).toBe(NO_EMBED_MODEL_MOBILE_MESSAGE)
    expect(failureReason(new Error('No text could be extracted from this file. The document may be empty or contain only images.'))).toMatch(/No text/)
  })
  it('a transport error or anything unknown falls back to the short sentence of the row', () => {
    expect(failureReason(new Error('proxy_localhost: error sending request'))).toBeUndefined()
    expect(failureReason('nope')).toBeUndefined()
    expect(failureReason(null)).toBeUndefined()
  })
  it('every step of the swap has a sentence that says the chat model comes back', () => {
    expect(slotTurnText('idle')).toBeNull()
    for (const turn of ['unloading-chat', 'reading', 'reloading-chat'] as const) {
      const text = slotTurnText(turn) ?? ''
      expect(text).toMatch(/chat model/)
      expect(text).not.toMatch(/[\u2013\u2014]/)
    }
    expect(slotTurnText('reading')).toBe('Reading document, the chat model reloads afterwards.')
  })
})

describe('C9 compare, speed of a very short answer', () => {
  it('shows no rate for an answer of a few tokens', () => {
    expect(rateIsMeaningful(2)).toBe(false)
    expect(rateIsMeaningful(8)).toBe(true)
    expect(rateIsMeaningful(Number.NaN)).toBe(false)
  })
})
