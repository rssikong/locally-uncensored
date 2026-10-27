// @vitest-environment jsdom
/**
 * Discord 22.10.2026: the tokens of a request stand under its answer, in the
 * answer's own action bar, and only when the backend reported them.
 *
 * Run: npx vitest run src/components/chat/__tests__/tokens-under-the-answer.test.tsx
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MessageBubble } from '../MessageBubble'
import { RequestUsageLine } from '../RequestUsageLine'
import type { Message } from '../../../types/chat'

afterEach(cleanup)

const answer = (over: Partial<Message> = {}): Message => ({
  id: 'a1', role: 'assistant', content: 'Paris is the capital of France.', timestamp: 1, modelId: 'ollama::qwen2.5:0.5b', ...over,
})

describe('the line under an answer', () => {
  it('shows in / out with the explanation in its title', () => {
    render(<MessageBubble message={answer({ requestUsage: { inputTokens: 1234, outputTokens: 56, calls: 1 } })} />)
    const line = screen.getByTestId('request-usage')
    expect(line.textContent).toBe('1,234 in · 56 out')
    expect(line.getAttribute('title')).toContain('as reported by the model')
  })

  it('an answer without numbers has no line', () => {
    render(<MessageBubble message={answer()} />)
    expect(screen.queryByTestId('request-usage')).toBeNull()
  })

  it('the old context anchor alone draws nothing, it is not the request sum', () => {
    render(<MessageBubble message={answer({ usage: { promptTokens: 900, completionTokens: 20, totalTokens: 920 } })} />)
    expect(screen.queryByTestId('request-usage')).toBeNull()
  })

  it('a user message never carries one', () => {
    render(<MessageBubble message={{ id: 'u1', role: 'user', content: 'hi', timestamp: 1, requestUsage: { inputTokens: 1, outputTokens: 1, calls: 1 } }} />)
    expect(screen.queryByTestId('request-usage')).toBeNull()
  })

  it('a Flash answer says No credits, a credit answer says Credits', () => {
    const { rerender } = render(<RequestUsageLine usage={{ inputTokens: 80, outputTokens: 8, calls: 1, billing: 'flash' }} />)
    expect(screen.getByTestId('request-usage').textContent).toBe('80 in · 8 out · No credits')
    rerender(<RequestUsageLine usage={{ inputTokens: 80, outputTokens: 8, calls: 2, billing: 'credits' }} />)
    expect(screen.getByTestId('request-usage').textContent).toBe('80 in · 8 out · Credits')
    expect(screen.getByTestId('request-usage').getAttribute('title')).toContain('Summed over 2 model calls.')
  })
})
