// @vitest-environment jsdom
/**
 * Round 10: "No" on the age question is asked a second time before it is saved.
 *
 * The answer is for good: on iOS it sits in the Keychain and outlives the
 * app, so a slip of the finger locked the phone out (audit r7, point 13).
 * "No" now only opens a second question. Nothing is written until "Yes, I am
 * under 18", "Go back" returns to the first question, and the closed page
 * has no button at all. The same on both stores.
 *
 * Run: npx vitest run src/mobile/policy/__tests__/age-second-question.dom.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AgeGate } from '../AgeGate'
import { AGE_KEY, __resetAgeForTests, ageSaving, ageState, answerNo, confirmMinor, declareAge, readAgeFromDevice, takeBackNo } from '../age'
import { setAgeVaultForTests, type AgeVault } from '../age-vault'
import { setStorePresetForTests } from '../storePolicy'
import { POLICY } from '../../strings/policy'

/** A vault whose writes finish when the test says so. */
function fakeVault(start: string | null = null) {
  let stored = start
  const pending: Array<() => void> = []
  const vault: AgeVault = {
    available: () => true,
    load: vi.fn(async () => stored),
    save: vi.fn(
      (answer) =>
        new Promise<void>((resolve) => {
          pending.push(() => {
            stored = answer
            resolve()
          })
        }),
    ),
  }
  return {
    vault,
    stored: () => stored,
    confirm: async () => {
      for (const done of pending.splice(0)) done()
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

const noVault: AgeVault = { available: () => false, load: async () => null, save: async () => undefined }

beforeEach(() => {
  localStorage.clear()
  __resetAgeForTests()
})
afterEach(() => {
  cleanup()
  setAgeVaultForTests(null)
  setStorePresetForTests(null)
  __resetAgeForTests()
})

for (const preset of ['play', 'appstore'] as const) {
  describe(`the second question, preset ${preset}`, () => {
    beforeEach(() => setStorePresetForTests(preset))

    it('"No" saves nothing and shows the second question', async () => {
      const fake = fakeVault()
      setAgeVaultForTests(fake.vault)
      await readAgeFromDevice()
      expect(ageState()).toBe('ask')
      answerNo()
      expect(ageState()).toBe('confirm')
      expect(localStorage.getItem(AGE_KEY)).toBeNull()
      expect(fake.vault.save).not.toHaveBeenCalled()
      expect(ageSaving()).toBeNull()
    })

    it('"Go back" returns to the first question, still nothing saved, and "Yes" then lets in', async () => {
      const fake = fakeVault()
      setAgeVaultForTests(fake.vault)
      await readAgeFromDevice()
      answerNo()
      takeBackNo()
      expect(ageState()).toBe('ask')
      expect(localStorage.getItem(AGE_KEY)).toBeNull()
      expect(fake.vault.save).not.toHaveBeenCalled()
      const done = declareAge('adult')
      await fake.confirm()
      await done
      expect(ageState()).toBe('open')
      expect(fake.stored()).toBe('adult')
    })

    it('only "Yes, I am under 18" writes, the second question stays until the disk has it, then the app is closed', async () => {
      const fake = fakeVault()
      setAgeVaultForTests(fake.vault)
      await readAgeFromDevice()
      answerNo()
      const done = confirmMinor()
      expect(localStorage.getItem(AGE_KEY)).toBe('minor')
      expect(fake.vault.save).toHaveBeenCalledWith('minor')
      expect(ageState()).toBe('confirm')
      // While it is being written neither a way back nor a second write.
      takeBackNo()
      void confirmMinor()
      expect(ageState()).toBe('confirm')
      expect(fake.vault.save).toHaveBeenCalledTimes(1)
      await fake.confirm()
      await done
      expect(fake.stored()).toBe('minor')
      expect(ageState()).toBe('blocked')
      // The closed page has no way back.
      takeBackNo()
      answerNo()
      expect(ageState()).toBe('blocked')
    })

    it('the second answer cannot be given without the first', async () => {
      setAgeVaultForTests(noVault)
      await confirmMinor()
      expect(ageState()).toBe('ask')
      expect(localStorage.getItem(AGE_KEY)).toBeNull()
    })

    it('the doubt is not kept: a new start asks the first question again', async () => {
      setAgeVaultForTests(noVault)
      answerNo()
      expect(ageState()).toBe('confirm')
      // What a restart leaves: the storage, not the memory of the page.
      const kept = localStorage.getItem(AGE_KEY)
      __resetAgeForTests()
      if (kept) localStorage.setItem(AGE_KEY, kept)
      expect(ageState()).toBe('ask')
    })

    it('an earlier "No" on the device still closes the app while the second question shows', async () => {
      const fake = fakeVault('minor')
      setAgeVaultForTests(fake.vault)
      await readAgeFromDevice()
      expect(ageState()).toBe('blocked')
      answerNo()
      expect(ageState()).toBe('blocked')
    })

    it('on the page: No, the second question with its two answers, Go back, No again, confirm, closed without a button', async () => {
      setAgeVaultForTests(noVault)
      render(
        <AgeGate>
          <div data-testid="the-app" />
        </AgeGate>,
      )
      expect(screen.getByTestId('m-age-ask').textContent).toContain('stays on this device')
      fireEvent.click(screen.getByTestId('m-age-no'))
      const second = screen.getByTestId('m-age-confirm')
      expect(`${second.querySelector('h2')!.textContent}. ${second.querySelector('p')!.textContent}`.replace(/­/g, '')).toBe(
        'You said you are under 18. LU will stay closed on this device. Is that right?',
      )
      expect(screen.getByTestId('m-age-gate').getAttribute('data-age')).toBe('confirm')
      expect(screen.getByTestId('m-age-confirm-back').textContent).toBe('Go back')
      expect(screen.getByTestId('m-age-confirm-minor').textContent).toBe('Yes, I am under 18')
      // The answer that cannot be undone carries the mark that keeps the sweep off it.
      expect(screen.getByTestId('m-age-confirm-minor').getAttribute('data-m-risk')).toBe('destructive')
      expect(screen.queryByTestId('m-age-yes')).toBeNull()
      expect(localStorage.getItem(AGE_KEY)).toBeNull()

      fireEvent.click(screen.getByTestId('m-age-confirm-back'))
      expect(screen.getByTestId('m-age-ask')).toBeTruthy()
      expect(screen.queryByTestId('m-age-confirm')).toBeNull()
      expect(localStorage.getItem(AGE_KEY)).toBeNull()

      fireEvent.click(screen.getByTestId('m-age-no'))
      await act(async () => {
        fireEvent.click(screen.getByTestId('m-age-confirm-minor'))
      })
      expect(screen.getByTestId('m-age-blocked')).toBeTruthy()
      expect(localStorage.getItem(AGE_KEY)).toBe('minor')
      expect(screen.queryAllByRole('button')).toEqual([])
      expect(screen.queryByTestId('the-app')).toBeNull()
    })
  })
}

describe('the words', () => {
  it('the question says that the answer stays on the device, and no text has a long dash', () => {
    expect(POLICY.ageText).toContain('Your answer is saved on this phone and stays on this device.')
    for (const text of [POLICY.ageText, POLICY.ageConfirmTitle, POLICY.ageConfirmText, POLICY.ageConfirmBack, POLICY.ageConfirmMinor, POLICY.ageBlockedText]) {
      expect(text).not.toMatch(/[–—]/)
    }
  })
})
