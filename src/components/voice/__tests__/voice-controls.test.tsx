/**
 * @vitest-environment jsdom
 *
 * The row of switches at the top of the Voice surface and the light switch
 * that unloads Voice: what each one shows, what a click does, and that the
 * widest level is never reached without a clear yes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'

const backend = vi.hoisted(() => ({ backendCall: vi.fn(async () => true), tauri: true }))
vi.mock('../../../api/backend', async (original) => ({
  ...(await original<typeof import('../../../api/backend')>()),
  backendCall: backend.backendCall,
  isTauri: () => backend.tauri,
}))
const loop = vi.hoisted(() => ({ status: { running: true, memoryBytes: 912_261_120 as number | null } }))
vi.mock('../../../api/voice-loop', async (original) => ({
  ...(await original<typeof import('../../../api/voice-loop')>()),
  getVoiceLoopStatus: vi.fn(async () => loop.status),
}))
const session = vi.hoisted(() => ({
  unloadVoiceEngine: vi.fn(async () => ({ freedBytes: 912_261_120, modelUnloaded: false, gone: true })),
  voiceLoadedChatModel: vi.fn(() => false),
}))
vi.mock('../../../api/voice-session', () => session)

import { SANDBOX_REASON, VoiceControls } from '../VoiceControls'
import { VoiceUnloadSwitch, unloadTitle, unloadedWords } from '../VoiceUnloadSwitch'
import { thoughtLabel } from '../VoiceThought'
import { useVoiceStore } from '../../../stores/voiceStore'
import { useModelStore } from '../../../stores/modelStore'
import { useComputerStore } from '../../../stores/computerStore'
import { VOICE_WORK_DEFAULTS } from '../../../lib/voice/work-scope'

function model(patch: Record<string, unknown> = {}) {
  useModelStore.setState({
    activeModel: 'lu-cloud::test-model',
    models: [{ name: 'lu-cloud::test-model', supportsTools: true, thinkMode: 'toggle', ...patch }],
  } as never)
}

beforeEach(() => {
  useVoiceStore.setState({ ...VOICE_WORK_DEFAULTS })
  useComputerStore.setState({ enabled: false })
  backend.backendCall.mockClear()
  backend.tauri = true
  loop.status = { running: true, memoryBytes: 912_261_120 }
  session.unloadVoiceEngine.mockClear()
  session.voiceLoadedChatModel.mockReturnValue(false)
  model()
})
afterEach(() => cleanup())

const show = () => render(createElement(VoiceControls, { onOpenSettings: vi.fn() }))

describe('the row of switches', () => {
  it('is one toolbar of four buttons of the same recipe, settings first', () => {
    const view = show()
    const buttons = [...view.getByRole('toolbar', { name: 'Voice controls' }).querySelectorAll(':scope > button, :scope > div > button')]
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Voice settings', 'Agent', 'Where it may work: Workspace only', 'Thinking',
    ])
    for (const button of buttons) {
      expect(button.className).toBe('lu-control lu-control--icon')
      expect(button.getAttribute('title')).toBeTruthy()
    }
  })

  it('opens the settings from the gear', () => {
    const onOpenSettings = vi.fn()
    const view = render(createElement(VoiceControls, { onOpenSettings }))
    fireEvent.click(view.getByRole('button', { name: 'Voice settings' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })
})

describe('Agent', () => {
  it('switches the tools off and on with one click and shows which it is', () => {
    const view = show()
    const agent = view.getByRole('button', { name: 'Agent' })
    expect(agent.getAttribute('aria-pressed')).toBe('true')
    expect(agent.getAttribute('title')).toContain('Agent ON')
    fireEvent.click(agent)
    expect(useVoiceStore.getState().loopAgent).toBe(false)
    expect(agent.getAttribute('aria-pressed')).toBe('false')
    expect(agent.getAttribute('title')).toContain('Conversation with web search')
    // Without the agent there is nothing to place.
    expect((view.getByTestId('voice-scope') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(agent)
    expect(useVoiceStore.getState().loopAgent).toBe(true)
  })

  it('is off and says why for a model that cannot use tools', () => {
    model({ supportsTools: false })
    const view = show()
    const agent = view.getByRole('button', { name: 'Agent' }) as HTMLButtonElement
    expect(agent.disabled).toBe(true)
    expect(agent.getAttribute('aria-pressed')).toBe('false')
    expect(agent.getAttribute('title')).toContain('cannot use tools')
  })
})

describe('Where it may work', () => {
  const open = (view: ReturnType<typeof show>) => {
    fireEvent.click(view.getByTestId('voice-scope'))
    return view.getByRole('menu', { name: 'Where it may work' })
  }

  it('starts at the narrowest level and offers three, the middle one locked with its reason', () => {
    const view = show()
    const menu = open(view)
    const items = [...menu.querySelectorAll('[role="menuitemradio"]')]
    expect(items.map((item) => item.textContent?.split(/(?<=[a-z])(?=[A-Z])/)[0])).toEqual(['Workspace only', 'Sandbox', 'Whole computer'])
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    const sandbox = view.getByTestId('voice-scope-sandbox')
    expect(sandbox.getAttribute('aria-disabled')).toBe('true')
    expect(sandbox.textContent).toContain(SANDBOX_REASON)
    fireEvent.click(sandbox)
    expect(useVoiceStore.getState().loopScope).toBe('workspace')
  })

  it('asks once, clearly, before the whole computer, and Cancel changes nothing', () => {
    const view = show()
    fireEvent.click(open(view).querySelectorAll('button[role="menuitemradio"]')[1])
    expect(useVoiceStore.getState().loopScope).toBe('workspace')
    const dialog = view.getByRole('dialog', { name: 'Whole computer' })
    expect(dialog.textContent).toContain('never types into a password field')
    expect(dialog.textContent).toContain('Stop ends everything at once')
    fireEvent.click(view.getByRole('button', { name: 'Keep workspace only' }))
    expect(useVoiceStore.getState()).toMatchObject({ loopScope: 'workspace', loopComputerConfirmed: false })
    expect(useComputerStore.getState().enabled).toBe(false)
  })

  it('a yes sets the level, remembers the yes and switches computer control on for the screen', async () => {
    const view = show()
    fireEvent.click(open(view).querySelectorAll('button[role="menuitemradio"]')[1])
    fireEvent.click(view.getByRole('button', { name: 'Allow the whole computer' }))
    expect(useVoiceStore.getState()).toMatchObject({ loopScope: 'computer', loopComputerConfirmed: true })
    expect(useComputerStore.getState().enabled).toBe(true)
    expect(view.getByTestId('voice-scope').getAttribute('aria-label')).toBe('Where it may work: Whole computer')
    // The dialog leaves with its closing animation.
    await waitFor(() => expect(view.queryByRole('dialog', { name: 'Whole computer' })).toBeNull())
    // Back to the folder: no run stays out of the file jail.
    fireEvent.click(open(view).querySelectorAll('button[role="menuitemradio"]')[0])
    expect(useVoiceStore.getState().loopScope).toBe('workspace')
    expect(backend.backendCall).toHaveBeenCalledWith('fs_whole_computer_forget')
    // The second time the in-app question is not asked again.
    fireEvent.click(open(view).querySelectorAll('button[role="menuitemradio"]')[1])
    expect(view.queryByRole('dialog', { name: 'Whole computer' })).toBeNull()
    expect(useVoiceStore.getState().loopScope).toBe('computer')
  })

  it('closes on Escape and moves with the arrow keys past the locked choice', () => {
    const view = show()
    const menu = open(view)
    const [workspace, computer] = [...menu.querySelectorAll<HTMLElement>('button[role="menuitemradio"]')]
    expect(document.activeElement).toBe(workspace)
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(computer)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('menu')).toBeNull()
    expect(view.getByTestId('voice-scope').getAttribute('aria-expanded')).toBe('false')
  })
})

describe('Thinking', () => {
  it('switches with one click for a model that can be switched', () => {
    const view = show()
    const thinking = view.getByRole('button', { name: 'Thinking' })
    expect(thinking.getAttribute('aria-pressed')).toBe('false')
    expect(thinking.getAttribute('title')).toBe('Thinking OFF')
    fireEvent.click(thinking)
    expect(useVoiceStore.getState().loopThinking).toBe(true)
    expect(thinking.getAttribute('aria-pressed')).toBe('true')
    expect(thinking.getAttribute('title')).toContain('never read aloud')
  })

  it('is locked on, with the reason, for a model that always thinks', () => {
    model({ thinkMode: 'always' })
    const view = show()
    const thinking = view.getByRole('button', { name: 'Thinking' }) as HTMLButtonElement
    expect(thinking.disabled).toBe(true)
    expect(thinking.getAttribute('aria-pressed')).toBe('true')
    expect(thinking.getAttribute('title')).toContain('always on for this model')
    fireEvent.click(thinking)
    expect(useVoiceStore.getState().loopThinking).toBe(false)
  })

  it('is locked off for a model that cannot think', () => {
    model({ thinkMode: 'never' })
    const view = show()
    const thinking = view.getByRole('button', { name: 'Thinking' }) as HTMLButtonElement
    expect(thinking.disabled).toBe(true)
    expect(thinking.getAttribute('aria-pressed')).toBe('false')
    expect(thinking.getAttribute('title')).toBe('Model does not support thinking')
  })
})

describe('the header of a finished thought', () => {
  it('says how long it took, and when it was ended early', () => {
    expect(thoughtLabel({ secs: 3.6 })).toBe('Thought for 4 s')
    expect(thoughtLabel({ secs: 0.2 })).toBe('Thought for 1 s')
    expect(thoughtLabel({})).toBe('Thought')
    expect(thoughtLabel({ secs: 9, cut: true })).toBe('Thought for 9 s, ended at the length set in the Voice settings')
  })
})

describe('the light switch that unloads Voice', () => {
  it('is not there while nothing is loaded', async () => {
    loop.status = { running: false, memoryBytes: null }
    const view = render(createElement(VoiceUnloadSwitch))
    await act(async () => { await Promise.resolve() })
    expect(view.queryByTestId('voice-unload')).toBeNull()
  })

  it('shows what is loaded and says what one click gives back', async () => {
    const view = render(createElement(VoiceUnloadSwitch))
    const button = await waitFor(() => view.getByTestId('voice-unload'))
    expect(button.getAttribute('role')).toBe('switch')
    expect(button.getAttribute('aria-checked')).toBe('true')
    expect(button.textContent).toBe('870.0 MB')
    expect(button.getAttribute('title')).toBe(
      'Unload Voice and free about 870.0 MB. One click ends the session, stops the voice engine and gives back everything Voice holds.')
  })

  it('one click unloads, the switch goes away and a line confirms what was freed', async () => {
    session.unloadVoiceEngine.mockImplementationOnce(async () => {
      loop.status = { running: false, memoryBytes: null }
      return { freedBytes: 912_261_120, modelUnloaded: true, gone: true }
    })
    const view = render(createElement(VoiceUnloadSwitch))
    fireEvent.click(await waitFor(() => view.getByTestId('voice-unload')))
    await waitFor(() => expect(view.getByTestId('voice-unloaded').textContent).toBe('Voice is unloaded. 870.0 MB freed. The chat model is unloaded too.'))
    expect(session.unloadVoiceEngine).toHaveBeenCalledTimes(1)
    expect(view.queryByTestId('voice-unload')).toBeNull()
  })

  it('names the chat model in the tooltip when Voice loaded it, and says so when unloading failed', () => {
    expect(unloadTitle(2_147_483_648, true)).toBe(
      'Unload Voice and free about 2.0 GB. One click ends the session, stops the voice engine and gives back everything Voice holds, the chat model it loaded included.')
    expect(unloadTitle(null, false)).toContain('free its memory')
    expect(unloadedWords({ freedBytes: null, modelUnloaded: false, gone: true })).toBe('Voice is unloaded. Its memory is free again.')
    expect(unloadedWords({ freedBytes: 1, modelUnloaded: false, gone: false })).toBe('Voice could not be unloaded. Try again.')
  })
})
