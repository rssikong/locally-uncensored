import { useId, type HTMLAttributes, type ReactNode } from 'react'
import { Clipboard, X } from 'lucide-react'
import { testProps, type Testable } from './common'
import { Icon, type IconType } from './Icon'
import { IconButton } from './IconButton'
import { pasteInto } from './paste'

interface FieldBase extends Testable {
  /** Required. Shown above the field, or used as aria-label when `hideLabel` is set. */
  label: string
  hideLabel?: boolean
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Shown under the field in red, and announced. The text the user typed stays. */
  error?: string
  hint?: string
  disabled?: boolean
  autoFocus?: boolean
}

export interface FieldProps extends FieldBase {
  type?: 'text' | 'email' | 'password' | 'search' | 'url' | 'tel'
  /** Picks the keyboard: "numeric" for a passcode, "url" for an address. */
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']
  autoComplete?: string
  /** An icon in front (search). */
  icon?: IconType
  /** "Clear" button while there is text. The only one: the small cross a search field of the engine brings is switched off (styles/reset.css). */
  clearable?: boolean
  /** "Paste" button, for key fields. */
  pasteable?: boolean
  /** Something at the end, for example a "Show" button of a password field. */
  trailing?: ReactNode
  onSubmit?: () => void
  maxLength?: number
}

function Frame(props: { label: string; hideLabel?: boolean; id: string; error?: string; hint?: string; children: ReactNode }) {
  const { label, hideLabel, id, error, hint, children } = props
  return (
    <div className="m-fieldset">
      {hideLabel ? null : (
        <label className="m-field-label" htmlFor={id}>
          {label}
        </label>
      )}
      {children}
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

export function Field(props: FieldProps) {
  const { label, hideLabel, value, onChange, placeholder, error, hint, disabled, autoFocus, type = 'text', inputMode, autoComplete = 'off', icon, clearable, pasteable, trailing, onSubmit, maxLength } = props
  const id = useId()
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined
  const hasEnd = (clearable && value) || pasteable || trailing
  return (
    <Frame label={label} hideLabel={hideLabel} id={id} error={error} hint={hint}>
      <div className="m-field" data-invalid={error ? '' : undefined}>
        {icon ? <Icon icon={icon} small /> : null}
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          inputMode={inputMode}
          autoComplete={autoComplete}
          autoCapitalize={type === 'text' ? undefined : 'none'}
          autoCorrect={type === 'text' ? undefined : 'off'}
          spellCheck={type === 'text' ? undefined : false}
          enterKeyHint={type === 'search' ? 'search' : onSubmit ? 'go' : undefined}
          maxLength={maxLength}
          aria-label={hideLabel ? label : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          data-m-autofocus={autoFocus ? '' : undefined}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onSubmit) {
              event.preventDefault()
              onSubmit()
            }
          }}
          {...testProps(props)}
        />
        {pasteable && !value ? (
          <IconButton
            icon={Clipboard}
            label={`Paste into ${label}`}
            onPress={() => void pasteInto(onChange, document.getElementById(id))}
          />
        ) : null}
        {clearable && value ? <IconButton icon={X} label={`Clear ${label}`} onPress={() => onChange('')} /> : null}
        {trailing}
        {hasEnd ? null : <span className="m-field-pad" />}
      </div>
    </Frame>
  )
}

export interface TextAreaProps extends FieldBase {
  rows?: number
  maxLength?: number
}

export function TextArea(props: TextAreaProps) {
  const { label, hideLabel, value, onChange, placeholder, error, hint, disabled, autoFocus, rows = 4, maxLength } = props
  const id = useId()
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined
  return (
    <Frame label={label} hideLabel={hideLabel} id={id} error={error} hint={hint}>
      <div className="m-textarea" data-invalid={error ? '' : undefined}>
        <textarea
          id={id}
          rows={rows}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          aria-label={hideLabel ? label : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          data-m-autofocus={autoFocus ? '' : undefined}
          onChange={(event) => onChange(event.target.value)}
          {...testProps(props)}
        />
      </div>
    </Frame>
  )
}
