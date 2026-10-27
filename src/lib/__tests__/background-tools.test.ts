import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  runWithBackgroundGrace,
  patchToolCallInMessages,
  markStaleBackgroundCallOnBlock,
  startedResult,
  isStartedResult,
  jobIdOfStartedResult,
  finishedNote,
  mayRunInBackground,
  generationOwnerFor,
  INTERRUPTED_LINE,
  BACKGROUND_FINISHED_PREFIX,
} from '../background-tools'
import { mediaCallSucceeded } from '../media-result'
import { toolResultIsFailure } from '../tool-result-failure'
import type { AgentBlock, AgentToolCall } from '../../types/agent-mode'

afterEach(() => vi.useRealTimers())

const call = (over: Partial<AgentToolCall> = {}): AgentToolCall => ({
  id: 'c1', toolName: 'video_generate', args: {}, status: 'running', timestamp: 1, ...over,
})

describe('which calls may go on in the background', () => {
  it('picture and video, unless switched off; nothing else', () => {
    expect(mayRunInBackground('video_generate', {})).toBe(true)
    expect(mayRunInBackground('image_generate', { backgroundMediaTools: true })).toBe(true)
    expect(mayRunInBackground('video_generate', { backgroundMediaTools: false })).toBe(false)
    expect(mayRunInBackground('web_search', {})).toBe(false)
    expect(mayRunInBackground('shell_execute', {})).toBe(false)
  })

  it('a job is booked under its own owner, never under the bare conversation id', () => {
    expect(generationOwnerFor('call-1')).toBe('bg:call-1')
  })
})

describe('the started result', () => {
  it('carries the job id, reads as neither a failure nor a delivered picture', () => {
    const r = startedResult('video_generate', 'bg-abc123')
    expect(isStartedResult(r)).toBe(true)
    expect(jobIdOfStartedResult(r)).toBe('bg-abc123')
    // Neither failure check may read it as an error: the block would go red.
    expect(mediaCallSucceeded('video_generate', r)).toBe(true)
    expect(toolResultIsFailure(r)).toBe(false)
    expect(r).not.toMatch(/now displayed/i)
    expect(r).toMatch(/Do not call video_generate again/)
  })

  it('a finished note is not a started result', () => {
    const n = finishedNote('video_generate', 'bg-1', 'done', 'Video generated: x.mp4')
    expect(n.startsWith(BACKGROUND_FINISHED_PREFIX)).toBe(true)
    expect(isStartedResult(n)).toBe(false)
    expect(jobIdOfStartedResult('Video generated: x.mp4')).toBeNull()
  })

  it('every end has its own words for the model', () => {
    expect(finishedNote('video_generate', 'bg-1', 'done', 'Video generated: x.mp4')).toContain('x.mp4')
    expect(finishedNote('video_generate', 'bg-1', 'failed', 'Error: OOM')).toContain('Error: OOM')
    expect(finishedNote('video_generate', 'bg-1', 'cancelled', '')).toMatch(/stopped by the user/)
    expect(finishedNote('image_generate', 'bg-1', 'interrupted', '')).toMatch(/app was closed/)
  })
})

describe('runWithBackgroundGrace', () => {
  it('a call that is done inside the window is the call result, nothing is handed over', async () => {
    const onDetach = vi.fn(() => 'started')
    const out = await runWithBackgroundGrace({
      graceMs: 1000,
      start: async () => 'Image generated: a.png',
      cancelGeneration: () => {},
      onDetach,
    })
    expect(out).toBe('Image generated: a.png')
    expect(onDetach).not.toHaveBeenCalled()
  })

  it('a rejection inside the window rejects, as it always did', async () => {
    await expect(runWithBackgroundGrace({
      graceMs: 1000,
      start: async () => { throw new Error('Tool execution timed out: video_generate') },
      cancelGeneration: () => {},
      onDetach: () => 'started',
    })).rejects.toThrow('timed out')
  })

  it('still running after the window: handed over, the turn gets the started text at once', async () => {
    vi.useFakeTimers()
    let finish!: (s: string) => void
    const work = new Promise<string>((r) => { finish = r })
    let handed: Promise<string> | null = null
    const p = runWithBackgroundGrace({
      graceMs: 20_000,
      start: () => work,
      cancelGeneration: () => {},
      onDetach: (w) => { handed = w; return 'started' },
    })
    await vi.advanceTimersByTimeAsync(20_000)
    await expect(p).resolves.toBe('started')
    expect(handed).not.toBeNull()
    finish('Video generated: v.mp4')
    await expect(handed!).resolves.toBe('Video generated: v.mp4')
  })

  it("the turn's Stop reaches the call while the turn waits, and not after the hand-over", async () => {
    vi.useFakeTimers()
    const turn = new AbortController()
    const cancelGeneration = vi.fn()
    let jobSignal!: AbortSignal
    let stopJob!: () => void
    const p = runWithBackgroundGrace({
      graceMs: 20_000,
      turnSignal: turn.signal,
      start: (sig) => { jobSignal = sig; return new Promise<string>(() => {}) },
      cancelGeneration,
      onDetach: (_w, stop) => { stopJob = stop; return 'started' },
    })
    await vi.advanceTimersByTimeAsync(20_000)
    await p
    turn.abort()
    expect(cancelGeneration).not.toHaveBeenCalled()
    expect(jobSignal.aborted).toBe(false)
    // The job's own Stop does reach it.
    stopJob()
    expect(cancelGeneration).toHaveBeenCalledTimes(1)
    expect(jobSignal.aborted).toBe(true)
  })

  it('a Stop inside the window cancels the generation and is not handed over', async () => {
    vi.useFakeTimers()
    const turn = new AbortController()
    const cancelGeneration = vi.fn()
    const onDetach = vi.fn(() => 'started')
    let resolveWork!: (s: string) => void
    const p = runWithBackgroundGrace({
      graceMs: 20_000,
      turnSignal: turn.signal,
      start: (sig) => new Promise<string>((r) => { resolveWork = r; sig.addEventListener('abort', () => r('Video generation cancelled.')) }),
      cancelGeneration,
      onDetach,
    })
    await vi.advanceTimersByTimeAsync(5_000)
    turn.abort()
    await expect(p).resolves.toBe('Video generation cancelled.')
    expect(cancelGeneration).toHaveBeenCalledTimes(1)
    expect(onDetach).not.toHaveBeenCalled()
    void resolveWork
  })
})

describe('patchToolCallInMessages', () => {
  it('patches both shapes of the block in the message that holds the call, leaves the others alone', () => {
    const c = call()
    const holder = { id: 'm1', agentBlocks: [{ id: 'b1', phase: 'tool_call', content: 'x', timestamp: 1, toolCall: { ...c }, toolCalls: [{ ...c }] } as AgentBlock] }
    const other = { id: 'm2', agentBlocks: [] as AgentBlock[] }
    const out = patchToolCallInMessages([holder, other], 'c1', (x) => ({ ...x, status: 'completed', result: 'Video generated: v.mp4' }), 'Completed: video_generate')!
    expect(out[1]).toBe(other)
    const b = out[0].agentBlocks![0]
    expect(b.toolCall?.status).toBe('completed')
    expect(b.toolCalls?.[0].result).toBe('Video generated: v.mp4')
    expect(b.content).toBe('Completed: video_generate')
    // The input is not mutated.
    expect(holder.agentBlocks[0].toolCall?.status).toBe('running')
  })

  it('no message holds the call: null', () => {
    expect(patchToolCallInMessages([{ agentBlocks: [] }], 'nope', (x) => x)).toBeNull()
  })
})

describe('after a restart', () => {
  it('a block that was still rendering in the background says it was not finished', () => {
    const c = call({ background: { jobId: 'bg-1', startedAt: 1, state: 'running' } })
    const block = { id: 'b', phase: 'tool_call', content: 'Rendering in the background: video_generate', timestamp: 1, toolCall: { ...c }, toolCalls: [{ ...c }] } as AgentBlock
    expect(markStaleBackgroundCallOnBlock(block)).toBe(true)
    expect(block.toolCall?.status).toBe('failed')
    expect(block.toolCalls?.[0].background?.state).toBe('interrupted')
    expect(block.toolCall?.error).toBe(INTERRUPTED_LINE)
    expect(block.content).toBe('Failed: video_generate')
  })

  it('an ordinary running call or a finished job is left alone', () => {
    const plain = { id: 'b', phase: 'tool_call', content: 'x', timestamp: 1, toolCall: call() } as AgentBlock
    expect(markStaleBackgroundCallOnBlock(plain)).toBe(false)
    const done = { id: 'b', phase: 'tool_call', content: 'x', timestamp: 1, toolCall: call({ status: 'completed', background: { jobId: 'j', startedAt: 1, state: 'done' } }) } as AgentBlock
    expect(markStaleBackgroundCallOnBlock(done)).toBe(false)
  })
})
