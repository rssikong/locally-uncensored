/**
 * The profile picture of the user, wherever the app shows "you".
 *
 * The picture is chosen under Settings, Appearance (E4.2) and kept in the
 * settings as a small data URL (settings.userAvatarDataUrl, the same field
 * the desktop uses). Until now only that page showed it. This component is
 * the one way to draw it: the account card on top of Settings, the card on
 * the Account page, and (for the chat strand) the bubble of the user.
 * Without a picture it draws the fallback it was given, or nothing.
 */
import type { ReactNode } from 'react'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { testProps, type Testable } from '../../../ui'

/** Pure: only a picture this app made itself is drawn (an image data URL), never an address from somewhere. */
export function usableAvatar(value: unknown): string | null {
  return typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null
}

/** The picture the user chose, or null. For a screen that draws it its own way. */
export function useUserAvatar(): string | null {
  return usableAvatar(useSettingsStore((s) => s.settings.userAvatarDataUrl))
}

export interface UserAvatarProps extends Testable {
  /** Edge length in px. Default 28, the size of a row icon. */
  size?: number
  /** Drawn when the user chose no picture. */
  fallback?: ReactNode
  /** Text for screen readers. Left out, the picture is decoration next to a name that is already read. */
  label?: string
}

export function UserAvatar(props: UserAvatarProps) {
  const { size = 28, fallback = null, label } = props
  const avatar = useUserAvatar()
  if (!avatar) return <>{fallback}</>
  return (
    <img
      src={avatar}
      alt={label ?? ''}
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none', display: 'block' }}
      {...testProps(props)}
    />
  )
}
