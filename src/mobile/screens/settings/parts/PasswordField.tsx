/**
 * A password field with "Show" (E2.3) and a key field that never shows what
 * is saved (E12.3).
 *
 * ui/Field switches automatic capitals off only while its type is not
 * "text". A password that is shown IS type "text", so the keyboard would
 * start it with a capital letter. This field keeps capitals, correction and
 * spell check off in both states. Same classes as ui/Field; the wish to fold
 * it into ui/ is in mobile-docs/geruest-wuensche/settings.md.
 */
import { useId, useState } from 'react'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { Button, testProps, type Testable } from '../../../ui'
import { pasteInto } from '../../../ui/paste'

export interface SecretFieldProps extends Testable {
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  placeholder?: string
  error?: string
  hint?: string
  disabled?: boolean
  onSubmit?: () => void
  /** testid of the Show button. */
  showTestid?: string
  /**
   * A key field: there is no "Show" at all, what is typed stays dots. In its
   * place sits "Paste" while the field is empty, with this text and testid.
   */
  paste?: { label: string; testid?: string }
}

const T = SETTINGS_STRINGS.account

export function SecretField(props: SecretFieldProps) {
  const { label, value, onChange, autoComplete, placeholder, error, hint, disabled, onSubmit, showTestid, paste } = props
  const id = useId()
  const [shown, setShown] = useState(false)
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined
  return (
    <div className="m-fieldset">
      <label className="m-field-label" htmlFor={id}>
        {label}
      </label>
      <div className="m-field" data-invalid={error ? '' : undefined}>
        <input
          id={id}
          type={shown && !paste ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={onSubmit ? 'go' : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onSubmit) {
              event.preventDefault()
              onSubmit()
            }
          }}
          {...testProps(props)}
        />
        {paste ? (
          value ? (
            <span className="m-field-pad" />
          ) : (
            <Button
              compact
              variant="quiet"
              onPress={() => void pasteInto(onChange, document.getElementById(id))}
              testid={paste.testid}
            >
              {paste.label}
            </Button>
          )
        ) : (
          <Button compact variant="quiet" onPress={() => setShown((v) => !v)} label={shown ? T.hidePassword : T.showPassword} testid={showTestid}>
            {shown ? T.hide : T.show}
          </Button>
        )}
      </div>
      {error ? (
        <span className="m-field-error" id={`${id}-err`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="m-field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}
