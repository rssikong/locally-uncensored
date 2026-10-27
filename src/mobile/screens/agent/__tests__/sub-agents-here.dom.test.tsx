// @vitest-environment jsdom
/**
 * Sub agents with a model of the phone are not offered (decision of
 * 09.10.2026, lib/phone-sub-agents.ts). The pages show that as a locked row
 * with its reason, never as a switch that does nothing.
 *
 * Run: npx vitest run src/mobile/screens/agent/__tests__/sub-agents-here.dom.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { SUB_AGENTS_NEED_CLOUD } from '../../../../lib/phone-sub-agents'
import { useModelStore } from '../../../../stores/modelStore'
import { standOn } from '../../../../test-support/devices'
import { AGENT_STRINGS as T } from '../../../strings/agent'
import { groupById } from '../parts/permission-groups'
import { PermissionRow } from '../parts/PermissionRows'
import { useSubAgentsOffered } from '../parts/sub-agents-here'

const choose = (name: string | null) => useModelStore.setState({ activeModel: name })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  choose(null)
})

describe('what the pages ask', () => {
  it('phone and a model of its engine: no', () => {
    standOn('android')
    choose('openai::Qwen3.5-2B-Q4_K_M')
    expect(renderHook(() => useSubAgentsOffered()).result.current).toBe(false)
  })

  it('phone and LU Cloud: yes, and it follows the model', () => {
    standOn('iphone')
    choose('lu-cloud::glm-5.3')
    const hook = renderHook(() => useSubAgentsOffered())
    expect(hook.result.current).toBe(true)
    choose('openai::Qwen3.5-2B-Q4_K_M')
    hook.rerender()
    expect(hook.result.current).toBe(false)
  })

  it('desktop: yes with a local model', () => {
    standOn('mac')
    choose('openai::Qwen3.5-2B-Q4_K_M')
    expect(renderHook(() => useSubAgentsOffered()).result.current).toBe(true)
  })
})

describe('the locked row', () => {
  const group = groupById('subagents')

  it('says why, and none of its three levels takes a tap', () => {
    const onChange = vi.fn()
    render(<PermissionRow group={group} level="confirm" onChange={onChange} lockedReason={SUB_AGENTS_NEED_CLOUD} idPrefix="m-agent-perm" el="E8.1" />)
    const row = screen.getByTestId('m-agent-perm-subagents-row')
    expect(row.textContent).toContain(SUB_AGENTS_NEED_CLOUD)
    expect(row.textContent).not.toContain(T.permissions.hints.subagents)
    expect(row.hasAttribute('data-locked')).toBe(true)
    for (const level of ['blocked', 'confirm', 'auto']) {
      const option = screen.getByTestId(`m-agent-perm-subagents-${level}`) as HTMLButtonElement
      expect(option.disabled).toBe(true)
      fireEvent.click(option)
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it('without a reason it is the row it was', () => {
    const onChange = vi.fn()
    render(<PermissionRow group={group} level="confirm" onChange={onChange} idPrefix="m-agent-perm" el="E8.1" />)
    const row = screen.getByTestId('m-agent-perm-subagents-row')
    expect(row.textContent).toContain(T.permissions.hints.subagents)
    expect(row.hasAttribute('data-locked')).toBe(false)
    fireEvent.click(screen.getByTestId('m-agent-perm-subagents-auto'))
    expect(onChange).toHaveBeenCalledWith('auto')
  })
})

describe('the intro of Agent mode', () => {
  it('the list for a model of the phone does not promise a sub agent', () => {
    expect(T.options.intro.pointsOnDevice.join(' ')).not.toMatch(/sub agent/i)
    expect(T.options.intro.points.join(' ')).toMatch(/sub agent/i)
    expect(T.options.intro.pointsOnDevice).toHaveLength(T.options.intro.points.length)
  })
})
