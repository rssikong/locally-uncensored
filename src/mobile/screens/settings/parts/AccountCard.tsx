/**
 * E1.1 the account card at the top of Settings: the profile picture where one
 * was chosen, email, plan and the credit bar, or the invitation to sign in. The whole card is one target and leads
 * to the Account page.
 */
import { ChevronRight, CircleUserRound } from 'lucide-react'
import { PAST_DUE_BADGE } from '../../../../lib/past-due'
import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { nav } from '../../../nav'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { Icon, Monogram, Progress, Spinner } from '../../../ui'
import { creditsView, planName } from './account-view'
import { storePolicy } from './policy'
import { UserAvatar } from './UserAvatar'

const T = SETTINGS_STRINGS.root
const A = SETTINGS_STRINGS.account

export function AccountCard() {
  const status = useCloudAuthStore((s) => s.status)
  const user = useCloudAuthStore((s) => s.user)
  const offline = useCloudAuthStore((s) => s.offline)
  const licenseActive = useCloudAuthStore((s) => s.licenseActive)
  const tier = useCloudAuthStore((s) => s.tier)
  const pastDue = useCloudAuthStore((s) => s.pastDue)
  const quota = useCloudAuthStore((s) => s.quota)

  const signedIn = status === 'signed-in' && !!user
  const credits = signedIn && licenseActive ? creditsView(quota) : null
  const state = status === 'probing' ? 'loading' : signedIn ? 'signed-in' : 'signed-out'

  let title: string = T.accountSignedOutTitle
  let sub: string = T.accountSignedOutText
  if (status === 'probing') {
    title = T.accountChecking
    sub = ''
  } else if (signedIn && user) {
    title = user.email ?? user.id
    // The name of a plan and a failed payment are words about buying; a build without them says "Active" or "not active".
    const words = storePolicy().pricingWords
    sub = offline ? T.accountOffline : licenseActive ? ((words ? planName(quota?.tier ?? tier) : null) ?? A.planActive) : pastDue && words ? PAST_DUE_BADGE : T.accountNoPlan
  }

  return (
    <button
      type="button"
      className="m-card"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--m-s3)', width: 'calc(100% - 2 * var(--m-gutter))', textAlign: 'left', marginTop: 'var(--m-s2)' }}
      aria-label={signedIn ? `${T.accountOpen}, ${title}` : T.accountSignedOutTitle}
      data-testid="m-settings-account"
      data-el="E1.1"
      data-state={state}
      onClick={() => nav.push('/settings/account')}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--m-s3)', minWidth: 0 }}>
        {status === 'probing' ? <Spinner label={T.accountChecking} /> : signedIn ? <UserAvatar size={28} fallback={<Icon icon={CircleUserRound} />} testid="m-settings-account-avatar" /> : <Monogram size={28} />}
        <span className="m-row-text">
          <span className="m-row-title" data-testid="m-settings-account-title">
            {title}
          </span>
          {sub ? <span className="m-row-sub">{sub}</span> : null}
        </span>
        <Icon icon={ChevronRight} small className="m-row-chev" />
      </span>
      {credits ? (
        <span style={{ display: 'block' }} data-testid={credits.empty ? 'm-settings-credits-empty' : 'm-settings-credits'}>
          <Progress
            label={A.credits}
            value={credits.share}
            tone="cloud"
            hidePercent
            detail={credits.empty ? A.creditsEmpty : A.creditsLeft(credits.left)}
            meta={A.creditsUsed(credits.used, credits.limit)}
            state={credits.empty ? 'error' : 'running'}
          />
        </span>
      ) : null}
    </button>
  )
}
