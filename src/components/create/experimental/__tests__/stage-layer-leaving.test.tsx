/**
 * @vitest-environment jsdom
 *
 * A face of the Create stage that is fading out takes no click (persona walk
 * of the Mac app, 09.10.2026, Fund 28).
 *
 * Image chosen and "Download & install" pressed at once started the VIDEO
 * setup: for the 120 ms of the cross-fade the leaving card was still on
 * screen with its own button.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/stage-layer-leaving.test.tsx
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { AnimatePresence } from 'framer-motion'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { StageLayer } from '../Stage'

afterEach(cleanup)

function Stage({ lane }: { lane: string }) {
  return (
    <AnimatePresence mode="wait">
      <StageLayer key={lane}>
        <button>{`Download & install (${lane})`}</button>
      </StageLayer>
    </AnimatePresence>
  )
}

describe('the face of the stage', () => {
  it('takes clicks while it is the one on screen', () => {
    const { getByText } = render(<Stage lane="video" />)
    const layer = getByText('Download & install (video)').parentElement!
    expect(layer.getAttribute('data-stage-layer')).toBe('present')
    expect(layer.hasAttribute('inert')).toBe(false)
    expect(layer.className).not.toContain('pointer-events-none')
  })

  it('is inert from the moment its lane is left, while it is still drawn', async () => {
    const { getByText, rerender } = render(<Stage lane="video" />)
    const button = getByText('Download & install (video)')
    await act(async () => { rerender(<Stage lane="image" />) })
    // mode="wait": the leaving face is still in the tree.
    expect(button.isConnected).toBe(true)
    const layer = button.parentElement!
    expect(layer.getAttribute('data-stage-layer')).toBe('leaving')
    expect(layer.hasAttribute('inert')).toBe(true)
    expect(layer.className).toContain('pointer-events-none')
  })

  it('is what the stage draws every lane in', () => {
    const source = readFileSync(resolve(__dirname, '../Stage.tsx'), 'utf-8')
    expect(source).toContain("<StageLayer key={intent + (isGenerating ? ':gen' : '')} footRoom={footLine}>{body}</StageLayer>")
  })
})
