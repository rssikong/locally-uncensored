/** The two progress dashes of the setup steps (A2, A3). */
import { MODELS_STRINGS as S } from '../../../strings/models'

export function Steps({ step }: { step: 1 | 2 }) {
  const dash = (on: boolean) => ({ flex: '1 1 0', height: 3, borderRadius: 2, background: on ? 'var(--m-accent)' : 'var(--m-hair)' })
  return (
    <div className="m-pad" style={{ marginBottom: 'var(--m-s4)' }} role="img" aria-label={step === 1 ? S.setupModel.step : S.setupDocs.step} data-testid="m-onboarding-steps" data-state={String(step)}>
      <div style={{ display: 'flex', gap: 'var(--m-s2)' }}>
        <span style={dash(true)} />
        <span style={dash(step === 2)} />
      </div>
    </div>
  )
}
