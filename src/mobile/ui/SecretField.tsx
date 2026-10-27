/**
 * A password field with "Show" and a key field that never shows what is
 * saved.
 *
 * ui/Field switches automatic capitals off only while its type is not
 * "text". A password that is shown IS type "text", so the keyboard would
 * start it with a capital letter. This field keeps capitals, correction and
 * spell check off in both states.
 */
import { useId, useState } from 'react'
import { pasteInto } from './paste'
import { COMMON } from '../strings/common'
import { Button } from './Button'
import { testProps, type Testable } from './common'

export interface SecretFieldProps extends Testable {
  label: string
  value: string
  onChange: (value: string) => void
  /** "current-password", "new-password", or "off" for a key. */
  autoComplete: string
  placeholder?: string
  /** Shown under the field in red, and announced. The text the user typed stays. */
  error?: string
  hint?: string
  disabled?: boolean
  onSubmit?: () => void
  /**
   * password  "Show" and "Hide" at the end (default).
   * key       there is no "Show" at all, what is typed stays dots. "Paste" sits at the end while the field is empty.
   */
  kind?: 'password' | 'key'
  /** data-testid of the button at the end (Show, or Paste). */
  actionTestid?: string
  /** Other words on the paste button of a key field ("Paste key"). */
  pasteLabel?: string
}

export function SecretField(props: SecretFieldProps) {
  const { label, value, onChange, autoComplete, placeholder, error, hint, disabled, onSubmit, kind = 'password', actionTestid, pasteLabel } = props
  const id = useId()
  const [shown, setShown] = useState(false)
  const isKey = kind === 'key'
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined
  return (
    <div className="m-fieldset">
      <label className="m-field-label" htmlFor={id}>
        {label}
      </label>
      <div className="m-field" data-invalid={error ? '' : undefined}>
        <input
          id={id}
          type={shown && !isKey ? 'text' : 'password'}
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
        {isKey ? (
          value ? (
            <span className="m-field-pad" />
          ) : (
            <Button
              compact
              variant="quiet"
              disabled={disabled}
              onPress={() => void pasteInto(onChange, document.getElementById(id))}
              testid={actionTestid}
            >
              {pasteLabel ?? COMMON.paste}
            </Button>
          )
        ) : (
          <Button compact variant="quiet" onPress={() => setShown((v) => !v)} label={shown ? COMMON.hidePassword : COMMON.showPassword} testid={actionTestid}>
            {shown ? COMMON.hide : COMMON.show}
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
