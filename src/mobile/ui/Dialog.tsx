import { useId, useRef, useState } from 'react'
import { navApi } from '../nav/api'
import type { DialogEntry } from '../nav/types'
import { Button } from './Button'
import type { Risk } from './common'
import { Field } from './Field'
import { useFocusTrap } from './focus'
import { hyphenated } from './hyphenate'

/** Pure: the risk mark of the action button of a question. An explicit mark wins, else the tone says it. */
export function dialogRisk(spec: Pick<DialogEntry['dialog'], 'risk' | 'tone'>): Risk | undefined {
  if (spec.risk === 'none') return undefined
  if (spec.risk) return spec.risk
  return spec.tone === 'danger' ? 'destructive' : spec.tone === 'cloud' ? 'paid' : undefined
}

/**
 * The confirmation dialog (G3). Opened only through nav.confirm or
 * nav.prompt, so it holds a place in the back stack and back means the safe
 * answer. Centered, at most 340 px wide, buttons stacked at full width with
 * the action on top. It never closes by itself and has no scrim tap: a
 * question before something destructive wants an answer.
 */
export function Dialog({ entry, isTop }: { entry: DialogEntry; isTop: boolean }) {
  const spec = entry.dialog
  const titleId = useId()
  const textId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [typed, setTyped] = useState(spec.field?.initial ?? '')
  const [gate, setGate] = useState('')
  useFocusTrap(ref, isTop)

  const gateOpen = !spec.requireText || gate.trim() === spec.requireText
  const fieldOk = !spec.field || typed.trim().length > 0
  const confirm = () => {
    if (!gateOpen || !fieldOk) return
    navApi.answerDialog(entry.key, spec.field ? typed.trim() : true)
  }
  const cancel = () => navApi.answerDialog(entry.key, spec.field ? null : false)
  const variant = spec.tone === 'danger' ? 'danger' : spec.tone === 'cloud' ? 'cloud' : 'primary'

  return (
    <div className="m-scrim m-scrim--center">
      <div
        ref={ref}
        className="m-dlg"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={spec.text ? textId : undefined}
        tabIndex={-1}
        data-testid={spec.testid ? `m-dialog-${spec.testid}` : 'm-dialog'}
      >
        <h2 className="m-dlg-title" id={titleId}>
          {hyphenated(spec.title)}
        </h2>
        {spec.text ? (
          <p className="m-dlg-text" id={textId}>
            {spec.text}
          </p>
        ) : null}
        {spec.field ? (
          <div className="m-dlg-field">
            <Field label={spec.field.label} value={typed} onChange={setTyped} placeholder={spec.field.placeholder} onSubmit={confirm} autoFocus testid="m-dialog-field" />
          </div>
        ) : null}
        {spec.requireText ? (
          <div className="m-dlg-field">
            <Field label={`Type ${spec.requireText} to go on`} value={gate} onChange={setGate} autoComplete="off" testid="m-dialog-gate" />
          </div>
        ) : null}
        <div className="m-dlg-buttons">
          <Button variant={variant} block disabled={!gateOpen || !fieldOk} onPress={confirm} risk={dialogRisk(spec)} testid="m-dialog-confirm">
            {spec.confirmLabel}
          </Button>
          {/* The safe answer takes the focus, unless a field wants it. */}
          <Button block onPress={cancel} autoFocus={!spec.field} testid="m-dialog-cancel">
            {spec.cancelLabel ?? 'Cancel'}
          </Button>
        </div>
      </div>
    </div>
  )
}
