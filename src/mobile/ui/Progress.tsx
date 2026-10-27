import { cx, testProps, type Testable } from './common'

export interface ProgressProps extends Testable {
  /** Required accessible name ("Downloading Gemma 3 4B"). */
  label: string
  /** 0 to 1. Leave it out for an indeterminate ring. */
  value?: number
  /** Left under the bar, in mono: "38%" is added automatically unless `hidePercent`. */
  detail?: string
  /** Right under the bar, in mono: sizes or time left. */
  meta?: string
  state?: 'running' | 'paused' | 'error'
  tone?: 'accent' | 'cloud'
  hidePercent?: boolean
}

export function clampShare(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** A determinate bar with percent and sizes, or an indeterminate ring. */
export function Progress(props: ProgressProps) {
  const { label, value, detail, meta, state = 'running', tone = 'accent', hidePercent } = props
  if (value === undefined) {
    return (
      <span className="m-rowh" role="progressbar" aria-label={label} aria-busy="true" {...testProps(props)}>
        <span className="m-ring m-ring--lg" aria-hidden="true" />
        {detail ? <span className="m-cap">{detail}</span> : null}
      </span>
    )
  }
  const share = clampShare(value)
  const percent = Math.round(share * 100)
  const left = [hidePercent ? null : `${percent}%`, detail].filter(Boolean).join(' ')
  return (
    <div className="m-progress" {...testProps(props)}>
      <div
        className={cx('m-bar', tone === 'cloud' && 'm-bar--cloud', state === 'paused' && 'm-bar--paused', state === 'error' && 'm-bar--error')}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={state === 'paused' ? `${percent}%, paused` : `${percent}%`}
      >
        <i style={{ width: `${percent}%` }} />
      </div>
      {left || meta ? (
        <div className="m-progress-meta m-mono">
          <span>{left}</span>
          {meta ? <span>{meta}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

/** A small ring for inline use ("Loading Gemma 3 4B"). */
export function Spinner({ label }: { label: string }) {
  return <span className="m-ring" role="progressbar" aria-label={label} aria-busy="true" />
}
