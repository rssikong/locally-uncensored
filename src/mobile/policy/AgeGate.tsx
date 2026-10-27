/**
 * The age question in front of everything else (switch ageGate).
 *
 * With 'declare-18' the app shows "Are you 18 or older?" before the
 * onboarding and before any service starts. Yes lets the app in, for good.
 * No opens a second question first ("You said you are under 18 ..."), because
 * the answer cannot be taken back on this device: "Go back" returns to the
 * first question with nothing saved, "Yes, I am under 18" saves and leads to
 * a quiet page that stays, also after a restart, and has no way back. With
 * 'none' this renders its children and nothing else.
 *
 * The two buttons sit in a footer of their own and the text scrolls above
 * it, so both answers stay on screen at 200 percent text, upright and on the
 * side. The page moves on only after the answer is confirmed on the disk
 * (policy/age.ts); until then the tapped button shows that it is working.
 */
import type { ReactNode } from 'react'
import { POLICY } from '../strings/policy'
import { Button, EmptyState } from '../ui'
import { answerNo, confirmMinor, declareAge, takeBackNo, useAgeSaving, useAgeState } from './age'

export function AgeGate({ children }: { children: ReactNode }) {
  const state = useAgeState()
  const saving = useAgeSaving()
  if (state === 'open') return <>{children}</>
  return (
    <div className="m-app" data-testid="m-age-gate" data-age={state} aria-busy={state === 'checking' || undefined}>
      <div className="m-stack">
        <div className="m-page">
          {state === 'checking' ? null : (
            <main className="m-body m-age-body" data-m-scroll-hint="">
              {state === 'ask' ? (
                <EmptyState title={POLICY.ageTitle} testid="m-age-ask">
                  {POLICY.ageText}
                </EmptyState>
              ) : state === 'confirm' ? (
                <EmptyState title={POLICY.ageConfirmTitle} testid="m-age-confirm">
                  {POLICY.ageConfirmText}
                </EmptyState>
              ) : (
                <EmptyState title={POLICY.ageBlockedTitle} testid="m-age-blocked">
                  {POLICY.ageBlockedText}
                </EmptyState>
              )}
            </main>
          )}
          {state === 'ask' ? (
            <footer className="m-foot m-age-foot" data-testid="m-age-actions">
              <Button variant="primary" block busy={saving === 'adult'} disabled={saving === 'minor'} onPress={() => void declareAge('adult')} testid="m-age-yes">
                {POLICY.ageYes}
              </Button>
              <Button block busy={saving === 'minor'} disabled={saving === 'adult'} onPress={answerNo} testid="m-age-no">
                {POLICY.ageNo}
              </Button>
            </footer>
          ) : state === 'confirm' ? (
            <footer className="m-foot m-age-foot" data-testid="m-age-actions">
              <Button variant="primary" block disabled={saving === 'minor'} onPress={takeBackNo} testid="m-age-confirm-back">
                {POLICY.ageConfirmBack}
              </Button>
              <Button block busy={saving === 'minor'} onPress={() => void confirmMinor()} risk="destructive" testid="m-age-confirm-minor">
                {POLICY.ageConfirmMinor}
              </Button>
            </footer>
          ) : null}
        </div>
      </div>
    </div>
  )
}
