// @vitest-environment jsdom
/**
 * macOS has to grant computer control two permissions. On 07.10.2026 the Mac
 * build answered a screen task with a sentence about permissions and gave the
 * user nothing to act on: no button, and nothing asked macOS for it.
 *
 * The dialog shows both permissions with their state, one button each that
 * asks macOS and opens the right list, notices by itself when they are
 * granted, and lets the waiting call go on.
 *
 * What the owner's Mac really held that day (privacy database, read on 08.10.):
 * LU stood in both lists, with entries of two builds from August. macOS ties
 * an entry to the code hash of a build without a fixed signature, so the
 * build of 07.10. was a stranger: Accessibility switched off, Screen
 * Recording switched on and worthless. A row that is missing therefore offers
 * "Reset and ask again", which makes macOS drop the old entry and ask for the
 * running build.
 *
 * Run: npx vitest run src/components/computer/__tests__/permission-dialog.test.tsx
 */
import { createElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'

const mac = vi.hoisted(() => ({
  granted: { needed: true, accessibility: false, screenRecording: false },
  requested: [] as string[],
  reset: [] as string[],
  resetAnswer: null as null | { ok: false; refusal: { code: string; message: string } },
}))
vi.mock('../../../api/computer', () => ({
  COMPUTER_STOPPED_EVENT: 'computer://stopped',
  COMPUTER_PAUSED_EVENT: 'computer://paused',
  requestComputerAttention: async () => ({ ok: true }),
  setComputerSurface: async () => ({ ok: true, mode: 'window', glow: false, glass: false }),
  watchComputer: async () => ({ ok: true, paused: false }),
  answerComputerTakeover: async () => ({ ok: true, paused: false, session: null }),
  getComputerPermissions: async () => ({ ok: true, permissions: { ...mac.granted } }),
  requestComputerPermission: async (permission: string) => {
    mac.requested.push(permission)
    return { ok: true, permissions: { ...mac.granted } }
  },
  resetComputerPermission: async (permission: string) => {
    mac.reset.push(permission)
    return mac.resetAnswer ?? { ok: true, permissions: { ...mac.granted } }
  },
}))
vi.mock('../../../api/computer-use', () => ({
  computerControlBusy: () => false,
  noteComputerStopped: vi.fn(),
  resumeComputerControl: vi.fn(),
  setComputerAutonomy: vi.fn(),
  dismissComputerStop: vi.fn(),
  stopComputerControl: vi.fn(),
  pauseComputerControl: vi.fn(),
  computerRunOrigin: () => ({ voice: false, conversationId: null }),
}))
vi.mock('../../../api/backend', () => ({ isTauri: () => false }))

import { ComputerControlHost } from '../ComputerControlHost'
import { PERMISSION_POLL_MS } from '../ComputerPermissions'
import { askPermission, refusePendingComputerPrompt } from '../../../lib/computer/prompts'
import { useComputerStore } from '../../../stores/computerStore'

/** Let the poll run and its answer land. */
async function tick(ms = PERMISSION_POLL_MS) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

beforeEach(() => {
  vi.useFakeTimers()
  mac.granted = { needed: true, accessibility: false, screenRecording: false }
  mac.requested = []
  mac.reset = []
  mac.resetAnswer = null
  refusePendingComputerPrompt()
  useComputerStore.setState({ session: null, stopped: null, prompt: null, notice: null, task: null, working: false, currentApp: null, autonomous: false, stopShortcut: null, surface: 'window', paused: false, questionSlots: [] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the permission question', () => {
  it('names both permissions, and each button asks macOS for exactly that one', async () => {
    const view = render(createElement(ComputerControlHost))
    let answer: boolean | null = null
    act(() => { void askPermission('accessibility').then((value) => { answer = value }) })
    await tick(10)
    const dialog = view.getByRole('group', { name: 'macOS has to allow this first' })
    const rows = within(dialog).getByTestId('computer-permissions')
    expect([...rows.querySelectorAll('li')].map((row) => `${row.getAttribute('data-permission')}:${row.getAttribute('data-granted')}`)).toEqual(['accessibility:false', 'screen_recording:false'])
    expect(dialog.textContent).toContain('LU notices by itself and carries on.')
    expect(dialog.textContent).not.toMatch(/[–—]/)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Open System Settings for Accessibility' }))
    expect(mac.requested).toEqual(['accessibility'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open System Settings for Screen Recording' }))
    expect(mac.requested).toEqual(['accessibility', 'screen_recording'])
    // Screen Recording says what macOS does with it.
    expect(rows.querySelector('[data-permission="screen_recording"]')?.textContent).toContain('after LU was quit and opened again')
    expect(answer).toBeNull()
  })

  it('goes on by itself once both are granted, without a click in LU', async () => {
    const view = render(createElement(ComputerControlHost))
    let answer: boolean | null = null
    act(() => { void askPermission('accessibility').then((value) => { answer = value }) })
    await tick(10)
    // The user switches Accessibility on in System Settings.
    mac.granted.accessibility = true
    await tick()
    const row = view.getByTestId('computer-permissions').querySelector('[data-permission="accessibility"]')!
    expect(row.getAttribute('data-granted')).toBe('true')
    expect(row.textContent).toContain('Granted.')
    expect(within(row as HTMLElement).queryByRole('button')).toBeNull()
    // One is not enough: a screen task needs both.
    expect(answer).toBeNull()
    mac.granted.screenRecording = true
    await tick()
    expect(answer).toBe(true)
    expect(useComputerStore.getState().prompt).toBeNull()
  })

  it('switched on in the list and still missing: the row resets the old entry and asks again', async () => {
    const view = render(createElement(ComputerControlHost))
    let answer: boolean | null = null
    act(() => { void askPermission('accessibility').then((value) => { answer = value }) })
    await tick(10)
    const dialog = view.getByRole('group', { name: 'macOS has to allow this first' })
    expect(dialog.textContent).toContain('Click Reset and ask again.')
    // The hint names the link, so it is there from the start: after a restart
    // of LU nothing was asked in this view, and the old entry is still in the
    // way (owner's Mac, 12.10.2026).
    expect(within(dialog).getByRole('button', { name: 'Reset and ask again for Accessibility' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open System Settings for Accessibility' }))
    // The user switched LU on, macOS still says no: the row stays open.
    await tick()
    // Screen Recording is missing too and offers its own reset; the click
    // below resets Accessibility alone.
    expect(within(dialog).getByRole('button', { name: 'Reset and ask again for Screen Recording' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset and ask again for Accessibility' }))
    await tick(10)
    expect(mac.reset).toEqual(['accessibility'])
    expect(mac.requested).toEqual(['accessibility'])
    expect(within(dialog).queryByRole('alert')).toBeNull()
    // The entry of the running build is granted: the waiting call goes on.
    mac.granted = { needed: true, accessibility: true, screenRecording: true }
    await tick()
    expect(answer).toBe(true)
  })

  it('a reset macOS turns down says what to do by hand, in the row it belongs to', async () => {
    mac.resetAnswer = { ok: false, refusal: { code: 'failed', message: 'macOS did not remove the old entry of LU. Remove LU from the list in System Settings with the minus button, then try again.' } }
    const view = render(createElement(ComputerControlHost))
    act(() => { void askPermission('screen_recording') })
    await tick(10)
    const dialog = view.getByRole('group', { name: 'macOS has to allow this first' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open System Settings for Screen Recording' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset and ask again for Screen Recording' }))
    await tick(10)
    const row = dialog.querySelector('[data-permission="screen_recording"]') as HTMLElement
    expect(within(row).getByRole('alert').textContent).toContain('with the minus button')
    expect(dialog.querySelector('[data-permission="accessibility"] [role="alert"]')).toBeNull()
    // A second try clears the old message first.
    mac.resetAnswer = null
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset and ask again for Screen Recording' }))
    await tick(10)
    expect(within(row).queryByRole('alert')).toBeNull()
  })

  it('"Not now" and Escape both mean no', async () => {
    for (const close of ['button', 'escape'] as const) {
      const view = render(createElement(ComputerControlHost))
      let answer: boolean | null = null
      act(() => { void askPermission('screen_recording').then((value) => { answer = value }) })
      await tick(10)
      const dialog = view.getByRole('group', { name: 'macOS has to allow this first' })
      if (close === 'button') fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }))
      else fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Not now' }), { key: 'Escape' })
      await tick(10)
      expect(answer).toBe(false)
      cleanup()
    }
  })

  it('already granted when the dialog opens (the refusal was stale): no waiting', async () => {
    mac.granted = { needed: true, accessibility: true, screenRecording: true }
    render(createElement(ComputerControlHost))
    let answer: boolean | null = null
    act(() => { void askPermission('accessibility').then((value) => { answer = value }) })
    await tick(10)
    expect(answer).toBe(true)
  })
})
