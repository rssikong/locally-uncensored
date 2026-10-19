// @vitest-environment jsdom
/**
 * Discord, 15.10.2026: a reporter had a Wan 2.2 Animate workflow running in
 * ComfyUI and did not know LU can run his own workflows. The only way in was a
 * bare icon. On Video, Animate and Motion Control the button now says what it
 * is for and opens the Workflows window.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/the-own-workflow-button-names-itself.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

vi.mock('../CreateContext', () => ({
  useCreateExp: () => ({
    generate: vi.fn(), cancel: vi.fn(), makeVoice: vi.fn(), quota: null,
    samplerList: [], schedulerList: [], loraList: [], vaeList: [], refreshModelLists: vi.fn(),
    connected: true, modelsLoaded: true, modelLoadError: null, mlxMissing: null,
    installCapability: vi.fn(), installModelBundle: vi.fn(),
  }),
}))
vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => false }))
vi.mock('../../../../api/backend', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  openExternal: vi.fn(),
}))

import { Composer } from '../Composer'
import { useCreateStore, type CreateIntent } from '../../../../stores/createStore'

const LABEL = 'Use your own ComfyUI workflow'

beforeEach(() => {
  useCreateStore.setState({ backend: 'local', isGenerating: false, error: null, gallery: [], source: null } as never)
})
afterEach(cleanup)

function open(intent: CreateIntent) {
  useCreateStore.getState().setIntent(intent)
  const onOpenWorkflows = vi.fn()
  render(<Composer onOpenAdvanced={() => {}} onOpenWorkflows={onOpenWorkflows} />)
  return onOpenWorkflows
}

describe('the workflow button', () => {
  it.each(['motion', 'video', 'animate'] as CreateIntent[])('on %s it names itself and opens the Workflows window', (intent) => {
    const onOpen = open(intent)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(LABEL) }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('on Image it stays the quiet icon', () => {
    open('image')
    expect(screen.queryByText(LABEL)).toBeNull()
    expect(screen.getByTitle('Workflows and tags')).toBeTruthy()
  })

  it('on the cloud there is no such button', () => {
    useCreateStore.setState({ backend: 'cloud' } as never)
    open('motion')
    expect(screen.queryByText(LABEL)).toBeNull()
  })
})
