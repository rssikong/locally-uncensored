import type { ComponentType, SVGProps } from 'react'
import { cx } from './common'

/** Any lucide icon. Size comes from --m-icon, so it grows a little with the text and stops at 28 px. */
export type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>

export function Icon({ icon: Glyph, small, className }: { icon: IconType; small?: boolean; className?: string }) {
  return <Glyph className={cx('m-icon', small && 'm-icon--sm', className)} aria-hidden="true" focusable="false" />
}

/**
 * The LU monogram. The file is the one the desktop uses (public/LU-monogram.svg),
 * drawn through a mask so it takes the text colour in both themes.
 *
 * The mark stands alone: no screen writes the name of the product as a line of its own under it
 * (David, 10.10.2026; guard in e2e/mobile/mitte.mobile.ts). Where the mark is all there is of the
 * name (welcome, about), `label` gives it to a screen reader. Next to a heading or a sentence that
 * says what the page is about, the mark is decoration and stays silent.
 */
export function Monogram({ size = 18, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      className={cx('m-mono-mark', className)}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        backgroundColor: 'currentColor',
        WebkitMask: 'url(/LU-monogram.svg) center / contain no-repeat',
        mask: 'url(/LU-monogram.svg) center / contain no-repeat',
      }}
    />
  )
}
