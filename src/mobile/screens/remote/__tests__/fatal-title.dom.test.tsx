// @vitest-environment jsdom
/**
 * G4, the error screen: one title, and the right one. "LU could not start."
 * for a start that failed, "LU ran into a problem." for an error while the
 * app was running (wish 10 in mobile-docs/geruest-wuensche/remote.md). The
 * risk mark of the reset sits on the button itself (find M2b).
 *
 * Run: npx vitest run src/mobile/screens/remote/__tests__/fatal-title.dom.test.tsx
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FatalScreen } from '../../../resilience/FatalScreen'
import { COMMON } from '../../../strings/common'

afterEach(cleanup)

const titles = () => Array.from(document.querySelectorAll('h1, h2, h3')).map((h) => h.textContent)

describe('the title of the error screen', () => {
  it('a start that failed', () => {
    render(<FatalScreen error={new Error('boot')} />)
    expect(titles()).toEqual([COMMON.fatalTitle])
    expect(screen.getByTestId('m-fatal-screen').textContent).toContain(COMMON.fatalText)
    expect(screen.getByTestId('m-fatal-screen').textContent).not.toContain(COMMON.fatalRunningText)
  })

  it('an error while the app was running', () => {
    render(<FatalScreen error={new Error('render')} running />)
    expect(titles()).toEqual([COMMON.fatalRunningTitle])
    expect(screen.getByTestId('m-fatal-screen').textContent).toContain(COMMON.fatalRunningText)
    expect(screen.getByTestId('m-fatal-screen').textContent).not.toContain(COMMON.fatalTitle)
  })

  it('the boundary of the shell is the one that says "running", the boot is not', () => {
    const src = (rel: string) => readFileSync(resolve(__dirname, '../../..', rel), 'utf8')
    expect(src('MobileRoot.tsx')).toMatch(/<FatalScreen error=\{this\.state\.error\} running \/>/)
    expect(src('boot/index.tsx')).toMatch(/<FatalScreen error=\{error\} \/>/)
  })
})

describe('the reset of the error screen', () => {
  it('carries the risk mark on the button, and no frame carries one', () => {
    render(<FatalScreen error="x" running />)
    fireEvent.click(screen.getByTestId('m-fatal-reset'))
    const confirm = screen.getByTestId('m-fatal-reset-confirm')
    expect(confirm.tagName).toBe('BUTTON')
    expect(confirm.getAttribute('data-m-risk')).toBe('destructive')
    expect(document.querySelectorAll('[data-m-risk]')).toHaveLength(1)
  })
})
