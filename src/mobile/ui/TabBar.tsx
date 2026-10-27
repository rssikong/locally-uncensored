import { useRef } from 'react'
import { Box, Image, MessageSquare, Settings } from 'lucide-react'
import type { Tab } from '../nav/types'
import { Icon, type IconType } from './Icon'

export interface TabBadge {
  /** What runs, in words, added to the name: "Models, 1 download running". */
  description: string
}

export interface TabBarProps {
  active: Tab
  onSelect: (tab: Tab) => void
  /** Dots for running work, by tab. */
  badges?: Partial<Record<Tab, TabBadge | null>>
}

export const TAB_ITEMS: ReadonlyArray<{ tab: Tab; label: string; icon: IconType }> = [
  { tab: 'chat', label: 'Chat', icon: MessageSquare },
  { tab: 'create', label: 'Create', icon: Image },
  { tab: 'models', label: 'Models', icon: Box },
  { tab: 'settings', label: 'Settings', icon: Settings },
]

/** Pure: the accessible name of a tab, with what runs behind it. */
export function tabName(label: string, badge?: TabBadge | null): string {
  return badge ? `${label}, ${badge.description}` : label
}

/** A click this soon after a tap that already switched is the same tap. */
export const TAP_ECHO_MS = 800

/**
 * Pure: is this click the second half of a tap that has already been taken on lift-off.
 * `taken` is the tab and the time of that tap.
 */
export function isTapEcho(taken: { tab: Tab; at: number } | null, tab: Tab, now: number): boolean {
  return !!taken && taken.tab === tab && now - taken.at >= 0 && now - taken.at < TAP_ECHO_MS
}

/**
 * The four tabs. A bar at the bottom, a rail at the left in landscape (the
 * switch is pure CSS, styles/base.css). It comes last in the reading order.
 */
export function TabBar({ active, onSelect, badges }: TabBarProps) {
  // A finger that goes down and up on the same tab switches on lift-off. The browser sends the click after that,
  // and on a phone it may not: right after a model arrived (download, load, a toast coming in) the first tap on
  // "Chat" reached the page as a touch and no click followed (check on the iPhone, round 23, N14). The click that
  // does come is the same tap and is ignored.
  const down = useRef<Tab | null>(null)
  const taken = useRef<{ tab: Tab; at: number } | null>(null)
  return (
    <nav className="m-tabbar" role="tablist" aria-label="Sections" data-testid="m-nav">
      {TAB_ITEMS.map(({ tab, label, icon }) => {
        const badge = badges?.[tab]
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            className="m-tab"
            aria-selected={active === tab}
            aria-label={tabName(label, badge)}
            data-testid={`m-nav-${tab}`}
            data-el={`G1.${TAB_ITEMS.findIndex((t) => t.tab === tab) + 1}`}
            onPointerDown={(event) => {
              down.current = event.pointerType === 'touch' ? tab : null
            }}
            onPointerCancel={() => {
              down.current = null
            }}
            onPointerUp={(event) => {
              const armed = down.current === tab
              down.current = null
              if (!armed || event.pointerType !== 'touch') return
              const box = event.currentTarget.getBoundingClientRect()
              if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) return
              taken.current = { tab, at: Date.now() }
              onSelect(tab)
            }}
            onClick={() => {
              if (isTapEcho(taken.current, tab, Date.now())) {
                taken.current = null
                return
              }
              onSelect(tab)
            }}
          >
            <span className="m-tab-icon">
              <Icon icon={icon} />
              {badge ? <span className="m-tab-dot" aria-hidden="true" /> : null}
            </span>
            <span className="m-tab-label" aria-hidden="true">
              {label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
