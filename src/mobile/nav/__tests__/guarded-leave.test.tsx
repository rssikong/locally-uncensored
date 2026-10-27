// @vitest-environment jsdom
/**
 * useGuardedLeave: back on a page with unsaved input asks first, and the
 * function the hook returns leaves without that question (after Save).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { __setNavSaveForTests, navApi } from '../api'
import { PageContext } from '../context'
import { activeStack } from '../core'
import { useGuardedLeave } from '../guarded-leave'
import { useNavStore } from '../store'

function Editor({ dirty }: { dirty: boolean }) {
  const leave = useGuardedLeave(dirty)
  return (
    <button type="button" onClick={leave}>
      Save
    </button>
  )
}

const leave = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

function mountEditor(dirty: boolean) {
  navApi.push('/dev/ui')
  const entry = activeStack(useNavStore.getState()).at(-1)!
  render(
    <PageContext.Provider value={{ entry, isTop: true, isRoot: false }}>
      <Editor dirty={dirty} />
    </PageContext.Provider>,
  )
  return entry
}

const topKey = () => activeStack(useNavStore.getState()).at(-1)?.key
const overlays = () => useNavStore.getState().overlays

beforeEach(() => {
  __setNavSaveForTests(false)
  while (overlays().length > 0) navApi.back()
})

afterEach(() => {
  cleanup()
  while (overlays().length > 0) {
    const top = overlays().at(-1)!
    if (top.kind === 'dialog') navApi.answerDialog(top.key, true)
    else navApi.closeSheet()
  }
})

describe('useGuardedLeave', () => {
  it('back on a page with unsaved input asks before it leaves', () => {
    const entry = mountEditor(true)
    act(() => {
      navApi.back()
    })
    expect(topKey()).toBe(entry.key)
    const dialog = overlays().at(-1)
    expect(dialog?.kind === 'dialog' ? dialog.dialog.title : null).toBe('Discard changes?')
  })

  it('the returned function leaves at once, without the question', () => {
    const entry = mountEditor(true)
    act(() => {
      leave()
    })
    expect(overlays()).toEqual([])
    expect(topKey()).not.toBe(entry.key)
  })

  it('a page without changes just goes back', () => {
    const entry = mountEditor(false)
    act(() => {
      navApi.back()
    })
    expect(overlays()).toEqual([])
    expect(topKey()).not.toBe(entry.key)
  })
})
