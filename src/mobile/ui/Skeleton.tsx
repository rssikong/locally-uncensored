import { testProps, type Testable } from './common'

/** One grey bar. Width in percent or any CSS length. No shimmer with reduced motion. */
export function Skeleton({ width = '100%', height = 14 }: { width?: string | number; height?: number }) {
  return <span className="m-skel" style={{ width, height }} aria-hidden="true" />
}

/** Placeholder rows while a list loads. The group is announced once as busy. */
export function SkeletonRows(props: { rows?: number; label?: string } & Testable) {
  const { rows = 4, label = 'Loading' } = props
  return (
    <div role="status" aria-busy="true" aria-label={label} {...testProps(props)}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="m-skel-row" key={i}>
          <Skeleton width={28} height={28} />
          <span className="m-skel-lines">
            <Skeleton width={`${70 - (i % 3) * 12}%`} />
            <Skeleton width={`${45 + (i % 2) * 15}%`} height={10} />
          </span>
        </div>
      ))}
    </div>
  )
}

/** Placeholder cards while a catalogue loads. */
export function SkeletonCards(props: { cards?: number; label?: string } & Testable) {
  const { cards = 3, label = 'Loading' } = props
  return (
    <div role="status" aria-busy="true" aria-label={label} {...testProps(props)}>
      {Array.from({ length: cards }, (_, i) => (
        <div className="m-card" key={i}>
          <span className="m-skel-lines">
            <Skeleton width="55%" height={18} />
            <Skeleton width="35%" height={10} />
            <Skeleton width="80%" />
          </span>
        </div>
      ))}
    </div>
  )
}
