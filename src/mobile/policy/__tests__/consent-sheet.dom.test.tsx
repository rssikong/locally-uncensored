// @vitest-environment jsdom
/**
 * Round 28, R5 (Apple 5.1.2(i)): the sheet before the first content goes to
 * LU Cloud says that it goes on to third-party AI providers and links the
 * privacy policy, in every preset. A yes to the older text counts no more.
 *
 * Run: npx vitest run src/mobile/policy/__tests__/consent-sheet.dom.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const openExternalMock = vi.hoisted(() => vi.fn(async (_url: string) => ({ opened: true })))
vi.mock('../../platform/open-external', async (original) => ({ ...(await original<typeof import('../../platform/open-external')>()), openExternal: openExternalMock }))

import { POLICY } from '../../strings/policy'
import ConsentSheet from '../ConsentSheet'
import { CONSENT_VERSION } from '../consent'
import { LEGAL_LINKS } from '../links'
import { setStorePresetForTests } from '../storePolicy'

afterEach(() => {
  cleanup()
  setStorePresetForTests(null)
  openExternalMock.mockClear()
})

describe('R5: the consent names third-party AI providers and links the privacy policy', () => {
  it('the text says that content goes on to third-party AI providers, and names none', () => {
    expect(POLICY.consentText).toMatch(/third-party AI providers/)
    expect(POLICY.consentText).not.toMatch(/fal\b|OpenAI|Anthropic|Google|RunPod|Together|Replicate|OpenRouter/i)
  })

  it('a yes to the text before round 28 is asked again', () => {
    expect(CONSENT_VERSION).toBeGreaterThanOrEqual(2)
  })

  for (const preset of ['open', 'play', 'appstore'] as const) {
    it(`${preset}: the sheet shows the text and opens the privacy policy`, async () => {
      setStorePresetForTests(preset)
      render(<ConsentSheet />)
      expect(screen.getByTestId('m-consent-text').textContent).toContain('third-party AI providers')
      fireEvent.click(screen.getByTestId('m-consent-privacy'))
      await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalledWith(LEGAL_LINKS.privacy))
    })
  }
})

describe('round 30, H1: the link to the privacy policy stands in the footer, not at the end of the scrolling text', () => {
  it('in the footer with the two answers, before them', () => {
    render(<ConsentSheet />)
    const link = screen.getByTestId('m-consent-privacy')
    expect(screen.getByTestId('m-consent-text').contains(link)).toBe(false)
    const actions = link.closest('.m-policy-actions')
    expect(actions).not.toBeNull()
    expect([...(actions as Element).querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid'))).toEqual(['m-consent-privacy', 'm-consent-agree', 'm-consent-decline'])
  })
})
