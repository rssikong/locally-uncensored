import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, dropConversationSideState } from '../chatStore'
import {
  useBackgroundJobStore,
  detachToolCall,
  runMessageStarted,
  runMessageEnded,
  __resetBackgroundJobsForTests,
} from '../backgroundJobStore'
import { BACKGROUND_FINISHED_PREFIX } from '../../lib/background-tools'
import type { AgentToolCall } from '../../types/agent-mode'

const VIDEO = 'Video generated: lu_00001.mp4 (prompt: "x")\nhttp://127.0.0.1:8188/view?filename=lu_00001.mp4&subfolder=&type=output'

function seedConversationWithRunningCall(): { convId: string; messageId: string } {
  const convId = useChatStore.getState().createConversation('lu-cloud::m', '')
  const messageId = 'assistant-1'
  const call: AgentToolCall = {
    id: 'call-1', toolName: 'video_generate', args: { prompt: 'x' }, status: 'running', timestamp: 1,
    background: { jobId: 'bg-1', startedAt: 1, state: 'running' },
  }
  useChatStore.getState().addMessage(convId, { id: 'u1', role: 'user', content: 'video please', timestamp: 1 })
  useChatStore.getState().addMessage(convId, {
    id: messageId, role: 'assistant', content: 'It is rendering.', timestamp: 2,
    agentBlocks: [{ id: 'b1', phase: 'tool_call', content: 'Rendering in the background: video_generate', timestamp: 2, toolCall: call, toolCalls: [call] }],
  })
  return { convId, messageId }
}

function deferred() {
  let resolve!: (s: string) => void
  const promise = new Promise<string>((r) => { resolve = r })
  return { promise, resolve }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function theCall(convId: string): AgentToolCall {
  const m = useChatStore.getState().conversations.find((c) => c.id === convId)!.messages.find((x) => x.id === 'assistant-1')!
  return m.agentBlocks![0].toolCall!
}

beforeEach(() => {
  __resetBackgroundJobsForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
})

describe('backgroundJobStore', () => {
  it('a finished job writes its result onto the call and leaves a hidden note at the end', async () => {
    const { convId, messageId } = seedConversationWithRunningCall()
    const d = deferred()
    detachToolCall({ jobId: 'bg-1', toolCallId: 'call-1', toolName: 'video_generate', convId, messageId, startedAt: 1, work: d.promise, stop: () => {} })
    expect(useBackgroundJobStore.getState().runningFor(convId)).toHaveLength(1)
    // The user wrote on meanwhile.
    useChatStore.getState().addMessage(convId, { id: 'u2', role: 'user', content: 'and a joke', timestamp: 3 })
    d.resolve(VIDEO)
    await flush()
    const c = theCall(convId)
    expect(c.status).toBe('completed')
    expect(c.result).toBe(VIDEO)
    expect(c.background?.state).toBe('done')
    const msgs = useChatStore.getState().conversations.find((x) => x.id === convId)!.messages
    const last = msgs[msgs.length - 1]
    expect(last.hidden).toBe(true)
    expect(last.content.startsWith(BACKGROUND_FINISHED_PREFIX)).toBe(true)
    // After the user's newer message, not in front of it.
    expect(msgs[msgs.length - 2].id).toBe('u2')
    expect(useBackgroundJobStore.getState().runningFor(convId)).toHaveLength(0)
  })

  it('waits while the run that owns the message is still writing it', async () => {
    const { convId, messageId } = seedConversationWithRunningCall()
    runMessageStarted(messageId)
    const d = deferred()
    detachToolCall({ jobId: 'bg-1', toolCallId: 'call-1', toolName: 'video_generate', convId, messageId, startedAt: 1, work: d.promise, stop: () => {} })
    d.resolve(VIDEO)
    await flush()
    expect(theCall(convId).status).toBe('running')
    runMessageEnded(messageId)
    expect(theCall(convId).status).toBe('completed')
  })

  it("the block's Stop ends the job as stopped, not as failed", async () => {
    const { convId, messageId } = seedConversationWithRunningCall()
    const d = deferred()
    let stopped = 0
    detachToolCall({ jobId: 'bg-1', toolCallId: 'call-1', toolName: 'video_generate', convId, messageId, startedAt: 1, work: d.promise, stop: () => { stopped++; d.resolve('Video generation cancelled.') } })
    expect(useBackgroundJobStore.getState().cancel('bg-1')).toBe(true)
    await flush()
    expect(stopped).toBe(1)
    const c = theCall(convId)
    expect(c.background?.state).toBe('cancelled')
    expect(c.status).toBe('failed')
    expect(useBackgroundJobStore.getState().cancel('bg-1')).toBe(false)
  })

  it('a failed render is shown as failed and the model is told what it reported', async () => {
    const { convId, messageId } = seedConversationWithRunningCall()
    const d = deferred()
    detachToolCall({ jobId: 'bg-1', toolCallId: 'call-1', toolName: 'video_generate', convId, messageId, startedAt: 1, work: d.promise, stop: () => {} })
    d.resolve('Video generation failed: CUDA out of memory')
    await flush()
    expect(theCall(convId).background?.state).toBe('failed')
    const msgs = useChatStore.getState().conversations.find((x) => x.id === convId)!.messages
    expect(msgs[msgs.length - 1].content).toContain('CUDA out of memory')
  })

  it('deleting the chat stops its background render', () => {
    const { convId, messageId } = seedConversationWithRunningCall()
    const d = deferred()
    let stopped = 0
    detachToolCall({ jobId: 'bg-1', toolCallId: 'call-1', toolName: 'video_generate', convId, messageId, startedAt: 1, work: d.promise, stop: () => { stopped++ } })
    dropConversationSideState(convId)
    expect(stopped).toBe(1)
  })

  it('a job whose chat is gone ends quietly', async () => {
    const { convId, messageId } = seedConversationWithRunningCall()
    const d = deferred()
    detachToolCall({ jobId: 'bg-1', toolCallId: 'call-1', toolName: 'video_generate', convId, messageId, startedAt: 1, work: d.promise, stop: () => {} })
    useChatStore.setState({ conversations: [] })
    d.resolve(VIDEO)
    await flush()
    expect(useChatStore.getState().conversations).toHaveLength(0)
  })
})
