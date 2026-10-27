import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { ArrowUp, Mic, Square } from 'lucide-react'
import { haptic } from '../platform/haptics'
import { cx, riskProps, testProps, type Risk, type Testable } from './common'
import { Icon } from './Icon'
import { installRoom } from './room'

export interface ComposerProps extends Testable {
  value: string
  onChange: (value: string) => void
  /** Accessible name of the text field, default "Message". */
  label?: string
  placeholder?: string
  onSend: () => void
  /** A run is going: the shared slot shows Stop. */
  running?: boolean
  onStop?: () => void
  /** With an empty field the shared slot shows the microphone. Leave it out and the slot shows a disabled Send. */
  onDictate?: () => void
  /** Something other than text makes the message sendable (an attachment). */
  hasAttachment?: boolean
  /** Send is not possible right now, with the reason for the accessible name ("No internet"). */
  sendBlocked?: string
  /** Name of the send button, default "Send". Create uses "Create". */
  sendLabel?: string
  /** What sending costs, written as data-m-risk on the send button ("paid" while a cloud model is chosen). */
  risk?: Risk
  /** The mark of the microphone. The chat sets "paid" always: it records, and with LU Cloud the recording costs credits. */
  micRisk?: Risk
  /** Chips above the field (Agent, documents, persona). Folded away while the keyboard is open and the screen is short (ui/room.ts). */
  status?: ReactNode
  /** Attachment chips between status and field. */
  attachments?: ReactNode
  /** Left of the model choice: Attach and Chat options as IconButtons. */
  leading?: ReactNode
  /** The ModelChip. Takes the rest of the row, and a row of its own below 16rem. */
  model?: ReactNode
  /** Cloud mode paints the border in cloud violet. */
  cloud?: boolean
  /** Shown instead of the text field (the dictation meter). */
  replaceField?: ReactNode
  /**
   * A dictation is going. The slot stays the microphone until its text is in the field, also when the field
   * already held text: Send never takes its place while a tap may still be meant for the microphone. While the
   * take is written down the microphone is busy and takes no tap (mobile round 48).
   */
  dictation?: 'recording' | 'transcribing'
  disabled?: boolean
  /** Prefix for the data-testids of the parts, default "m-chat": m-chat-input, m-chat-send, m-chat-stop, m-chat-mic. */
  idPrefix?: string
}

/**
 * Send and Stop keep the focus in the field (A17, found in the Android
 * emulator against a real desktop): pressing them used to move the focus,
 * the keyboard closed under the finger, the page grew by its height, and the
 * first tap only closed the keyboard. The click itself is not touched.
 */
export function keepFocus(event: { preventDefault: () => void }): void {
  event.preventDefault()
}

export type ComposerSlot = 'stop' | 'send' | 'mic'

/** Pure: what the shared slot shows. Empty field: microphone. Text or attachment: Send. Running: Stop. */
export function composerSlot(input: { running?: boolean; text: string; hasAttachment?: boolean; canDictate: boolean; dictation?: 'recording' | 'transcribing' }): ComposerSlot {
  if (input.running) return 'stop'
  if (input.dictation && input.canDictate) return 'mic'
  if (input.text.trim().length > 0 || input.hasAttachment) return 'send'
  return input.canDictate ? 'mic' : 'send'
}

/**
 * The input of C2, R4, C9 and K1: status row, text field, control row with
 * one shared slot for Dictate, Send and Stop. The slot never changes size.
 * With the phone on its side the status row moves into the control row and
 * the field keeps to one or two lines, so the whole input takes at most a
 * third of the height. Where the keyboard leaves very little room (a phone
 * on its side, the largest text) the input is one row: field and Send, so
 * Send is never under the keyboard (ui/room.ts).
 */
export function Composer(props: ComposerProps) {
  const { value, onChange, label = 'Message', placeholder, onSend, running, onStop, onDictate, hasAttachment, sendBlocked, sendLabel = 'Send', status, attachments, leading, model, cloud, replaceField, disabled, idPrefix = 'm-chat', risk, micRisk, dictation } = props
  const ref = useRef<HTMLTextAreaElement>(null)
  const slot = composerSlot({ running, text: value, hasAttachment, canDictate: !!onDictate, dictation })
  const canSend = value.trim().length > 0 || !!hasAttachment

  useEffect(installRoom, [])

  useLayoutEffect(() => {
    // Grow with the text up to the max-height from the stylesheet (6 lines), then scroll.
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <div className="m-composer-wrap" {...testProps(props)}>
      <div className={cx('m-composer', cloud && 'm-composer--cloud')}>
        {status || attachments ? (
          // One box for both rows: on its side the phone puts it into the control row (styles/components.css).
          <div className="m-composer-top">
            {status ? <div className="m-composer-status m-composer-status--chips">{status}</div> : null}
            {attachments ? <div className="m-composer-status">{attachments}</div> : null}
          </div>
        ) : null}
        {replaceField ?? (
          <textarea
            ref={ref}
            rows={1}
            value={value}
            placeholder={placeholder ?? label}
            aria-label={label}
            disabled={disabled}
            data-testid={`${idPrefix}-input`}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        <div className="m-composer-row">
          {leading}
          {model ?? <span className="m-composer-spacer" />}
          {/* One element per face of the slot (key): a tap that went down on the microphone and comes up after the
              text landed never completes on Send, the browser sends no click to an element the finger did not press
              (mobile round 48). */}
          {slot === 'stop' ? (
            <button
              key="stop"
              type="button"
              className="m-send m-send--stop"
              aria-label="Stop"
              data-testid={`${idPrefix}-stop`}
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={() => {
                haptic('light')
                onStop?.()
              }}
            >
              <Icon icon={Square} small />
            </button>
          ) : slot === 'mic' ? (
            <button
              key="mic"
              type="button"
              className="m-send m-send--mic"
              aria-label="Dictate"
              aria-busy={dictation === 'transcribing' || undefined}
              disabled={disabled || dictation === 'transcribing'}
              data-testid={`${idPrefix}-mic`}
              data-m-dictation={dictation}
              {...riskProps(micRisk)}
              onClick={onDictate}
            >
              <Icon icon={Mic} />
            </button>
          ) : (
            <button
              key="send"
              type="button"
              className="m-send"
              aria-label={sendBlocked ? `${sendLabel}, ${sendBlocked}` : sendLabel}
              disabled={disabled || !canSend || !!sendBlocked}
              data-testid={`${idPrefix}-send`}
              {...riskProps(risk)}
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={() => {
                haptic('light')
                onSend()
              }}
            >
              <Icon icon={ArrowUp} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
